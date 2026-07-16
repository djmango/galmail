import { describe, expect, it } from "bun:test";
import {
  assertBlindPayload,
  createRelayApp,
  safeLog,
  signAccountTokenForTest,
} from "./server.js";

describe("blind relay", () => {
  it("rejects nested plaintext and credential fields", () => {
    expect(() => assertBlindPayload({ subject: "hi" })).toThrow(/subject/);
    expect(() =>
      assertBlindPayload({ safe: [{ nested: { refreshToken: "x" } }] }),
    ).toThrow(/refreshToken/);
    expect(() => assertBlindPayload({ Subject: "case bypass" })).toThrow(
      /Subject/,
    );
  });

  it("creates short-lived account-scoped bearer tokens", async () => {
    const token = await signAccountTokenForTest(
      "test-secret",
      "account_12345678",
      Math.floor(Date.now() / 1000) + 60,
    );
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(token).not.toContain("test-secret");
  });

  it("exposes a Workers-compatible Hono fetch handler", () => {
    expect(typeof createRelayApp().fetch).toBe("function");
  });

  it("guards structured logs against sensitive fields", () => {
    expect(() => safeLog("info", "health", { outcome: "ok" })).not.toThrow();
    expect(() =>
      safeLog("error", "request_failed", { status: 500 }),
    ).not.toThrow();
  });

  it("serves health through the Workers binding boundary", async () => {
    const app = createRelayApp();
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
    const response = await app.request("/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"ok":true,"service":"galmail-blind-relay","environment":"test"}',
    );
  });

  it("rejects a valid token used for another account", async () => {
    const secret = "integration-secret";
    const token = await signAccountTokenForTest(
      secret,
      "account_12345678",
      Math.floor(Date.now() / 1000) + 60,
    );
    const response = await createRelayApp().request(
      "/v1/accounts/account_87654321/devices/bootstrap",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
      { ACCOUNT_AUTH_SECRET: secret } as unknown as Env,
    );
    expect(response.status).toBe(403);
  });
});
