import XCTest

final class BlindNotificationTests: XCTestCase {
    func testAcceptsOnlyOpaqueGenericHints() {
        XCTAssertTrue(
            BlindPayloadPolicy.isGenericBlindPayload([
                "opaqueRouteId": "opaque-route-identifier-1234567890",
                "eventType": "mail_changed",
            ])
        )
        XCTAssertFalse(
            BlindPayloadPolicy.isGenericBlindPayload([
                "opaqueRouteId": "opaque-route-identifier-1234567890",
                "eventType": "mail_changed",
                "subject": "must never arrive through APNs",
            ])
        )
    }

    func testRejectsUnexpectedEventsAndIdentifiers() {
        XCTAssertNil(
            GalMailPushHint(userInfo: [
                "opaqueRouteId": "short",
                "eventType": "mail_changed",
            ])
        )
        XCTAssertNil(
            GalMailPushHint(userInfo: [
                "opaqueRouteId": "opaque-route-identifier-1234567890",
                "eventType": "plaintext_mail",
            ])
        )
    }
}
