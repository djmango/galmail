import { describe, expect, test } from "bun:test";
import { asAccountId, asThreadId, type MailThread } from "@galmail/core-api";

function filterThreads(
  threads: MailThread[],
  inboxAccountFilter: "all" | string,
): MailThread[] {
  if (inboxAccountFilter === "all") return threads;
  return threads.filter((thread) => thread.accountId === inboxAccountFilter);
}

describe("inbox account filter", () => {
  const threads: MailThread[] = [
    {
      id: asThreadId("t1"),
      accountId: asAccountId("gmail:a@example.com"),
      provider: "gmail",
      subject: "A",
      snippet: "",
      participants: [],
      messageIds: [],
      labelIds: ["INBOX" as never],
      unreadCount: 1,
      lastMessageAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: asThreadId("t2"),
      accountId: asAccountId("microsoft:b@example.com"),
      provider: "microsoft",
      subject: "B",
      snippet: "",
      participants: [],
      messageIds: [],
      labelIds: ["INBOX" as never],
      unreadCount: 0,
      lastMessageAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  test("All accounts shows every thread", () => {
    expect(filterThreads(threads, "all")).toHaveLength(2);
  });

  test("one-account filter hides other mailboxes", () => {
    const filtered = filterThreads(threads, "gmail:a@example.com");
    expect(filtered.map((thread) => String(thread.id))).toEqual(["t1"]);
  });
});
