import type { SyncEngine, SyncEvent } from "./capabilities.js";
import type {
  AccountId,
  MailMessage,
  MailThread,
  OutboxMutation,
  SyncCursor,
} from "./types.js";
import type { MailProvider } from "./capabilities.js";

function id(): string {
  return `mut_${Math.random().toString(36).slice(2, 12)}`;
}

/** Linear-style local-first sync engine used by the Gmail vertical slice. */
export class MemorySyncEngine implements SyncEngine {
  private threads = new Map<string, MailThread>();
  private messages = new Map<string, MailMessage>();
  private cursors = new Map<string, SyncCursor>();
  private outbox: OutboxMutation[] = [];
  private listeners = new Set<(e: SyncEvent) => void>();

  constructor(private readonly providers: MailProvider[]) {}

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
    const row: OutboxMutation = {
      ...mutation,
      id: id(),
      attempts: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
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
      if (m.status === "done") continue;
      if (accountId && m.accountId !== accountId) continue;
      m.status = "inflight";
      m.attempts += 1;
      this.emit({ type: "outbox", mutationId: m.id, status: "inflight" });
      try {
        const provider = this.providerFor(m.accountId);
        await provider.applyMutation(m.accountId, {
          kind: m.kind,
          targetIds: m.targetIds,
          payload: m.payload,
        });
        m.status = "done";
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

  /** Test helpers */
  getOutbox(): OutboxMutation[] {
    return [...this.outbox];
  }

  getMessages(accountId: AccountId): MailMessage[] {
    return [...this.messages.values()].filter((m) => m.accountId === accountId);
  }
}
