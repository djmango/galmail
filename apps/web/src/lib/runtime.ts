import { invoke } from "@tauri-apps/api/core";
import {
  MemorySyncEngine,
  asAccountId,
  type AccountId,
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
  readStoredGmailAccountId,
  readStoredMicrosoftAccountId,
  readStoredProviderMode,
  type ProviderMode,
} from "./account-session";
import { googleDesktopClientId } from "./gmail-connect";
import { microsoftClientId, microsoftTenant } from "./microsoft-connect";
import { NativeGmailSyncEngine, NativeMailStore } from "./native-sync";

function providerMode(): ProviderMode {
  const stored = readStoredProviderMode();
  if (stored) return stored;
  const configured = import.meta.env.VITE_GALMAIL_PROVIDER_MODE;
  if (configured === "fixture" || configured === "live") return configured;
  return import.meta.env.DEV ? "fixture" : "live";
}

function gmailConnectCapability() {
  const clientId = googleDesktopClientId();
  const native = isNativeShell();
  return {
    available: native && Boolean(clientId),
    clientIdConfigured: Boolean(clientId),
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

async function createFixtureRuntime() {
  const gmail = createGmailFixtureProvider();
  const microsoft = createMicrosoftFixtureProvider();
  const accounts = demoAccounts(gmail, microsoft);
  const sync = new MemorySyncEngine([gmail, microsoft]);
  const services = baseServices();
  const { store, crypto } = services;
  const vaultKey = await crypto.generateVaultKey();
  const devices = new LocalDeviceLinking(store, crypto, vaultKey);

  // Local-first: hydrate before any optional network work.
  for (const a of accounts) {
    await sync.hydrateLocal(a.accountId);
  }
  const threads = await listUnifiedInbox(accounts);

  return {
    accounts,
    sync,
    ...services,
    vaultKey,
    devices,
    threads,
    providerMode: "fixture" as const,
    gmailAccountId: asAccountId("gmail:demo"),
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
  const googleClientId = googleDesktopClientId();
  const gmailAccount =
    import.meta.env.VITE_GMAIL_ACCOUNT_ID?.trim() ||
    readStoredGmailAccountId() ||
    undefined;
  const msClientId = microsoftClientId();
  const microsoftAccount =
    import.meta.env.VITE_MICROSOFT_ACCOUNT_ID?.trim() ||
    readStoredMicrosoftAccountId() ||
    undefined;
  if (!gmailAccount && !microsoftAccount) {
    throw new Error(
      "Connect Gmail or Microsoft 365 before starting the live inbox",
    );
  }
  if (gmailAccount && !googleClientId) {
    throw new Error("VITE_GOOGLE_DESKTOP_CLIENT_ID is required for live Gmail");
  }
  if (microsoftAccount && !msClientId) {
    throw new Error(
      "VITE_MICROSOFT_CLIENT_ID is required for live Microsoft 365",
    );
  }
  const gmailAccountId = gmailAccount
    ? asAccountId(
        gmailAccount.startsWith("gmail:")
          ? gmailAccount
          : `gmail:${gmailAccount.toLowerCase()}`,
      )
    : undefined;
  const microsoftAccountId = microsoftAccount
    ? asAccountId(
        microsoftAccount.startsWith("microsoft:")
          ? microsoftAccount
          : `microsoft:${microsoftAccount.toLowerCase()}`,
      )
    : undefined;
  const nativeTokens = {
    async accessToken() {
      return "native-vault";
    },
    async refreshAccessToken() {
      return "native-vault";
    },
  };
  const gmail = gmailAccountId
    ? createGmailLiveProvider({
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
                  accountId: gmailAccountId,
                  clientId: googleClientId!,
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
      })
    : undefined;
  const microsoft = microsoftAccountId
    ? createMicrosoftLiveProvider({
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
                accountId: microsoftAccountId,
                clientId: msClientId!,
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
      })
    : undefined;
  const providers = [gmail, microsoft].filter(
    (provider): provider is NonNullable<typeof provider> => Boolean(provider),
  );
  const accounts = [
    ...(gmail && gmailAccountId
      ? [
          {
            accountId: gmailAccountId,
            provider: gmail,
            email: gmailAccountId.slice("gmail:".length),
            displayName: "Gmail",
          },
        ]
      : []),
    ...(microsoft && microsoftAccountId
      ? [
          {
            accountId: microsoftAccountId,
            provider: microsoft,
            email: microsoftAccountId.slice("microsoft:".length),
            displayName: "Microsoft 365",
          },
        ]
      : []),
  ];
  const nativeStore = new NativeMailStore();
  const sync = new NativeGmailSyncEngine(providers, nativeStore);
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
    // Legacy UI name: primary account for compose/consent when only one is live.
    gmailAccountId: gmailAccountId ?? microsoftAccountId!,
    microsoftAccountId,
    gmailOAuth: gmailAccountId
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
          revoke: (targetAccountId: AccountId = gmailAccountId) =>
            invoke<boolean>("gmail_revoke", { accountId: targetAccountId }),
          remove: (targetAccountId: AccountId = gmailAccountId) =>
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
  if (providerMode() !== "live") {
    return createFixtureRuntime();
  }
  const hasLiveAccount = Boolean(
    import.meta.env.VITE_GMAIL_ACCOUNT_ID?.trim() ||
      readStoredGmailAccountId() ||
      import.meta.env.VITE_MICROSOFT_ACCOUNT_ID?.trim() ||
      readStoredMicrosoftAccountId(),
  );
  const hasProviderClient =
    Boolean(googleDesktopClientId()) || Boolean(microsoftClientId());
  // Allow Microsoft-only live without a Google client ID (and vice versa).
  if (!hasLiveAccount || !hasProviderClient) {
    return createFixtureRuntime();
  }
  return createLiveRuntime();
}

export type GalMailRuntime = Awaited<ReturnType<typeof createGalMailRuntime>>;
