import { MemorySyncEngine, asAccountId } from "@galmail/core-api";
import {
  createBrowserAdapters,
  DevVaultCrypto,
  MemoryEncryptedStore,
} from "@galmail/browser-adapters";
import {
  createGmailFixtureProvider,
  createMicrosoftFixtureProvider,
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

export async function createGalMailRuntime() {
  const gmail = createGmailFixtureProvider();
  const microsoft = createMicrosoftFixtureProvider();
  const accounts = demoAccounts(gmail, microsoft);
  const sync = new MemorySyncEngine([gmail, microsoft]);
  const adapters = createBrowserAdapters();
  const store = new MemoryEncryptedStore();
  const crypto = new DevVaultCrypto();
  const vaultKey = await crypto.generateVaultKey();
  const devices = new LocalDeviceLinking(store, crypto, vaultKey);
  const classifier = new LocalClassifier();
  const notifications = new BlindAwareNotificationPolicy(true);
  const receipts = new LocalReceiptService();
  const remoteOptIn = new LocalRemoteOptInService();
  const commands = new CommandRegistry();

  // Local-first: hydrate before any optional network work.
  for (const a of accounts) {
    await sync.hydrateLocal(a.accountId);
  }
  const threads = await listUnifiedInbox(accounts);

  return {
    accounts,
    sync,
    adapters,
    store,
    crypto,
    vaultKey,
    devices,
    classifier,
    notifications,
    receipts,
    remoteOptIn,
    commands,
    threads,
    gmailAccountId: asAccountId("gmail:demo"),
    microsoftAccountId: asAccountId("microsoft:demo"),
    copy: REMOTE_OPT_IN_COPY,
  };
}

export type GalMailRuntime = Awaited<ReturnType<typeof createGalMailRuntime>>;
