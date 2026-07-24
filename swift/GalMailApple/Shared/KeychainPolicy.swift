import Foundation
import Security

/// Single source of truth for GalMail Apple Keychain policy.
///
/// Rust vault/OAuth code in `apps/web/src-tauri/src/secure_storage.rs` must stay
/// aligned with these values. `scripts/keychain-contract.test.ts` and
/// `KeychainPolicyTests` fail CI when they drift.
public enum GalMailKeychainPolicy {
    /// Info.plist key resolved to `$(AppIdentifierPrefix)com.galateacorp.mail.keychain`.
    public static let accessGroupInfoKey = "GalMailKeychainAccessGroup"

    /// Entitlement / Info.plist suffix (team prefix applied by Xcode).
    public static let accessGroupSuffix = "com.galateacorp.mail.keychain"

    /// Extension-shared keys (notification index, share inbox, etc.).
    public static let extensionVaultService = "com.galateacorp.mail.vault"

    /// Rust device vault wrapping key service. Must stay distinct from the
    /// extension vault service.
    public static let rustDeviceVaultService = "com.galmail.app.vault"

    public static let rustDeviceVaultAccount = "device-wrap-key-v1"

    /// Provider-neutral OAuth token service (Gmail + Microsoft).
    public static let oauthService = "com.galmail.app.oauth"

    public static let oauthServiceLegacy = "com.galmail.app.gmail-oauth"

    /// Accessibility for all GalMail generic-password items.
    /// Prefer `kSecAttrAccessible` over `SecAccessControl` for these items:
    /// AccessControl has caused errSecInteractionNotAllowed (-25308) at cold start.
    public static let accessible: CFString = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    public static let accessibleAttributeName = "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly"
}
