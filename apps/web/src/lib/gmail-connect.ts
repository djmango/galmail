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

export async function connectGmailWithPkce(
  clientId = googleDesktopClientId(),
): Promise<ConnectedGmailAccount> {
  if (!clientId) {
    throw new Error("VITE_GOOGLE_DESKTOP_CLIENT_ID is not configured in sops");
  }
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
}

export async function disconnectGmailAccount(accountId: string): Promise<void> {
  await invoke<{ localRecordsDeleted: number; remotelyRevoked: boolean }>(
    "gmail_remove_account",
    { accountId },
  );
}
