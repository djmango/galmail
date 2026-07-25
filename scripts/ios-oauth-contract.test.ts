/**
 * iOS OAuth presenter contract.
 *
 * Catches Release failures where `-fvisibility=hidden` makes Swift @_cdecl
 * symbols invisible to dlsym, and drift in Google/Microsoft URL schemes.
 *
 * Runs on every `bun test` / js CI job (Ubuntu).
 */
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFile(new URL(path, root), "utf8");

const GOOGLE_SCHEME =
  "com.googleusercontent.apps.966863975017-9jr34jv83g260dgs0nckqr4h2pm7q10c";
const MICROSOFT_SCHEME = "msauth.com.galateacorp.mail";

describe("ios oauth contract", () => {
  it("registers the Swift presenter into Rust at bootstrap (not dlsym-only)", async () => {
    const [rust, plugin, main] = await Promise.all([
      file("apps/web/src-tauri/src/ios_oauth.rs"),
      file("swift/GalMailApple/Sources/GalMailApplePlugin.swift"),
      file("apps/web/src-tauri/gen/apple/Sources/galmail-tauri/main.mm"),
    ]);
    expect(rust).toContain("galmail_ios_register_oauth_presenter");
    expect(rust).toContain("PRESENT_FN");
    expect(rust).toContain("resolve_present_fn");
    expect(plugin).toContain("galmail_ios_register_oauth_presenter");
    expect(plugin).toContain("galmailIosPresentOAuth");
    expect(main).toContain("galmail_apple_bootstrap");
    expect(main).toContain("oauthRetain");
    expect(main).toMatch(/&\s*galmail_ios_present_oauth/);
  });

  it("marks OAuth cdecls @_used and exposes the presenter type", async () => {
    const presenter = await file(
      "swift/GalMailApple/Sources/GalMailOAuthPresenter.swift",
    );
    expect(presenter).toContain('@_cdecl("galmail_ios_present_oauth")');
    expect(presenter).toContain('@_cdecl("galmail_ios_open_oauth_url")');
    expect(presenter).toMatch(
      /@_used\s*\n\s*@_cdecl\("galmail_ios_present_oauth"\)/,
    );
    expect(presenter).toContain("ASWebAuthenticationSession");
    expect(presenter).toContain("prefersEphemeralWebBrowserSession = false");
  });

  it("keeps Google and Microsoft URL schemes on the iOS app", async () => {
    const [project, info] = await Promise.all([
      file("apps/web/src-tauri/gen/apple/project.yml"),
      file("apps/web/src-tauri/gen/apple/galmail-tauri_iOS/Info.plist"),
    ]);
    for (const body of [project, info]) {
      expect(body).toContain(GOOGLE_SCHEME);
      expect(body).toContain(MICROSOFT_SCHEME);
    }
    expect(project).toContain("AuthenticationServices.framework");
  });

  it("wires both providers through the shared iOS OAuth presenter", async () => {
    const [iosOauth, gmail, microsoft, gmailUi, msUi, archive] =
      await Promise.all([
        file("apps/web/src-tauri/src/ios_oauth.rs"),
        file("apps/web/src-tauri/src/gmail_oauth.rs"),
        file("apps/web/src-tauri/src/microsoft_oauth.rs"),
        file("apps/web/src/lib/gmail-connect.ts"),
        file("apps/web/src/lib/microsoft-connect.ts"),
        file("scripts/ios-archive-testflight.ts"),
      ]);
    expect(iosOauth).toContain("MICROSOFT_CALLBACK_SCHEME");
    expect(iosOauth).toContain("google_callback_scheme");
    expect(gmail).toContain("ios_oauth::present");
    expect(microsoft).toContain("ios_oauth::present");
    expect(gmailUi).toContain("VITE_GOOGLE_IOS_CLIENT_ID");
    expect(gmailUi).toContain("gmail_oauth_begin");
    expect(msUi).toContain("VITE_MICROSOFT_CLIENT_ID");
    expect(msUi).toContain("microsoft_oauth_begin");
    expect(archive).toContain("assertOAuthPresenterLinked");
    expect(archive).toContain("galmail_ios_register_oauth_presenter");
  });

  it("bakes both provider client IDs into TestFlight CI", async () => {
    const [workflow, viteExample] = await Promise.all([
      file(".github/workflows/ios-testflight.yml"),
      file("secrets/ci/vite.example.yaml"),
    ]);
    expect(workflow).toContain("VITE_GOOGLE_IOS_CLIENT_ID");
    expect(workflow).toContain("VITE_MICROSOFT_CLIENT_ID");
    expect(viteExample).toContain("VITE_GOOGLE_IOS_CLIENT_ID");
    expect(viteExample).toContain("VITE_MICROSOFT_CLIENT_ID");
  });
});
