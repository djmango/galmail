import { invoke } from "@tauri-apps/api/core";
import {
  MemorySyncEngine,
  asAccountId,
  type AccountId,
  type MailProvider,
} from "@galmail/core-api";
import {
  createBrowserAdapters,
  DevVaultCrypto,
  MemoryEncryptedStore,
} from "@galmail/browser-adapters";
import {
  createGmailFixtureProvider,
  createGmailLiveProvider,
  createMicrosoftFixtureProvider,
  createMicrosoftLiveProvider,
  demoAccounts,
  listUnifiedInbox,
  type UnifiedAccount,
} from "@galmail/providers";
import { CommandRegistry } from "@galmail/keyboard";
import {
  BlindAwareNotificationPolicy,
  LocalClassifier,
  LocalReceiptService,
} from "@galmail/notifications";
import {
  LocalRemoteOptInService,
  REMOTE_OPT_IN_COPY,
} from "@galmail/remote-opt-in";
import { LocalDeviceLinking } from "@galmail/sync";
import {
  isNativeShell,
  readStoredAccountIds,
  readStoredProviderMode,
  reconcileAccountIdsFromKeychain,
  resolveDefaultComposeAccountId,
  type ProviderMode,
} from "./account-session";
import {
  googleClientIdConfigured,
  googleOAuthClientId,
} from "./gmail-connect";
import { microsoftClientId, microsoftTenant } from "./microsoft-connect";
import { NativeGmailSyncEngine, NativeMailStore } from "./native-sync";

function providerMode(): ProviderMode {
  const stored = readStoredProviderMode();
  if (stored) return stored;
  const configured = import.meta.env.VITE_GALMAIL_PROVIDER_MODE;
  if (configured === "fixture" || configured === "live") return configured;
  // Never silent-default to fixture; App gates unauthenticated users on SignInScreen.
  return "live";
}

function gmailConnectCapability() {
  const clientId = googleOAuthClientId();
  const native = isNativeShell();
  return {
    available: native && Boolean(clientId),
    clientIdConfigured: googleClientIdConfigured(),
    nativeShell: native,
  };
}

function microsoftConnectCapability() {
  const clientId = microsoftClientId();
  const native = isNativeShell();
  return {
    available: native && Boolean(clientId),
    clientIdConfigured: Boolean(clientId),
    nativeShell: native,
    tenant: microsoftTenant(),
  };
}

function baseServices() {
  return {
    adapters: createBrowserAdapters(),
    store: new MemoryEncryptedStore(),
    crypto: new DevVaultCrypto(),
    classifier: new LocalClassifier(),
    notifications: new BlindAwareNotificationPolicy(true),
    receipts: new LocalReceiptService(),
    remoteOptIn: new LocalRemoteOptInService(),
    commands: new CommandRegistry(),
  };
}

function normalizeLiveAccountId(raw: string): AccountId {
  const trimmed = raw.trim();
  if (trimmed.startsWith("gmail:") || trimmed.startsWith("microsoft:")) {
    const [prefix, ...rest] = trimmed.split(":");
    return asAccountId(`${prefix}:${rest.join(":").toLowerCase()}`);
  }
  // Env overrides may omit the provider prefix; prefer gmail for bare emails.
  return asAccountId(`gmail:${trimmed.toLowerCase()}`);
}

function collectLiveAccountIds(): AccountId[] {
  const fromSession = readStoredAccountIds().map(normalizeLiveAccountId);
  const fromEnv: AccountId[] = [];
  const envGmail = import.meta.env.VITE_GMAIL_ACCOUNT_ID?.trim();
  const envMs = import.meta.env.VITE_MICROSOFT_ACCOUNT_ID?.trim();
  if (envGmail) {
    fromEnv.push(
      asAccountId(
        envGmail.startsWith("gmail:")
          ? envGmail.toLowerCase()
          : `gmail:${envGmail.toLowerCase()}`,
      ),
    );
  }
  if (envMs) {
    fromEnv.push(
      asAccountId(
        envMs.startsWith("microsoft:")
          ? envMs.toLowerCase()
          : `microsoft:${envMs.toLowerCase()}`,
      ),
    );
  }
  return [...new Set([...fromSession, ...fromEnv].map(String))].map(asAccountId);
}

async function reconcileKeychainAccountIds(): Promise<AccountId[]> {
  try {
    const listed = await invoke<string[]>("list_oauth_account_ids");
    return reconcileAccountIdsFromKeychain(listed).map(asAccountId);
  } catch {
    return readStoredAccountIds().map(asAccountId);
  }
}

function createGmailProviderForAccount(
  accountId: AccountId,
  googleClientId: string,
): MailProvider {
  const nativeTokens = {
    async accessToken() {
      return "native-vault";
    },
    async refreshAccessToken() {
      return "native-vault";
    },
  };
  return createGmailLiveProvider({
    tokens: nativeTokens,
    http: {
      async request(input) {
        const url = new URL(input.url);
        const prefix = "/gmail/v1/users/me";
        if (!url.pathname.startsWith(prefix)) {
          throw new Error("Invalid Gmail API URL");
        }
        const result = await invoke<{ status: number; body: unknown }>(
          "gmail_api_request",
          {
            request: {
              accountId,
              clientId: googleClientId,
              method: input.method ?? "GET",
              path: `${url.pathname.slice(prefix.length)}${url.search}`,
              body: input.body ? JSON.parse(input.body) : undefined,
            },
          },
        );
        return {
          status: result.status,
          async json() {
            return result.body;
          },
        };
      },
    },
  });
}

function createMicrosoftProviderForAccount(
  accountId: AccountId,
  msClientId: string,
): MailProvider {
  return createMicrosoftLiveProvider({
    authorization: "transport",
    http: {
      async request(input) {
        const url = new URL(input.url);
        if (
          url.origin !== "https://graph.microsoft.com" ||
          !url.pathname.startsWith("/v1.0/")
        ) {
          throw new Error("Invalid Microsoft Graph API URL");
        }
        const result = await invoke<{
          status: number;
          body: unknown;
          retryAfter?: string;
        }>("microsoft_graph_request", {
          request: {
            accountId,
            clientId: msClientId,
            method: input.method ?? "GET",
            path: `${url.pathname}${url.search}`,
            body: input.body ? JSON.parse(input.body) : undefined,
          },
        });
        return {
          status: result.status,
          headers: { "retry-after": result.retryAfter },
          async json() {
            return result.body;
          },
        };
      },
    },
  });
}

async function createFixtureRuntime() {
  const gmail = createGmailFixtureProvider();
  const microsoft = createMicrosoftFixtureProvider();
  const accounts = demoAccounts(gmail, microsoft);
  const sync = new MemorySyncEngine(
    accounts.map((account) => ({
      accountId: account.accountId,
      provider: account.provider,
    })),
  );
  const services = baseServices();
  const { store, crypto } = services;
  const vaultKey = await crypto.generateVaultKey();
  const devices = new LocalDeviceLinking(store, crypto, vaultKey);

  // Local-first: hydrate before any optional network work.
  for (const a of accounts) {
    await sync.hydrateLocal(a.accountId);
  }
  const threads = await listUnifiedInbox(accounts);
  const accountIds = accounts.map((account) => account.accountId);
  const defaultAccountId = asAccountId(
    resolveDefaultComposeAccountId(accountIds.map(String)) ?? accountIds[0]!,
  );

  return {
    accounts,
    sync,
    ...services,
    vaultKey,
    devices,
    threads,
    providerMode: "fixture" as const,
    accountIds,
    defaultAccountId,
    /** @deprecated Use defaultAccountId */
    gmailAccountId: defaultAccountId,
    microsoftAccountId: asAccountId("microsoft:demo"),
    gmailOAuth: undefined,
    microsoftOAuth: undefined,
    gmailConnect: gmailConnectCapability(),
    microsoftConnect: microsoftConnectCapability(),
    nativeStore: undefined as NativeMailStore | undefined,
    copy: REMOTE_OPT_IN_COPY,
  };
}

async function createLiveRuntime() {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Live provider mode requires the native GalMail application",
    );
  }
  const googleClientId = googleOAuthClientId();
  const msClientId = microsoftClientId();

  // Prefer Keychain enumerate + session merge so orphans rehydrate.
  let accountIds = await reconcileKeychainAccountIds();
  if (accountIds.length === 0) {
    accountIds = collectLiveAccountIds();
  } else {
    const envIds = collectLiveAccountIds();
    accountIds = [...new Set([...accountIds, ...envIds].map(String))].map(
      asAccountId,
    );
  }

  if (accountIds.length === 0) {
    throw new Error(
      "Connect Gmail or Microsoft 365 before starting the live inbox",
    );
  }

  const hasGmail = accountIds.some((id) => String(id).startsWith("gmail:"));
  const hasMicrosoft = accountIds.some((id) =>
    String(id).startsWith("microsoft:"),
  );
  if (hasGmail && !googleClientId) {
    throw new Error("VITE_GOOGLE_DESKTOP_CLIENT_ID is required for live Gmail");
  }
  if (hasMicrosoft && !msClientId) {
    throw new Error(
      "VITE_MICROSOFT_CLIENT_ID is required for live Microsoft 365",
    );
  }

  const accounts: UnifiedAccount[] = accountIds.map((accountId) => {
    const id = String(accountId);
    if (id.startsWith("gmail:")) {
      const provider = createGmailProviderForAccount(
        accountId,
        googleClientId!,
      );
      return {
        accountId,
        provider,
        email: id.slice("gmail:".length),
        displayName: "Gmail",
      };
    }
    if (id.startsWith("microsoft:")) {
      const provider = createMicrosoftProviderForAccount(
        accountId,
        msClientId!,
      );
      return {
        accountId,
        provider,
        email: id.slice("microsoft:".length),
        displayName: "Microsoft 365",
      };
    }
    throw new Error(`Unsupported account id ${id}`);
  });

  const nativeStore = new NativeMailStore();
  const sync = new NativeGmailSyncEngine(
    accounts.map((account) => ({
      accountId: account.accountId,
      provider: account.provider,
    })),
    nativeStore,
  );
  const locals = await Promise.all(
    accounts.map((account) => sync.hydrateLocal(account.accountId)),
  );
  const services = baseServices();
  const vaultKey = await services.crypto.generateVaultKey();
  const devices = new LocalDeviceLinking(
    services.store,
    services.crypto,
    vaultKey,
  );

  const defaultAccountId = asAccountId(
    resolveDefaultComposeAccountId(accountIds.map(String)) ??
      String(accountIds[0]!),
  );
  const microsoftAccountId = accountIds.find((id) =>
    String(id).startsWith("microsoft:"),
  );

  return {
    accounts,
    sync,
    ...services,
    vaultKey,
    devices,
    threads: locals
      .flatMap((local) => local.threads)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    providerMode: "live" as const,
    accountIds,
    defaultAccountId,
    /** @deprecated Use defaultAccountId */
    gmailAccountId: defaultAccountId,
    microsoftAccountId,
    gmailOAuth: hasGmail
      ? {
          begin: () =>
            invoke<{ attemptId: string; authorizationUrl: string }>(
              "gmail_oauth_begin",
              { clientId: googleClientId! },
            ),
          complete: (attemptId: string) =>
            invoke<{
              accountId: string;
              email: string;
              grantedScopes: string[];
            }>("gmail_oauth_complete", { attemptId }),
          revoke: (targetAccountId: AccountId) =>
            invoke<boolean>("gmail_revoke", { accountId: targetAccountId }),
          remove: (targetAccountId: AccountId) =>
            invoke<{ localRecordsDeleted: number; remotelyRevoked: boolean }>(
              "gmail_remove_account",
              { accountId: targetAccountId },
            ),
        }
      : undefined,
    gmailConnect: gmailConnectCapability(),
    microsoftConnect: microsoftConnectCapability(),
    microsoftOAuth: msClientId
      ? {
          begin: (tenant = microsoftTenant()) =>
            invoke<{ attemptId: string; authorizationUrl: string }>(
              "microsoft_oauth_begin",
              { clientId: msClientId, tenant },
            ),
          complete: (attemptId: string) =>
            invoke<{
              accountId: string;
              email: string;
              tenant: string;
              grantedScopes: string[];
            }>("microsoft_oauth_complete", { attemptId }),
          remove: (targetAccountId: AccountId) =>
            invoke<{ localRecordsDeleted: number; remotelyRevoked: false }>(
              "microsoft_remove_account",
              { accountId: targetAccountId },
            ),
        }
      : undefined,
    nativeStore,
    copy: REMOTE_OPT_IN_COPY,
  };
}

export async function createGalMailRuntime() {
  // Fixture only when explicitly chosen (localStorage) or env-forced (e2e/CI).
  if (providerMode() === "fixture") {
    return createFixtureRuntime();
  }
  const hasLiveAccount =
    readStoredAccountIds().length > 0 ||
    Boolean(import.meta.env.VITE_GMAIL_ACCOUNT_ID?.trim()) ||
    Boolean(import.meta.env.VITE_MICROSOFT_ACCOUNT_ID?.trim());
  const hasProviderClient =
    googleClientIdConfigured() || Boolean(microsoftClientId());
  // Allow Microsoft-only live without a Google client ID (and vice versa).
  if (!hasLiveAccount || !hasProviderClient) {
    // Still try Keychain orphans when native + live mode.
    if (isNativeShell() && hasProviderClient) {
      try {
        const listed = await invoke<string[]>("list_oauth_account_ids");
        if (listed.length > 0) {
          reconcileAccountIdsFromKeychain(listed);
          return createLiveRuntime();
        }
      } catch {
        // No keychain accounts; surface a clear error instead of silent fixture.
      }
    }
    if (!hasLiveAccount) {
      throw new Error(
        "Connect Gmail or Microsoft 365 before starting the live inbox",
      );
    }
    throw new Error(
      "A provider client ID (Google or Microsoft) is required for live mode",
    );
  }
  return createLiveRuntime();
}

export type GalMailRuntime = Awaited<ReturnType<typeof createGalMailRuntime>>;
