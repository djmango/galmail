const PROVIDER_MODE_KEY = "galmail.providerMode";
const ACCOUNT_IDS_KEY = "galmail.accountIds";
/** @deprecated Migrated into ACCOUNT_IDS_KEY on read. */
const GMAIL_ACCOUNT_KEY = "galmail.gmailAccountId";
/** @deprecated Migrated into ACCOUNT_IDS_KEY on read. */
const MICROSOFT_ACCOUNT_KEY = "galmail.microsoftAccountId";
const INBOX_FILTER_KEY = "galmail.inboxAccountFilter";
const LAST_COMPOSE_ACCOUNT_KEY = "galmail.lastComposeAccountId";

export type ProviderMode = "fixture" | "live";
export type InboxAccountFilter = "all" | string;

function normalizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("gmail:") || trimmed.startsWith("microsoft:")) {
    const [prefix, ...rest] = trimmed.split(":");
    return `${prefix}:${rest.join(":").toLowerCase()}`;
  }
  return trimmed.toLowerCase();
}

function readLegacyScalarIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  const ids: string[] = [];
  const gmail = localStorage.getItem(GMAIL_ACCOUNT_KEY)?.trim();
  const microsoft = localStorage.getItem(MICROSOFT_ACCOUNT_KEY)?.trim();
  if (gmail) ids.push(normalizeAccountId(gmail));
  if (microsoft) ids.push(normalizeAccountId(microsoft));
  return ids;
}

function writeAccountIds(ids: string[]): void {
  const unique = [...new Set(ids.map(normalizeAccountId).filter(Boolean))];
  if (unique.length === 0) {
    localStorage.removeItem(ACCOUNT_IDS_KEY);
    localStorage.removeItem(GMAIL_ACCOUNT_KEY);
    localStorage.removeItem(MICROSOFT_ACCOUNT_KEY);
    return;
  }
  localStorage.setItem(ACCOUNT_IDS_KEY, JSON.stringify(unique));
  // Keep legacy keys in sync for older readers during migration.
  const gmail = unique.find((id) => id.startsWith("gmail:"));
  const microsoft = unique.find((id) => id.startsWith("microsoft:"));
  if (gmail) localStorage.setItem(GMAIL_ACCOUNT_KEY, gmail);
  else localStorage.removeItem(GMAIL_ACCOUNT_KEY);
  if (microsoft) localStorage.setItem(MICROSOFT_ACCOUNT_KEY, microsoft);
  else localStorage.removeItem(MICROSOFT_ACCOUNT_KEY);
}

export function readStoredProviderMode(): ProviderMode | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(PROVIDER_MODE_KEY);
  return value === "fixture" || value === "live" ? value : null;
}

/** All connected live account IDs (migrates legacy scalar keys on read). */
export function readStoredAccountIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(ACCOUNT_IDS_KEY);
  let ids: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        ids = parsed
          .filter((item): item is string => typeof item === "string")
          .map(normalizeAccountId)
          .filter(Boolean);
      }
    } catch {
      ids = [];
    }
  }
  const legacy = readLegacyScalarIds();
  if (legacy.length > 0) {
    const merged = [...new Set([...ids, ...legacy])];
    if (
      merged.length !== ids.length ||
      merged.some((id, index) => id !== ids[index])
    ) {
      writeAccountIds(merged);
    }
    return merged;
  }
  return [...new Set(ids)];
}

export function readStoredGmailAccountId(): string | null {
  return readStoredAccountIds().find((id) => id.startsWith("gmail:")) ?? null;
}

export function readStoredMicrosoftAccountId(): string | null {
  return (
    readStoredAccountIds().find((id) => id.startsWith("microsoft:")) ?? null
  );
}

export function addLiveAccount(accountId: string): void {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return;
  const next = [...readStoredAccountIds()];
  if (!next.includes(normalized)) next.push(normalized);
  localStorage.setItem(PROVIDER_MODE_KEY, "live");
  writeAccountIds(next);
}

export function removeLiveAccount(accountId: string): void {
  const normalized = normalizeAccountId(accountId);
  const next = readStoredAccountIds().filter((id) => id !== normalized);
  writeAccountIds(next);
  const filter = readInboxAccountFilter();
  if (filter !== "all" && filter === normalized) {
    persistInboxAccountFilter("all");
  }
  if (next.length === 0) {
    localStorage.removeItem(PROVIDER_MODE_KEY);
  }
}

/** @deprecated Prefer addLiveAccount - appends instead of replacing. */
export function persistLiveGmailAccount(accountId: string): void {
  addLiveAccount(
    accountId.startsWith("gmail:") ? accountId : `gmail:${accountId}`,
  );
}

/** @deprecated Prefer addLiveAccount - appends instead of replacing. */
export function persistLiveMicrosoftAccount(accountId: string): void {
  addLiveAccount(
    accountId.startsWith("microsoft:")
      ? accountId
      : `microsoft:${accountId}`,
  );
}

/** @deprecated Prefer removeLiveAccount for a specific ID. */
export function clearLiveGmailAccount(): void {
  for (const id of readStoredAccountIds().filter((item) =>
    item.startsWith("gmail:"),
  )) {
    removeLiveAccount(id);
  }
}

/** @deprecated Prefer removeLiveAccount for a specific ID. */
export function clearLiveMicrosoftAccount(): void {
  for (const id of readStoredAccountIds().filter((item) =>
    item.startsWith("microsoft:"),
  )) {
    removeLiveAccount(id);
  }
}

export function readInboxAccountFilter(): InboxAccountFilter {
  if (typeof localStorage === "undefined") return "all";
  const value = localStorage.getItem(INBOX_FILTER_KEY)?.trim();
  if (!value || value === "all") return "all";
  return normalizeAccountId(value);
}

export function persistInboxAccountFilter(filter: InboxAccountFilter): void {
  if (filter === "all") {
    localStorage.setItem(INBOX_FILTER_KEY, "all");
    return;
  }
  localStorage.setItem(INBOX_FILTER_KEY, normalizeAccountId(filter));
}

export function readLastComposeAccountId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(LAST_COMPOSE_ACCOUNT_KEY)?.trim();
  return value ? normalizeAccountId(value) : null;
}

export function persistLastComposeAccountId(accountId: string): void {
  localStorage.setItem(
    LAST_COMPOSE_ACCOUNT_KEY,
    normalizeAccountId(accountId),
  );
}

/** Resolve compose From default: filtered account → last-used → first. */
export function resolveDefaultComposeAccountId(
  accountIds: string[],
  inboxFilter: InboxAccountFilter = readInboxAccountFilter(),
): string | null {
  if (accountIds.length === 0) return null;
  if (inboxFilter !== "all" && accountIds.includes(inboxFilter)) {
    return inboxFilter;
  }
  const last = readLastComposeAccountId();
  if (last && accountIds.includes(last)) return last;
  return accountIds[0] ?? null;
}

/** Explicitly choose the local demo mailbox (skips the sign-in gate). */
export function persistDemoMailboxPreference(): void {
  localStorage.setItem(PROVIDER_MODE_KEY, "fixture");
}

/**
 * Unauthenticated cold start should land on SignInScreen.
 * Skip only when a live account exists, the user explicitly chose demo/fixture,
 * or CI/env forces fixture (e.g. Playwright).
 */
export function shouldPromptSignIn(_input?: {
  googleClientIdConfigured: boolean;
  microsoftClientIdConfigured: boolean;
}): boolean {
  if (readStoredAccountIds().length > 0) {
    return false;
  }
  if (readStoredProviderMode() === "fixture") {
    return false;
  }
  if (import.meta.env.VITE_GALMAIL_PROVIDER_MODE === "fixture") {
    return false;
  }
  return true;
}

/** @deprecated Prefer shouldPromptSignIn - kept for existing call sites during migration. */
export function shouldPromptGmailSignIn(clientIdConfigured: boolean): boolean {
  return shouldPromptSignIn({
    googleClientIdConfigured: clientIdConfigured,
    microsoftClientIdConfigured: false,
  });
}

export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Merge Keychain-listed account IDs into the session (orphan reconcile). */
export function reconcileAccountIdsFromKeychain(keychainIds: string[]): string[] {
  const fromKeychain = keychainIds
    .map(normalizeAccountId)
    .filter(
      (id) => id.startsWith("gmail:") || id.startsWith("microsoft:"),
    );
  if (fromKeychain.length === 0) return readStoredAccountIds();
  const merged = [...new Set([...readStoredAccountIds(), ...fromKeychain])];
  if (merged.length > 0) {
    localStorage.setItem(PROVIDER_MODE_KEY, "live");
    writeAccountIds(merged);
  }
  return merged;
}
