import { invoke } from "@tauri-apps/api/core";
import { persistLiveGmailAccount } from "./account-session";

export type ConnectedGmailAccount = {
  accountId: string;
  email: string;
  grantedScopes: string[];
};

export function googleDesktopClientId(): string | undefined {
  const value = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID?.trim();
  return value || undefined;
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
  clientId = googleDesktopClientId(),
): Promise<ConnectedGmailAccount> {
  if (!clientId) {
    throw new Error("VITE_GOOGLE_DESKTOP_CLIENT_ID is not configured in sops");
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
    persistLiveGmailAccount(connected.accountId);
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
