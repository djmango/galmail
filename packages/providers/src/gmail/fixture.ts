import type { MailProvider } from "@galmail/core-api";
import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  type AccountId,
  type MailLabel,
  type MailMessage,
  type MailThread,
  type MessageId,
  type SyncCursor,
  type ThreadId,
} from "@galmail/core-api";
import small from "./small.json";

type FixtureFile = typeof small;

function loadFixture(): FixtureFile {
  return small;
}

export function createGmailFixtureProvider(
  fixture: FixtureFile = loadFixture(),
): MailProvider {
  const accountId = asAccountId(fixture.accountId);
  const labels: MailLabel[] = fixture.labels.map((l) => ({
    id: asLabelId(l.id),
    name: l.name,
    kind: l.kind as MailLabel["kind"],
    providerNativeId: l.providerNativeId,
  }));

  const threads = new Map<string, MailThread>();
  for (const t of fixture.threads) {
    threads.set(t.id, {
      id: asThreadId(t.id),
      accountId,
      provider: "gmail",
      subject: t.subject,
      snippet: t.snippet,
      participants: t.participants,
      messageIds: t.messageIds.map(asMessageId),
      labelIds: t.labelIds.map(asLabelId),
      unreadCount: t.unreadCount,
      lastMessageAt: t.lastMessageAt,
    });
  }

  const messages = new Map<string, MailMessage>();
  const drafts = new Map<string, Parameters<MailProvider["saveDraft"]>[1]>();
  for (const m of fixture.messages) {
    messages.set(m.id, {
      id: asMessageId(m.id),
      threadId: asThreadId(m.threadId),
      accountId,
      provider: "gmail",
      subject: m.subject,
      snippet: m.snippet,
      from: m.from,
      to: m.to,
      cc: "cc" in m ? m.cc : undefined,
      date: m.date,
      unread: m.unread,
      starred: m.starred,
      labelIds: m.labelIds.map(asLabelId),
      hasAttachments: m.hasAttachments,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml,
      headers:
        "headers" in m && m.headers && typeof m.headers === "object"
          ? (m.headers as Record<string, string>)
          : undefined,
    });
  }

  let history = 1;

  return {
    kind: "gmail",
    async listLabels() {
      return labels;
    },
    async listThreads(_accountId, opts) {
      let list = [...threads.values()];
      if (opts?.labelId) {
        const lid = asLabelId(opts.labelId);
        list = list.filter((t) => t.labelIds.includes(lid));
      }
      list.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      const limit = opts?.limit ?? 50;
      const offset = opts?.pageToken ? Number(opts.pageToken) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new Error("invalid fixture page token");
      }
      const nextOffset = offset + limit;
      return {
        threads: list.slice(offset, nextOffset),
        nextPageToken:
          nextOffset < list.length ? String(nextOffset) : undefined,
      };
    },
    async getThread(_a, threadId: ThreadId) {
      const t = threads.get(threadId);
      if (!t) throw new Error(`thread not found: ${threadId}`);
      return t;
    },
    async getMessage(_a, messageId: MessageId) {
      const m = messages.get(messageId);
      if (!m) throw new Error(`message not found: ${messageId}`);
      return m;
    },
    async hydrateBodies(_a, messageIds) {
      return messageIds
        .map((id) => messages.get(id))
        .filter((m): m is MailMessage => Boolean(m));
    },
    async applyMutation(_accountId: AccountId, mutation) {
      for (const target of mutation.targetIds) {
        const msg = messages.get(target);
        if (!msg) continue;
        if (mutation.kind === "archive") {
          msg.labelIds = msg.labelIds.filter((l) => l !== "INBOX");
          msg.unread = false;
        }
        if (mutation.kind === "mark_read") msg.unread = false;
        if (mutation.kind === "mark_unread") msg.unread = true;
        if (mutation.kind === "star") msg.starred = true;
        if (mutation.kind === "unstar") msg.starred = false;
        if (mutation.kind === "trash") {
          msg.labelIds = [asLabelId("TRASH")];
        }
        if (mutation.kind === "spam") {
          msg.labelIds = [asLabelId("SPAM")];
        }
        if (mutation.kind === "not_spam") {
          msg.labelIds = [asLabelId("INBOX")];
        }
        if (
          mutation.kind === "apply_label" &&
          typeof mutation.payload?.labelId === "string"
        ) {
          msg.labelIds = [
            ...new Set([...msg.labelIds, asLabelId(mutation.payload.labelId)]),
          ];
        }
        if (
          mutation.kind === "remove_label" &&
          typeof mutation.payload?.labelId === "string"
        ) {
          msg.labelIds = msg.labelIds.filter(
            (label) => label !== mutation.payload?.labelId,
          );
        }
        if (
          mutation.kind === "move_folder" &&
          typeof mutation.payload?.labelId === "string"
        ) {
          msg.labelIds = [asLabelId(mutation.payload.labelId)];
        }
        messages.set(target, { ...msg });
      }
    },
    async sendDraft(_a, draft) {
      const mid = asMessageId(`m_sent_${Date.now()}`);
      const tid = asThreadId(`t_sent_${Date.now()}`);
      const msg: MailMessage = {
        id: mid,
        threadId: tid,
        accountId,
        provider: "gmail",
        subject: draft.subject,
        snippet: draft.bodyText.slice(0, 120),
        from: { email: fixture.email },
        to: draft.to,
        date: new Date().toISOString(),
        unread: false,
        starred: false,
        labelIds: [asLabelId("SENT")],
        hasAttachments: false,
        bodyText: draft.bodyText,
        bodyHtml: draft.bodyHtml,
      };
      messages.set(mid, msg);
      threads.set(tid, {
        id: tid,
        accountId,
        provider: "gmail",
        subject: draft.subject,
        snippet: msg.snippet,
        participants: draft.to,
        messageIds: [mid],
        labelIds: [asLabelId("SENT")],
        unreadCount: 0,
        lastMessageAt: msg.date,
      });
      return mid;
    },
    async saveDraft(_a, draft) {
      const id = draft.providerDraftId ?? `fixture-draft-${draft.id}`;
      drafts.set(id, { ...draft, providerDraftId: id });
      return id;
    },
    async deleteDraft(_a, providerDraftId) {
      drafts.delete(providerDraftId);
    },
    async *fetchAttachment(_a, attachment) {
      const message = messages.get(attachment.messageId);
      const found = message?.attachments?.find(
        (item) => item.id === attachment.id,
      );
      if (!found) throw new Error("attachment not found");
      yield new Uint8Array();
    },
    async fetchDeltas(_a, cursor: SyncCursor | null) {
      history += 1;
      return {
        upserts: [],
        deletes: [],
        nextCursor: {
          accountId,
          provider: "gmail",
          token: cursor
            ? String(Number(cursor.token || 0) + 1)
            : String(history),
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}
