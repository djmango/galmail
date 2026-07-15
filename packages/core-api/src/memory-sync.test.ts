import { describe, expect, it } from "vitest";
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
});
