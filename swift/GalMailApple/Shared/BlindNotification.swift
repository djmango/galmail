import Foundation

public enum GalMailNotificationAction: String, CaseIterable, Codable {
    case archive
    case markRead = "mark_read"
    case delete
    case reply
}

public struct GalMailPushHint: Codable {
    /// Opaque route id only — never subject/body in blind mode.
    public let opaqueRouteId: String
    public let eventType: String

    public init?(userInfo: [AnyHashable: Any]) {
        guard
            let route = userInfo["opaqueRouteId"] as? String,
            let event = userInfo["eventType"] as? String,
            BlindPayloadPolicy.isOpaqueIdentifier(route),
            BlindPayloadPolicy.allowedEvents.contains(event)
        else { return nil }
        opaqueRouteId = route
        eventType = event
    }
}

public enum BlindPayloadPolicy {
    public static let allowedEvents = ["mail_changed", "sync_required"]
    public static let genericTitle = "GalMail"
    public static let genericBody = "New mail — open GalMail to read."

    public static func isOpaqueIdentifier(_ value: String) -> Bool {
        (20 ... 180).contains(value.utf8.count)
            && value.allSatisfy {
                $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0))
            }
    }

    /// Reject any relay payload that attempts to inject mail metadata.
    public static func isGenericBlindPayload(_ userInfo: [AnyHashable: Any]) -> Bool {
        let permitted = Set(["opaqueRouteId", "eventType", "aps"])
        guard userInfo.keys.allSatisfy({
            permitted.contains(String(describing: $0))
        }) else { return false }
        return GalMailPushHint(userInfo: userInfo) != nil
    }

    public static func normalizedReply(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.utf8.count <= 16_384 else { return nil }
        return normalized
    }
}
