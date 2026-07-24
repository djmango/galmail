import XCTest

final class KeychainPolicyTests: XCTestCase {
    func testVaultServicesStayDistinct() {
        XCTAssertNotEqual(
            GalMailKeychainPolicy.extensionVaultService,
            GalMailKeychainPolicy.rustDeviceVaultService
        )
        XCTAssertNotEqual(
            GalMailKeychainPolicy.oauthService,
            GalMailKeychainPolicy.rustDeviceVaultService
        )
        XCTAssertNotEqual(
            GalMailKeychainPolicy.oauthService,
            GalMailKeychainPolicy.extensionVaultService
        )
    }

    func testOAuthLegacyIsDistinct() {
        XCTAssertNotEqual(
            GalMailKeychainPolicy.oauthService,
            GalMailKeychainPolicy.oauthServiceLegacy
        )
    }

    func testAccessibilityIsAfterFirstUnlockThisDeviceOnly() {
        XCTAssertEqual(
            GalMailKeychainPolicy.accessible as String,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
        )
    }

    func testAccessGroupSuffixMatchesEntitlementContract() {
        XCTAssertEqual(
            GalMailKeychainPolicy.accessGroupSuffix,
            "com.galateacorp.mail.keychain"
        )
        XCTAssertEqual(
            GalMailKeychainPolicy.accessGroupInfoKey,
            "GalMailKeychainAccessGroup"
        )
    }

    func testRustDeviceVaultAccountIsStable() {
        XCTAssertEqual(
            GalMailKeychainPolicy.rustDeviceVaultAccount,
            "device-wrap-key-v1"
        )
    }
}
