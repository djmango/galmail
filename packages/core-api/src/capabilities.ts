import type {
  AccountId,
  AttachmentMetadata,
  ClassificationResult,
  ComposeDraft,
  MailLabel,
  MailMessage,
  MailThread,
  MessageId,
  MutationKind,
  OutboxMutation,
  ProviderKind,
  ReceiptStatus,
  RemoteProcessingConsent,
  SyncCursor,
  ThreadId,
} from "./types.js";

/** Normalized provider adapter contract. */
export interface MailProvider {
  readonly kind: ProviderKind;
  listLabels(accountId: AccountId): Promise<MailLabel[]>;
  listThreads(
    accountId: AccountId,
    opts?: { labelId?: string; pageToken?: string; limit?: number },
  ): Promise<{ threads: MailThread[]; nextPageToken?: string }>;
  getThread(accountId: AccountId, threadId: ThreadId): Promise<MailThread>;
  getMessage(accountId: AccountId, messageId: MessageId): Promise<MailMessage>;
  hydrateBodies(
    accountId: AccountId,
    messageIds: MessageId[],
  ): Promise<MailMessage[]>;
  applyMutation(
    accountId: AccountId,
    mutation: Pick<OutboxMutation, "kind" | "targetIds" | "payload">,
  ): Promise<void>;
  sendDraft(accountId: AccountId, draft: ComposeDraft): Promise<MessageId>;
  saveDraft(accountId: AccountId, draft: ComposeDraft): Promise<string>;
  deleteDraft(accountId: AccountId, providerDraftId: string): Promise<void>;
  fetchAttachment(
    accountId: AccountId,
    attachment: AttachmentMetadata,
  ): AsyncIterable<Uint8Array>;
  fetchDeltas(
    accountId: AccountId,
    cursor: SyncCursor | null,
  ): Promise<{
    upserts: MailMessage[];
    deletes: MessageId[];
    nextCursor: SyncCursor;
    /** True when the result is a complete provider snapshot after cursor expiry. */
    fullReconcile?: boolean;
  }>;
  /**
   * Optional bounded pull for side views (Spam/Trash/Starred/Archive/custom).
   * Does not advance the history cursor and must not imply a full mailbox snapshot.
   */
  fetchRecentMessages?(
    accountId: AccountId,
    opts: { labelId?: string; q?: string; limit?: number },
  ): Promise<{ upserts: MailMessage[] }>;
}

export interface SyncEngine {
  hydrateLocal(accountId: AccountId): Promise<{
    threads: MailThread[];
    messages: MailMessage[];
    cursor: SyncCursor | null;
  }>;
  pullDeltas(accountId: AccountId): Promise<void>;
  enqueue(
    mutation: Omit<OutboxMutation, "id" | "attempts" | "status" | "createdAt">,
  ): Promise<OutboxMutation>;
  flushOutbox(
    accountId?: AccountId,
  ): Promise<{ flushed: number; failed: number }>;
  listOutbox(accountId?: AccountId): Promise<OutboxMutation[]>;
  cancelOutbox(mutationId: string): Promise<boolean>;
  retryOutbox(mutationId: string): Promise<boolean>;
  searchLocal(accountId: AccountId, query: string): Promise<MessageId[]>;
  observe(listener: (event: SyncEvent) => void): () => void;
}

export type SyncEvent =
  | { type: "hydrated"; accountId: AccountId }
  | { type: "delta"; accountId: AccountId; upserts: number; deletes: number }
  | { type: "outbox"; mutationId: string; status: OutboxMutation["status"] }
  | { type: "error"; accountId?: AccountId; message: string };

export interface EncryptedStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(prefix?: string): Promise<string[]>;
}

export interface VaultCrypto {
  generateVaultKey(): Promise<Uint8Array>;
  wrapKey(
    vaultKey: Uint8Array,
    devicePublicKey: Uint8Array,
  ): Promise<Uint8Array>;
  unwrapKey(
    wrapped: Uint8Array,
    devicePrivateKey: Uint8Array,
  ): Promise<Uint8Array>;
  seal(plaintext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array>;
  open(ciphertext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array>;
}

export interface SearchIndex {
  indexMessage(message: MailMessage): Promise<void>;
  search(query: string, limit?: number): Promise<MessageId[]>;
}

export interface Classifier {
  classify(message: MailMessage): Promise<ClassificationResult>;
  recordCorrection(
    messageId: MessageId,
    correction: ClassificationResult["priority"],
  ): Promise<void>;
}

export interface NotificationPolicy {
  shouldNotify(
    result: ClassificationResult,
    message: MailMessage,
  ): Promise<{
    notify: boolean;
    /** Blind mode: generic/delayed when true */
    blindHintOnly: boolean;
    title?: string;
    body?: string;
  }>;
}

export interface ReceiptService {
  requestReceipt(
    messageId: MessageId,
    mode: "standard" | "pixel",
  ): Promise<void>;
  status(messageId: MessageId): Promise<ReceiptStatus>;
}

export interface BlindRelayClient {
  registerDevice(input: {
    deviceId: string;
    pushToken: string;
    platform: "ios" | "macos" | "web";
    opaqueAccountHints: string[];
  }): Promise<void>;
  /** Server must never receive plaintext subjects/bodies */
  publishOpaqueEvent(input: {
    opaqueRouteId: string;
    eventType: string;
    ciphertextHint?: string;
  }): Promise<void>;
}

export interface DeviceLinking {
  createInvite(): Promise<{ inviteCode: string; expiresAt: string }>;
  acceptInvite(inviteCode: string): Promise<{ deviceId: string }>;
  listDevices(): Promise<
    Array<{ deviceId: string; name: string; createdAt: string }>
  >;
  revokeDevice(deviceId: string): Promise<void>;
}

export interface RemoteOptInService {
  getConsent(accountId: AccountId): Promise<RemoteProcessingConsent>;
  setConsent(consent: RemoteProcessingConsent): Promise<void>;
  DISCLOSURE_VERSION: string;
}

export interface CapabilitySurface {
  providers: Record<ProviderKind, MailProvider>;
  sync: SyncEngine;
  store: EncryptedStore;
  crypto: VaultCrypto;
  search: SearchIndex;
  classifier: Classifier;
  notifications: NotificationPolicy;
  receipts: ReceiptService;
  relay: BlindRelayClient;
  devices: DeviceLinking;
  remoteOptIn: RemoteOptInService;
}

export const MUTATION_KINDS: MutationKind[] = [
  "archive",
  "trash",
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "apply_label",
  "remove_label",
  "snooze",
  "spam",
  "not_spam",
  "send",
  "save_draft",
  "delete_draft",
  "move_folder",
];
