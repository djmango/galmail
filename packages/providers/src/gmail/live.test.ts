import { describe, expect, test } from "bun:test";
import { asAccountId } from "@galmail/core-api";
import {
  createGmailLiveProvider,
  type GmailHttpClient,
  type GmailHttpResponse,
} from "./live.js";

const accountId = asAccountId("gmail:test");

function response(
  status: number,
  value: unknown,
  retryAfter?: string,
): GmailHttpResponse {
  return {
    status,
    headers: { "retry-after": retryAfter },
    async json() {
      return value;
    },
  };
}

function message(id: string, historyId = "10") {
  return {
    id,
    threadId: `t-${id}`,
    historyId,
    internalDate: "1700000000000",
    labelIds: ["INBOX", "UNREAD"],
    snippet: `snippet ${id}`,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: `Subject ${id}` },
        { name: "From", value: "Sender <sender@example.com>" },
        { name: "To", value: "reader@example.com" },
      ],
      body: { data: Buffer.from(`body ${id}`).toString("base64url") },
    },
  };
}

function scripted(
  handler: (
    input: Parameters<GmailHttpClient["request"]>[0],
  ) => GmailHttpResponse,
) {
  const requests: Parameters<GmailHttpClient["request"]>[0][] = [];
  const http: GmailHttpClient = {
    async request(input) {
      requests.push(input);
      return handler(input);
    },
  };
  return { http, requests };
}

const tokens = {
  async accessToken() {
    return "access-token";
  },
  async refreshAccessToken() {
    return "refreshed-token";
  },
};

describe("Gmail live provider contract", () => {
  test("paginates initial reconciliation and survives a restart cursor", async () => {
    const { http, requests } = scripted((input) => {
      const url = new URL(input.url);
      if (
        url.pathname.endsWith("/messages") &&
        !url.searchParams.has("pageToken")
      ) {
        return response(200, {
          messages: [{ id: "m1" }],
          nextPageToken: "next",
        });
      }
      if (
        url.pathname.endsWith("/messages") &&
        url.searchParams.get("pageToken") === "next"
      ) {
        return response(200, { messages: [{ id: "m2" }] });
      }
      if (url.pathname.endsWith("/messages/m1"))
        return response(200, message("m1", "10"));
      if (url.pathname.endsWith("/messages/m2"))
        return response(200, message("m2", "12"));
      throw new Error(`Unexpected request: ${input.url}`);
    });
    const provider = createGmailLiveProvider({
      tokens,
      http,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await provider.fetchDeltas(accountId, null);
    expect(result.upserts.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(result.nextCursor.token).toBe("12");
    expect(
      requests.filter((item) =>
        new URL(item.url).pathname.endsWith("/messages"),
      ),
    ).toHaveLength(2);
  });

  test("consumes History API pages and normalizes deletes", async () => {
    const { http } = scripted((input) => {
      const url = new URL(input.url);
      if (url.pathname.endsWith("/history")) {
        return response(200, {
          historyId: "21",
          history: [
            {
              messagesAdded: [{ message: { id: "m3" } }],
              labelsRemoved: [{ message: { id: "m3" } }],
              messagesDeleted: [{ message: { id: "gone" } }],
            },
          ],
        });
      }
      if (url.pathname.endsWith("/messages/m3"))
        return response(200, message("m3", "21"));
      throw new Error(`Unexpected request: ${input.url}`);
    });
    const provider = createGmailLiveProvider({ tokens, http });
    const result = await provider.fetchDeltas(accountId, {
      accountId,
      provider: "gmail",
      token: "20",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.upserts.map((item) => item.id)).toEqual(["m3"]);
    expect(result.deletes).toEqual(["gone"]);
    expect(result.nextCursor.token).toBe("21");
  });

  test("reconciles from scratch when Gmail expires the history cursor", async () => {
    const { http, requests } = scripted((input) => {
      const url = new URL(input.url);
      if (url.pathname.endsWith("/history"))
        return response(404, { error: {} });
      if (url.pathname.endsWith("/messages")) {
        return response(200, { messages: [{ id: "fresh" }] });
      }
      if (url.pathname.endsWith("/messages/fresh")) {
        return response(200, message("fresh", "44"));
      }
      throw new Error(`Unexpected request: ${input.url}`);
    });
    const provider = createGmailLiveProvider({ tokens, http });
    const result = await provider.fetchDeltas(accountId, {
      accountId,
      provider: "gmail",
      token: "1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.upserts[0]?.id).toBe("fresh");
    expect(result.nextCursor.token).toBe("44");
    expect(
      requests.some((item) => new URL(item.url).pathname.endsWith("/messages")),
    ).toBe(true);
  });

  test("backs off, refreshes once, and deduplicates normalized mutations", async () => {
    let count = 0;
    const delays: number[] = [];
    const { http, requests } = scripted((input) => {
      if (!input.url.endsWith("/messages/m1/modify")) {
        throw new Error(`Unexpected request: ${input.url}`);
      }
      count += 1;
      if (count === 1) return response(429, { error: {} }, "2");
      if (count === 2) return response(401, { error: {} });
      return response(200, {});
    });
    const provider = createGmailLiveProvider({
      tokens,
      http,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    const mutation = {
      kind: "archive" as const,
      targetIds: ["m1", "m1"],
      payload: { mutationId: "stable-mutation-id" },
    };
    await provider.applyMutation(accountId, mutation);
    await provider.applyMutation(accountId, mutation);
    expect(delays).toEqual([2_000]);
    expect(requests).toHaveLength(3);
    expect(requests.at(-1)?.headers.authorization).toBe(
      "Bearer refreshed-token",
    );
  });

  test("generates MIME drafts and streams attachment chunks", async () => {
    const data = Buffer.alloc(70 * 1024, 7).toString("base64url");
    const { http, requests } = scripted((input) => {
      const url = new URL(input.url);
      if (url.pathname.endsWith("/messages/send"))
        return response(200, { id: "sent-1" });
      if (url.pathname.endsWith("/drafts"))
        return response(200, { id: "draft-1" });
      if (url.pathname.includes("/attachments/"))
        return response(200, { data });
      throw new Error(`Unexpected request: ${input.method} ${input.url}`);
    });
    const provider = createGmailLiveProvider({ tokens, http });
    const draft = {
      id: "d1",
      accountId,
      to: [{ name: "Renée", email: "reader@example.com" }],
      subject: "International ✓",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      updatedAt: new Date().toISOString(),
    };
    expect(await provider.sendDraft(accountId, draft)).toBe("sent-1");
    expect(await provider.saveDraft(accountId, draft)).toBe("draft-1");
    const chunks: Uint8Array[] = [];
    for await (const chunk of provider.fetchAttachment(accountId, {
      id: "a1",
      providerNativeId: "native-a1",
      filename: "safe.bin",
      mimeType: "application/octet-stream",
      size: 70 * 1024,
      messageId: "m1" as never,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([
      64 * 1024,
      6 * 1024,
    ]);
    const send = requests.find((item) => item.url.endsWith("/messages/send"));
    expect(String(send?.body)).toContain('"raw"');
  });
});
