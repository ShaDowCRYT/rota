import { createHash } from "node:crypto";

import type { TransactionRunner } from "../../db/types.js";
import { getErrorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { EmailSender } from "../../providers/email.js";
import type { CheckoutResult } from "./types.js";
import type { ActivityService } from "../activity/types.js";
import {
  NOTICE_LEVEL_DUE,
  NOTICE_LEVEL_REMINDER,
  nextState,
} from "./lifecycle.js";
import { applyVerifiedPayment } from "./paymentApply.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import type { PaymentRepository } from "./paymentRepository.js";
import type { BillingRepository } from "./types.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface BillingMaintenanceDeps {
  repository: BillingRepository;
  paymentRepository: PaymentRepository;
  transactions: TransactionRunner;
  provider: PaymentProvider;
  email: EmailSender;
  activity: ActivityService;
  currency: string;
  ensureRenewalCheckout: (
    teamId: string,
    paymentId: string,
    email: string,
  ) => Promise<CheckoutResult>;
  now: () => Date;
  limit?: number;
}

export interface BillingMaintenanceResult {
  subscriptionsChecked: number;
  transitionsApplied: number;
  renewalPaymentsCreated: number;
  noticesSent: number;
  restrictionsApplied: number;
  paymentsReconciled: number;
  checkoutLinksCreated: number;
}

function stableId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function noticeMessage(level: number): { subject: string; text: string } {
  if (level === NOTICE_LEVEL_DUE) {
    return {
      subject: "Your Rota renewal is due",
      text: "Your Rota subscription renewed today. Please complete payment to keep full access.",
    };
  }
  if (level === NOTICE_LEVEL_REMINDER) {
    return {
      subject: "Rota renewal reminder",
      text: "Your Rota renewal is still unpaid. Please complete payment within two days.",
    };
  }
  return {
    subject: "Rota access will be restricted",
    text: "Your Rota renewal is still unpaid. Team access becomes read-only today.",
  };
}

export async function runBillingMaintenance(
  deps: BillingMaintenanceDeps,
): Promise<BillingMaintenanceResult> {
  const now = deps.now();
  const limit = deps.limit ?? 100;
  const result: BillingMaintenanceResult = {
    subscriptionsChecked: 0,
    transitionsApplied: 0,
    renewalPaymentsCreated: 0,
    noticesSent: 0,
    restrictionsApplied: 0,
    paymentsReconciled: 0,
    checkoutLinksCreated: 0,
  };

  const subscriptions = await deps.repository.listSubscriptionsForMaintenance(now, limit);
  for (const subscription of subscriptions) {
    result.subscriptionsChecked += 1;
    const transition = nextState({ subscription, now });
    if (!transition.changed) continue;

    const ownerId = await deps.repository.getTeamOwnerId(subscription.teamId);
    const ownerEmail = ownerId === undefined ? undefined : await deps.repository.getOwnerEmail(ownerId);
    const actorId = ownerId ?? "system";

    await deps.transactions(subscription.teamId, async (executor) => {
      await deps.repository.upsertSubscription(executor, {
        teamId: subscription.teamId,
        planId: transition.subscription.planId,
        seats: transition.subscription.seats,
        periodStart: transition.subscription.periodStart,
        periodEnd: transition.subscription.periodEnd,
        status: transition.subscription.status,
        pendingPlanId: transition.subscription.pendingPlanId,
        pendingSeats: transition.subscription.pendingSeats,
        graceEndsAt: transition.subscription.graceEndsAt,
        lastNotice: transition.subscription.lastNotice,
      });

      for (const action of transition.actions) {
        if (action.type === "create_renewal_payment") {
          if (ownerId === undefined) {
            logger.warn("billing renewal owner not found", { teamId: subscription.teamId });
            continue;
          }
          const paymentId = stableId(
            `${subscription.teamId}:${action.quote.periodStart}:${action.quote.periodEnd}`,
          );
          const txRef = `rota.${subscription.teamId}.${paymentId}`;
          const created = await deps.paymentRepository.insertRenewalPaymentIfMissing(executor, {
            id: paymentId,
            teamId: subscription.teamId,
            txRef,
            kind: "renewal",
            amountCents: action.quote.amountCents,
            currency: deps.currency,
            planId: action.quote.planId,
            seats: action.quote.seats,
            quote: action.quote,
            createdBy: ownerId,
          });
          if (created) result.renewalPaymentsCreated += 1;
          continue;
        }

        if (action.type === "notify_owner") {
          await deps.activity.record(executor, {
            teamId: subscription.teamId,
            type:
              action.noticeLevel === NOTICE_LEVEL_DUE
                ? "billing_renewal_due"
                : action.noticeLevel === NOTICE_LEVEL_REMINDER
                  ? "billing_renewal_reminder"
                  : "billing_renewal_final_notice",
            actorId,
            payload: { noticeLevel: action.noticeLevel },
          });
          if (ownerEmail !== undefined) {
            const message = noticeMessage(action.noticeLevel);
            await deps.email.send({ to: ownerEmail, subject: message.subject, text: message.text });
            result.noticesSent += 1;
          }
          continue;
        }

        await deps.activity.record(executor, {
          teamId: subscription.teamId,
          type: "billing_access_restricted",
          actorId,
          payload: { reason: "renewal_unpaid" },
        });
        result.restrictionsApplied += 1;
      }
    });

    result.transitionsApplied += 1;
  }

  const staleBefore = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
  const pendingRenewals = await deps.paymentRepository.listPendingRenewals(staleBefore, limit);
  for (const payment of pendingRenewals) {
    try {
      const verified = await deps.provider.verifyByReference(payment.txRef);
      const applied = await applyVerifiedPayment(
        {
          paymentRepository: deps.paymentRepository,
          repository: deps.repository,
          transactions: deps.transactions,
          activity: deps.activity,
          now: deps.now,
        },
        { teamId: payment.teamId, txRef: payment.txRef, verified },
      );
      if (applied !== "missing") result.paymentsReconciled += 1;
    } catch (error) {
      logger.warn("billing reconciliation attempt failed", {
        teamId: payment.teamId,
        txRef: payment.txRef,
        error: getErrorMessage(error),
      });
    }
  }

  const renewalsNeedingCheckout = await deps.paymentRepository.listRenewalsNeedingCheckout(
    staleBefore,
    limit,
  );
  for (const payment of renewalsNeedingCheckout) {
    const ownerId = await deps.repository.getTeamOwnerId(payment.teamId);
    const ownerEmail = ownerId === undefined ? undefined : await deps.repository.getOwnerEmail(ownerId);
    if (ownerEmail === undefined) continue;
    try {
      await deps.ensureRenewalCheckout(payment.teamId, payment.id, ownerEmail);
      result.checkoutLinksCreated += 1;
    } catch (error) {
      logger.warn("billing renewal checkout creation failed", {
        teamId: payment.teamId,
        paymentId: payment.id,
        error: getErrorMessage(error),
      });
    }
  }

  return result;
}

export function createBillingMaintenanceProcessor(deps: BillingMaintenanceDeps) {
  return async (): Promise<BillingMaintenanceResult> => {
    const result = await runBillingMaintenance(deps);
    logger.info("billing maintenance completed", { ...result });
    return result;
  };
}
