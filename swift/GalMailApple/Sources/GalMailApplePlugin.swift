import CryptoKit
import Foundation
import UIKit
import UserNotifications

@_silgen_name("galmail_ios_register_oauth_presenter")
func galmail_ios_register_oauth_presenter(
    _ present: (@convention(c) (
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?
    ) -> Bool)?
)

@_cdecl("galmail_apple_bootstrap")
public func galmailAppleBootstrap() {
    // Register before any UI can start OAuth. Release builds use
    // -fvisibility=hidden, so Rust cannot dlsym the Swift @_cdecl.
    galmail_ios_register_oauth_presenter(galmailIosPresentOAuth)
    GalMailApplePlugin.bootstrap()
}

/// Thin host bootstrap. Rust/Tauri remains the source of truth and drains the
/// App Group action/background queues after its encrypted store unlocks.
@objc(GalMailApplePlugin)
public final class GalMailApplePlugin: NSObject, UNUserNotificationCenterDelegate {
    @objc public static let shared = GalMailApplePlugin()

    @objc public static func bootstrap() {
        // Touch the OAuth presenter so its @_cdecl entry points stay linked for
        // Rust dlsym(RTLD_DEFAULT). main.mm also retains the C symbols.
        _ = GalMailOAuthPresenter.shared
        try? GalMailKeychain.initializeExtensionKeysIfNeeded()
        GalMailAppleBridge.registerNotificationCategories()
        UNUserNotificationCenter.current().delegate = shared
        GalMailBackgroundTasks.register(
            refresh: { completion in
                completion(queueWakeReason("refresh"))
            },
            processing: { completion in
                completion(queueWakeReason("processing"))
            }
        )
        try? GalMailBackgroundTasks.schedule()
    }

    @objc public static func registerForPush() {
        GalMailAppleBridge.requestPushAuthorization(
            application: UIApplication.shared
        ) { _ in
            // The UI reads authorization state through the native command.
            // No mail or token material is logged.
        }
    }

    /// Called by the Tauri iOS host's APNs delegate callback. The opaque token
    /// is queued for authenticated relay registration after Rust unlocks.
    @objc public static func didRegisterForRemoteNotifications(deviceToken: Data) {
        guard let root = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: GalMailAppleBridge.appGroupId
        ) else { return }
        guard
            let keyData = try? GalMailKeychain.load(account: "apns-registration-key")
        else { return }
        let token = Data(GalMailAppleBridge.apnsToken(deviceToken).utf8)
        guard
            let sealed = try? AES.GCM.seal(
                token,
                using: SymmetricKey(data: keyData),
                authenticating: Data("galmail/apns-token/v1".utf8)
            ),
            let combined = sealed.combined
        else { return }
        try? combined.write(
            to: root.appendingPathComponent("PendingAPNsToken.sealed"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    /// Drained once by Rust and sent only to the authenticated blind relay.
    @objc public static func drainPendingAPNsToken() -> String? {
        guard
            let root = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: GalMailAppleBridge.appGroupId
            ),
            let keyData = try? GalMailKeychain.load(account: "apns-registration-key")
        else { return nil }
        let url = root.appendingPathComponent("PendingAPNsToken.sealed")
        guard
            let combined = try? Data(contentsOf: url),
            let box = try? AES.GCM.SealedBox(combined: combined),
            let plaintext = try? AES.GCM.open(
                box,
                using: SymmetricKey(data: keyData),
                authenticating: Data("galmail/apns-token/v1".utf8)
            ),
            let token = String(data: plaintext, encoding: .utf8)
        else { return nil }
        try? FileManager.default.removeItem(at: url)
        return token
    }

    @objc public static func drainPendingActionsJSON() -> Data? {
        guard let actions = try? GalMailActionQueue.drain() else { return nil }
        return try? JSONEncoder().encode(actions)
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        try? GalMailActionQueue.enqueue(response: response)
        completionHandler()
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }

    private static func queueWakeReason(_ reason: String) -> Bool {
        guard let root = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: GalMailAppleBridge.appGroupId
        ) else { return false }
        let directory = root.appendingPathComponent("WakeRequests", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            try Data(reason.utf8).write(
                to: directory.appendingPathComponent("\(UUID().uuidString).wake"),
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            try? GalMailBackgroundTasks.schedule()
            return true
        } catch {
            return false
        }
    }
}
