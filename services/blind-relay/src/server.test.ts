import { describe, expect, it } from "vitest";
import {
  assertBlindPayload,
  createRelayApp,
  signRegistration,
  verifySignature,
} from "./server.js";

describe("blind relay", () => {
  it("rejects plaintext fields", () => {
    expect(() => assertBlindPayload({ subject: "hi" })).toThrow(/subject/);
    expect(() => assertBlindPayload({ accessToken: "x" })).toThrow(/accessToken/);
  });

  it("verifies hmac signatures", () => {
    const sig = signRegistration("secret", "dev1", "token");
    expect(verifySignature("secret", "dev1", "token", sig)).toBe(true);
    expect(verifySignature("secret", "dev1", "other", sig)).toBe(false);
  });

  it("accepts opaque events", async () => {
    const app = createRelayApp("secret");
    const res = await app.request("/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opaqueRouteId: "route_abc",
        eventType: "mail.hint",
        ciphertextHint: "opaque",
      }),
    });
    expect(res.status).toBe(200);
    const bad = await app.request("/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opaqueRouteId: "route_abc",
        eventType: "mail.hint",
        subject: "leaked",
      }),
    });
    expect(bad.status).toBe(400);
  });
});
