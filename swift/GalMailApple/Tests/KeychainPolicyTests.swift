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

    func testNormalizedAccessGroupKeepsTeamPrefix() {
        let prefixed = "A95F4H2423.com.galateacorp.mail.keychain"
        XCTAssertEqual(
            GalMailKeychainPolicy.normalizedAccessGroup(
                prefixed,
                teamIdentifier: "A95F4H2423"
            ),
            prefixed
        )
    }

    func testNormalizedAccessGroupRepairsBareSuffix() {
        XCTAssertEqual(
            GalMailKeychainPolicy.normalizedAccessGroup(
                "com.galateacorp.mail.keychain",
                teamIdentifier: "A95F4H2423"
            ),
            "A95F4H2423.com.galateacorp.mail.keychain"
        )
    }

    func testRustDeviceVaultAccountIsStable() {
        XCTAssertEqual(
            GalMailKeychainPolicy.rustDeviceVaultAccount,
            "device-wrap-key-v1"
        )
    }
}
