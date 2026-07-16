import { describe, expect, it } from "bun:test";
import { MemorySyncEngine } from "./memory-sync.js";
import type { MailProvider } from "./capabilities.js";
import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  type MailMessage,
  type MailThread,
} from "./types.js";

function fixtureProvider(): MailProvider {
  const accountId = asAccountId("gmail:demo");
  const threadId = asThreadId("t1");
  const messageId = asMessageId("m1");
  const thread: MailThread = {
    id: threadId,
    accountId,
    provider: "gmail",
    subject: "Hello GalMail",
    snippet: "Welcome",
    participants: [{ email: "a@example.com" }],
    messageIds: [messageId],
    labelIds: [asLabelId("INBOX")],
    unreadCount: 1,
    lastMessageAt: "2026-07-15T12:00:00Z",
  };
  const message: MailMessage = {
    id: messageId,
    threadId,
    accountId,
    provider: "gmail",
    subject: "Hello GalMail",
    snippet: "Welcome",
    from: { email: "a@example.com", name: "Ada" },
    to: [{ email: "me@example.com" }],
    date: "2026-07-15T12:00:00Z",
    unread: true,
    starred: false,
    labelIds: [asLabelId("INBOX")],
    hasAttachments: false,
    bodyText: "Welcome to GalMail",
  };

  return {
    kind: "gmail",
    async listLabels() {
      return [
        {
          id: asLabelId("INBOX"),
          name: "Inbox",
          kind: "system",
          providerNativeId: "INBOX",
        },
      ];
    },
    async listThreads() {
      return { threads: [thread] };
    },
    async getThread() {
      return thread;
    },
    async getMessage() {
      return message;
    },
    async hydrateBodies() {
      return [message];
    },
    async applyMutation() {},
    async sendDraft() {
      return messageId;
    },
    async saveDraft(_accountId, draft) {
      return draft.id;
    },
    async deleteDraft() {},
    async *fetchAttachment() {
      yield new Uint8Array();
    },
    async fetchDeltas(_accountId, cursor) {
      return {
        upserts: [],
        deletes: [],
        nextCursor: {
          accountId,
          provider: "gmail",
          token: cursor ? String(Number(cursor.token) + 1) : "1",
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

describe("MemorySyncEngine", () => {
  it("hydrates local before networking deltas", async () => {
    const sync = new MemorySyncEngine([fixtureProvider()]);
    const accountId = asAccountId("gmail:demo");
    const local = await sync.hydrateLocal(accountId);
    expect(local.threads).toHaveLength(1);
    expect(local.messages[0]?.subject).toBe("Hello GalMail");
    await sync.pullDeltas(accountId);
  });

  it("optimistic outbox flush marks mutations done", async () => {
    const sync = new MemorySyncEngine([fixtureProvider()]);
    const accountId = asAccountId("gmail:demo");
    await sync.hydrateLocal(accountId);
    await sync.enqueue({
      accountId,
      kind: "archive",
      targetIds: ["m1"],
    });
    const result = await sync.flushOutbox(accountId);
    expect(result.flushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(sync.getOutbox()[0]?.status).toBe("done");
  });

  it("supports delayed send, cancellation, retry, and draft coalescing", async () => {
    const sync = new MemorySyncEngine([fixtureProvider()]);
    const accountId = asAccountId("gmail:demo");
    const draft = {
      id: "d1",
      accountId,
      to: [{ email: "a@example.com" }],
      subject: "Queued",
      bodyHtml: "<p>body</p>",
      bodyText: "body",
      updatedAt: new Date().toISOString(),
    };
    const first = await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft },
    });
    const second = await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft: { ...draft, subject: "Updated" } },
    });
    expect(second.id).toBe(first.id);
    const send = await sync.enqueue({
      accountId,
      kind: "send",
      targetIds: [],
      payload: { draft },
      availableAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await sync.flushOutbox(accountId)).flushed).toBe(0);
    expect(await sync.cancelOutbox(send.id)).toBe(true);
    expect(
      (await sync.listOutbox(accountId)).find((item) => item.id === send.id)
        ?.status,
    ).toBe("cancelled");
  });

  it("does not auto-retry failed outbox rows until explicit retry", async () => {
    const accountId = asAccountId("gmail:demo");
    let saves = 0;
    const provider = fixtureProvider();
    provider.saveDraft = async () => {
      saves += 1;
      throw new Error("boom");
    };
    const sync = new MemorySyncEngine([provider]);
    const draft = {
      id: "d-fail",
      accountId,
      to: [{ email: "a@example.com" }],
      subject: "Fail",
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      updatedAt: new Date().toISOString(),
    };
    await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft },
    });
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 1,
    });
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 0,
    });
    expect(saves).toBe(1);
    expect(sync.getOutbox()[0]?.lastError).toBe("boom");

    // Re-enqueue (compose autosave) must not promote failed → pending.
    await sync.enqueue({
      accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft: { ...draft, subject: "Fail again" } },
    });
    expect(sync.getOutbox()[0]?.status).toBe("failed");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 0,
    });
    expect(saves).toBe(1);

    expect(await sync.retryOutbox(sync.getOutbox()[0]!.id)).toBe(true);
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 0,
      failed: 1,
    });
    expect(saves).toBe(2);
  });

  it("is deterministic under an injected clock and id source", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const ids = ["mutation-1", "mutation-2"];
    const sync = new MemorySyncEngine([fixtureProvider()], {
      now: () => now,
      createId: () => ids.shift() ?? "unexpected",
    });
    const accountId = asAccountId("gmail:demo");

    const first = await sync.enqueue({
      accountId,
      kind: "mark_read",
      targetIds: ["m1"],
    });
    const delayed = await sync.enqueue({
      accountId,
      kind: "mark_unread",
      targetIds: ["m1"],
      availableAt: "2026-07-15T12:00:01.000Z",
    });

    expect(first).toMatchObject({
      id: "mutation-1",
      createdAt: now.toISOString(),
    });
    expect(delayed.id).toBe("mutation-2");
    expect(await sync.flushOutbox(accountId)).toEqual({
      flushed: 1,
      failed: 0,
    });
    expect(delayed.status).toBe("pending");
  });
});
