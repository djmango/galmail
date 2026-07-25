/**
 * Keychain contract gate.
 *
 * Catches the class of iOS vault/safe-mode regressions that slipped through
 * compile-only CI: access-group drift, SecAccessControl on generic passwords,
 * missing -25308 soft-miss handling, and Swift/Rust service mismatches.
 *
 * Runs on every `bun test` / js CI job (Ubuntu). No Apple hardware required.
 */
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFile(new URL(path, root), "utf8");

const ACCESS_GROUP_SUFFIX = "com.galateacorp.mail.keychain";
const RUST_DEVICE_VAULT = "com.galmail.app.vault";
const EXTENSION_VAULT = "com.galateacorp.mail.vault";
const OAUTH = "com.galmail.app.oauth";
const OAUTH_LEGACY = "com.galmail.app.gmail-oauth";
const DEVICE_ACCOUNT = "device-wrap-key-v1";

describe("keychain contract", () => {
  it("keeps Swift KeychainPolicy as the Apple-side source of truth", async () => {
    const policy = await file("swift/GalMailApple/Shared/KeychainPolicy.swift");
    expect(policy).toContain(`"${ACCESS_GROUP_SUFFIX}"`);
    expect(policy).toContain(`"${RUST_DEVICE_VAULT}"`);
    expect(policy).toContain(`"${EXTENSION_VAULT}"`);
    expect(policy).toContain(`"${OAUTH}"`);
    expect(policy).toContain(`"${OAUTH_LEGACY}"`);
    expect(policy).toContain(`"${DEVICE_ACCOUNT}"`);
    expect(policy).toContain(
      "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
    );
    expect(policy).toContain("SecAccessControl");
    expect(policy).toMatch(/Prefer.*kSecAttrAccessible.*SecAccessControl/s);
  });

  it("aligns Rust vault/OAuth services with Swift KeychainPolicy", async () => {
    const rust = await file("apps/web/src-tauri/src/secure_storage.rs");
    expect(rust).toContain(`"${RUST_DEVICE_VAULT}"`);
    expect(rust).toContain(`"${DEVICE_ACCOUNT}"`);
    expect(rust).toContain(`"${OAUTH}"`);
    expect(rust).toContain(`"${OAUTH_LEGACY}"`);
    expect(rust).toContain(`"${EXTENSION_VAULT}"`);
    expect(rust).toContain("EXTENSION_VAULT_KEYCHAIN_SERVICE");
    // Device vault must not be confused with the extension vault service.
    expect(rust).toContain(
      "assert_ne!(VAULT_KEYCHAIN_SERVICE, EXTENSION_VAULT_KEYCHAIN_SERVICE)",
    );
  });

  it("uses Keychain store V3 purge-then-Add (identity delete, no fat-query Update)", async () => {
    const [rust, archive] = await Promise.all([
      file("apps/web/src-tauri/src/secure_storage.rs"),
      file("scripts/ios-archive-testflight.ts"),
    ]);
    // Certified store path — security-framework set_generic_password_options is banned.
    expect(rust).toContain("fn store_app_private_generic_password");
    expect(rust).toContain("GALMAIL_KEYCHAIN_STORE_V3_PURGE_THEN_ADD_IDENT");
    expect(rust).toContain("galmail_keychain_store_v3");
    expect(rust).toContain("#[used]");
    expect(rust).toContain("#[no_mangle]");
    expect(rust).toContain("SecItemDelete");
    expect(rust).toContain("SecItemAdd");
    expect(rust).toContain("kSecAttrSynchronizableAny");
    expect(rust).toContain("errSecDuplicateItem");
    expect(rust).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    // V3 must not Prefer-Update (multi-match leftovers → -25300 / -25299).
    const storeFn = rust.match(
      /fn store_app_private_generic_password\([\s\S]*?\n\}\n\n#\[cfg/,
    )?.[0];
    expect(storeFn).toBeTruthy();
    expect(storeFn).not.toContain("SecItemUpdate");
    expect(storeFn).not.toContain("set_generic_password_options");
    expect(storeFn).not.toContain("SecAccessControl");
    expect(storeFn).not.toContain("GALMAIL_KEYCHAIN_STORE_V2");
    expect(rust).toContain("store_app_private_generic_password(");
    expect(rust).not.toMatch(
      /fn store_oauth_bytes[\s\S]*?set_generic_password_options/,
    );
    // IPA gate must prove the #[used] marker shipped (V2 was optimized out).
    expect(archive).toContain("GALMAIL_KEYCHAIN_STORE_V3_PURGE_THEN_ADD_IDENT");
    expect(archive).toContain("galmail_keychain_store_v3");
  });

  it("treats Keychain -25308 as a soft miss with retry on reads", async () => {
    const rust = await file("apps/web/src-tauri/src/secure_storage.rs");
    expect(rust).toContain("fn keychain_soft_miss");
    expect(rust).toMatch(/code == -25308/);
    expect(rust).toMatch(/code == -25300/);
    expect(rust).toMatch(/code == -34018/);
    expect(rust).toContain("load_generic_password_bytes");
    expect(rust).toContain("read_password_variants");
    expect(rust).toContain("identity_password_options");
    expect(rust).toMatch(/for attempt in 0\.\.4/);
  });

  it("requires shared Keychain access group on app and both extensions", async () => {
    const [
      project,
      appEnt,
      nseEnt,
      shareEnt,
      appInfo,
      nseInfo,
      shareInfo,
      archive,
    ] = await Promise.all([
      file("apps/web/src-tauri/gen/apple/project.yml"),
      file(
        "apps/web/src-tauri/gen/apple/galmail-tauri_iOS/galmail-tauri_iOS.entitlements",
      ),
      file(
        "apps/web/src-tauri/gen/apple/GalMailNotificationService/GalMailNotificationService.entitlements",
      ),
      file(
        "apps/web/src-tauri/gen/apple/GalMailShareExtension/GalMailShareExtension.entitlements",
      ),
      file("apps/web/src-tauri/gen/apple/galmail-tauri_iOS/Info.plist"),
      file(
        "apps/web/src-tauri/gen/apple/GalMailNotificationService/Info.plist",
      ),
      file("apps/web/src-tauri/gen/apple/GalMailShareExtension/Info.plist"),
      file("scripts/ios-archive-testflight.ts"),
    ]);

    for (const body of [project, appEnt, nseEnt, shareEnt]) {
      expect(body).toContain(`com.galateacorp.mail.keychain`);
      expect(body).toContain("keychain-access-groups");
    }
    for (const body of [project, appInfo, nseInfo, shareInfo]) {
      expect(body).toContain("GalMailKeychainAccessGroup");
      expect(body).toContain(
        "$(AppIdentifierPrefix)com.galateacorp.mail.keychain",
      );
    }
    // Share extension must compile Shared/KeychainPolicy.swift.
    expect(project).toMatch(
      /GalMailShareExtension:[\s\S]*?GalMailApple\/Shared/,
    );
    // Archive must bake TEAMID.suffix (empty AppIdentifierPrefix caused -34018).
    expect(archive).toContain("bakeKeychainAccessGroup");
    expect(archive).toContain("assertKeychainAccessGroup");
    // IPA Info.plists are binary — gate must plutil-convert, not grep XML tags.
    expect(archive).toContain("infoPlistAsXml");
    expect(archive).toContain("plutil");
    expect(archive).toContain('const TEAM_ID = "A95F4H2423"');
    expect(archive).toContain(
      "const KEYCHAIN_ACCESS_GROUP = `${TEAM_ID}.com.galateacorp.mail.keychain`",
    );
  });

  it("normalizes bare Keychain access-group suffixes in Rust and Swift", async () => {
    const [rust, bridge, policy, tests] = await Promise.all([
      file("apps/web/src-tauri/src/secure_storage.rs"),
      file("swift/GalMailApple/Sources/NotificationBridge.swift"),
      file("swift/GalMailApple/Shared/KeychainPolicy.swift"),
      file("swift/GalMailApple/Tests/KeychainPolicyTests.swift"),
    ]);
    expect(rust).toContain("fn normalize_keychain_access_group");
    expect(rust).toContain("fn team_identifier");
    expect(rust).toContain('APPLE_TEAM_IDENTIFIER: &str = "A95F4H2423"');
    // SecTask* are non-public; ASC rejects IPAs that link them (altool code 11).
    expect(rust).not.toContain("SecTaskCreateFromSelf");
    expect(rust).not.toContain("SecTaskCopyValueForEntitlement");
    // OAuth + device vault are app-private — shared group only for migration delete.
    expect(rust).toContain("fn store_app_private_generic_password");
    expect(rust).not.toContain("missing team prefix or entitlement");
    expect(policy).toContain("normalizedAccessGroup");
    expect(policy).toContain('appleTeamIdentifier = "A95F4H2423"');
    expect(policy).toContain("App-private (no shared access group)");
    expect(bridge).toContain("normalizedAccessGroup");
    expect(bridge).toContain("appleTeamIdentifier");
    expect(tests).toContain("testNormalizedAccessGroupRepairsBareSuffix");
  });

  it("keeps Swift Keychain helpers on purge-then-Add with identity queries", async () => {
    const bridge = await file(
      "swift/GalMailApple/Sources/NotificationBridge.swift",
    );
    expect(bridge).toContain("GalMailKeychainPolicy.extensionVaultService");
    expect(bridge).toContain("GalMailKeychainPolicy.accessible");
    expect(bridge).not.toMatch(/SecAccessControlCreateWithFlags/);
    const storeBlock = bridge.match(
      /public static func store\(_ data: Data[\s\S]*?throw GalMailAppleError\.keychain\(status\)/,
    )?.[0];
    expect(storeBlock).toBeTruthy();
    expect(storeBlock).toContain("SecItemDelete");
    expect(storeBlock).toContain("SecItemAdd");
    expect(storeBlock).not.toContain("SecItemUpdate");
    expect(storeBlock).toContain("GalMailKeychainPolicy.accessible");
    expect(storeBlock).not.toContain("kSecAttrAccessControl");
    const identityBlock = storeBlock.match(
      /let identity: \[String: Any\] = \[[\s\S]*?\]/,
    )?.[0];
    expect(identityBlock).toBeTruthy();
    expect(identityBlock).not.toContain("kSecAttrAccessible");
  });

  it("mirrors OAuth service names through GalMailOAuthPresenter", async () => {
    const oauth = await file(
      "swift/GalMailApple/Sources/GalMailOAuthPresenter.swift",
    );
    expect(oauth).toContain("GalMailKeychainPolicy.oauthService");
    expect(oauth).toContain("GalMailKeychainPolicy.oauthServiceLegacy");
  });

  it("maps Keychain startup failures into safe-mode recovery", async () => {
    const [release, lib] = await Promise.all([
      file("apps/web/src-tauri/src/release_support.rs"),
      file("apps/web/src-tauri/src/lib.rs"),
    ]);
    expect(release).toContain('if error.contains("Keychain")');
    expect(release).toContain('"keychain-unavailable"');
    expect(lib).toContain("startup_detail");
    expect(lib).toContain("require_normal_mode");
    expect(lib).toContain("recovery_status");
    expect(lib).toContain("reset_local_database");
  });

  it("ships XCTest coverage for KeychainPolicy and runs it in ios CI", async () => {
    const [tests, ci, iosCheck] = await Promise.all([
      file("swift/GalMailApple/Tests/KeychainPolicyTests.swift"),
      file(".github/workflows/ci.yml"),
      file("scripts/ios-check.ts"),
    ]);
    expect(tests).toContain("KeychainPolicyTests");
    expect(tests).toContain(
      "testAccessibilityIsAfterFirstUnlockThisDeviceOnly",
    );
    expect(ci).toContain("xcodebuild test");
    expect(ci).toContain("GalMailAppleTests");
    expect(ci).toContain("Run GalMailAppleTests on Simulator");
    expect(iosCheck).toContain('"test"');
    expect(iosCheck).toContain("GalMailAppleTests");
  });
});
