import { describe, expect, it } from "bun:test";
import {
  asAccountId,
  asMessageId,
  asThreadId,
  type MailMessage,
} from "@galmail/core-api";
import {
  capabilityForMessage,
  unsubscribeButtonVisible,
  unsubscribeFailureStatus,
  unsubscribeSenderLabel,
  unsubscribeSuccessStatus,
  unsubscribeTooltip,
} from "./unsubscribe";

function message(
  partial: Partial<MailMessage> &
    Pick<MailMessage, "headers" | "bodyHtml">,
): MailMessage {
  return {
    id: asMessageId("m1"),
    threadId: asThreadId("t1"),
    accountId: asAccountId("gmail:demo"),
    provider: "gmail",
    subject: "Weekly digest",
    snippet: "Hi",
    from: { email: "news@example.com", name: "News" },
    to: [{ email: "demo@galmail.local" }],
    date: "2026-07-15T12:00:00.000Z",
    unread: true,
    starred: false,
    labelIds: [],
    hasAttachments: false,
    ...partial,
  };
}

describe("unsubscribe UI helpers", () => {
  it("shows the button for one-click header capability", () => {
    const capability = capabilityForMessage(
      message({
        headers: {
          "List-Unsubscribe": "<https://example.com/unsub>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        bodyHtml: "<p>Hi</p>",
      }),
    );
    expect(capability.kind).toBe("one_click");
    expect(unsubscribeButtonVisible(capability)).toBe(true);
    expect(unsubscribeTooltip(capability)).toContain("one-click");
  });

  it("hides the button when there is no capability", () => {
    const capability = capabilityForMessage(
      message({ headers: {}, bodyHtml: "<p>Hello</p>" }),
    );
    expect(capability.kind).toBe("none");
    expect(unsubscribeButtonVisible(capability)).toBe(false);
  });

  it("falls back to body heuristics", () => {
    const capability = capabilityForMessage(
      message({
        headers: {},
        bodyHtml: `<a href="https://shop.example/opt-out">Opt out</a>`,
      }),
    );
    expect(capability.kind).toBe("body_heuristic");
    expect(unsubscribeButtonVisible(capability)).toBe(true);
    expect(unsubscribeTooltip(capability)).toContain("message");
  });

  it("formats success and failure status copy", () => {
    expect(unsubscribeSenderLabel(message({ headers: {}, bodyHtml: "" }))).toBe(
      "News",
    );
    expect(
      unsubscribeSenderLabel(
        message({
          headers: {},
          bodyHtml: "",
          from: { email: "only@example.com" },
        }),
      ),
    ).toBe("only@example.com");
    expect(unsubscribeSuccessStatus("News")).toBe("Unsubscribed from News");
    expect(unsubscribeFailureStatus("network error")).toBe(
      "Couldn't unsubscribe (network error)",
    );
  });
});
