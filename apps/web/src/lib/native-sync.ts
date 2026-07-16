import { invoke } from "@tauri-apps/api/core";
import {
  asThreadId,
  asMessageId,
  parseMailSearch,
  toFts5Query,
  type AccountId,
  type AttachmentMetadata,
  type ComposeDraft,
  type MailLabel,
  type MailMessage,
  type MailProvider,
  type MailThread,
  type OutboxMutation,
  type SyncCursor,
  type SyncEngine,
  type SyncEvent,
} from "@galmail/core-api";

export type DurableKind =
  | "cursor"
  | "message"
  | "thread"
  | "label"
  | "contact"
  | "attachment"
  | "attachment_blob"
  | "mutation"
  | "outbox";

type NativeRecord = { objectId: string; payload: number[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(value: unknown): number[] {
  return [...encoder.encode(JSON.stringify(value))];
}

function decode<T>(bytes: number[]): T {
  return JSON.parse(decoder.decode(new Uint8Array(bytes))) as T;
}

export class NativeMailStore {
  async list<T>(accountId: AccountId, kind: DurableKind): Promise<T[]> {
    const records = await invoke<NativeRecord[]>("list_durable_records", {
      request: { accountId, kind },
    });
    return records.map((record) => decode<T>(record.payload));
  }

  async put(
    accountId: AccountId,
    kind: DurableKind,
    objectId: string,
    value: unknown,
  ): Promise<void> {
    await invoke("put_durable_record", {
      request: { accountId, kind, objectId, payload: encode(value) },
    });
  }

  async applySyncBatch(input: {
    accountId: AccountId;
    upserts: Array<{ kind: DurableKind; objectId: string; value: unknown }>;
    deletes: Array<{ kind: DurableKind; objectId: string }>;
    cursor: SyncCursor;
  }): Promise<void> {
    await invoke("apply_sync_batch", {
      request: {
        accountId: input.accountId,
        upserts: input.upserts.map((record) => ({
          kind: record.kind,
          objectId: record.objectId,
          payload: encode(record.value),
        })),
        deletes: input.deletes,
        cursor: encode(input.cursor),
      },
    });
  }

  async putAttachmentStream(
    accountId: AccountId,
    attachmentId: string,
    stream: AsyncIterable<Uint8Array>,
  ): Promise<number> {
    let index = 0;
    let total = 0;
    for await (const chunk of stream) {
      if (chunk.byteLength > 1024 * 1024)
        throw new Error("attachment chunk exceeds 1 MiB");
      await invoke("put_durable_record", {
        request: {
          accountId,
          kind: "attachment_blob",
          objectId: `${attachmentId}:${String(index).padStart(8, "0")}`,
          payload: [...chunk],
        },
      });
      index += 1;
      total += chunk.byteLength;
    }
    return total;
  }

  async *readAttachmentStream(
    accountId: AccountId,
    attachmentId: string,
  ): AsyncIterable<Uint8Array> {
    for (let index = 0; ; index += 1) {
      const payload = await invoke<number[] | null>("get_durable_record", {
        request: {
          accountId,
          kind: "attachment_blob",
          objectId: `${attachmentId}:${String(index).padStart(8, "0")}`,
        },
      });
      if (!payload) break;
      yield Uint8Array.from(payload);
    }
  }

  async indexMessage(message: MailMessage): Promise<void> {
    await invoke("index_mail", {
      request: {
        accountId: message.accountId,
        objectId: message.id,
        subject: message.subject,
        sender: `${message.from.name ?? ""} ${message.from.email}`,
        body: `${message.snippet}\n${message.bodyText ?? ""}`,
      },
    });
  }

  async search(accountId: AccountId, ftsQuery: string): Promise<string[]> {
    if (!ftsQuery.trim()) return [];
    return invoke<string[]>("search_mail", {
      request: { accountId, query: ftsQuery },
    });
  }
}

function threadFromMessages(
  accountId: AccountId,
  messages: MailMessage[],
): MailThread[] {
  const grouped = new Map<string, MailMessage[]>();
  for (const message of messages) {
    const bucket = grouped.get(message.threadId) ?? [];
    bucket.push(message);
    grouped.set(message.threadId, bucket);
  }
  return [...grouped.entries()].map(([threadId, items]) => {
    const ordered = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const latest = ordered.at(-1)!;
    const participants = new Map<string, MailMessage["from"]>();
    for (const item of ordered) {
      for (const address of [item.from, ...item.to, ...(item.cc ?? [])]) {
        participants.set(address.email.toLowerCase(), address);
      }
    }
    return {
      id: asThreadId(threadId),
      accountId,
      provider: latest.provider,
      subject: latest.subject,
      snippet: latest.snippet,
      participants: [...participants.values()],
      messageIds: ordered.map((item) => item.id),
      labelIds: [...new Set(ordered.flatMap((item) => item.labelIds))],
      unreadCount: ordered.filter((item) => item.unread).length,
      lastMessageAt: latest.date,
    };
  });
}

function mutationId(): string {
  return `mut_${crypto.randomUUID()}`;
}

/** Prefer Error/Tauri `{ message }` over opaque String(object). */
export function outboxErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "provider operation failed";
  }
}

/** Map UI label keys to a Gmail messages.list filter. Archive is not a label. */
export function labelSyncQuery(
  labelId: string,
): { labelId?: string; q?: string } | null {
  if (labelId === "INBOX" || labelId === "ALL") return null;
  if (labelId === "ARCHIVE") {
    return { q: "-in:inbox -in:trash -in:spam" };
  }
  return { labelId };
}

export class NativeGmailSyncEngine implements SyncEngine {
  private listeners = new Set<(event: SyncEvent) => void>();
  private messages = new Map<string, MailMessage>();
  private threads = new Map<string, MailThread>();
  private cursors = new Map<string, SyncCursor>();
  private outbox = new Map<string, OutboxMutation>();
  private attachments = new Map<string, AttachmentMetadata>();

  private readonly providers: Map<string, MailProvider>;

  constructor(
    provider: MailProvider | MailProvider[],
    private readonly store: NativeMailStore,
  ) {
    this.providers = new Map(
      (Array.isArray(provider) ? provider : [provider]).map((item) => [
        item.kind,
        item,
      ]),
    );
  }

  private providerFor(accountId: AccountId): MailProvider {
    const kind = accountId.split(":", 1)[0];
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`No native provider configured for ${kind}`);
    return provider;
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async hydrateLocal(accountId: AccountId) {
    const [messages, threads, cursors, outbox, attachments] = await Promise.all(
      [
        this.store.list<MailMessage>(accountId, "message"),
        this.store.list<MailThread>(accountId, "thread"),
        this.store.list<SyncCursor>(accountId, "cursor"),
        this.store.list<OutboxMutation>(accountId, "outbox"),
        this.store.list<AttachmentMetadata>(accountId, "attachment"),
      ],
    );
    for (const message of messages) this.messages.set(message.id, message);
    for (const thread of threads) this.threads.set(thread.id, thread);
    for (const cursor of cursors) this.cursors.set(accountId, cursor);
    for (const mutation of outbox) this.outbox.set(mutation.id, mutation);
    for (const attachment of attachments) {
      this.attachments.set(attachment.id, attachment);
    }
    this.emit({ type: "hydrated", accountId });
    return {
      threads: [...this.threads.values()].filter(
        (thread) => thread.accountId === accountId,
      ),
      messages: [...this.messages.values()].filter(
        (message) => message.accountId === accountId,
      ),
      cursor: this.cursors.get(accountId) ?? null,
    };
  }

  private rebuildThreads(accountId: AccountId): MailThread[] {
    const allMessages = [...this.messages.values()].filter(
      (message) => message.accountId === accountId,
    );
    const rebuiltThreads = threadFromMessages(accountId, allMessages);
    for (const [id, thread] of this.threads) {
      if (thread.accountId === accountId) this.threads.delete(id);
    }
    for (const thread of rebuiltThreads) this.threads.set(thread.id, thread);
    return rebuiltThreads;
  }

  async pullDeltas(accountId: AccountId): Promise<void> {
    const provider = this.providerFor(accountId);
    const result = await provider.fetchDeltas(
      accountId,
      this.cursors.get(accountId) ?? null,
    );
    const deletes = new Set(result.deletes);
    if (result.fullReconcile) {
      const snapshotIds = new Set(result.upserts.map((message) => message.id));
      for (const message of this.messages.values()) {
        if (message.accountId === accountId && !snapshotIds.has(message.id)) {
          deletes.add(message.id);
        }
      }
    }
    for (const id of deletes) this.messages.delete(id);
    const deletedAttachments = [...this.attachments.values()].filter(
      (attachment) => deletes.has(attachment.messageId),
    );
    for (const attachment of deletedAttachments) {
      this.attachments.delete(attachment.id);
    }
    for (const message of result.upserts)
      this.messages.set(message.id, message);
    for (const message of result.upserts) {
      for (const attachment of message.attachments ?? []) {
        this.attachments.set(attachment.id, attachment);
      }
    }
    const rebuiltThreads = this.rebuildThreads(accountId);
    const allMessages = [...this.messages.values()].filter(
      (message) => message.accountId === accountId,
    );
    const labels = await provider.listLabels(accountId);
    const contacts = new Map<string, MailMessage["from"]>();
    for (const message of allMessages) {
      for (const address of [
        message.from,
        ...message.to,
        ...(message.cc ?? []),
      ]) {
        contacts.set(address.email.toLowerCase(), address);
      }
    }
    const upserts = [
      ...result.upserts.map((value) => ({
        kind: "message" as const,
        objectId: value.id,
        value,
      })),
      ...rebuiltThreads.map((value) => ({
        kind: "thread" as const,
        objectId: value.id,
        value,
      })),
      ...labels.map((value: MailLabel) => ({
        kind: "label" as const,
        objectId: value.id,
        value,
      })),
      ...[...contacts].map(([objectId, value]) => ({
        kind: "contact" as const,
        objectId,
        value,
      })),
      ...result.upserts.flatMap((message) =>
        (message.attachments ?? []).map((value) => ({
          kind: "attachment" as const,
          objectId: value.id,
          value,
        })),
      ),
    ];
    await this.store.applySyncBatch({
      accountId,
      upserts,
      deletes: [
        ...[...deletes].map((objectId) => ({
          kind: "message" as const,
          objectId,
        })),
        ...deletedAttachments.map((attachment) => ({
          kind: "attachment" as const,
          objectId: attachment.id,
        })),
      ],
      cursor: result.nextCursor,
    });
    for (const message of result.upserts) {
      await this.store.indexMessage(message);
    }
    this.cursors.set(accountId, result.nextCursor);
    this.emit({
      type: "delta",
      accountId,
      upserts: result.upserts.length,
      deletes: deletes.size,
    });
  }

  /**
   * Pull messages for Spam/Trash/Starred/Archive/custom labels into the local
   * store without treating the result as a full mailbox snapshot.
   */
  async syncLabel(accountId: AccountId, labelId: string): Promise<void> {
    const provider = this.providerFor(accountId);
    const fetchRecent = provider.fetchRecentMessages?.bind(provider);
    if (!fetchRecent) return;
    const query = labelSyncQuery(labelId);
    if (!query) return;

    const { upserts } = await fetchRecent(accountId, {
      ...query,
      limit: 50,
    });
    for (const message of upserts) {
      this.messages.set(message.id, message);
      for (const attachment of message.attachments ?? []) {
        this.attachments.set(attachment.id, attachment);
      }
    }
    const rebuiltThreads = this.rebuildThreads(accountId);
    const cursor = this.cursors.get(accountId) ?? {
      accountId,
      provider: provider.kind,
      token: "1",
      updatedAt: new Date().toISOString(),
    };
    await this.store.applySyncBatch({
      accountId,
      upserts: [
        ...upserts.map((value) => ({
          kind: "message" as const,
          objectId: value.id,
          value,
        })),
        ...rebuiltThreads.map((value) => ({
          kind: "thread" as const,
          objectId: value.id,
          value,
        })),
        ...upserts.flatMap((message) =>
          (message.attachments ?? []).map((value) => ({
            kind: "attachment" as const,
            objectId: value.id,
            value,
          })),
        ),
      ],
      deletes: [],
      cursor,
    });
    for (const message of upserts) {
      await this.store.indexMessage(message);
    }
    this.emit({
      type: "delta",
      accountId,
      upserts: upserts.length,
      deletes: 0,
    });
  }

  async enqueue(
    input: Omit<OutboxMutation, "id" | "attempts" | "status" | "createdAt">,
  ): Promise<OutboxMutation> {
    if (input.kind === "send") {
      const draftId = (input.payload?.draft as { id?: string } | undefined)?.id;
      for (const item of this.outbox.values()) {
        if (
          draftId &&
          item.kind === "save_draft" &&
          item.targetIds[0] === draftId &&
          (item.status === "pending" || item.status === "failed")
        ) {
          item.status = "cancelled";
          await this.store.put(item.accountId, "outbox", item.id, item);
        }
      }
    }
    if (input.kind === "save_draft") {
      const draftKey = input.targetIds[0];
      const priorProviderDraftId = [...this.outbox.values()]
        .filter(
          (item) =>
            item.kind === "save_draft" &&
            item.accountId === input.accountId &&
            item.targetIds[0] === draftKey,
        )
        .map((item) => {
          const draft = item.payload?.draft as
            | { providerDraftId?: string }
            | undefined;
          return (
            draft?.providerDraftId ??
            (typeof item.payload?.providerDraftId === "string"
              ? item.payload.providerDraftId
              : undefined)
          );
        })
        .find(Boolean);
      const withProviderId = (
        payload: OutboxMutation["payload"],
      ): OutboxMutation["payload"] => {
        const draft = payload?.draft as Record<string, unknown> | undefined;
        if (!draft || typeof draft !== "object" || !priorProviderDraftId) {
          return payload;
        }
        if (typeof draft.providerDraftId === "string" && draft.providerDraftId) {
          return payload;
        }
        return {
          ...payload,
          draft: { ...draft, providerDraftId: priorProviderDraftId },
          providerDraftId: priorProviderDraftId,
        };
      };
      const existing = [...this.outbox.values()].find(
        (item) =>
          item.kind === "save_draft" &&
          (item.status === "pending" || item.status === "failed") &&
          item.accountId === input.accountId &&
          item.targetIds[0] === draftKey,
      );
      if (existing) {
        // Refresh payload (and providerDraftId) but never auto-promote failed →
        // pending. Compose autosave would otherwise retry forever (attempt N).
        existing.payload = withProviderId(input.payload);
        if (existing.status === "pending") {
          existing.lastError = undefined;
        }
        await this.store.put(
          existing.accountId,
          "outbox",
          existing.id,
          existing,
        );
        this.emit({
          type: "outbox",
          mutationId: existing.id,
          status: existing.status,
        });
        return existing;
      }
      input = { ...input, payload: withProviderId(input.payload) };
    }
    const mutation: OutboxMutation = {
      ...input,
      id: mutationId(),
      attempts: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.outbox.set(mutation.id, mutation);
    await Promise.all([
      this.store.put(mutation.accountId, "outbox", mutation.id, mutation),
      this.store.put(mutation.accountId, "mutation", mutation.id, mutation),
    ]);
    this.emit({
      type: "outbox",
      mutationId: mutation.id,
      status: mutation.status,
    });
    return mutation;
  }

  async flushOutbox(
    accountId?: AccountId,
  ): Promise<{ flushed: number; failed: number }> {
    let flushed = 0;
    let failed = 0;
    for (const mutation of this.outbox.values()) {
      if (
        mutation.status === "done" ||
        mutation.status === "cancelled" ||
        mutation.status === "failed" ||
        (accountId && mutation.accountId !== accountId)
      ) {
        continue;
      }
      if (mutation.availableAt && new Date(mutation.availableAt) > new Date()) {
        continue;
      }
      mutation.status = "inflight";
      mutation.attempts += 1;
      await Promise.all([
        this.store.put(mutation.accountId, "outbox", mutation.id, mutation),
        this.store.put(mutation.accountId, "mutation", mutation.id, mutation),
      ]);
      try {
        const provider = this.providerFor(mutation.accountId);
        if (mutation.kind === "send") {
          await provider.sendDraft(
            mutation.accountId,
            mutation.payload?.draft as unknown as ComposeDraft,
          );
        } else if (mutation.kind === "save_draft") {
          const providerDraftId = await provider.saveDraft(
            mutation.accountId,
            mutation.payload?.draft as unknown as ComposeDraft,
          );
          const draft = mutation.payload?.draft as
            | Record<string, unknown>
            | undefined;
          mutation.payload = {
            ...mutation.payload,
            providerDraftId,
            draft:
              draft && typeof draft === "object"
                ? { ...draft, providerDraftId }
                : draft,
          };
        } else if (mutation.kind === "delete_draft") {
          await provider.deleteDraft(
            mutation.accountId,
            String(mutation.payload?.providerDraftId ?? ""),
          );
        } else {
          await provider.applyMutation(mutation.accountId, {
            kind: mutation.kind,
            targetIds: mutation.targetIds,
            payload: { ...mutation.payload, mutationId: mutation.id },
          });
        }
        mutation.status = "done";
        mutation.lastError = undefined;
        flushed += 1;
      } catch (error) {
        mutation.status = "failed";
        mutation.lastError = outboxErrorMessage(error);
        failed += 1;
      }
      await Promise.all([
        this.store.put(mutation.accountId, "outbox", mutation.id, mutation),
        this.store.put(mutation.accountId, "mutation", mutation.id, mutation),
      ]);
      this.emit({
        type: "outbox",
        mutationId: mutation.id,
        status: mutation.status,
      });
    }
    return { flushed, failed };
  }

  observe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listOutbox(accountId?: AccountId): Promise<OutboxMutation[]> {
    return [...this.outbox.values()].filter(
      (item) => !accountId || item.accountId === accountId,
    );
  }

  async cancelOutbox(mutationId: string): Promise<boolean> {
    const mutation = this.outbox.get(mutationId);
    if (!mutation || mutation.status !== "pending") return false;
    mutation.status = "cancelled";
    await this.store.put(mutation.accountId, "outbox", mutation.id, mutation);
    this.emit({ type: "outbox", mutationId, status: "cancelled" });
    return true;
  }

  async retryOutbox(mutationId: string): Promise<boolean> {
    const mutation = this.outbox.get(mutationId);
    if (!mutation || mutation.status !== "failed") return false;
    mutation.status = "pending";
    mutation.lastError = undefined;
    await this.store.put(mutation.accountId, "outbox", mutation.id, mutation);
    this.emit({ type: "outbox", mutationId, status: "pending" });
    return true;
  }

  async searchLocal(accountId: AccountId, query: string) {
    return (
      await this.store.search(accountId, toFts5Query(parseMailSearch(query)))
    ).map(asMessageId);
  }

  localThreads(accountId: AccountId): MailThread[] {
    return [...this.threads.values()]
      .filter((thread) => thread.accountId === accountId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
}
