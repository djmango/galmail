import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@galmail/core-api";

describe("web reading pane sanitizer wiring", () => {
  it("neutralizes common XSS payloads", () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">')).not.toMatch(/onerror/i);
  });
});
