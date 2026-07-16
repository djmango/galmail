import { describe, expect, it } from "bun:test";
import { asAccountId, asMessageId } from "@galmail/core-api";
import {
  createMicrosoftLiveProvider,
  MicrosoftAuthorizationRequired,
  microsoftDeltaCursor,
  type GraphHttpClient,
} from "./live.js";
import {
  beginMicrosoftPkce,
  microsoftAdminConsentUrl,
  MICROSOFT_GRAPH_SCOPES,
} from "./oauth.js";

function response(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return {
    status,
    headers,
    async json() {
      return body;
    },
  };
}

function provider(http: GraphHttpClient, sleeps: number[] = []) {
  return createMicrosoftLiveProvider({
    http,
    tokens: {
      async accessToken() {
        return "opaque-native-token";
      },
      async refreshAccessToken() {
        return "refreshed-native-token";
      },
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => new Date("2026-07-15T12:00:00.000Z"),
  });
}

describe("Microsoft Graph live provider", () => {
  it("normalizes folder/category/conversation semantics", async () => {
    const http: GraphHttpClient = {
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
            ],
          });
        }
        if (input.url.includes("/masterCategories")) {
          return response(200, {
            value: [{ id: "blue", displayName: "Focused" }],
          });
        }
        return response(200, {
          value: [
            {
              id: "message-1",
              conversationId: "conversation-1",
              subject: "Graph semantics",
              bodyPreview: "Normalized",
              body: { contentType: "text", content: "Body" },
              sender: { emailAddress: { address: "sender@example.com" } },
              toRecipients: [
                { emailAddress: { address: "recipient@example.com" } },
              ],
              receivedDateTime: "2026-07-15T10:00:00.000Z",
              isRead: false,
              flag: { flagStatus: "flagged" },
              categories: ["Focused"],
              parentFolderId: "inbox-id",
              hasAttachments: false,
            },
          ],
        });
      },
    };
    const graph = provider(http);
    const accountId = asAccountId("microsoft:reader@example.com");
    const labels = await graph.listLabels(accountId);
    const { threads } = await graph.listThreads(accountId);
    const message = await graph.getMessage(accountId, asMessageId("message-1"));

    expect(labels.map((label) => [label.kind, label.providerNativeId])).toEqual(
      [
        ["folder", "inbox-id"],
        ["category", "Focused"],
      ],
    );
    expect(threads[0]).toMatchObject({
      id: "conversation:conversation-1",
      provider: "microsoft",
      unreadCount: 1,
    });
    expect(message.labelIds).toEqual([
      "folder:inbox-id",
      "category:Focused",
      "INBOX",
      "STARRED",
    ]);
    expect(message.starred).toBe(true);
  });

  it("bootstraps recent well-known folders without a full mailbox delta", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const http: GraphHttpClient = {
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
              {
                id: "custom-id",
                displayName: "Project",
                wellKnownName: undefined,
              },
            ],
          });
        }
        calls += 1;
        if (calls === 1) return response(429, {}, { "retry-after": "3" });
        expect(input.url).toContain("/mailFolders/inbox-id/messages?");
        expect(decodeURIComponent(input.url)).toContain("$top=50");
        expect(input.url).not.toContain("/delta");
        return response(200, {
          value: [
            {
              id: "delta-message",
              conversationId: "delta-conversation",
              subject: "Delta",
              sender: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-07-15T10:00:00.000Z",
              parentFolderId: "inbox-id",
            },
          ],
        });
      },
    };
    const accountId = asAccountId("microsoft:reader@example.com");
    const delta = await provider(http, sleeps).fetchDeltas(accountId, null);

    expect(sleeps).toEqual([3_000]);
    expect(delta.fullReconcile).toBe(true);
    expect(delta.upserts).toHaveLength(1);
    expect(microsoftDeltaCursor.decode(delta.nextCursor.token)).toEqual({
      "inbox-id": "bootstrap",
    });
  });

  it("establishes opaque delta links after bootstrap sentinel", async () => {
    const http: GraphHttpClient = {
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
            ],
          });
        }
        expect(input.url).toContain("/messages/delta");
        return response(200, {
          value: [
            {
              id: "delta-message",
              conversationId: "delta-conversation",
              subject: "Delta",
              sender: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-07-15T10:00:00.000Z",
              parentFolderId: "inbox-id",
            },
          ],
          "@odata.deltaLink":
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=opaque",
        });
      },
    };
    const accountId = asAccountId("microsoft:reader@example.com");
    const delta = await provider(http).fetchDeltas(accountId, {
      accountId,
      provider: "microsoft",
      token: microsoftDeltaCursor.encode({ "inbox-id": "bootstrap" }),
      updatedAt: "2026-07-14T10:00:00.000Z",
    });

    expect(delta.upserts).toHaveLength(1);
    expect(microsoftDeltaCursor.decode(delta.nextCursor.token)).toEqual({
      "inbox-id":
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=opaque",
    });
  });

  it("surfaces enterprise admin-consent state without leaking response text", async () => {
    const graph = provider({
      async request() {
        return response(403, {
          error: {
            code: "Authorization_RequestDenied",
            message: "An administrator must consent",
          },
        });
      },
    });
    const error = await graph
      .listLabels(asAccountId("microsoft:reader@example.com"))
      .catch((reason) => reason);
    expect(error).toBeInstanceOf(MicrosoftAuthorizationRequired);
    expect(error.state).toBe("admin_consent_required");
    expect(error.message).not.toContain("administrator must consent");
  });

  it("keeps bearer credentials out of native transport requests", async () => {
    let headers: Record<string, string> | undefined;
    const graph = createMicrosoftLiveProvider({
      authorization: "transport",
      http: {
        async request(input) {
          headers = input.headers;
          return response(401, {});
        },
      },
    });

    const error = await graph
      .listLabels(asAccountId("microsoft:reader@example.com"))
      .catch((reason) => reason);
    expect(headers?.authorization).toBeUndefined();
    expect(error).toBeInstanceOf(MicrosoftAuthorizationRequired);
    expect(error.state).toBe("reauthentication_required");
  });

  it("maps spam, not-spam, and snooze into Graph folder moves", async () => {
    const moves: Array<{ path: string; destinationId: string }> = [];
    const graph = provider({
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              { id: "archive-id", wellKnownName: "archive" },
              { id: "inbox-id", wellKnownName: "inbox" },
              { id: "junk-id", wellKnownName: "junkemail" },
            ],
          });
        }
        moves.push({
          path: new URL(input.url).pathname,
          destinationId: (
            JSON.parse(input.body ?? "{}") as {
              destinationId: string;
            }
          ).destinationId,
        });
        return response(201, {});
      },
    });
    const accountId = asAccountId("microsoft:reader@example.com");

    await graph.applyMutation(accountId, {
      kind: "spam",
      targetIds: ["message-1"],
    });
    await graph.applyMutation(accountId, {
      kind: "not_spam",
      targetIds: ["message-2"],
    });
    await graph.applyMutation(accountId, {
      kind: "snooze",
      targetIds: ["message-3"],
    });

    expect(moves.map((move) => move.destinationId)).toEqual([
      "junk-id",
      "inbox-id",
      "archive-id",
    ]);
    expect(moves.every((move) => move.path.endsWith("/move"))).toBe(true);
  });

  it("lets a cross-folder upsert win over an old-folder removal", async () => {
    const http: GraphHttpClient = {
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              {
                id: "inbox-id",
                displayName: "Inbox",
                wellKnownName: "inbox",
              },
              {
                id: "archive-id",
                displayName: "Archive",
                wellKnownName: "archive",
              },
            ],
          });
        }
        if (input.url.includes("/inbox-id/")) {
          return response(200, {
            value: [
              {
                id: "moved-message",
                conversationId: "conversation-1",
                subject: "Moved",
                sender: { emailAddress: { address: "sender@example.com" } },
                receivedDateTime: "2026-07-15T10:00:00.000Z",
                parentFolderId: "inbox-id",
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=new",
          });
        }
        return response(200, {
          value: [{ id: "moved-message", "@removed": { reason: "changed" } }],
          "@odata.deltaLink":
            "https://graph.microsoft.com/v1.0/me/mailFolders/archive-id/messages/delta?$deltatoken=old",
        });
      },
    };

    const accountId = asAccountId("microsoft:reader@example.com");
    const delta = await provider(http).fetchDeltas(accountId, {
      accountId,
      provider: "microsoft",
      token: microsoftDeltaCursor.encode({
        "inbox-id": "bootstrap",
        "archive-id": "bootstrap",
      }),
      updatedAt: "2026-07-14T10:00:00.000Z",
    });
    expect(delta.upserts.map((message) => message.id)).toEqual([
      "moved-message",
    ]);
    expect(delta.deletes).toEqual([]);
  });

  it("restarts well-known folders after an expired delta cursor", async () => {
    let expiredRequests = 0;
    const http: GraphHttpClient = {
      async request(input) {
        if (input.url.includes("/mailFolders?")) {
          return response(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
              {
                id: "archive-id",
                displayName: "Archive",
                wellKnownName: "archive",
              },
            ],
          });
        }
        if (input.url.includes("$deltatoken=expired")) {
          expiredRequests += 1;
          return response(410, {});
        }
        const folder = input.url.includes("/inbox-id/")
          ? "inbox-id"
          : "archive-id";
        return response(200, {
          value: [
            {
              id: `${folder}-message`,
              conversationId: `${folder}-conversation`,
              sender: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-07-15T10:00:00.000Z",
              parentFolderId: folder,
            },
          ],
          "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$deltatoken=fresh`,
        });
      },
    };
    const accountId = asAccountId("microsoft:reader@example.com");
    const delta = await provider(http).fetchDeltas(accountId, {
      accountId,
      provider: "microsoft",
      token: microsoftDeltaCursor.encode({
        "inbox-id":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=expired",
        "archive-id":
          "https://graph.microsoft.com/v1.0/me/mailFolders/archive-id/messages/delta?$deltatoken=expired",
      }),
      updatedAt: "2026-07-14T10:00:00.000Z",
    });

    expect(expiredRequests).toBe(1);
    expect(delta.fullReconcile).toBe(true);
    expect(delta.upserts.map((message) => message.id).sort()).toEqual([
      "archive-id-message",
      "inbox-id-message",
    ]);
    expect(
      Object.keys(microsoftDeltaCursor.decode(delta.nextCursor.token)!),
    ).toEqual(["inbox-id", "archive-id"]);
  });
});

describe("Microsoft public-client PKCE", () => {
  it("uses S256, delegated mail scopes, no client secret, and strict state", async () => {
    const attempt = await beginMicrosoftPkce({
      clientId: "00000000-0000-4000-8000-000000000001",
      redirectUri: "http://127.0.0.1:49152/oauth/callback",
      tenant: "organizations",
    });
    const url = new URL(attempt.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(url.searchParams.get("scope")).toContain("Mail.ReadWrite");
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
    expect(MICROSOFT_GRAPH_SCOPES).toContain("offline_access");
    expect(attempt.verifier).toHaveLength(43);
  });

  it("builds tenant-specific admin consent without application permissions", () => {
    const url = new URL(
      microsoftAdminConsentUrl({
        clientId: "00000000-0000-4000-8000-000000000001",
        redirectUri: "https://example.com/oauth/callback",
        tenant: "00000000-0000-4000-8000-000000000002",
        state: "opaque-state",
      }),
    );
    expect(url.pathname).toContain("/v2.0/adminconsent");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("scope")).not.toContain(".default");
  });
});
