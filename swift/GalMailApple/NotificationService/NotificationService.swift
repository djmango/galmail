import UserNotifications

/// Scaffold for GalMail Notification Service Extension.
/// DO NOT put plaintext subjects from the network into the notification
/// unless the account has opted into remote processing AND local policy allows it.
final class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        // Blind default: keep generic title/body from relay.
        // Future: App Group lookup of encrypted local index by opaqueRouteId.
        if let bestAttemptContent {
            bestAttemptContent.title = "GalMail"
            bestAttemptContent.body = "New mail — open GalMail to read (blind mode)."
            contentHandler(bestAttemptContent)
        } else {
            contentHandler(request.content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }
}
