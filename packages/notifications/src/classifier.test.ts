import { describe, expect, it } from "vitest";
import {
  BlindAwareNotificationPolicy,
  LocalClassifier,
  LocalReceiptService,
} from "./classifier.js";
import {
  asAccountId,
  asLabelId,
  asMessageId,
  asThreadId,
  type MailMessage,
} from "@galmail/core-api";

function msg(partial: Partial<MailMessage> & Pick<MailMessage, "subject" | "from" | "snippet">): MailMessage {
  return {
    id: asMessageId("m1"),
    threadId: asThreadId("t1"),
    accountId: asAccountId("gmail:demo"),
    provider: "gmail",
    to: [{ email: "me@x.com" }],
    date: "2026-07-15T00:00:00Z",
    unread: true,
    starred: false,
    labelIds: [asLabelId("INBOX")],
    hasAttachments: false,
    ...partial,
  };
}

describe("LocalClassifier", () => {
  it("flags security subjects as urgent", async () => {
    const c = new LocalClassifier();
    const result = await c.classify(
      msg({
        subject: "Security verification code",
        snippet: "Your code",
        from: { email: "security@bank.com" },
      }),
    );
    expect(result.priority).toBe("urgent");
  });

  it("respects user corrections", async () => {
    const c = new LocalClassifier();
    await c.recordCorrection(asMessageId("m1"), "low");
    const result = await c.classify(
      msg({
        subject: "Security verification code",
        snippet: "Your code",
        from: { email: "security@bank.com" },
      }),
    );
    expect(result.source).toBe("user_correction");
    expect(result.priority).toBe("low");
  });
});

describe("BlindAwareNotificationPolicy", () => {
  it("omits subject/body in blind mode", async () => {
    const policy = new BlindAwareNotificationPolicy(true);
    const decision = await policy.shouldNotify(
      {
        messageId: asMessageId("m1"),
        priority: "urgent",
        reasons: [],
        source: "rules",
      },
      msg({
        subject: "SECRET SUBJECT",
        snippet: "x",
        from: { email: "a@b.com", name: "A" },
      }),
    );
    expect(decision.blindHintOnly).toBe(true);
    expect(decision.body).not.toContain("SECRET");
  });
});

describe("LocalReceiptService", () => {
  it("labels receipts as receipt_received or likely_opened", async () => {
    const r = new LocalReceiptService();
    await r.requestReceipt(asMessageId("m1"), "standard");
    expect(await r.status(asMessageId("m1"))).toBe("none");
    r.mark("m1", "likely_opened");
    expect(await r.status(asMessageId("m1"))).toBe("likely_opened");
  });
});
