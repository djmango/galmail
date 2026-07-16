const PROVIDER_MODE_KEY = "galmail.providerMode";
const GMAIL_ACCOUNT_KEY = "galmail.gmailAccountId";

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

export function persistLiveGmailAccount(accountId: string): void {
  localStorage.setItem(PROVIDER_MODE_KEY, "live");
  localStorage.setItem(GMAIL_ACCOUNT_KEY, accountId);
}

export function clearLiveGmailAccount(): void {
  localStorage.removeItem(GMAIL_ACCOUNT_KEY);
  localStorage.setItem(PROVIDER_MODE_KEY, "fixture");
}

export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
