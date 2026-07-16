import { describe, expect, test } from "bun:test";
import {
  asAccountId,
  asMessageId,
  asThreadId,
  type MailMessage,
  type MailProvider,
  type SyncCursor,
} from "@galmail/core-api";
import {
  NativeGmailSyncEngine,
  NativeMailStore,
  labelSyncQuery,
  type DurableKind,
} from "./native-sync";

const accountId = asAccountId("gmail:restart@example.com");

function message(id: string, labelIds: string[] = []): MailMessage {
  return {
    id: asMessageId(id),
    threadId: asThreadId(`thread-${id}`),
    accountId,
    provider: "gmail",
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    from: { email: "sender@example.com" },
    to: [{ email: "restart@example.com" }],
    date: "2026-01-01T00:00:00.000Z",
    unread: true,
    starred: labelIds.includes("STARRED"),
    labelIds: labelIds as MailMessage["labelIds"],
    hasAttachments: false,
  };
}

class MockNativeStore extends NativeMailStore {
  records = new Map<string, unknown>();

  override async list<T>(
    _accountId: typeof accountId,
    kind: DurableKind,
  ): Promise<T[]> {
    return [...this.records]
      .filter(([key]) => key.startsWith(`${kind}:`))
      .map(([, value]) => structuredClone(value) as T);
  }

  override async put(
    _accountId: typeof accountId,
    kind: DurableKind,
    objectId: string,
    value: unknown,
  ): Promise<void> {
    this.records.set(`${kind}:${objectId}`, structuredClone(value));
  }

  override async applySyncBatch(input: {
    accountId: typeof accountId;
    upserts: Array<{ kind: DurableKind; objectId: string; value: unknown }>;
    deletes: Array<{ kind: DurableKind; objectId: string }>;
    cursor: SyncCursor;
  }): Promise<void> {
    for (const record of input.upserts) {
      this.records.set(
        `${record.kind}:${record.objectId}`,
        structuredClone(record.value),
      );
    }
    for (const record of input.deletes) {
      this.records.delete(`${record.kind}:${record.objectId}`);
    }
    this.records.set("cursor:gmail", structuredClone(input.cursor));
  }

  override async indexMessage(): Promise<void> {}

  override async search(): Promise<string[]> {
    return [];
  }
}

function provider(
  deltas: MailMessage[][],
  deleted: string[][] = [],
  fullReconcile: boolean[] = [],
): MailProvider {
  let pull = 0;
  return {
    kind: "gmail",
    async listLabels() {
      return [];
    },
    async listThreads() {
      throw new Error("network listing is not used during local hydrate");
    },
    async getThread() {
      throw new Error("not used");
    },
    async getMessage() {
      throw new Error("not used");
    },
    async hydrateBodies() {
      return [];
    },
    async applyMutation() {},
    async sendDraft() {
      return asMessageId("sent");
    },
    async saveDraft(_accountId, draft) {
      return draft.providerDraftId ?? draft.id;
    },
    async deleteDraft() {},
    async *fetchAttachment() {
      yield new Uint8Array();
    },
    async fetchDeltas() {
      const index = pull++;
      return {
        upserts: deltas[index] ?? [],
        deletes: (deleted[index] ?? []).map(asMessageId),
        nextCursor: {
          accountId,
          provider: "gmail",
          token: String(index + 1),
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        fullReconcile: fullReconcile[index],
      };
    },
    async fetchRecentMessages(_accountId, opts) {
      const labelId = opts.labelId;
      const all = deltas.flat();
      if (opts.q?.includes("-in:inbox")) {
        return {
          upserts: all.filter(
            (item) =>
              !item.labelIds.includes("INBOX" as never) &&
              !item.labelIds.includes("TRASH" as never) &&
              !item.labelIds.includes("SPAM" as never),
          ),
        };
      }
      if (!labelId) return { upserts: all };
      return {
        upserts: all.filter((item) =>
          item.labelIds.includes(labelId as never),
        ),
      };
    },
  };
}

describe("native Gmail sync restart contract", () => {
  test("labelSyncQuery maps archive to a Gmail search and skips inbox", () => {
    expect(labelSyncQuery("INBOX")).toBeNull();
    expect(labelSyncQuery("SPAM")).toEqual({ labelId: "SPAM" });
    expect(labelSyncQuery("STARRED")).toEqual({ labelId: "STARRED" });
    expect(labelSyncQuery("ARCHIVE")).toEqual({
      labelId: "ARCHIVE",
      q: "-in:inbox -in:trash -in:spam",
    });
  });

  test("syncLabel merges side-view messages without wiping inbox", async () => {
    const store = new MockNativeStore();
    const inbox = message("inbox-1", ["INBOX"]);
    const spam = message("spam-1", ["SPAM"]);
    const sync = new NativeGmailSyncEngine(
      provider([[inbox], [spam]]),
      store,
    );
    await sync.pullDeltas(accountId);
    expect(sync.localThreads(accountId).map((item) => String(item.id))).toEqual(
      ["thread-inbox-1"],
    );

    await sync.syncLabel(accountId, "SPAM");
    const ids = sync
      .localThreads(accountId)
      .map((item) => String(item.id))
      .sort();
    expect(ids).toEqual(["thread-inbox-1", "thread-spam-1"]);
    expect(store.records.has("message:inbox-1")).toBe(true);
    expect(store.records.has("message:spam-1")).toBe(true);
  });

  test("hydrates offline after restart and reconciles deletes", async () => {
    const store = new MockNativeStore();
    const first = new NativeGmailSyncEngine(
      provider([[message("m1")], []], [[], ["m1"]]),
      store,
    );
    await first.hydrateLocal(accountId);
    await first.pullDeltas(accountId);
    expect(first.localThreads(accountId)).toHaveLength(1);

    const restarted = new NativeGmailSyncEngine(
      provider([[]], [[]], [true]),
      store,
    );
    const local = await restarted.hydrateLocal(accountId);
    expect(local.messages.map((item) => String(item.id))).toEqual(["m1"]);
    expect(local.cursor?.token).toBe("1");
    await restarted.pullDeltas(accountId);
    expect(restarted.localThreads(accountId)).toHaveLength(0);
    expect(store.records.has("message:m1")).toBe(false);
  });

  test("restores and flushes a durable offline outbox", async () => {
    const store = new MockNativeStore();
    const first = new NativeGmailSyncEngine(provider([]), store);
    await first.enqueue({
      accountId,
      kind: "archive",
      targetIds: ["m1"],
    });
    const restarted = new NativeGmailSyncEngine(provider([]), store);
    await restarted.hydrateLocal(accountId);
    expect(await restarted.flushOutbox(accountId)).toEqual({
      flushed: 1,
      failed: 0,
    });
    const outbox = await store.list<{ status: string }>(accountId, "outbox");
    expect(outbox[0]?.status).toBe("done");
  });

  test("save_draft surfaces errors, skips auto-retry, and keeps providerDraftId", async () => {
    const store = new MockNativeStore();
    let saves = 0;
    const failing = provider([]);
    failing.saveDraft = async (_accountId, draft) => {
      saves += 1;
      if (saves === 1) throw new Error("Gmail request failed (400): Invalid From");
      return draft.providerDraftId ?? "gmail-draft-9";
    };
    const sync = new NativeGmailSyncEngine(failing, store);
    const draft = {
      id: "local-d1",
      accountId,
      to: [{ email: "a@example.com" }],
      subject: "Hi",
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      updatedAt: new Date().toISOString(),
    };
    const first = await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft },
    });
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 1,
    });
    expect(first.lastError).toContain("Invalid From");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 0,
    });
    expect(first.attempts).toBe(1);

    // Autosave / re-enqueue must update payload but NOT re-queue failed rows.
    const second = await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft: { ...draft, subject: "Hi again" } },
    });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("failed");
    expect(second.lastError).toContain("Invalid From");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 0,
    });
    expect(first.attempts).toBe(1);
    expect(saves).toBe(1);

    expect(await sync.retryOutbox(first.id)).toBe(true);
    expect(first.status).toBe("pending");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 1,
      failed: 0,
    });
    expect(
      (second.payload?.draft as { providerDraftId?: string } | undefined)
        ?.providerDraftId,
    ).toBe("gmail-draft-9");

    const third = await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft: { ...draft, subject: "Third" } },
    });
    expect(
      (third.payload?.draft as { providerDraftId?: string } | undefined)
        ?.providerDraftId,
    ).toBe("gmail-draft-9");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 1,
      failed: 0,
    });
    expect(saves).toBe(3);
  });
});
