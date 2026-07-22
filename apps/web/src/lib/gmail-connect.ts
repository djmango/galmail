import { invoke } from "@tauri-apps/api/core";
import { addLiveAccount } from "./account-session";

export type ConnectedGmailAccount = {
  accountId: string;
  email: string;
  grantedScopes: string[];
};

export function googleDesktopClientId(): string | undefined {
  const value = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID?.trim();
  return value || undefined;
}

/** iOS Google client ID (custom-scheme / no secret). */
export function googleIosClientId(): string | undefined {
  const value = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID?.trim();
  return value || undefined;
}

/** True when any Google OAuth client ID is present in the build. */
export function googleClientIdConfigured(): boolean {
  return Boolean(googleIosClientId() || googleDesktopClientId());
}

function isAppleMobileWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  // Tauri iOS WKWebView reports iPhone/iPad; also cover iPad desktop-UA mode.
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Client ID for the current platform's OAuth begin call. */
export function googleOAuthClientId(): string | undefined {
  if (isAppleMobileWebView()) {
    // iOS must use the iOS OAuth client (custom-scheme / no secret). Never fall
    // back to the desktop client - that yields Google's generic failure after
    // consent (redirect_uri is not registered for Desktop clients).
    return googleIosClientId();
  }
  // Desktop/macOS must use the desktop client; do not silently use the iOS ID.
  return googleDesktopClientId();
}

/** Tauri often rejects with a bare string, not an Error instance. */
export function invokeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

export async function connectGmailWithPkce(
  clientId = googleOAuthClientId(),
): Promise<ConnectedGmailAccount> {
  if (!clientId) {
    throw new Error(
      isAppleMobileWebView()
        ? "VITE_GOOGLE_IOS_CLIENT_ID is not configured in sops (required for iOS Google sign-in)"
        : "VITE_GOOGLE_DESKTOP_CLIENT_ID is not configured in sops",
    );
  }
  try {
    const began = await invoke<{ attemptId: string; authorizationUrl: string }>(
      "gmail_oauth_begin",
      { clientId },
    );
    const connected = await invoke<ConnectedGmailAccount>(
      "gmail_oauth_complete",
      {
        attemptId: began.attemptId,
      },
    );
    addLiveAccount(connected.accountId);
    return connected;
  } catch (error) {
    throw new Error(invokeErrorMessage(error, "Google sign-in failed"));
  }
}

export async function disconnectGmailAccount(accountId: string): Promise<void> {
  await invoke<{ localRecordsDeleted: number; remotelyRevoked: boolean }>(
    "gmail_remove_account",
    { accountId },
  );
}
