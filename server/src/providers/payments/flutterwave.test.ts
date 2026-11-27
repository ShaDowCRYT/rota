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
  const modern = {
    event: "charge.completed",
    data: { id: "provider-1", tx_ref: "rota.team.payment", status: "successful" },
  };
  const legacy = {
    "event.type": "CARD_TRANSACTION",
    id: "provider-2",
    txRef: "rota.team.payment",
    status: "successful",
  };

  it("accepts both modern and legacy charge payloads", () => {
    expect(parseFlutterwaveWebhook(modern)).toEqual({
      providerTxId: "provider-1",
      txRef: "rota.team.payment",
      eventName: "charge.completed",
      dedupeStatus: "successful",
    });
    expect(parseFlutterwaveWebhook(legacy)).toEqual({
      providerTxId: "provider-2",
      txRef: "rota.team.payment",
      eventName: "CARD_TRANSACTION",
      dedupeStatus: "successful",
    });
  });

  it("uses unknown when the body status is absent", () => {
    expect(parseFlutterwaveWebhook({ ...legacy, status: undefined })?.dedupeStatus).toBe("unknown");
  });

  it("rejects missing id and missing tx_ref in both shapes", () => {
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { tx_ref: "rota.team.payment" } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { id: "provider-1" } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", txRef: "rota.team.payment" })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: "provider-2" })).toBeUndefined();
  });

  it("ignores unrelated event types in both shapes", () => {
    expect(parseFlutterwaveWebhook({ event: "transfer.completed", data: { id: "provider-1", tx_ref: "rota.team.payment" } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "TRANSFER_COMPLETED", id: "provider-2", txRef: "rota.team.payment" })).toBeUndefined();
  });

  it("rejects non-string provider fields", () => {
    expect(parseFlutterwaveWebhook({ event: 123, data: modern.data })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { ...modern.data, id: 123 } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ event: "charge.completed", data: { ...modern.data, tx_ref: 123 } })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": 123, id: "provider-2", txRef: "rota.team.payment" })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: 123, txRef: "rota.team.payment" })).toBeUndefined();
    expect(parseFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: "provider-2", txRef: 123 })).toBeUndefined();
  });

  it("describes ignored payloads with names and a safe event label only", () => {
    expect(describeFlutterwaveWebhook({ "event.type": "CARD_TRANSACTION", id: "provider-2", data: { note: "secret-value" } })).toEqual({
      topLevelKeys: ["data", "event.type", "id"],
      dataKeys: ["note"],
      eventName: "CARD_TRANSACTION",
    });
    expect(describeFlutterwaveWebhook({ event: "charge.completed\nsecret-value" }).eventName).toBeUndefined();
  });
});
