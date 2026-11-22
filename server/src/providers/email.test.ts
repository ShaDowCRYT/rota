import { afterEach, describe, expect, it, vi } from "vitest";

import { createDevEmailSender } from "./email.js";

const resetLink = "rota://reset?token=example-token-value";
const message = {
  to: "user@example.com",
  subject: "Reset your Rota password",
  text: `Use this link to reset your Rota password: ${resetLink}`,
};

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

describe("createDevEmailSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["development", "test"])("logs the reset link in %s", async (environment) => {
    const lines = captureStdout();
    const sender = createDevEmailSender(environment);

    const result = await sender.send(message);

    expect(result).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.includes("password reset link")).toBe(true);
    expect(lines[0]?.includes("rota://reset?token=")).toBe(true);
    expect(lines[0]?.includes('"text":')).toBe(true);
  });

  it("sends nothing and logs one configured warning in production", async () => {
    const lines = captureStdout();
    const sender = createDevEmailSender("production");

    const result = await sender.send(message);

    expect(result).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.includes("no email provider configured")).toBe(true);
    expect(lines[0]?.includes("rota://reset?token=")).toBe(false);
  });

  it("does not return or store the message", async () => {
    captureStdout();
    const sender = createDevEmailSender("test");

    const result = await sender.send(message);

    expect(result).toBeUndefined();
    expect(Object.keys(sender)).toEqual(["send"]);
  });
});
