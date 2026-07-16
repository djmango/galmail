import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFile(new URL(path, root), "utf8");

describe("platform expansion repository gates", () => {
  it("keeps the generated iOS project credential-free and extension-complete", async () => {
    const [project, entitlements, service, bridge, share] = await Promise.all([
      file("apps/web/src-tauri/gen/apple/project.yml"),
      file(
        "apps/web/src-tauri/gen/apple/galmail-tauri_iOS/galmail-tauri_iOS.entitlements",
      ),
      file("swift/GalMailApple/NotificationService/NotificationService.swift"),
      file("swift/GalMailApple/Sources/NotificationBridge.swift"),
      file("swift/GalMailApple/ShareExtension/ShareViewController.swift"),
    ]);
    expect(project).toContain("GalMailNotificationService");
    expect(project).toContain("GalMailShareExtension");
    expect(project).toContain("schemes:\n  GalMailAppleTests:");
    expect(project).toContain("GalMailAppleTests: [test]");
    expect(project).toContain('DEVELOPMENT_TEAM: ""');
    expect(project).not.toContain("XXXXXXXXXX");
    expect(entitlements).toContain("group.app.galmail.client");
    expect(service).toContain("applyGenericFallback");
    expect(service).toContain("AES.GCM.open");
    expect(bridge).toContain("action-queue-key");
    expect(bridge).toContain("AES.GCM.seal");
    expect(bridge).toContain("GalMailNotificationIndex");
    expect(share).toContain("maximumPayloadBytes");
    expect(share).toContain("completeFileProtection");
  });

  it("documents a no-go web decision with evidence and recovery gates", async () => {
    const evaluation = await file("docs/public-web-security-evaluation.md");
    expect(evaluation).toContain("no-go for a production public web client");
    expect(evaluation).toContain("non-extractable");
    expect(evaluation).toContain("QuotaExceededError");
    expect(evaluation).toContain("Background Synchronization API");
    expect(evaluation).toContain("developer.mozilla.org");
    expect(evaluation).toContain("w3c.github.io");
    expect(evaluation).toContain("webkit.org");
  });

  it("does not introduce provider or Apple credentials", async () => {
    const [environment, config, project] = await Promise.all([
      file("secrets/dev.example.json"),
      file("apps/web/src-tauri/tauri.conf.json"),
      file("apps/web/src-tauri/gen/apple/project.yml"),
    ]);
    expect(environment).toMatch(/"VITE_MICROSOFT_CLIENT_ID":\s*""/);
    expect(config).toContain('"developmentTeam": ""');
    expect(project).not.toMatch(/DEVELOPMENT_TEAM: [A-Z0-9]{10}/);
  });
});
