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

    /// Entitlement / Info.plist suffix (team prefix applied by Xcode / archive bake).
    public static let accessGroupSuffix = "com.galateacorp.mail.keychain"

    /// Apple Developer Team ID (must match `TEAM_ID` in `scripts/ios-archive-testflight.ts`).
    /// Used when Info.plist still has a bare suffix after empty `$(AppIdentifierPrefix)`.
    public static let appleTeamIdentifier = "A95F4H2423"

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

    /// Ensure `TEAMID.com.galateacorp.mail.keychain`. Bare suffixes (empty
    /// `$(AppIdentifierPrefix)` expansion) are repaired when `teamIdentifier` is set.
    public static func normalizedAccessGroup(
        _ raw: String,
        teamIdentifier: String?
    ) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed.contains("$(") {
            if let team = teamIdentifier, isTeamIdentifier(team) {
                return "\(team).\(accessGroupSuffix)"
            }
            return accessGroupSuffix
        }
        let parts = trimmed.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        if parts.count == 2 {
            let team = String(parts[0])
            if isTeamIdentifier(team) {
                return trimmed
            }
        }
        if let team = teamIdentifier, isTeamIdentifier(team) {
            return "\(team).\(accessGroupSuffix)"
        }
        return trimmed
    }

    private static func isTeamIdentifier(_ value: String) -> Bool {
        value.count == 10
            && value.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) }
    }
}
