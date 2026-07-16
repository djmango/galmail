import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  type AccountId,
  type AttachmentMetadata,
  type ComposeDraft,
  type MailAddress,
  type MailLabel,
  type MailMessage,
  type MailProvider,
  type MailThread,
  type MessageId,
  type SyncCursor,
  type ThreadId,
} from "@galmail/core-api";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0`;
const MESSAGE_SELECT = [
  "id",
  "conversationId",
  "internetMessageId",
  "subject",
  "bodyPreview",
  "body",
  "sender",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "flag",
  "categories",
  "parentFolderId",
  "hasAttachments",
].join(",");
/** Well-known folders synced on bootstrap / delta (not the whole mailbox tree). */
const SYNC_WELL_KNOWN = [
  "inbox",
  "archive",
  "deleteditems",
  "junkemail",
  "sentitems",
] as const;
const BOOTSTRAP_PAGE_SIZE = 50;
/** Cursor sentinel: recent bootstrap done; next pull establishes real delta links. */
const BOOTSTRAP_DELTA_SENTINEL = "bootstrap";
const WELL_KNOWN_SYSTEM_LABEL: Record<string, string> = {
  inbox: "INBOX",
  archive: "ARCHIVE",
  deleteditems: "TRASH",
  junkemail: "SPAM",
  sentitems: "SENT",
  drafts: "DRAFTS",
};
export interface GraphHttpResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  json(): Promise<unknown>;
}

export interface GraphHttpClient {
  request(input: {
    url: string;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    headers: Record<string, string>;
    body?: string;
  }): Promise<GraphHttpResponse>;
}

export interface MicrosoftTokenSource {
  accessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

interface MicrosoftLiveBaseOptions {
  http?: GraphHttpClient;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
}

/**
 * `transport` authorization is the native production contract: the renderer
 * never receives or supplies a bearer token, and the native HTTP broker
 * authenticates the request. `provider` is retained for protocol tests and
 * non-native clients whose token source is already inside a trusted boundary.
 */
export type MicrosoftLiveOptions = MicrosoftLiveBaseOptions &
  (
    | {
        authorization: "transport";
        tokens?: never;
      }
    | {
        authorization?: "provider";
        tokens: MicrosoftTokenSource;
      }
  );

export type MicrosoftConsentState =
  | "user_consent_required"
  | "admin_consent_required"
  | "conditional_access_required"
  | "reauthentication_required";

export class MicrosoftAuthorizationRequired extends Error {
  constructor(public readonly state: MicrosoftConsentState) {
    super(`Microsoft authorization requires ${state.replaceAll("_", " ")}`);
    this.name = "MicrosoftAuthorizationRequired";
  }
}

type GraphAddress = {
  emailAddress?: { address?: string; name?: string };
};
type GraphMessage = {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  sender?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  bccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  categories?: string[];
  parentFolderId?: string;
  hasAttachments?: boolean;
  "@removed"?: { reason?: string };
};
type GraphFolder = {
  id?: string;
  displayName?: string;
  wellKnownName?: string;
  childFolderCount?: number;
};
type GraphPage<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

function defaultHttp(): GraphHttpClient {
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
          "x-ms-retry-after-ms":
            response.headers.get("x-ms-retry-after-ms") ?? undefined,
        },
        json: () => response.json().catch(() => null),
      };
    },
  };
}

function address(value?: GraphAddress): MailAddress {
  const email = value?.emailAddress?.address?.trim();
  return {
    email: email || "unknown@invalid",
    name: value?.emailAddress?.name || undefined,
  };
}

function addresses(values?: GraphAddress[]): MailAddress[] {
  return (values ?? [])
    .map(address)
    .filter((value) => value.email !== "unknown@invalid");
}

function normalizeMessage(
  accountId: AccountId,
  raw: GraphMessage,
  folderSystemById?: Map<string, string>,
): MailMessage {
  if (!raw.id)
    throw new Error("Microsoft Graph returned an incomplete message");
  const conversationId = raw.conversationId || raw.id;
  const categoryIds = (raw.categories ?? []).map((value) =>
    asLabelId(`category:${value}`),
  );
  const folderIds = raw.parentFolderId
    ? [asLabelId(`folder:${raw.parentFolderId}`)]
    : [];
  const systemIds: ReturnType<typeof asLabelId>[] = [];
  if (raw.parentFolderId && folderSystemById) {
    const system = folderSystemById.get(raw.parentFolderId);
    if (system) systemIds.push(asLabelId(system));
  }
  const starred = raw.flag?.flagStatus === "flagged";
  if (starred) systemIds.push(asLabelId("STARRED"));
  const date =
    raw.receivedDateTime ?? raw.sentDateTime ?? new Date(0).toISOString();
  const contentType = raw.body?.contentType?.toLowerCase();
  return {
    id: asMessageId(raw.id),
    threadId: asThreadId(`conversation:${conversationId}`),
    accountId,
    provider: "microsoft",
    subject: raw.subject || "(no subject)",
    snippet: raw.bodyPreview ?? "",
    from: address(raw.sender),
    to: addresses(raw.toRecipients),
    cc: addresses(raw.ccRecipients),
    bcc: addresses(raw.bccRecipients),
    date,
    unread: raw.isRead === false,
    starred,
    labelIds: [...folderIds, ...categoryIds, ...systemIds],
    hasAttachments: raw.hasAttachments === true,
    bodyHtml: contentType === "html" ? raw.body?.content : undefined,
    bodyText: contentType !== "html" ? raw.body?.content : undefined,
    headers: raw.internetMessageId
      ? { "Message-ID": raw.internetMessageId }
      : undefined,
  };
}
function normalizeThread(messages: MailMessage[]): MailThread {
  if (messages.length === 0)
    throw new Error("cannot normalize an empty conversation");
  const sorted = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)!;
  const participants = new Map<string, MailAddress>();
  for (const message of sorted) {
    for (const item of [message.from, ...message.to, ...(message.cc ?? [])]) {
      participants.set(item.email.toLowerCase(), item);
    }
  }
  return {
    id: latest.threadId,
    accountId: latest.accountId,
    provider: "microsoft",
    subject: latest.subject,
    snippet: latest.snippet,
    participants: [...participants.values()],
    messageIds: sorted.map((message) => message.id),
    labelIds: [...new Set(sorted.flatMap((message) => message.labelIds))],
    unreadCount: sorted.filter((message) => message.unread).length,
    lastMessageAt: latest.date,
  };
}

function encodeDeltaLinks(links: Record<string, string>): string {
  return JSON.stringify({ version: 1, links });
}

function decodeDeltaLinks(token: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(token) as {
      version?: unknown;
      links?: Record<string, unknown>;
    };
    if (parsed.version !== 1 || !parsed.links) return null;
    const links = Object.fromEntries(
      Object.entries(parsed.links).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    return Object.keys(links).length ? links : null;
  } catch {
    return null;
  }
}

function consentState(payload: unknown): MicrosoftConsentState | null {
  const error = payload as {
    error?: { code?: string; message?: string };
    error_description?: string;
  };
  const text = [
    error.error?.code,
    error.error?.message,
    error.error_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/aadsts65001|consent_required|authorization_requestdenied/.test(text)) {
    return /admin|authorization_requestdenied/.test(text)
      ? "admin_consent_required"
      : "user_consent_required";
  }
  if (/aadsts53000|conditional.?access|interaction_required/.test(text)) {
    return "conditional_access_required";
  }
  return null;
}

export function createMicrosoftLiveProvider(
  options: MicrosoftLiveOptions,
): MailProvider {
  const http = options.http ?? defaultHttp();
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const maxRetries = options.maxRetries ?? 5;
  const messages = new Map<MessageId, MailMessage>();
  const threads = new Map<ThreadId, MailThread>();
  const completedMutations = new Set<string>();
  const folderNames = new Map<string, string>();
  const folderSystemById = new Map<string, string>();

  function toMessage(accountId: AccountId, raw: GraphMessage): MailMessage {
    return normalizeMessage(accountId, raw, folderSystemById);
  }

  function trustedUrl(pathOrUrl: string): string {
    const url = new URL(pathOrUrl, GRAPH_ROOT);
    if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith("/v1.0/")) {
      throw new Error("Microsoft Graph returned an untrusted continuation URL");
    }
    return url.toString();
  }

  async function request<T>(
    pathOrUrl: string,
    init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
  ): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      const token =
        options.authorization === "transport"
          ? null
          : refreshed
            ? await options.tokens.refreshAccessToken()
            : await options.tokens.accessToken();
      const response = await http.request({
        url: trustedUrl(pathOrUrl),
        method: init.method,
        headers: {
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      if (response.status >= 200 && response.status < 300) {
        return (await response.json()) as T;
      }
      const payload = await response.json().catch(() => ({}));
      if (
        response.status === 401 &&
        !refreshed &&
        options.authorization !== "transport"
      ) {
        refreshed = true;
        continue;
      }
      if (response.status === 401) {
        throw new MicrosoftAuthorizationRequired("reauthentication_required");
      }
      const required = response.status === 403 ? consentState(payload) : null;
      if (required) throw new MicrosoftAuthorizationRequired(required);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        const error = new Error(
          `Microsoft Graph request failed (${response.status})`,
        );
        Object.assign(error, { status: response.status });
        throw error;
      }
      const retryAfter = Number(response.headers?.["retry-after"]);
      const retryAfterMilliseconds = Number(
        response.headers?.["x-ms-retry-after-ms"],
      );
      await sleep(
        Number.isFinite(retryAfterMilliseconds) && retryAfterMilliseconds >= 0
          ? retryAfterMilliseconds
          : Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1_000
            : Math.min(60_000, 500 * 2 ** attempt),
      );
    }
  }

  async function loadFolders(): Promise<Array<GraphFolder & { id: string }>> {
    const all: GraphFolder[] = [];
    const collections = [
      "/v1.0/me/mailFolders?includeHiddenFolders=true&$top=100",
    ];
    while (collections.length) {
      let next: string | undefined = collections.shift();
      while (next) {
        const page: GraphPage<GraphFolder> = await request(next);
        const folders = page.value ?? [];
        all.push(...folders);
        for (const folder of folders) {
          if (folder.id && (folder.childFolderCount ?? 0) > 0) {
            collections.push(
              `/v1.0/me/mailFolders/${encodeURIComponent(folder.id)}/childFolders?includeHiddenFolders=true&$top=100`,
            );
          }
        }
        next = page["@odata.nextLink"];
      }
    }
    folderSystemById.clear();
    for (const folder of all) {
      if (folder.id) {
        const wellKnown = (folder.wellKnownName ?? "").toLowerCase();
        folderNames.set(
          wellKnown || folder.displayName || folder.id,
          folder.id,
        );
        if (wellKnown) {
          folderNames.set(wellKnown, folder.id);
          const system = WELL_KNOWN_SYSTEM_LABEL[wellKnown];
          if (system) folderSystemById.set(folder.id, system);
        }
      }
    }
    return all.filter((folder): folder is GraphFolder & { id: string } =>
      Boolean(folder.id),
    );
  }

  async function syncFolderIds(): Promise<string[]> {
    await loadFolders();
    const ids: string[] = [];
    for (const name of SYNC_WELL_KNOWN) {
      const id = folderNames.get(name);
      if (id) ids.push(id);
    }
    return ids;
  }

  function cache(items: MailMessage[]): void {
    for (const item of items) messages.set(item.id, item);
    const grouped = new Map<ThreadId, MailMessage[]>();
    for (const item of messages.values()) {
      const conversation = grouped.get(item.threadId) ?? [];
      conversation.push(item);
      grouped.set(item.threadId, conversation);
    }
    threads.clear();
    for (const [id, conversation] of grouped) {
      threads.set(id, normalizeThread(conversation));
    }
  }

  async function listMessages(
    accountId: AccountId,
    path: string,
  ): Promise<{ items: MailMessage[]; next?: string }> {
    const page = await request<GraphPage<GraphMessage>>(path);
    const items = (page.value ?? [])
      .filter((item) => item.id && !item["@removed"])
      .map((item) => toMessage(accountId, item));
    cache(items);
    return { items, next: page["@odata.nextLink"] };
  }

  async function folderDelta(
    accountId: AccountId,
    folderId: string,
    initialUrl?: string,
  ): Promise<{
    upserts: MailMessage[];
    deletes: MessageId[];
    deltaLink: string;
  }> {
    const query = new URLSearchParams({
      $select: MESSAGE_SELECT,
      $top: "100",
    });
    let next =
      initialUrl ??
      `/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?${query}`;
    const upserts: MailMessage[] = [];
    const deletes: MessageId[] = [];
    let deltaLink: string | undefined;
    do {
      const page = await request<GraphPage<GraphMessage>>(next);
      for (const raw of page.value ?? []) {
        if (!raw.id) continue;
        if (raw["@removed"]) {
          const id = asMessageId(raw.id);
          deletes.push(id);
        } else {
          upserts.push(toMessage(accountId, raw));
        }
      }
      next = page["@odata.nextLink"] ?? "";
      deltaLink = page["@odata.deltaLink"] ?? deltaLink;
    } while (next);
    if (!deltaLink)
      throw new Error("Microsoft Graph delta round omitted deltaLink");
    cache(upserts);
    return { upserts, deletes, deltaLink };
  }

  async function folderId(name: string): Promise<string> {
    if (!folderNames.size) await loadFolders();
    const id = folderNames.get(name);
    if (id) return id;
    if (
      [
        "archive",
        "deleteditems",
        "drafts",
        "inbox",
        "junkemail",
        "sentitems",
      ].includes(name)
    ) {
      return name;
    }
    throw new Error(`Microsoft mailbox folder is unavailable: ${name}`);
  }

  return {
    kind: "microsoft",
    async listLabels() {
      const folders = await loadFolders();
      const categories = await request<
        GraphPage<{ id?: string; displayName?: string }>
      >("/v1.0/me/outlook/masterCategories");
      return [
        ...folders.map<MailLabel>((folder) => ({
          id: asLabelId(`folder:${folder.id}`),
          name: folder.displayName ?? folder.id,
          kind: "folder",
          providerNativeId: folder.id,
        })),
        ...(categories.value ?? [])
          .filter(
            (category): category is { id: string; displayName?: string } =>
              Boolean(category.id),
          )
          .map<MailLabel>((category) => ({
            id: asLabelId(`category:${category.displayName ?? category.id}`),
            name: category.displayName ?? category.id,
            kind: "category",
            providerNativeId: category.displayName ?? category.id,
          })),
      ];
    },
    async listThreads(accountId, opts) {
      const query = new URLSearchParams({
        $select: MESSAGE_SELECT,
        $top: String(Math.min(100, opts?.limit ?? 50)),
        $orderby: "receivedDateTime desc",
      });
      const label = opts?.labelId;
      const root = label?.startsWith("folder:")
        ? `/v1.0/me/mailFolders/${encodeURIComponent(label.slice(7))}/messages`
        : "/v1.0/me/messages";
      const page = await listMessages(
        accountId,
        opts?.pageToken ? opts.pageToken : `${root}?${query}`,
      );
      return {
        threads: [...new Set(page.items.map((item) => item.threadId))]
          .map((id) => threads.get(id))
          .filter((thread): thread is MailThread => Boolean(thread)),
        nextPageToken: page.next,
      };
    },
    async getThread(accountId, threadId) {
      const cached = threads.get(threadId);
      if (cached) return cached;
      const conversationId = threadId.replace(/^conversation:/, "");
      const query = new URLSearchParams({
        $select: MESSAGE_SELECT,
        $filter: `conversationId eq '${conversationId.replaceAll("'", "''")}'`,
      });
      await listMessages(accountId, `/v1.0/me/messages?${query}`);
      const loaded = threads.get(threadId);
      if (!loaded) throw new Error("Microsoft conversation was not found");
      return loaded;
    },
    async getMessage(accountId, messageId) {
      const cached = messages.get(messageId);
      if (cached) return cached;
      const raw = await request<GraphMessage>(
        `/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${MESSAGE_SELECT}`,
      );
      const normalized = toMessage(accountId, raw);
      cache([normalized]);
      return normalized;
    },
    async fetchRecentMessages(accountId, opts) {
      await loadFolders();
      const limit = Math.min(100, opts?.limit ?? BOOTSTRAP_PAGE_SIZE);
      const query = new URLSearchParams({
        $select: MESSAGE_SELECT,
        $top: String(limit),
        $orderby: "receivedDateTime desc",
      });
      let root = "/v1.0/me/messages";
      const labelId = opts?.labelId;
      if (labelId?.startsWith("folder:")) {
        root = `/v1.0/me/mailFolders/${encodeURIComponent(labelId.slice(7))}/messages`;
      } else if (labelId === "STARRED") {
        query.set("$filter", "flag/flagStatus eq 'flagged'");
      } else if (labelId?.startsWith("category:")) {
        const category = labelId
          .slice("category:".length)
          .replaceAll("'", "''");
        query.set("$filter", `categories/any(c:c eq '${category}')`);
      } else if (labelId) {
        const wellKnown = Object.entries(WELL_KNOWN_SYSTEM_LABEL).find(
          ([, system]) => system === labelId,
        )?.[0];
        if (wellKnown) {
          const id = await folderId(wellKnown);
          root = `/v1.0/me/mailFolders/${encodeURIComponent(id)}/messages`;
        }
      }
      const page = await listMessages(accountId, `${root}?${query}`);
      return { upserts: page.items };
    },
    async hydrateBodies(accountId, messageIds) {
      return Promise.all(
        messageIds.map(async (id) => {
          messages.delete(id);
          return this.getMessage(accountId, id);
        }),
      );
    },
    async applyMutation(_accountId, mutation) {
      const mutationId =
        typeof mutation.payload?.mutationId === "string"
          ? mutation.payload.mutationId
          : `${mutation.kind}:${[...mutation.targetIds].sort().join(",")}:${JSON.stringify(mutation.payload ?? {})}`;
      if (completedMutations.has(mutationId)) return;
      for (const target of [...new Set(mutation.targetIds)]) {
        const id = encodeURIComponent(target);
        switch (mutation.kind) {
          case "archive":
          case "snooze":
            await request(`/v1.0/me/messages/${id}/move`, {
              method: "POST",
              body: { destinationId: await folderId("archive") },
            });
            break;
          case "spam":
          case "not_spam":
            await request(`/v1.0/me/messages/${id}/move`, {
              method: "POST",
              body: {
                destinationId: await folderId(
                  mutation.kind === "spam" ? "junkemail" : "inbox",
                ),
              },
            });
            break;
          case "trash":
            await request(`/v1.0/me/messages/${id}`, { method: "DELETE" });
            break;
          case "mark_read":
          case "mark_unread":
            await request(`/v1.0/me/messages/${id}`, {
              method: "PATCH",
              body: { isRead: mutation.kind === "mark_read" },
            });
            break;
          case "star":
          case "unstar":
            await request(`/v1.0/me/messages/${id}`, {
              method: "PATCH",
              body: {
                flag: {
                  flagStatus:
                    mutation.kind === "star" ? "flagged" : "notFlagged",
                },
              },
            });
            break;
          case "apply_label":
          case "remove_label": {
            const label = String(mutation.payload?.labelId ?? "");
            if (!label.startsWith("category:")) {
              throw new Error("Graph labels must be normalized categories");
            }
            const category = label.slice("category:".length);
            const current = messages.get(asMessageId(target))?.labelIds ?? [];
            const categories = current
              .filter((value) => value.startsWith("category:"))
              .map((value) => value.slice("category:".length));
            const next =
              mutation.kind === "apply_label"
                ? [...new Set([...categories, category])]
                : categories.filter((value) => value !== category);
            await request(`/v1.0/me/messages/${id}`, {
              method: "PATCH",
              body: { categories: next },
            });
            break;
          }
          case "move_folder": {
            const destination = String(mutation.payload?.labelId ?? "").replace(
              /^folder:/,
              "",
            );
            if (!destination)
              throw new Error("A destination folder is required");
            await request(`/v1.0/me/messages/${id}/move`, {
              method: "POST",
              body: { destinationId: destination },
            });
            break;
          }
          default:
            throw new Error(`Unsupported Microsoft mutation: ${mutation.kind}`);
        }
      }
      completedMutations.add(mutationId);
    },
    async sendDraft(_accountId, draft: ComposeDraft) {
      const recipients = (values: MailAddress[] = []) =>
        values.map((value) => ({
          emailAddress: { address: value.email, name: value.name },
        }));
      await request("/v1.0/me/sendMail", {
        method: "POST",
        body: {
          message: {
            subject: draft.subject,
            body: {
              contentType: draft.bodyHtml ? "HTML" : "Text",
              content: draft.bodyHtml || draft.bodyText,
            },
            toRecipients: recipients(draft.to),
            ccRecipients: recipients(draft.cc),
            bccRecipients: recipients(draft.bcc),
          },
          saveToSentItems: true,
        },
      });
      return asMessageId(`graph-sent:${draft.id}`);
    },
    async saveDraft(_accountId, draft) {
      const body = {
        subject: draft.subject,
        body: {
          contentType: draft.bodyHtml ? "HTML" : "Text",
          content: draft.bodyHtml || draft.bodyText,
        },
        toRecipients: draft.to.map((value) => ({
          emailAddress: { address: value.email, name: value.name },
        })),
      };
      const saved = await request<{ id?: string }>(
        draft.providerDraftId
          ? `/v1.0/me/messages/${encodeURIComponent(draft.providerDraftId)}`
          : "/v1.0/me/messages",
        { method: draft.providerDraftId ? "PATCH" : "POST", body },
      );
      const id = saved.id ?? draft.providerDraftId;
      if (!id)
        throw new Error("Microsoft draft response omitted the message id");
      return id;
    },
    async deleteDraft(_accountId, providerDraftId) {
      await request(
        `/v1.0/me/messages/${encodeURIComponent(providerDraftId)}`,
        {
          method: "DELETE",
        },
      );
    },
    async *fetchAttachment(_accountId, attachment: AttachmentMetadata) {
      const result = await request<{ contentBytes?: string }>(
        `/v1.0/me/messages/${encodeURIComponent(attachment.messageId)}/attachments/${encodeURIComponent(attachment.providerNativeId)}`,
      );
      if (!result.contentBytes) {
        throw new Error(
          "Microsoft attachment is not an inline file attachment",
        );
      }
      const bytes =
        typeof Buffer !== "undefined"
          ? Uint8Array.from(Buffer.from(result.contentBytes, "base64"))
          : Uint8Array.from(atob(result.contentBytes), (char) =>
              char.charCodeAt(0),
            );
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        yield bytes.slice(offset, offset + 64 * 1024);
      }
    },
    async fetchDeltas(accountId, cursor: SyncCursor | null) {
      let links = cursor ? decodeDeltaLinks(cursor.token) : null;
      let fullReconcile = !links;
      const upserts = new Map<MessageId, MailMessage>();
      const deletes = new Set<MessageId>();
      const nextLinks: Record<string, string> = {};

      // Bounded bootstrap: recent messages from well-known folders only.
      // Defers full Graph delta establishment to the next pull.
      if (!links) {
        const folderIds = await syncFolderIds();
        for (const id of folderIds) {
          const query = new URLSearchParams({
            $select: MESSAGE_SELECT,
            $top: String(BOOTSTRAP_PAGE_SIZE),
            $orderby: "receivedDateTime desc",
          });
          const page = await listMessages(
            accountId,
            `/v1.0/me/mailFolders/${encodeURIComponent(id)}/messages?${query}`,
          );
          for (const item of page.items) upserts.set(item.id, item);
          nextLinks[id] = BOOTSTRAP_DELTA_SENTINEL;
        }
        cache([...upserts.values()]);
        return {
          upserts: [...upserts.values()],
          deletes: [],
          nextCursor: {
            accountId: asAccountId(accountId),
            provider: "microsoft",
            token: encodeDeltaLinks(nextLinks),
            updatedAt: now().toISOString(),
          },
          fullReconcile: true,
        };
      }

      try {
        for (const [folderId, link] of Object.entries(links)) {
          const initialUrl =
            !link || link === BOOTSTRAP_DELTA_SENTINEL ? undefined : link;
          const delta = await folderDelta(accountId, folderId, initialUrl);
          nextLinks[folderId] = delta.deltaLink;
          for (const item of delta.upserts) {
            upserts.set(item.id, item);
            deletes.delete(item.id);
          }
          for (const id of delta.deletes) {
            deletes.add(id);
          }
        }
      } catch (error) {
        if ((error as { status?: number }).status !== 410 || fullReconcile)
          throw error;
        fullReconcile = true;
        for (const key of Object.keys(nextLinks)) delete nextLinks[key];
        upserts.clear();
        deletes.clear();
        const folderIds = await syncFolderIds();
        for (const id of folderIds) {
          const delta = await folderDelta(accountId, id);
          nextLinks[id] = delta.deltaLink;
          for (const item of delta.upserts) upserts.set(item.id, item);
        }
      }
      // A folder move can appear as a removal in the old folder and an upsert
      // in the new folder in either order. The upsert wins globally.
      for (const id of upserts.keys()) deletes.delete(id);
      for (const id of deletes) messages.delete(id);
      cache([...upserts.values()]);
      return {
        upserts: [...upserts.values()],
        deletes: [...deletes],
        nextCursor: {
          accountId: asAccountId(accountId),
          provider: "microsoft",
          token: encodeDeltaLinks(nextLinks),
          updatedAt: now().toISOString(),
        },
        fullReconcile,
      };
    },
  };
}

export const microsoftDeltaCursor = {
  encode: encodeDeltaLinks,
  decode: decodeDeltaLinks,
};
