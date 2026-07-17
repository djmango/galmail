import AuthenticationServices
import Foundation
import UIKit

/// Presents OAuth authorization with ASWebAuthenticationSession on iOS.
/// Desktop continues to use the system browser + localhost callback.
///
/// Callback schemes:
/// - Google: reverse client ID (`com.googleusercontent.apps.*`)
/// - Microsoft: `msauth.com.galateacorp.mail`
///
/// Rust/Tauri remains the token exchange authority — this only presents UI and
/// returns the callback URL (never logs codes/tokens).
@objc(GalMailOAuthPresenter)
public final class GalMailOAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    @objc public static let shared = GalMailOAuthPresenter()

    /// Provider-neutral OAuth Keychain service (tokens stored by Rust).
    public static let oauthKeychainService = "com.galmail.app.oauth"
    /// Legacy service; Rust migrates items into `oauthKeychainService`.
    public static let oauthKeychainServiceLegacy = "com.galmail.app.gmail-oauth"

    private var session: ASWebAuthenticationSession?
    /// attemptId → true while that session owns the presenter (for cancel fan-out).
    private var activeAttemptId: String?

    /// Start an OAuth session. On finish, delivers the callback URL to Rust.
    @objc public func present(
        urlString: String,
        callbackScheme: String,
        attemptId: String
    ) -> Bool {
        guard let url = URL(string: urlString), !callbackScheme.isEmpty, !attemptId.isEmpty else {
            return false
        }
        // Replace any in-flight session; cancel must not notify the new attempt.
        let superseded = activeAttemptId
        session?.cancel()
        session = nil
        if let superseded, superseded != attemptId {
            Self.deliverCallback(
                attemptId: superseded,
                callbackURL: nil,
                errorMessage: "OAuth attempt was superseded"
            )
        }
        activeAttemptId = attemptId

        // Capture attemptId in the completion handler — do not read `activeAttemptId`
        // later (a newer present() can overwrite it before the old callback runs).
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: callbackScheme
        ) { [weak self] callbackURL, error in
            guard let self else { return }
            if self.activeAttemptId == attemptId {
                self.session = nil
                self.activeAttemptId = nil
            }
            Self.deliverCallback(
                attemptId: attemptId,
                callbackURL: callbackURL,
                error: error
            )
        }
        session.presentationContextProvider = self
        // Shared cookies are required for Google's consent → custom-scheme redirect.
        // Ephemeral sessions commonly fail after Google consent with a generic
        // "Something went wrong" page and no usable callback (Microsoft is fine either way).
        session.prefersEphemeralWebBrowserSession = false
        self.session = session

        var started = false
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            started = session.start()
            if !started {
                if self.activeAttemptId == attemptId {
                    self.session = nil
                    self.activeAttemptId = nil
                }
            }
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 5)
        return started
    }

    /// Fallback: open the authorization URL in the system browser (no callback capture).
    @objc public func openInSystemBrowser(urlString: String) -> Bool {
        guard let url = URL(string: urlString) else { return false }
        var opened = false
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                opened = success
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 5)
        return opened
    }

    public func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return key
        }
        return scenes.flatMap(\.windows).first ?? ASPresentationAnchor()
    }

    private static func deliverCallback(
        attemptId: String,
        callbackURL: URL?,
        error: Error?
    ) {
        let message: String?
        if callbackURL != nil {
            message = nil
        } else if let error = error as? ASWebAuthenticationSessionError,
                  error.code == .canceledLogin
        {
            message = "OAuth sign-in was cancelled"
        } else if let error {
            message = error.localizedDescription
        } else {
            message = "OAuth callback omitted the authorization response"
        }
        deliverCallback(attemptId: attemptId, callbackURL: callbackURL, errorMessage: message)
    }

    private static func deliverCallback(
        attemptId: String,
        callbackURL: URL?,
        errorMessage: String?
    ) {
        attemptId.withCString { attemptPtr in
            if let callbackURL {
                let absolute = callbackURL.absoluteString
                if !absolute.isEmpty {
                    absolute.withCString { urlPtr in
                        galmail_ios_oauth_callback(attemptPtr, urlPtr, nil)
                    }
                    return
                }
            }
            let text = (errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
                $0.isEmpty ? nil : $0
            } ?? "OAuth sign-in was cancelled"
            text.withCString { errorPtr in
                galmail_ios_oauth_callback(attemptPtr, nil, errorPtr)
            }
        }
    }
}

@_silgen_name("galmail_ios_oauth_callback")
func galmail_ios_oauth_callback(
    _ attemptId: UnsafePointer<CChar>?,
    _ callbackURL: UnsafePointer<CChar>?,
    _ errorMessage: UnsafePointer<CChar>?
)

/// Present ASWebAuthenticationSession and deliver the redirect to Rust.
@_cdecl("galmail_ios_present_oauth")
public func galmailIosPresentOAuth(
    _ url: UnsafePointer<CChar>?,
    _ callbackScheme: UnsafePointer<CChar>?,
    _ attemptId: UnsafePointer<CChar>?
) -> Bool {
    guard let url, let callbackScheme, let attemptId else { return false }
    return GalMailOAuthPresenter.shared.present(
        urlString: String(cString: url),
        callbackScheme: String(cString: callbackScheme),
        attemptId: String(cString: attemptId)
    )
}

/// Legacy open-URL helper (no callback capture). Prefer `galmail_ios_present_oauth`.
@_cdecl("galmail_ios_open_oauth_url")
public func galmailIosOpenOAuthUrl(_ url: UnsafePointer<CChar>?) -> Bool {
    guard let url else { return false }
    let urlString = String(cString: url)
    return GalMailOAuthPresenter.shared.openInSystemBrowser(urlString: urlString)
}
