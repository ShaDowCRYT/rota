export interface CheckoutInput {
  txRef: string;
  amountCents: number;
  currency: string;
  redirectUrl: string;
  customerEmail: string;
  title: string;
  meta: Record<string, string>;
}

export interface CheckoutResult {
  checkoutUrl: string;
}

export interface VerifiedTransaction {
  providerTxId: string;
  txRef: string;
  status: string;
  amountCents: number;
  currency: string;
}

export interface ParsedWebhook {
  providerTxId: string;
  txRef: string;
  eventName: string;
  dedupeStatus: string;
}

export interface IgnoredWebhookSummary {
  topLevelKeys: readonly string[];
  dataKeys: readonly string[];
  eventName?: string;
}

export interface PaymentProvider {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyTransaction(providerTxId: string): Promise<VerifiedTransaction>;
  verifyWebhookAuth(headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(payload: unknown): ParsedWebhook | undefined;
  describeIgnoredWebhook(payload: unknown): IgnoredWebhookSummary;
}
