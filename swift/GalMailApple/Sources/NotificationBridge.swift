import BackgroundTasks
import CryptoKit
import Foundation
import Security
import UIKit
import UserNotifications

/// Thin Swift glue for GalMail Apple hosts.
/// Platform glue only — not a second UI codebase.
///
/// Responsibilities (scaffolded):
/// - APNs registration token → Tauri/Rust command
/// - Actionable notification categories: archive, mark_read, delete, reply
/// - Notification Service Extension enrichment via App Group encrypted index
/// - Keychain access-group for vault wraps / OAuth tokens
/// - ASWebAuthenticationSession presentation for OAuth

public enum GalMailAppleBridge {
    public static let appGroupId = "group.com.galateacorp.mail"
    public static var keychainAccessGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "GalMailKeychainAccessGroup") as? String
            ?? "com.galateacorp.mail.keychain"
    }

    public static let appRefreshTask = "com.galateacorp.mail.refresh"
    public static let processingTask = "com.galateacorp.mail.sync"

    public static func categoryIdentifier() -> String { "GALMAIL_MAIL_ACTIONS" }

    public static func registerNotificationCategories() {
        let archive = UNNotificationAction(
            identifier: GalMailNotificationAction.archive.rawValue,
            title: "Archive"
        )
        let markRead = UNNotificationAction(
            identifier: GalMailNotificationAction.markRead.rawValue,
            title: "Mark Read"
        )
        let delete = UNNotificationAction(
            identifier: GalMailNotificationAction.delete.rawValue,
            title: "Delete",
            options: [.destructive, .authenticationRequired]
        )
        let reply = UNTextInputNotificationAction(
            identifier: GalMailNotificationAction.reply.rawValue,
            title: "Reply",
            options: [.authenticationRequired],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Reply"
        )
        let category = UNNotificationCategory(
            identifier: categoryIdentifier(),
            actions: [archive, markRead, delete, reply],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    public static func requestPushAuthorization(
        application: UIApplication,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        registerNotificationCategories()
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            if let error {
                completion(.failure(error))
            } else if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                    completion(.success(()))
                }
            } else {
                completion(.failure(GalMailAppleError.notificationPermissionDenied))
            }
        }
    }

    /// The token is opaque and may only be sent to GalMail's authenticated blind relay.
    public static func apnsToken(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    /// NSE must load ciphertext locally; APNs payload stays generic in blind mode.
    public static func enrichmentRiskNote() -> String {
        """
        Tauri 2 iOS + Notification Service Extension + App Group key sharing
        is the highest-risk integration path. Until validated on device,
        GalMail defaults to delayed/generic blind notifications.
        """
    }
}

public struct GalMailPendingAction: Codable {
    public let action: GalMailNotificationAction
    public let opaqueRouteId: String
    public let replyText: String?
    public let createdAt: Date
}

private struct GalMailLocalNotificationRecord: Codable {
    let title: String
    let body: String
    let expiresAt: Date
}

public enum GalMailNotificationIndex {
    /// Store enrichment locally. APNs receives only the opaque route identifier.
    public static func store(
        opaqueRouteId: String,
        title: String,
        body: String,
        expiresAt: Date
    ) throws {
        guard
            BlindPayloadPolicy.isOpaqueIdentifier(opaqueRouteId),
            title.utf8.count <= 1_024,
            body.utf8.count <= 4_096,
            expiresAt > Date(),
            let keyData = try GalMailKeychain.load(account: "notification-index-key"),
            let root = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: GalMailAppleBridge.appGroupId
            )
        else { throw GalMailAppleError.invalidBlindPayload }
        let plaintext = try JSONEncoder().encode(
            GalMailLocalNotificationRecord(
                title: title,
                body: body,
                expiresAt: expiresAt
            )
        )
        let sealed = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: keyData),
            authenticating: Data(opaqueRouteId.utf8)
        )
        guard let combined = sealed.combined else {
            throw GalMailAppleError.appGroupUnavailable
        }
        let directory = root.appendingPathComponent("NotificationIndex", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let digest = SHA256.hash(data: Data(opaqueRouteId.utf8))
            .map { String(format: "%02x", $0) }.joined()
        try combined.write(
            to: directory.appendingPathComponent("\(digest).sealed"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }
}

public enum GalMailActionQueue {
    private static let associatedData = Data("galmail/action-queue/v1".utf8)

    private static var directory: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: GalMailAppleBridge.appGroupId)?
            .appendingPathComponent("PendingActions", isDirectory: true)
    }

    /// Queue only opaque identifiers. Rust resolves the identifier after the app unlocks.
    public static func enqueue(
        response: UNNotificationResponse
    ) throws {
        guard
            let action = GalMailNotificationAction(rawValue: response.actionIdentifier),
            let hint = GalMailPushHint(userInfo: response.notification.request.content.userInfo)
        else { throw GalMailAppleError.invalidBlindPayload }
        let rawReply = (response as? UNTextInputNotificationResponse)?.userText
        guard rawReply?.utf8.count ?? 0 <= 16_384 else {
            throw GalMailAppleError.replyTooLarge
        }
        let reply = BlindPayloadPolicy.normalizedReply(rawReply)
        let pending = GalMailPendingAction(
            action: action,
            opaqueRouteId: hint.opaqueRouteId,
            replyText: reply,
            createdAt: Date()
        )
        guard let directory else { throw GalMailAppleError.appGroupUnavailable }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        guard let keyData = try GalMailKeychain.load(account: "action-queue-key") else {
            throw GalMailAppleError.appGroupUnavailable
        }
        let plaintext = try JSONEncoder().encode(pending)
        let sealed = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: keyData),
            authenticating: associatedData
        )
        guard let combined = sealed.combined else {
            throw GalMailAppleError.appGroupUnavailable
        }
        let destination = directory.appendingPathComponent("\(UUID().uuidString).sealed")
        try combined.write(
            to: destination,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    public static func drain() throws -> [GalMailPendingAction] {
        guard
            let directory,
            let keyData = try GalMailKeychain.load(account: "action-queue-key")
        else { return [] }
        let key = SymmetricKey(data: keyData)
        let decoder = JSONDecoder()
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "sealed" }
        var actions: [GalMailPendingAction] = []
        for url in urls {
            let combined = try Data(contentsOf: url)
            let plaintext = try AES.GCM.open(
                AES.GCM.SealedBox(combined: combined),
                using: key,
                authenticating: associatedData
            )
            let action = try decoder.decode(GalMailPendingAction.self, from: plaintext)
            guard action.createdAt > Date(timeIntervalSinceNow: -24 * 60 * 60) else {
                try FileManager.default.removeItem(at: url)
                continue
            }
            actions.append(action)
            try FileManager.default.removeItem(at: url)
        }
        return actions.sorted { $0.createdAt < $1.createdAt }
    }
}

public enum GalMailKeychain {
    public static func initializeExtensionKeysIfNeeded() throws {
        for account in [
            "notification-index-key",
            "share-inbox-key",
            "action-queue-key",
            "apns-registration-key",
        ] {
            if try load(account: account) == nil {
                var bytes = Data(count: 32)
                let status = bytes.withUnsafeMutableBytes {
                    SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
                }
                guard status == errSecSuccess else {
                    throw GalMailAppleError.keychain(status)
                }
                try store(bytes, account: account)
            }
        }
    }

    public static func store(_ data: Data, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.galateacorp.mail.vault",
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: GalMailAppleBridge.keychainAccessGroup,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw GalMailAppleError.keychain(status) }
    }

    public static func load(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.galateacorp.mail.vault",
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: GalMailAppleBridge.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw GalMailAppleError.keychain(status) }
        return result as? Data
    }
}

public enum GalMailBackgroundTasks {
    public typealias Handler = (@escaping (Bool) -> Void) -> Void

    public static func register(refresh: @escaping Handler, processing: @escaping Handler) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: GalMailAppleBridge.appRefreshTask,
            using: nil
        ) { task in
            guard let task = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            task.expirationHandler = { task.setTaskCompleted(success: false) }
            refresh { task.setTaskCompleted(success: $0) }
        }
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: GalMailAppleBridge.processingTask,
            using: nil
        ) { task in
            guard let task = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            task.expirationHandler = { task.setTaskCompleted(success: false) }
            processing { task.setTaskCompleted(success: $0) }
        }
    }

    public static func schedule() throws {
        let refresh = BGAppRefreshTaskRequest(identifier: GalMailAppleBridge.appRefreshTask)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try BGTaskScheduler.shared.submit(refresh)
        let processing = BGProcessingTaskRequest(identifier: GalMailAppleBridge.processingTask)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = false
        try BGTaskScheduler.shared.submit(processing)
    }
}

public enum GalMailAppleError: Error {
    case notificationPermissionDenied
    case invalidBlindPayload
    case replyTooLarge
    case appGroupUnavailable
    case keychain(OSStatus)
}
