import type { SyncEngine, SyncEvent } from "./capabilities.js";
import type {
  AccountId,
  ComposeDraft,
  MailMessage,
  MailThread,
  OutboxMutation,
  SyncCursor,
} from "./types.js";
import type { MailProvider } from "./capabilities.js";
import { matchesMailSearch, parseMailSearch } from "./search.js";

/** Linear-style local-first sync engine used by the Gmail vertical slice. */
export class MemorySyncEngine implements SyncEngine {
  private threads = new Map<string, MailThread>();
  private messages = new Map<string, MailMessage>();
  private cursors = new Map<string, SyncCursor>();
  private outbox: OutboxMutation[] = [];
  private listeners = new Set<(e: SyncEvent) => void>();

  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly providers: MailProvider[],
    options: {
      now?: () => Date;
      createId?: () => string;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId =
      options.createId ??
      (() => `mut_${Math.random().toString(36).slice(2, 12)}`);
  }

  private emit(event: SyncEvent): void {
    for (const l of this.listeners) l(event);
  }

  private providerFor(accountId: AccountId, hint?: string): MailProvider {
    const provider =
      this.providers.find((p) => hint?.startsWith(p.kind)) ?? this.providers[0];
    if (!provider) throw new Error("No mail provider configured");
    // Prefer provider matching account prefix "gmail:" / "microsoft:"
    const byPrefix = this.providers.find((p) => accountId.startsWith(p.kind));
    return byPrefix ?? provider;
  }

  async hydrateLocal(accountId: AccountId): Promise<{
    threads: MailThread[];
    messages: MailMessage[];
    cursor: SyncCursor | null;
  }> {
    const provider = this.providerFor(accountId);
    const { threads } = await provider.listThreads(accountId, { limit: 100 });
    for (const t of threads) this.threads.set(`${accountId}:${t.id}`, t);

    const messages: MailMessage[] = [];
    for (const t of threads.slice(0, 40)) {
      for (const mid of t.messageIds) {
        const m = await provider.getMessage(accountId, mid);
        this.messages.set(`${accountId}:${m.id}`, m);
        messages.push(m);
      }
    }

    this.emit({ type: "hydrated", accountId });
    return {
      threads,
      messages,
      cursor: this.cursors.get(accountId) ?? null,
    };
  }

  async pullDeltas(accountId: AccountId): Promise<void> {
    const provider = this.providerFor(accountId);
    const cursor = this.cursors.get(accountId) ?? null;
    const { upserts, deletes, nextCursor } = await provider.fetchDeltas(
      accountId,
      cursor,
    );
    for (const m of upserts) {
      this.messages.set(`${accountId}:${m.id}`, m);
    }
    for (const d of deletes) {
      this.messages.delete(`${accountId}:${d}`);
    }
    this.cursors.set(accountId, nextCursor);
    this.emit({
      type: "delta",
      accountId,
      upserts: upserts.length,
      deletes: deletes.length,
    });
  }

  async enqueue(
    mutation: Omit<OutboxMutation, "id" | "attempts" | "status" | "createdAt">,
  ): Promise<OutboxMutation> {
    if (mutation.kind === "send") {
      const draftId = (mutation.payload?.draft as { id?: string } | undefined)
        ?.id;
      for (const item of this.outbox) {
        if (
          draftId &&
          item.kind === "save_draft" &&
          item.targetIds[0] === draftId &&
          (item.status === "pending" || item.status === "failed")
        ) {
          item.status = "cancelled";
        }
      }
    }
    if (mutation.kind === "save_draft") {
      const draftKey = mutation.targetIds[0];
      const priorProviderDraftId = this.outbox
        .filter(
          (item) =>
            item.kind === "save_draft" &&
            item.accountId === mutation.accountId &&
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
      const existing = this.outbox.find(
        (item) =>
          item.kind === "save_draft" &&
          (item.status === "pending" || item.status === "failed") &&
          item.accountId === mutation.accountId &&
          item.targetIds[0] === draftKey,
      );
      if (existing) {
        existing.payload = withProviderId(mutation.payload);
        existing.status = "pending";
        existing.lastError = undefined;
        this.emit({
          type: "outbox",
          mutationId: existing.id,
          status: "pending",
        });
        return existing;
      }
      mutation = { ...mutation, payload: withProviderId(mutation.payload) };
    }
    const row: OutboxMutation = {
      ...mutation,
      id: this.createId(),
      attempts: 0,
      status: "pending",
      createdAt: this.now().toISOString(),
    };
    this.outbox.push(row);
    this.emit({ type: "outbox", mutationId: row.id, status: "pending" });
    return row;
  }

  async flushOutbox(
    accountId?: AccountId,
  ): Promise<{ flushed: number; failed: number }> {
    let flushed = 0;
    let failed = 0;
    for (const m of this.outbox) {
      if (
        m.status === "done" ||
        m.status === "cancelled" ||
        m.status === "failed"
      ) {
        continue;
      }
      if (accountId && m.accountId !== accountId) continue;
      if (m.availableAt && new Date(m.availableAt) > this.now()) continue;
      m.status = "inflight";
      m.attempts += 1;
      this.emit({ type: "outbox", mutationId: m.id, status: "inflight" });
      try {
        const provider = this.providerFor(m.accountId);
        if (m.kind === "send") {
          await provider.sendDraft(
            m.accountId,
            m.payload?.draft as unknown as ComposeDraft,
          );
        } else if (m.kind === "save_draft") {
          const providerDraftId = await provider.saveDraft(
            m.accountId,
            m.payload?.draft as unknown as ComposeDraft,
          );
          const draft = m.payload?.draft as Record<string, unknown> | undefined;
          m.payload = {
            ...m.payload,
            providerDraftId,
            draft:
              draft && typeof draft === "object"
                ? { ...draft, providerDraftId }
                : draft,
          };
        } else if (m.kind === "delete_draft") {
          await provider.deleteDraft(
            m.accountId,
            String(m.payload?.providerDraftId ?? ""),
          );
        } else {
          await provider.applyMutation(m.accountId, {
            kind: m.kind,
            targetIds: m.targetIds,
            payload: m.payload,
          });
        }
        m.status = "done";
        m.lastError = undefined;
        flushed += 1;
        this.emit({ type: "outbox", mutationId: m.id, status: "done" });
      } catch (err) {
        m.status = "failed";
        m.lastError = err instanceof Error ? err.message : String(err);
        failed += 1;
        this.emit({ type: "outbox", mutationId: m.id, status: "failed" });
        this.emit({
          type: "error",
          accountId: m.accountId,
          message: m.lastError,
        });
      }
    }
    return { flushed, failed };
  }

  observe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listOutbox(accountId?: AccountId): Promise<OutboxMutation[]> {
    return this.outbox.filter(
      (item) => !accountId || item.accountId === accountId,
    );
  }

  async cancelOutbox(mutationId: string): Promise<boolean> {
    const mutation = this.outbox.find((item) => item.id === mutationId);
    if (!mutation || mutation.status !== "pending") return false;
    mutation.status = "cancelled";
    this.emit({ type: "outbox", mutationId, status: "cancelled" });
    return true;
  }

  async retryOutbox(mutationId: string): Promise<boolean> {
    const mutation = this.outbox.find((item) => item.id === mutationId);
    if (!mutation || mutation.status !== "failed") return false;
    mutation.status = "pending";
    mutation.lastError = undefined;
    this.emit({ type: "outbox", mutationId, status: "pending" });
    return true;
  }

  async searchLocal(accountId: AccountId, input: string) {
    const query = parseMailSearch(input);
    return [...this.messages.values()]
      .filter((message) => {
        if (message.accountId !== accountId) return false;
        const thread = this.threads.get(`${accountId}:${message.threadId}`);
        return thread ? matchesMailSearch(message, thread, query) : false;
      })
      .map((message) => message.id);
  }

  /** Test helpers */
  getOutbox(): OutboxMutation[] {
    return [...this.outbox];
  }

  getMessages(accountId: AccountId): MailMessage[] {
    return [...this.messages.values()].filter((m) => m.accountId === accountId);
  }
}
