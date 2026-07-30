import { describe, expect, test } from "bun:test";
import {
  asAccountId,
  asMessageId,
  asThreadId,
  type MailMessage,
} from "@galmail/core-api";
import { resolveCidImageMap } from "./cid-images";

function messageWithInline(): MailMessage {
  return {
    id: asMessageId("m1"),
    threadId: asThreadId("t1"),
    accountId: asAccountId("gmail:demo"),
    provider: "gmail",
    subject: "Inline",
    snippet: "hi",
    from: { email: "a@example.com" },
    to: [{ email: "me@example.com" }],
    date: "2026-07-15T12:00:00Z",
    unread: false,
    starred: false,
    labelIds: [],
    hasAttachments: true,
    attachments: [
      {
        id: "att1",
        providerNativeId: "att1",
        filename: "logo.png",
        mimeType: "image/png",
        size: 4,
        messageId: asMessageId("m1"),
        contentId: "logo@mail",
      },
    ],
  };
}

describe("resolveCidImageMap", () => {
  test("loads inline image attachments into a cid map", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const map = await resolveCidImageMap(messageWithInline(), async function* () {
      yield bytes;
    });
    expect(map["logo@mail"]).toMatch(/^data:image\/png;base64,/);
    expect(map["cid:logo@mail"]).toBe(map["logo@mail"]);
  });

  test("skips non-image attachments", async () => {
    const message = messageWithInline();
    message.attachments![0]!.mimeType = "application/pdf";
    const map = await resolveCidImageMap(message, async function* () {
      yield new Uint8Array([1]);
    });
    expect(map).toEqual({});
  });
});
