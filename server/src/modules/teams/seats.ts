import type { BillingService } from "../billing/types.js";

let billingService: BillingService | undefined;

export function configureSeatLimitService(service: BillingService): void {
  billingService = service;
}

export async function assertSeatAvailable(teamId: string): Promise<void> {
  if (billingService === undefined) {
    return;
  }
  await billingService.assertSeatAvailable(teamId);
}
