import CryptoKit
import MobileCoreServices
import Security
import UniformTypeIdentifiers
import UIKit

private struct SharedDraftEnvelope: Codable {
    let id: UUID
    let createdAt: Date
    let typeIdentifier: String
    let originalName: String?
    let payload: Data
}

final class ShareViewController: UIViewController {
    private let maximumPayloadBytes = 25 * 1_024 * 1_024

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        importFirstSupportedItem()
    }

    private func importFirstSupportedItem() {
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []
        guard let provider = providers.first(where: isSupported) else {
            finish(NSError(domain: "GalMailShare", code: 1))
            return
        }
        let type = preferredType(for: provider)
        provider.loadDataRepresentation(forTypeIdentifier: type.identifier) {
            [weak self] data, error in
            guard let self else { return }
            do {
                if let error { throw error }
                guard let data, data.count <= maximumPayloadBytes else {
                    throw NSError(domain: "GalMailShare", code: 2)
                }
                try persist(
                    SharedDraftEnvelope(
                        id: UUID(),
                        createdAt: Date(),
                        typeIdentifier: type.identifier,
                        originalName: provider.suggestedName,
                        payload: data
                    )
                )
                finish(nil)
            } catch {
                finish(error)
            }
        }
    }

    private func isSupported(_ provider: NSItemProvider) -> Bool {
        [UTType.plainText, .html, .url, .image, .pdf, .data].contains {
            provider.hasItemConformingToTypeIdentifier($0.identifier)
        }
    }

    private func preferredType(for provider: NSItemProvider) -> UTType {
        [UTType.plainText, .html, .url, .image, .pdf, .data].first {
            provider.hasItemConformingToTypeIdentifier($0.identifier)
        } ?? .data
    }

    private func persist(_ envelope: SharedDraftEnvelope) throws {
        guard let root = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.app.galmail.client"
        ) else { throw NSError(domain: "GalMailShare", code: 3) }
        let directory = root.appendingPathComponent("ShareInbox", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        let plaintext = try JSONEncoder().encode(envelope)
        let key = try loadShareKey()
        let associatedData = Data(envelope.id.uuidString.utf8)
        let sealed = try AES.GCM.seal(
            plaintext,
            using: key,
            authenticating: associatedData
        )
        guard let combined = sealed.combined else {
            throw NSError(domain: "GalMailShare", code: 4)
        }
        try combined.write(
            to: directory.appendingPathComponent("\(envelope.id.uuidString).sealed"),
            options: [.atomic, .completeFileProtection]
        )
    }

    private func loadShareKey() throws -> SymmetricKey {
        let accessGroup = Bundle.main.object(
            forInfoDictionaryKey: "GalMailKeychainAccessGroup"
        ) as? String ?? "app.galmail.client.keychain"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.galmail.client.vault",
            kSecAttrAccount as String: "share-inbox-key",
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

    private func finish(_ error: Error?) {
        DispatchQueue.main.async { [weak self] in
            if let error {
                self?.extensionContext?.cancelRequest(withError: error)
            } else {
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }
}
