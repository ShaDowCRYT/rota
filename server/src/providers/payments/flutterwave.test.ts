import { describe, expect, it, vi } from "vitest";

import { createFlutterwaveProvider, centsToMajorString, majorToCents, verifyFlutterwaveHash } from "./flutterwave.js";

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
