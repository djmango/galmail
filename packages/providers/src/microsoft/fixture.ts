import type { MailProvider } from "@galmail/core-api";
import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  type MailLabel,
  type MailMessage,
  type MailThread,
  type MessageId,
  type ThreadId,
} from "@galmail/core-api";

/** Microsoft Graph fixture provider for unified inbox validation. */
export function createMicrosoftFixtureProvider(): MailProvider {
  const accountId = asAccountId("microsoft:demo");
  const labels: MailLabel[] = [
    {
      id: asLabelId("inbox"),
      name: "Inbox",
      kind: "folder",
      providerNativeId: "Inbox",
    },
    {
      id: asLabelId("cat_focus"),
      name: "Focused",
      kind: "category",
      providerNativeId: "Focused",
    },
  ];

  const threadId = asThreadId("ms_t1");
  const messageId = asMessageId("ms_m1");

  const thread: MailThread = {
    id: threadId,
    accountId,
    provider: "microsoft",
    subject: "Graph delta sync notes",
    snippet: "Folders and categories map into the unified view.",
    participants: [{ email: "outlook@example.com", name: "Outlook Bot" }],
    messageIds: [messageId],
    labelIds: [asLabelId("inbox"), asLabelId("cat_focus")],
    unreadCount: 1,
    lastMessageAt: "2026-07-15T12:00:00.000Z",
  };

  const message: MailMessage = {
    id: messageId,
    threadId,
    accountId,
    provider: "microsoft",
    subject: thread.subject,
    snippet: thread.snippet,
    from: { email: "outlook@example.com", name: "Outlook Bot" },
    to: [{ email: "demo@contoso.local" }],
    date: thread.lastMessageAt,
    unread: true,
    starred: false,
    labelIds: thread.labelIds,
    hasAttachments: false,
    bodyText:
      "Microsoft Graph folders/categories appear alongside Gmail labels in GalMail's unified inbox.",
    bodyHtml:
      "<p>Microsoft Graph folders/categories appear alongside Gmail labels in GalMail's unified inbox.</p>",
  };

  const threads = new Map<string, MailThread>([[threadId, thread]]);
  const messages = new Map<string, MailMessage>([[messageId, message]]);
  let delta = 1;

  return {
    kind: "microsoft",
    async listLabels() {
      return labels;
    },
    async listThreads() {
      return { threads: [...threads.values()] };
    },
    async getThread(_a, id: ThreadId) {
      const t = threads.get(id);
      if (!t) throw new Error(`thread not found: ${id}`);
      return t;
    },
    async getMessage(_a, id: MessageId) {
      const m = messages.get(id);
      if (!m) throw new Error(`message not found: ${id}`);
      return m;
    },
    async hydrateBodies(_a, ids) {
      return ids
        .map((id) => messages.get(id))
        .filter((m): m is MailMessage => Boolean(m));
    },
    async applyMutation(_a, mutation) {
      for (const target of mutation.targetIds) {
        const msg = messages.get(target);
        if (!msg) continue;
        if (mutation.kind === "archive" || mutation.kind === "move_folder") {
          msg.labelIds = msg.labelIds.filter((l) => l !== "inbox");
        }
        if (mutation.kind === "mark_read") msg.unread = false;
        messages.set(target, { ...msg });
      }
    },
    async sendDraft() {
      return asMessageId(`ms_sent_${Date.now()}`);
    },
    async fetchDeltas(_a, cursor) {
      delta += 1;
      return {
        upserts: [],
        deletes: [],
        nextCursor: {
          accountId,
          provider: "microsoft",
          token: cursor?.token
            ? `${cursor.token}+${delta}`
            : `delta_${delta}`,
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

export function createMicrosoftLiveProvider(_opts: {
  accessToken: string;
}): MailProvider {
  throw new Error(
    "Live Microsoft Graph provider requires OAuth. Use fixture mode or configure MS_CLIENT_ID.",
  );
}
