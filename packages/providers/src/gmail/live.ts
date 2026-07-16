import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  attachmentQuarantineReason,
  decodeMimeHeader,
  generateMime,
  parseAddressList,
  type AccountId,
  type AttachmentMetadata,
  type ComposeDraft,
  type MailAddress,
  type MailLabel,
  type MailMessage,
  type MailProvider,
  type MailThread,
  type MessageId,
  type OutboxMutation,
  type SyncCursor,
  type ThreadId,
} from "@galmail/core-api";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailHttpResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  json(): Promise<unknown>;
}

export interface GmailHttpClient {
  request(input: {
    url: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers: Record<string, string>;
    body?: string;
  }): Promise<GmailHttpResponse>;
}

export interface GmailTokenSource {
  accessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

export interface GmailLiveOptions {
  tokens: GmailTokenSource;
  http?: GmailHttpClient;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
}

export class GmailReauthenticationRequired extends Error {
  constructor() {
    super("Gmail authorization must be renewed");
    this.name = "GmailReauthenticationRequired";
  }
}

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};
type GmailThread = {
  id?: string;
  historyId?: string;
  messages?: GmailMessage[];
};

function defaultHttp(): GmailHttpClient {
  return {
    async request(input) {
      const response = await fetch(input.url, {
        method: input.method ?? "GET",
        headers: input.headers,
        body: input.body,
      });
      return {
        status: response.status,
        headers: {
          "retry-after": response.headers.get("retry-after") ?? undefined,
        },
        json: () => response.json().catch(() => null),
      };
    },
  };
}

function header(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function addresses(value: string): MailAddress[] {
  return parseAddressList(value);
}

function decodeBase64Url(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(normalized, "base64").toString("utf8");
    }
    const binary = atob(normalized);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
}

function bodyPart(
  part: GmailPart | undefined,
  mimeType: string,
): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = bodyPart(child, mimeType);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeMessage(
  accountId: AccountId,
  raw: GmailMessage,
): MailMessage {
  if (!raw.id || !raw.threadId)
    throw new Error("Gmail returned an incomplete message");
  const labels = raw.labelIds ?? [];
  const timestamp = Number(raw.internalDate);
  const dateHeader = header(raw, "Date");
  const parsedHeader = Date.parse(dateHeader);
  const date =
    raw.internalDate && Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : Number.isFinite(parsedHeader)
        ? new Date(parsedHeader).toISOString()
        : new Date(0).toISOString();
  const attachment = (part: GmailPart | undefined): boolean =>
    Boolean(
      part?.body?.attachmentId ||
      part?.filename ||
      part?.parts?.some((child) => attachment(child)),
    );
  const attachments: AttachmentMetadata[] = [];
  const collectAttachments = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.body?.attachmentId) {
      const metadata: AttachmentMetadata = {
        id: `${raw.id}:${part.partId ?? part.body.attachmentId}`,
        providerNativeId: part.body.attachmentId,
        filename: part.filename ?? "",
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        messageId: asMessageId(raw.id!),
        disposition: part.filename ? "attachment" : "inline",
        contentId: part.headers
          ?.find((item) => item.name?.toLowerCase() === "content-id")
          ?.value?.replace(/^<|>$/g, ""),
      };
      const reason = attachmentQuarantineReason(metadata);
      attachments.push(
        reason
          ? { ...metadata, quarantined: true, quarantineReason: reason }
          : metadata,
      );
    }
    for (const child of part.parts ?? []) collectAttachments(child);
  };
  collectAttachments(raw.payload);
  return {
    id: asMessageId(raw.id),
    threadId: asThreadId(raw.threadId),
    accountId,
    provider: "gmail",
    subject: decodeMimeHeader(header(raw, "Subject")) || "(no subject)",
    snippet: raw.snippet ?? "",
    from: addresses(header(raw, "From"))[0] ?? { email: "unknown@invalid" },
    to: addresses(header(raw, "To")),
    cc: addresses(header(raw, "Cc")),
    bcc: addresses(header(raw, "Bcc")),
    date,
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    labelIds: labels.map(asLabelId),
    hasAttachments: attachment(raw.payload),
    attachments,
    bodyText: bodyPart(raw.payload, "text/plain"),
    bodyHtml: bodyPart(raw.payload, "text/html"),
    headers: Object.fromEntries(
      (raw.payload?.headers ?? []).flatMap((item) =>
        item.name && item.value ? [[item.name, item.value]] : [],
      ),
    ),
    inReplyTo: header(raw, "In-Reply-To").replace(/^<|>$/g, "") || undefined,
    references: header(raw, "References")
      .split(/\s+/)
      .map((value) => value.replace(/^<|>$/g, ""))
      .filter(Boolean),
    calendarInvite: bodyPart(raw.payload, "text/calendar")
      ? {
          method: /METHOD:([^\r\n]+)/i.exec(
            bodyPart(raw.payload, "text/calendar")!,
          )?.[1],
          content: bodyPart(raw.payload, "text/calendar")!,
        }
      : undefined,
  };
}

function normalizeThread(accountId: AccountId, raw: GmailThread): MailThread {
  const messages = (raw.messages ?? []).map((message) =>
    normalizeMessage(accountId, message),
  );
  if (!raw.id || messages.length === 0)
    throw new Error("Gmail returned an empty thread");
  const latest = [...messages].sort((a, b) => b.date.localeCompare(a.date))[0]!;
  const labels = [...new Set(messages.flatMap((message) => message.labelIds))];
  const participants = new Map<string, MailAddress>();
  for (const message of messages) {
    for (const address of [
      message.from,
      ...message.to,
      ...(message.cc ?? []),
    ]) {
      participants.set(address.email.toLowerCase(), address);
    }
  }
  return {
    id: asThreadId(raw.id),
    accountId,
    provider: "gmail",
    subject: latest.subject,
    snippet: latest.snippet,
    participants: [...participants.values()],
    messageIds: messages.map((message) => message.id),
    labelIds: labels,
    unreadCount: messages.filter((message) => message.unread).length,
    lastMessageAt: latest.date,
  };
}

function mutationLabels(mutation: Pick<OutboxMutation, "kind" | "payload">): {
  addLabelIds?: string[];
  removeLabelIds?: string[];
} {
  const labelId =
    typeof mutation.payload?.labelId === "string"
      ? mutation.payload.labelId
      : undefined;
  switch (mutation.kind) {
    case "archive":
      return { removeLabelIds: ["INBOX"] };
    case "trash":
      return { addLabelIds: ["TRASH"] };
    case "spam":
      return { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] };
    case "not_spam":
      return { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] };
    case "mark_read":
      return { removeLabelIds: ["UNREAD"] };
    case "mark_unread":
      return { addLabelIds: ["UNREAD"] };
    case "star":
      return { addLabelIds: ["STARRED"] };
    case "unstar":
      return { removeLabelIds: ["STARRED"] };
    case "apply_label":
      if (!labelId) throw new Error("A labelId is required");
      return { addLabelIds: [labelId] };
    case "remove_label":
      if (!labelId) throw new Error("A labelId is required");
      return { removeLabelIds: [labelId] };
    case "move_folder":
      if (!labelId) throw new Error("A labelId is required");
      return { addLabelIds: [labelId], removeLabelIds: ["INBOX"] };
    case "snooze":
      // Gmail exposes no public snooze endpoint. Keep the wake time locally and
      // remove Inbox until the durable outbox restores it.
      return { removeLabelIds: ["INBOX"] };
    default:
      throw new Error(`Unsupported Gmail mutation: ${mutation.kind}`);
  }
}

export function createGmailLiveProvider(
  options: GmailLiveOptions,
): MailProvider {
  const http = options.http ?? defaultHttp();
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const maxRetries = options.maxRetries ?? 5;
  const messages = new Map<string, MailMessage>();
  const threads = new Map<string, MailThread>();
  const completedMutations = new Set<string>();

  async function request<T>(
    path: string,
    init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
  ): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      const token = refreshed
        ? await options.tokens.refreshAccessToken()
        : await options.tokens.accessToken();
      const response = await http.request({
        url: path.startsWith("http") ? path : `${API}${path}`,
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      if (response.status >= 200 && response.status < 300) {
        return (await response.json()) as T;
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if (response.status === 401) throw new GmailReauthenticationRequired();
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { errors?: Array<{ reason?: string }> };
      };
      const reason = payload.error?.errors?.[0]?.reason;
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 &&
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "backendError",
          ].includes(reason ?? ""));
      if (!retryable || attempt >= maxRetries) {
        const error = new Error(`Gmail request failed (${response.status})`);
        Object.assign(error, { status: response.status });
        throw error;
      }
      const retryAfter = Number(response.headers?.["retry-after"]);
      const delay =
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : Math.min(30_000, 500 * 2 ** attempt);
      await sleep(delay);
    }
  }

  async function loadMessage(
    accountId: AccountId,
    id: string,
  ): Promise<MailMessage> {
    const raw = await request<GmailMessage>(
      `/messages/${encodeURIComponent(id)}?format=full`,
    );
    const normalized = normalizeMessage(accountId, raw);
    messages.set(normalized.id, normalized);
    return normalized;
  }

  async function loadThread(
    accountId: AccountId,
    id: string,
  ): Promise<MailThread> {
    const raw = await request<GmailThread>(
      `/threads/${encodeURIComponent(id)}?format=full`,
    );
    for (const item of raw.messages ?? []) {
      const normalized = normalizeMessage(accountId, item);
      messages.set(normalized.id, normalized);
    }
    const normalized = normalizeThread(accountId, raw);
    threads.set(normalized.id, normalized);
    return normalized;
  }

  async function fullReconcile(accountId: AccountId): Promise<{
    upserts: MailMessage[];
    nextCursor: SyncCursor;
  }> {
    const upserts: MailMessage[] = [];
    let pageToken: string | undefined;
    let latestHistoryId = "0";
    do {
      const query = new URLSearchParams({
        maxResults: "500",
        includeSpamTrash: "true",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await request<{
        messages?: Array<{ id?: string }>;
        nextPageToken?: string;
      }>(`/messages?${query}`);
      const ids = (page.messages ?? []).flatMap((item) =>
        item.id ? [item.id] : [],
      );
      for (let offset = 0; offset < ids.length; offset += 10) {
        const batch = await Promise.all(
          ids.slice(offset, offset + 10).map(async (id) => {
            const raw = await request<GmailMessage>(
              `/messages/${encodeURIComponent(id)}?format=full`,
            );
            return { raw, normalized: normalizeMessage(accountId, raw) };
          }),
        );
        for (const { raw, normalized } of batch) {
          messages.set(normalized.id, normalized);
          upserts.push(normalized);
          if (
            raw.historyId &&
            BigInt(raw.historyId) > BigInt(latestHistoryId)
          ) {
            latestHistoryId = raw.historyId;
          }
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return {
      upserts,
      nextCursor: {
        accountId,
        provider: "gmail",
        token: latestHistoryId,
        updatedAt: now().toISOString(),
      },
    };
  }

  return {
    kind: "gmail",
    async listLabels(_accountId) {
      const result = await request<{
        labels?: Array<{ id?: string; name?: string; type?: string }>;
      }>("/labels");
      return (result.labels ?? [])
        .filter(
          (label): label is { id: string; name?: string; type?: string } =>
            Boolean(label.id),
        )
        .map<MailLabel>((label) => ({
          id: asLabelId(label.id),
          name: label.name ?? label.id,
          kind: label.type === "system" ? "system" : "label",
          providerNativeId: label.id,
        }));
    },
    async listThreads(accountId, opts) {
      const query = new URLSearchParams({
        maxResults: String(Math.min(500, opts?.limit ?? 50)),
      });
      if (opts?.pageToken) query.set("pageToken", opts.pageToken);
      if (opts?.labelId) query.append("labelIds", opts.labelId);
      const page = await request<{
        threads?: Array<{ id?: string }>;
        nextPageToken?: string;
      }>(`/threads?${query}`);
      const normalized = await Promise.all(
        (page.threads ?? [])
          .filter((thread): thread is { id: string } => Boolean(thread.id))
          .map((thread) => loadThread(accountId, thread.id)),
      );
      return { threads: normalized, nextPageToken: page.nextPageToken };
    },
    async getThread(accountId, threadId: ThreadId) {
      return threads.get(threadId) ?? loadThread(accountId, threadId);
    },
    async getMessage(accountId, messageId: MessageId) {
      return messages.get(messageId) ?? loadMessage(accountId, messageId);
    },
    async hydrateBodies(accountId, messageIds) {
      return Promise.all(messageIds.map((id) => loadMessage(accountId, id)));
    },
    async applyMutation(accountId, mutation) {
      const mutationId =
        typeof mutation.payload?.mutationId === "string"
          ? mutation.payload.mutationId
          : `${accountId}:${mutation.kind}:${[...mutation.targetIds].sort().join(",")}:${JSON.stringify(mutation.payload ?? {})}`;
      if (completedMutations.has(mutationId)) return;
      const labels = mutationLabels(mutation);
      for (const target of [...new Set(mutation.targetIds)]) {
        const endpoint =
          mutation.kind === "trash"
            ? `/messages/${encodeURIComponent(target)}/trash`
            : `/messages/${encodeURIComponent(target)}/modify`;
        await request(endpoint, {
          method: "POST",
          body: mutation.kind === "trash" ? {} : labels,
        });
      }
      completedMutations.add(mutationId);
    },
    async sendDraft(_accountId, draft: ComposeDraft) {
      const encode = (value: string): string => {
        if (typeof Buffer !== "undefined") {
          return Buffer.from(value).toString("base64url");
        }
        return btoa(unescape(encodeURIComponent(value)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      };
      const raw = encode(generateMime(draft));
      const result = await request<{ id?: string }>("/messages/send", {
        method: "POST",
        body: { raw },
      });
      if (!result.id)
        throw new Error("Gmail send response omitted the message id");
      return asMessageId(result.id);
    },
    async saveDraft(_accountId, draft) {
      const encode = (value: string): string => {
        if (typeof Buffer !== "undefined")
          return Buffer.from(value).toString("base64url");
        return btoa(unescape(encodeURIComponent(value)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      };
      const path = draft.providerDraftId
        ? `/drafts/${encodeURIComponent(draft.providerDraftId)}`
        : "/drafts";
      const result = await request<{ id?: string }>(path, {
        method: draft.providerDraftId ? "PUT" : "POST",
        body: {
          id: draft.providerDraftId,
          message: { raw: encode(generateMime(draft)) },
        },
      });
      if (!result.id)
        throw new Error("Gmail draft response omitted the draft id");
      return result.id;
    },
    async deleteDraft(_accountId, providerDraftId) {
      await request(`/drafts/${encodeURIComponent(providerDraftId)}`, {
        method: "DELETE",
      });
    },
    async *fetchAttachment(_accountId, attachment) {
      const result = await request<{ data?: string }>(
        `/messages/${encodeURIComponent(attachment.messageId)}/attachments/${encodeURIComponent(attachment.providerNativeId)}`,
      );
      if (!result.data)
        throw new Error("Gmail attachment response omitted data");
      const normalized = result.data.replace(/-/g, "+").replace(/_/g, "/");
      const bytes =
        typeof Buffer !== "undefined"
          ? Uint8Array.from(Buffer.from(normalized, "base64"))
          : Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.slice(offset, offset + chunkSize);
      }
    },
    async fetchDeltas(accountId, cursor: SyncCursor | null) {
      if (!cursor) {
        const reconciled = await fullReconcile(accountId);
        return { ...reconciled, deletes: [], fullReconcile: true };
      }
      const upsertIds = new Set<string>();
      const deletes = new Set<MessageId>();
      let pageToken: string | undefined;
      let historyId = cursor.token;
      try {
        do {
          const query = new URLSearchParams({
            startHistoryId: cursor.token,
            maxResults: "500",
          });
          if (pageToken) query.set("pageToken", pageToken);
          const page = await request<{
            historyId?: string;
            nextPageToken?: string;
            history?: Array<{
              messages?: Array<{ id?: string }>;
              messagesAdded?: Array<{ message?: { id?: string } }>;
              labelsAdded?: Array<{ message?: { id?: string } }>;
              labelsRemoved?: Array<{ message?: { id?: string } }>;
              messagesDeleted?: Array<{ message?: { id?: string } }>;
            }>;
          }>(`/history?${query}`);
          historyId = page.historyId ?? historyId;
          for (const event of page.history ?? []) {
            for (const item of [
              ...(event.messages ?? []),
              ...(event.messagesAdded ?? []).map(
                (entry) => entry.message ?? {},
              ),
              ...(event.labelsAdded ?? []).map((entry) => entry.message ?? {}),
              ...(event.labelsRemoved ?? []).map(
                (entry) => entry.message ?? {},
              ),
            ]) {
              if (item.id) upsertIds.add(item.id);
            }
            for (const entry of event.messagesDeleted ?? []) {
              if (entry.message?.id) {
                deletes.add(asMessageId(entry.message.id));
                upsertIds.delete(entry.message.id);
                messages.delete(entry.message.id);
              }
            }
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        const reconciled = await fullReconcile(accountId);
        return { ...reconciled, deletes: [], fullReconcile: true };
      }
      const upserts = await Promise.all(
        [...upsertIds].map((id) => loadMessage(accountId, id)),
      );
      return {
        upserts,
        deletes: [...deletes],
        nextCursor: {
          accountId: asAccountId(accountId),
          provider: "gmail",
          token: historyId,
          updatedAt: now().toISOString(),
        },
      };
    },
  };
}
