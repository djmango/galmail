import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, sanitizeHtml } from "./sanitize.js";

describe("sanitizeHtml", () => {
  it("strips script and handlers", () => {
    const dirty =
      `<p onclick="alert(1)">Hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
  });
});

describe("isSafeHttpUrl", () => {
  it("allows http(s)/mailto only", () => {
    expect(isSafeHttpUrl("https://example.com")).toBe(true);
    expect(isSafeHttpUrl("mailto:a@b.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
  });
});
