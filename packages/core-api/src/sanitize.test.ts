import { describe, expect, it } from "bun:test";
import { isSafeHttpUrl, sanitizeHtml } from "./sanitize.js";

describe("sanitizeHtml", () => {
  it("strips script and handlers", () => {
    const dirty = `<p onclick="alert(1)">Hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
  });

  it("keeps safe inline styles and email layout attributes", () => {
    const clean = sanitizeHtml(
      '<table width="600" bgcolor="#ffffff"><tr><td align="center" style="color:#111;font-size:16px">Hello</td></tr></table>',
    );
    expect(clean).toContain("width=");
    expect(clean).toContain("bgcolor=");
    expect(clean).toContain("align=");
    expect(clean).toContain("style=");
    expect(clean).toContain("Hello");
  });

  it("wraps orphan table cells so they are not collapsed to text", () => {
    const clean = sanitizeHtml('<td style="color:#111">Hello world</td>');
    expect(clean).toContain("<table>");
    expect(clean).toContain("<td");
    expect(clean).toContain("Hello world");
  });

  it("rewrites cid images and drops remote images when blocked", () => {
    const withCid = sanitizeHtml('<img src="cid:logo@x" alt="logo">', {
      cidMap: { "logo@x": "data:image/png;base64,abc" },
    });
    expect(withCid).toContain("data:image/png;base64,abc");
    expect(withCid).not.toContain("cid:");

    const blocked = sanitizeHtml('<img src="https://tracker.invalid/x">', {
      allowRemoteImages: false,
    });
    expect(blocked).not.toContain("tracker.invalid");
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
