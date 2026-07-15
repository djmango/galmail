import { describe, expect, it } from "vitest";
import { createGmailFixtureProvider } from "./gmail/fixture.js";
import { createMicrosoftFixtureProvider } from "./microsoft/fixture.js";
import { demoAccounts, listUnifiedInbox } from "./unified.js";

describe("unified inbox", () => {
  it("merges gmail and microsoft threads by recency", async () => {
    const accounts = demoAccounts(
      createGmailFixtureProvider(),
      createMicrosoftFixtureProvider(),
    );
    const threads = await listUnifiedInbox(accounts);
    expect(threads.length).toBeGreaterThanOrEqual(4);
    expect(threads.some((t) => t.provider === "gmail")).toBe(true);
    expect(threads.some((t) => t.provider === "microsoft")).toBe(true);
    for (let i = 1; i < threads.length; i++) {
      expect(
        threads[i - 1]!.lastMessageAt >= threads[i]!.lastMessageAt,
      ).toBe(true);
    }
  });
});
