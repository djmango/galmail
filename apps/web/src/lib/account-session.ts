const PROVIDER_MODE_KEY = "galmail.providerMode";
const GMAIL_ACCOUNT_KEY = "galmail.gmailAccountId";
const MICROSOFT_ACCOUNT_KEY = "galmail.microsoftAccountId";

export type ProviderMode = "fixture" | "live";

export function readStoredProviderMode(): ProviderMode | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(PROVIDER_MODE_KEY);
  return value === "fixture" || value === "live" ? value : null;
}

export function readStoredGmailAccountId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(GMAIL_ACCOUNT_KEY)?.trim();
  return value ? value : null;
}

export function readStoredMicrosoftAccountId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(MICROSOFT_ACCOUNT_KEY)?.trim();
  return value ? value : null;
}

export function persistLiveGmailAccount(accountId: string): void {
  localStorage.setItem(PROVIDER_MODE_KEY, "live");
  localStorage.setItem(GMAIL_ACCOUNT_KEY, accountId);
}

export function persistLiveMicrosoftAccount(accountId: string): void {
  localStorage.setItem(PROVIDER_MODE_KEY, "live");
  localStorage.setItem(MICROSOFT_ACCOUNT_KEY, accountId);
}

export function clearLiveGmailAccount(): void {
  localStorage.removeItem(GMAIL_ACCOUNT_KEY);
  if (!readStoredMicrosoftAccountId()) {
    localStorage.removeItem(PROVIDER_MODE_KEY);
  }
}

export function clearLiveMicrosoftAccount(): void {
  localStorage.removeItem(MICROSOFT_ACCOUNT_KEY);
  if (!readStoredGmailAccountId()) {
    localStorage.removeItem(PROVIDER_MODE_KEY);
  }
}

/** Explicitly choose the local demo mailbox (skips the sign-in gate). */
export function persistDemoMailboxPreference(): void {
  localStorage.setItem(PROVIDER_MODE_KEY, "fixture");
}

export function shouldPromptSignIn(input: {
  googleClientIdConfigured: boolean;
  microsoftClientIdConfigured: boolean;
}): boolean {
  if (!isNativeShell()) return false;
  if (!input.googleClientIdConfigured && !input.microsoftClientIdConfigured) {
    return false;
  }
  if (readStoredGmailAccountId() || readStoredMicrosoftAccountId()) {
    return false;
  }
  // Only skip the gate when the user explicitly chose demo mail.
  return readStoredProviderMode() !== "fixture";
}

/** @deprecated Prefer shouldPromptSignIn — kept for existing call sites during migration. */
export function shouldPromptGmailSignIn(clientIdConfigured: boolean): boolean {
  return shouldPromptSignIn({
    googleClientIdConfigured: clientIdConfigured,
    microsoftClientIdConfigured: false,
  });
}

export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
