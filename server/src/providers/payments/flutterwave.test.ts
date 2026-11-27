import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createFlutterwaveProvider,
  centsToMajorString,
  describeFlutterwaveWebhook,
  majorToCents,
  parseFlutterwaveWebhook,
  verifyFlutterwaveHash,
} from "./flutterwave.js";


describe("flutterwave adapter", () => {
  it("converts cents/major amounts as integer strings", () => {
    expect(centsToMajorString(2000)).toBe("20.00");
    expect(centsToMajorString(360)).toBe("3.60");
    expect(majorToCents("20.00")).toBe(2000);
    expect(majorToCents(20)).toBe(2000);
    expect(majorToCents("20.1")).toBe(2010);
    expect(() => majorToCents("20.001")).toThrow();
    expect(() => majorToCents("abc")).toThrow();
  });

  it("compares verif-hash in constant time by equality semantics", () => {
    expect(verifyFlutterwaveHash("secret", "secret")).toBe(true);
    expect(verifyFlutterwaveHash("secret", "wrong")).toBe(false);
    expect(verifyFlutterwaveHash("secret", undefined)).toBe(false);
  });

  it("creates checkout and verifies transaction", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/payments")) {
        return new Response(JSON.stringify({ status: "success", data: { link: "https://checkout.test/pay" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "success", data: { id: 123, tx_ref: "rota.t.p", status: "successful", amount: "20.00", currency: "USD" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createFlutterwaveProvider({ secretKey: "sk", secretHash: "sh", fetchImpl, baseUrl: "https://api.flutterwave.com/v3" });
    const checkout = await provider.createCheckout({ txRef: "rota.t.p", amountCents: 2000, currency: "USD", redirectUrl: "https://example.com/r", customerEmail: "a@b.com", title: "Rota", meta: {} });
    expect(checkout.checkoutUrl).toBe("https://checkout.test/pay");
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk");
    expect(JSON.parse(String(init.body)).amount).toBe("20.00");

    const verified = await provider.verifyTransaction("123");
    expect(verified).toMatchObject({ txRef: "rota.t.p", status: "successful", amountCents: 2000, currency: "USD" });
  });
});

describe("flutterwave webhook parser", () => {
  const teamId = randomUUID();
  const paymentId = randomUUID();
  const txRef = `rota.${teamId}.${paymentId}`;
  const modern = {
    event: "charge.completed",
    data: { id: 123456, tx_ref: txRef, status: "successful" },
  };
  const legacy = {
    "event.type": "CARD_TRANSACTION",
    id: 987654321,
    txRef,
    status: "successful",
  };

  it("accepts both modern and legacy charge payloads", () => {
    expect(parseFlutterwaveWebhook(modern)).toEqual({
      providerTxId: "123456",
      txRef,
      eventName: "charge.completed",
      dedupeStatus: "successful",
    });
    expect(parseFlutterwaveWebhook(legacy)).toEqual({
      providerTxId: "987654321",
      txRef,
      eventName: "CARD_TRANSACTION",
      dedupeStatus: "successful",
    });
  });

  it("accepts numeric string ids and charge-like legacy event types", () => {
    expect(parseFlutterwaveWebhook({ ...legacy, id: "987654321" })?.providerTxId).toBe("987654321");
    expect(parseFlutterwaveWebhook({ ...legacy, "event.type": "BANK_TRANSFER_TRANSACTION" })?.eventName).toBe("BANK_TRANSFER_TRANSACTION");
    expect(parseFlutterwaveWebhook({ ...legacy, "event.type": "OTHER_TRANSACTION" })?.eventName).toBe("OTHER_TRANSACTION");
  });

  it("uses unknown when the body status is absent or unsafe", () => {
    expect(parseFlutterwaveWebhook({ ...legacy, status: undefined })?.dedupeStatus).toBe("unknown");
    expect(parseFlutterwaveWebhook({ ...legacy, status: "successful-123" })?.dedupeStatus).toBe("unknown");
  });

  it("rejects missing id and missing tx_ref in both shapes", () => {
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { tx_ref: txRef } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { id: 123456 } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", txRef })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: 987654321 })).toBeUndefined();
  });

  it("ignores unrelated event types in both shapes", () => {
    expect(parseFlutterwaveWebhook({ event: "transfer.completed", data: { id: 123456, tx_ref: txRef } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ ...legacy, "event.type": "TRANSFER" })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ ...legacy, "event.type": "TRANSFER_COMPLETED" })).toBeUndefined();
  });

  it("rejects invalid provider fields", () => {
    expect(parseFlutterwaveWebhook({ event: 123, data: modern.data })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { ...modern.data, tx_ref: 123 } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": 123, id: 987654321, txRef })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: "not-a-number", txRef })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: 0, txRef })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: 987654321, txRef: 123 })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ ...legacy, txRef: "not-a-rota-reference" })).toBeUndefined();
  });

  it("describes ignored payloads with names and a safe event label only", () => {
    const ignored = {
      IP: "203.0.113.10",
      amount: 2000,
      appfee: 0,
      charge_type: "card",
      charged_amount: 2000,
      createdAt: "2026-11-27T10:00:00Z",
      currency: "USD",
      customer: { email: "buyer@example.invalid" },
      entity: { id: 987654321 },
      "event.type": "CARD_TRANSACTION",
      flwRef: "flw-1",
      id: 987654321,
      merchantbearsfee: 0,
      merchantfee: 0,
      orderRef: txRef,
      paymentPage: "rota",
      paymentPlan: "team",
      status: "successful",
      txRef,
    };
    expect(describeFlutterwaveWebhook(ignored)).toEqual({
      topLevelKeys: ["IP", "amount", "appfee", "charge_type", "charged_amount", "createdAt", "currency", "customer", "entity", "event.type", "flwRef", "id", "merchantbearsfee", "merchantfee", "orderRef", "paymentPage", "paymentPlan", "status", "txRef"],
      dataKeys: [],
      eventName: "CARD_TRANSACTION",
    });
    expect(describeFlutterwaveWebhook({ event: "charge.completed\nsecret-value" }).eventName).toBeUndefined();
  });
});
