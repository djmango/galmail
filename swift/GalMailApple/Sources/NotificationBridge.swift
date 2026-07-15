import Foundation

/// Thin Swift glue for GalMail Apple hosts.
/// Platform glue only — not a second UI codebase.
///
/// Responsibilities (scaffolded):
/// - APNs registration token → Tauri/Rust command
/// - Actionable notification categories: archive, mark_read, delete, reply
/// - Notification Service Extension enrichment via App Group encrypted index
/// - Keychain access-group for vault wraps / OAuth tokens
/// - ASWebAuthenticationSession presentation for OAuth

public enum GalMailNotificationAction: String, CaseIterable {
    case archive
    case markRead = "mark_read"
    case delete
    case reply
}

public struct GalMailPushHint: Codable {
    /// Opaque route id only — never subject/body in blind mode
    public let opaqueRouteId: String
    public let eventType: String
}

public enum GalMailAppleBridge {
    public static let appGroupId = "group.app.galmail.client"
    public static let keychainAccessGroup = "app.galmail.client.keychain"

    public static func categoryIdentifier() -> String { "GALMAIL_MAIL_ACTIONS" }

    /// NSE must load ciphertext locally; APNs payload stays generic in blind mode.
    public static func enrichmentRiskNote() -> String {
        """
        Tauri 2 iOS + Notification Service Extension + App Group key sharing
        is the highest-risk integration path. Until validated on device,
        GalMail defaults to delayed/generic blind notifications.
        """
    }
}
