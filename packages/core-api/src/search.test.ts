import { describe, expect, test } from "bun:test";
import { parseMailSearch, toProviderSearchQuery } from "./search.js";

describe("toProviderSearchQuery", () => {
  test("maps free text and common operators for mailbox-wide search", () => {
    const query = parseMailSearch(
      'invoice from:billing@acme.com subject:"Q1 report" has:attachment is:unread',
    );
    expect(toProviderSearchQuery(query)).toBe(
      'from:billing@acme.com subject:"q1 report" has:attachment is:unread invoice',
    );
  });

  test("formats after/before as Gmail-style dates", () => {
    const query = parseMailSearch("receipt after:2024-01-15 before:2024-02-01");
    expect(toProviderSearchQuery(query)).toBe(
      "after:2024/1/15 before:2024/2/1 receipt",
    );
  });

  test("returns empty for blank input", () => {
    expect(toProviderSearchQuery(parseMailSearch("   "))).toBe("");
  });
});
