import { describe, expect, it } from "bun:test";
import { createOptInApp, safeLog, signAccountTokenForTest } from "./server.js";

describe("opt-in processor", () => {
  it("exposes a Workers-compatible Hono fetch handler", () => {
    expect(typeof createOptInApp().fetch).toBe("function");
  });

  it("creates account-scoped bearer tokens without exposing the secret", async () => {
    const token = await signAccountTokenForTest(
      "test-secret",
      "account_12345678",
      Math.floor(Date.now() / 1000) + 60,
    );
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain("test-secret");
  });

  it("allows only privacy-safe structured logs", () => {
    expect(() =>
      safeLog("info", "retention_complete", { outcome: "ok" }),
    ).not.toThrow();
    expect(() =>
      safeLog("warn", "subject_received", { outcome: "bad" }),
    ).toThrow(/sensitive/);
  });

  it("serves health through the Workers binding boundary", async () => {
    const env = {
      ENVIRONMENT: "test",
      DB: {
        prepare() {
          return {
            async first() {
              return { ok: 1 };
            },
          };
        },
      },
    } as unknown as Env;
    const response = await createOptInApp().request("/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"ok":true,"service":"galmail-opt-in-processor","environment":"test"}',
    );
  });

  it("rejects a valid token used for another account", async () => {
    const secret = "integration-secret";
    const token = await signAccountTokenForTest(
      secret,
      "account_12345678",
      Math.floor(Date.now() / 1000) + 60,
    );
    const response = await createOptInApp().request(
      "/v1/accounts/account_87654321/consent",
      { headers: { authorization: `Bearer ${token}` } },
      { ACCOUNT_AUTH_SECRET: secret } as unknown as Env,
    );
    expect(response.status).toBe(403);
  });
});
