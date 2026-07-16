import { invoke } from "@tauri-apps/api/core";
import { persistLiveMicrosoftAccount } from "./account-session";
import { invokeErrorMessage } from "./gmail-connect";

export type ConnectedMicrosoftAccount = {
  accountId: string;
  email: string;
  tenant: string;
  grantedScopes: string[];
};

export function microsoftClientId(): string | undefined {
  const value = import.meta.env.VITE_MICROSOFT_CLIENT_ID?.trim();
  return value || undefined;
}

export function microsoftTenant(): string {
  const value = import.meta.env.VITE_MICROSOFT_TENANT?.trim();
  return value || "common";
}

export async function connectMicrosoftWithPkce(
  clientId = microsoftClientId(),
  tenant = microsoftTenant(),
): Promise<ConnectedMicrosoftAccount> {
  if (!clientId) {
    throw new Error("VITE_MICROSOFT_CLIENT_ID is not configured in sops");
  }
  try {
    const began = await invoke<{ attemptId: string; authorizationUrl: string }>(
      "microsoft_oauth_begin",
      { clientId, tenant },
    );
    const connected = await invoke<ConnectedMicrosoftAccount>(
      "microsoft_oauth_complete",
      {
        attemptId: began.attemptId,
      },
    );
    persistLiveMicrosoftAccount(connected.accountId);
    return connected;
  } catch (error) {
    throw new Error(invokeErrorMessage(error, "Microsoft sign-in failed"));
  }
}

export async function disconnectMicrosoftAccount(
  accountId: string,
): Promise<void> {
  await invoke<{ localRecordsDeleted: number; remotelyRevoked: false }>(
    "microsoft_remove_account",
    { accountId },
  );
}
