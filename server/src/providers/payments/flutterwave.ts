import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError } from "../../lib/errors.js";
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentProvider,
  VerifiedTransaction,
} from "./types.js";

export interface FlutterwaveConfig {
  secretKey: string;
  secretHash: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface FlutterwavePaymentResponse {
  status?: string;
  message?: string;
  data?: { link?: string };
}

interface FlutterwaveVerifyResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    tx_ref?: string;
    status?: string;
    amount?: number | string;
    currency?: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function centsToMajorString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("amount cents must be a non-negative integer");
  }
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function majorToCents(amount: number | string): number {
  const raw = typeof amount === "number" ? String(amount) : amount.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("invalid major amount");
  }
  const [wholePart, fractionPart = ""] = raw.split(".");
  const whole = Number.parseInt(wholePart, 10);
  const fraction = Number.parseInt(fractionPart.padEnd(2, "0").slice(0, 2), 10);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) {
    throw new Error("invalid major amount");
  }
  return whole * 100 + fraction;
}

export function verifyFlutterwaveHash(
  secretHash: string,
  receivedHash: string | undefined,
): boolean {
  if (typeof receivedHash !== "string" || receivedHash.length === 0) {
    return false;
  }
  const expected = Buffer.from(secretHash, "utf8");
  const received = Buffer.from(receivedHash, "utf8");
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text.length === 0 ? undefined : JSON.parse(text);
    } catch {
      throw new HttpError(502, "Payment provider unavailable");
    }
    if (!response.ok) {
      throw new HttpError(502, "Payment provider unavailable");
    }
    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Payment provider unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export function createFlutterwaveProvider(config: FlutterwaveConfig): PaymentProvider {
  const baseUrl = config.baseUrl ?? "https://api.flutterwave.com/v3";
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  return {
    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      const body = {
        tx_ref: input.txRef,
        amount: centsToMajorString(input.amountCents),
        currency: input.currency,
        redirect_url: input.redirectUrl,
        customer: { email: input.customerEmail },
        customizations: { title: input.title },
        meta: input.meta,
      };
      const response = await fetchJson<FlutterwavePaymentResponse>(
        `${baseUrl}/payments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        fetchImpl,
        timeoutMs,
      );
      const link = response?.data?.link;
      if (typeof link !== "string" || link.length === 0) {
        throw new HttpError(502, "Payment provider unavailable");
      }
      return { checkoutUrl: link };
    },

    async verifyTransaction(providerTxId: string): Promise<VerifiedTransaction> {
      const encoded = encodeURIComponent(providerTxId);
      const response = await fetchJson<FlutterwaveVerifyResponse>(
        `${baseUrl}/transactions/${encoded}/verify`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${config.secretKey}` },
        },
        fetchImpl,
        timeoutMs,
      );
      const data = response?.data;
      if (!isObject(data)) {
        throw new HttpError(502, "Payment provider unavailable");
      }
      const txRef = data.tx_ref;
      const status = data.status;
      const amount = data.amount;
      const currency = data.currency;
      if (
        typeof txRef !== "string" ||
        typeof status !== "string" ||
        (typeof amount !== "number" && typeof amount !== "string") ||
        typeof currency !== "string"
      ) {
        throw new HttpError(502, "Payment provider unavailable");
      }
      return {
        providerTxId: String(data.id ?? providerTxId),
        txRef,
        status,
        amountCents: majorToCents(amount),
        currency: currency.toUpperCase(),
      };
    },

    verifyWebhookAuth(headers: Record<string, string | string[] | undefined>): boolean {
      const raw = headers["verif-hash"];
      const received = Array.isArray(raw) ? raw[0] : raw;
      return verifyFlutterwaveHash(config.secretHash, received);
    },
  };
}

export function hashEventKey(eventKey: string): string {
  return createHash("sha256").update(eventKey).digest("hex").slice(0, 16);
}
