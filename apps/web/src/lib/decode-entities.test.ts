import { describe, expect, test } from "bun:test";
import { decodeHtmlEntities } from "./decode-entities";

describe("decodeHtmlEntities", () => {
  test("decodes named and numeric entities from Gmail snippets", () => {
    expect(decodeHtmlEntities("Hello &#39;world&#39;")).toBe("Hello 'world'");
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
    expect(decodeHtmlEntities("CC: &lt;team@example.com&gt;")).toBe(
      "CC: <team@example.com>",
    );
    expect(decodeHtmlEntities("hash &#x23;39")).toBe("hash #39");
  });

  test("returns plain text unchanged", () => {
    expect(decodeHtmlEntities("Plain subject")).toBe("Plain subject");
    expect(decodeHtmlEntities("")).toBe("");
  });
});
