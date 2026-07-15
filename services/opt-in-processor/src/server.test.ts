import { describe, expect, it } from "vitest";
import { createOptInApp } from "./server.js";

describe("opt-in processor", () => {
  it("rejects classify without session", async () => {
    const app = createOptInApp();
    const res = await app.request("/v1/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: "gmail:x",
        normalized: { subject: "hi" },
      }),
    });
    expect(res.status).toBe(403);
  });

  it("classifies for consented accounts", async () => {
    const app = createOptInApp();
    await app.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: "gmail:x",
        allowAi: true,
        retentionHours: 0,
        disclosureVersion: "2026-07-15.v1",
        tokenVaultRef: "vault://opaque",
      }),
    });
    const res = await app.request("/v1/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: "gmail:x",
        normalized: { subject: "Security code" },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.priority).toBe("urgent");
    expect(json.source).toBe("remote_ai");
  });
});
