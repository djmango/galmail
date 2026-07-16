import { describe, expect, it } from "bun:test";
import { classifyMessage } from "./ai.js";
import type { HomelabConfig } from "./config.js";

const baseConfig = {
  port: 8789,
  databaseUrl: "postgres://unused",
  accountAuthSecret: "x",
  apiAdminToken: "y",
  apnsTeamId: "",
  apnsKeyId: "",
  apnsPrivateKey: "",
  apnsTopic: "com.galateacorp.mail",
  apnsSandboxDefault: true,
  fcmEnabled: false,
  openaiApiBase: "http://127.0.0.1:9",
  openaiApiKey: "",
  openaiModel: "llama3.2",
  consentDisclosureVersion: "2026-07-15.v1",
  processingRegion: "homelab",
  retentionMaxHours: 168,
} satisfies HomelabConfig;

describe("classifyMessage", () => {
  it("uses local rules when AI is disabled", async () => {
    const result = await classifyMessage(
      baseConfig,
      { subject: "Security alert: 2FA code" },
      false,
    );
    expect(result).toEqual({ priority: "urgent", source: "rules" });
  });

  it("falls back to rules when no API key is configured", async () => {
    const result = await classifyMessage(
      baseConfig,
      { subject: "Lunch tomorrow" },
      true,
    );
    expect(result.source).toBe("rules");
    expect(result.priority).toBe("normal");
  });
});
