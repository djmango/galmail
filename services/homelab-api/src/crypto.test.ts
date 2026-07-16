import { describe, expect, it } from "bun:test";
import { signAccountToken, verifyAccountToken } from "./crypto.js";

describe("account tokens", () => {
  it("round-trips a valid HS256 account JWT", async () => {
    const secret = "test-secret-homelab";
    const token = await signAccountToken(secret, "acct_test_01", 9999999999);
    await expect(verifyAccountToken(token, secret)).resolves.toBe(
      "acct_test_01",
    );
  });

  it("rejects expired tokens", async () => {
    const secret = "test-secret-homelab";
    const token = await signAccountToken(secret, "acct_test_01", 1);
    await expect(verifyAccountToken(token, secret)).rejects.toThrow();
  });
});
