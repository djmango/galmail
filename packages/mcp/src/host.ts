import type {
  AccountId,
  ComposeDraft,
  MailMessage,
  SyncEngine,
} from "@galmail/core-api";

export type McpAccountInfo = {
  accountId: string;
  email: string;
  provider: "gmail" | "microsoft" | "fixture";
};

export type McpSearchHit = {
  accountId: string;
  messageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
};

export type McpMessageView = {
  accountId: string;
  messageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  to: string[];
  date: string;
  /** Present only when mail:read is granted and includeBody was requested. */
  bodyText?: string;
};

export type McpCalendarEventView = {
  id: string;
  accountId: string;
  provider: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  attendees: string[];
};

export type McpDraftInput = {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  draftId?: string;
};

/** Execution backend for MCP tools. Keep tokens/vault out of this interface. */
export interface GalMailMcpHost {
  listAccounts(): Promise<McpAccountInfo[]>;
  searchMail(input: {
    accountIds: string[];
    query: string;
    limit: number;
    cursor?: string;
  }): Promise<{ hits: McpSearchHit[]; nextCursor?: string }>;
  getMessage(input: {
    accountId: string;
    messageId: string;
    includeBody: boolean;
  }): Promise<McpMessageView | null>;
  saveDraft?(input: McpDraftInput): Promise<{ draftId: string }>;
  sendDraft?(input: McpDraftInput): Promise<{ messageId: string }>;
  searchCalendar?(input: {
    accountIds: string[];
    query?: string;
    start?: string;
    end?: string;
    limit: number;
  }): Promise<{ events: McpCalendarEventView[] }>;
}

type MessageIndex = {
  byId: Map<string, MailMessage>;
};

/**
 * Host over a hydrated SyncEngine (fixture MemorySyncEngine or live
 * NativeGmailSyncEngine).
 */
export class SyncEngineMcpHost implements GalMailMcpHost {
  private readonly index = new Map<string, MessageIndex>();
  readonly saveDraft?: GalMailMcpHost["saveDraft"];
  readonly sendDraft?: GalMailMcpHost["sendDraft"];
  readonly searchCalendar?: GalMailMcpHost["searchCalendar"];

  constructor(
    private readonly sync: SyncEngine,
    private readonly accounts: McpAccountInfo[],
    options: {
      /** Optional write/calendar adapters for live desktop. */
      saveDraft?: (input: McpDraftInput) => Promise<{ draftId: string }>;
      sendDraft?: (input: McpDraftInput) => Promise<{ messageId: string }>;
      searchCalendar?: GalMailMcpHost["searchCalendar"];
    } = {},
  ) {
    this.saveDraft = options.saveDraft;
    this.sendDraft = options.sendDraft;
    this.searchCalendar = options.searchCalendar;
  }

  invalidate(accountId?: string): void {
    if (accountId) this.index.delete(accountId);
    else this.index.clear();
  }

  async ensureHydrated(accountId: string): Promise<MessageIndex> {
    let entry = this.index.get(accountId);
    if (entry) return entry;
    const hydrated = await this.sync.hydrateLocal(accountId as AccountId);
    entry = {
      byId: new Map(
        hydrated.messages.map((message) => [String(message.id), message]),
      ),
    };
    this.index.set(accountId, entry);
    return entry;
  }

  async listAccounts(): Promise<McpAccountInfo[]> {
    return [...this.accounts];
  }

  async searchMail(input: {
    accountIds: string[];
    query: string;
    limit: number;
    cursor?: string;
  }): Promise<{ hits: McpSearchHit[]; nextCursor?: string }> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
    const accountIds =
      input.accountIds.length > 0
        ? input.accountIds
        : this.accounts.map((account) => account.accountId);
    const collected: McpSearchHit[] = [];

    for (const accountId of accountIds) {
      // Refresh so live sync deltas are visible to MCP.
      this.index.delete(accountId);
      await this.ensureHydrated(accountId);
      const ids = await this.sync.searchLocal(
        accountId as AccountId,
        input.query,
      );
      const messages = this.index.get(accountId)?.byId;
      for (const messageId of ids) {
        const message = messages?.get(String(messageId));
        if (!message) continue;
        collected.push({
          accountId,
          messageId: String(message.id),
          threadId: String(message.threadId),
          subject: message.subject,
          snippet: message.snippet,
          from: message.from.email,
          date: message.date,
        });
      }
    }

    collected.sort((a, b) => b.date.localeCompare(a.date));
    const slice = collected.slice(offset, offset + input.limit);
    const nextOffset = offset + slice.length;
    return {
      hits: slice,
      nextCursor:
        nextOffset < collected.length ? String(nextOffset) : undefined,
    };
  }

  async getMessage(input: {
    accountId: string;
    messageId: string;
    includeBody: boolean;
  }): Promise<McpMessageView | null> {
    this.index.delete(input.accountId);
    const entry = await this.ensureHydrated(input.accountId);
    const message = entry.byId.get(input.messageId);
    if (!message) return null;
    const view: McpMessageView = {
      accountId: input.accountId,
      messageId: String(message.id),
      threadId: String(message.threadId),
      subject: message.subject,
      snippet: message.snippet,
      from: message.from.email,
      to: message.to.map((recipient) => recipient.email),
      date: message.date,
    };
    if (input.includeBody) {
      view.bodyText = message.bodyText ?? message.snippet;
    }
    return view;
  }

}

export function draftInputToComposeDraft(
  input: McpDraftInput,
  createId: () => string = () =>
    `draft_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
): ComposeDraft {
  const now = new Date().toISOString();
  return {
    id: input.draftId ?? createId(),
    accountId: input.accountId as AccountId,
    to: input.to.map((email) => ({ email })),
    cc: input.cc?.map((email) => ({ email })),
    bcc: input.bcc?.map((email) => ({ email })),
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: `<p>${escapeHtml(input.bodyText).replace(/\n/g, "<br>")}</p>`,
    updatedAt: now,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
