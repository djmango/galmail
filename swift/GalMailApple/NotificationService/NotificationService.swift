import CryptoKit
import Foundation
import Security
import UserNotifications

private struct LocalNotificationRecord: Codable {
    let title: String
    let body: String
    let expiresAt: Date
}

final class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let content = bestAttemptContent else {
            contentHandler(request.content)
            return
        }
        applyGenericFallback(to: content)
        guard
            BlindPayloadPolicy.isGenericBlindPayload(request.content.userInfo),
            let hint = GalMailPushHint(userInfo: request.content.userInfo),
            let record = try? loadLocalRecord(for: hint.opaqueRouteId),
            record.expiresAt > Date()
        else {
            contentHandler(content)
            return
        }
        // Enrichment came from the encrypted App Group index, never APNs.
        content.title = String(record.title.prefix(180))
        content.body = String(record.body.prefix(500))
        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttemptContent {
            applyGenericFallback(to: bestAttemptContent)
            contentHandler(bestAttemptContent)
        }
    }

    private func applyGenericFallback(to content: UNMutableNotificationContent) {
        content.title = BlindPayloadPolicy.genericTitle
        content.body = BlindPayloadPolicy.genericBody
        content.subtitle = ""
        content.categoryIdentifier = "GALMAIL_MAIL_ACTIONS"
        content.attachments = []
    }

    private func loadLocalRecord(for route: String) throws -> LocalNotificationRecord {
        guard
            let root = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.galateacorp.mail"
            )
        else { throw CocoaError(.fileNoSuchFile) }
        let digest = SHA256.hash(data: Data(route.utf8))
            .map { String(format: "%02x", $0) }.joined()
        let sealed = try Data(
            contentsOf: root
                .appendingPathComponent("NotificationIndex", isDirectory: true)
                .appendingPathComponent("\(digest).sealed"),
            options: [.mappedIfSafe]
        )
        let key = try loadIndexKey()
        let box = try AES.GCM.SealedBox(combined: sealed)
        let plaintext = try AES.GCM.open(box, using: key, authenticating: Data(route.utf8))
        return try JSONDecoder().decode(LocalNotificationRecord.self, from: plaintext)
    }

    private func loadIndexKey() throws -> SymmetricKey {
        let accessGroup = Bundle.main.object(
            forInfoDictionaryKey: "GalMailKeychainAccessGroup"
        ) as? String ?? "com.galateacorp.mail.keychain"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.galateacorp.mail.vault",
            kSecAttrAccount as String: "notification-index-key",
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data, data.count == 32 else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        return SymmetricKey(data: data)
    }
}
