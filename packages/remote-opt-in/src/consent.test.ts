import { describe, expect, it } from "bun:test";
import {
  LocalRemoteOptInService,
  REMOTE_OPT_IN_DISCLOSURE_VERSION,
} from "./consent.js";
import { asAccountId } from "@galmail/core-api";

describe("LocalRemoteOptInService", () => {
  it("defaults to disabled zero-access", async () => {
    const svc = new LocalRemoteOptInService();
    const c = await svc.getConsent(asAccountId("gmail:demo"));
    expect(c.enabled).toBe(false);
    expect(c.retentionHours).toBe(0);
  });

  it("requires current disclosure version to enable", async () => {
    const svc = new LocalRemoteOptInService();
    await expect(
      svc.setConsent({
        accountId: asAccountId("gmail:demo"),
        enabled: true,
        allowAi: false,
        retentionHours: 0,
        disclosureVersion: "old",
      }),
    ).rejects.toThrow(/disclosure/);

    await svc.setConsent({
      accountId: asAccountId("gmail:demo"),
      enabled: true,
      allowAi: true,
      retentionHours: 1,
      disclosureVersion: REMOTE_OPT_IN_DISCLOSURE_VERSION,
    });
    const c = await svc.getConsent(asAccountId("gmail:demo"));
    expect(c.enabled).toBe(true);
    expect(c.allowAi).toBe(true);
  });
});
