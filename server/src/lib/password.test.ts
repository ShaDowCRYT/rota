import { describe, expect, it } from "vitest";

import { createPasswordService } from "./password.js";

const password = "correct horse battery staple";

describe("password hashing", () => {
  const passwords = createPasswordService();

  it("hash is not the password and starts with $argon2id$", async () => {
    const passwordHash = await passwords.hash(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("correct password verifies", async () => {
    const passwordHash = await passwords.hash(password);

    expect(await passwords.verify(passwordHash, password)).toBe(true);
  });

  it("wrong password fails", async () => {
    const passwordHash = await passwords.hash(password);

    expect(await passwords.verify(passwordHash, "wrong password value")).toBe(false);
  });
});
