import { describe, expect, it } from "bun:test";
import { REMOTE_OPT_IN_DISCLOSURE_VERSION } from "./consent.js";
import { HttpRemoteOptInService } from "./http-consent.js";

describe("HttpRemoteOptInService", () => {
  it("GETs consent from the homelab API", async () => {
    const calls: string[] = [];
    const svc = new HttpRemoteOptInService({
      baseUrl: "http://galmail.test",
      getAccessToken: async () => "tok",
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            accountId: "acct_http_01",
            enabled: true,
            allowAi: true,
            retentionHours: 0,
            disclosureVersion: REMOTE_OPT_IN_DISCLOSURE_VERSION,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const consent = await svc.getConsent("acct_http_01");
    expect(consent.enabled).toBe(true);
    expect(calls[0]).toContain("/v1/accounts/acct_http_01/consent");
  });

  it("rejects setConsent when disclosure version is stale", async () => {
    const svc = new HttpRemoteOptInService({
      baseUrl: "http://galmail.test",
      getAccessToken: async () => "tok",
    });
    await expect(
      svc.setConsent({
        accountId: "acct_http_01",
        enabled: true,
        allowAi: false,
        retentionHours: 0,
        disclosureVersion: "stale",
      }),
    ).rejects.toThrow("disclosure version");
  });
});
