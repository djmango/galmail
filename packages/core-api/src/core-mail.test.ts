import { describe, expect, test } from "bun:test";
import {
  attachmentQuarantineReason,
  buildIsolatedMailDocument,
  generateMime,
  isTrackingImage,
  parseMailSearch,
  parseMime,
  sanitizeHtml,
  toFts5Query,
} from "./index.js";
import { asAccountId } from "./types.js";

describe("MIME contract", () => {
  test("roundtrips alternatives, international headers, reply metadata, and attachments", () => {
    const raw = generateMime({
      id: "draft-1",
      accountId: asAccountId("gmail:test"),
      alias: { name: "Renée", email: "renee@example.com" },
      to: [{ name: "José", email: "jose@example.com" }],
      cc: [{ email: "cc@example.com" }],
      subject: "Résumé ✓",
      bodyText: "Plain body",
      bodyHtml: "<p>HTML body</p>",
      inReplyTo: "message-1" as never,
      references: ["root-1"],
      attachments: [
        {
          id: "a1",
          filename: "résumé.txt",
          mimeType: "text/plain",
          size: 5,
          data: Buffer.from("hello").toString("base64"),
        },
      ],
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    const parsed = parseMime(raw);
    expect(parsed.subject).toBe("Résumé ✓");
    expect(parsed.text).toContain("Plain body");
    expect(parsed.html).toContain("HTML body");
    expect(parsed.attachments[0]?.filename).toBe("résumé.txt");
    expect(new TextDecoder().decode(parsed.attachments[0]?.data)).toBe("hello");
  });

  test("omits empty To and falls back From when alias email is blank", () => {
    const raw = generateMime({
      id: "draft-empty",
      accountId: asAccountId("gmail:test"),
      alias: { email: "   " },
      to: [],
      subject: "WIP",
      bodyText: "drafting",
      bodyHtml: "<p>drafting</p>",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(raw).toContain("From: me");
    expect(raw).not.toMatch(/^To:/m);
  });

  test("parses nested multipart and rejects excessive payloads", () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="x"',
      "Subject: Nested",
      "",
      "--x",
      "Content-Type: text/plain",
      "",
      "safe",
      "--x",
      "Content-Type: text/html",
      "",
      "<b>safe</b>",
      "--x--",
    ].join("\r\n");
    expect(parseMime(raw).text).toBe("safe");
    expect(() => parseMime(new Uint8Array(50 * 1024 * 1024 + 1))).toThrow(
      "safety limit",
    );
  });

  test("parses the checked-in malicious corpus without executing content", async () => {
    const fixture = Bun.file(
      new URL(
        "../../../fixtures/mime/malicious-multipart.eml",
        import.meta.url,
      ),
    );
    const parsed = parseMime(await fixture.text());
    expect(parsed.text).toContain("Safe plain-text fallback");
    expect(parsed.attachments[0]?.filename).toBe("invoice.pdf.exe");
    expect(sanitizeHtml(parsed.html ?? "")).toContain("Safe visible body");
    expect(sanitizeHtml(parsed.html ?? "")).not.toMatch(
      /script|form|javascript:/i,
    );
  });

  test("handles a deterministic malformed MIME fuzz corpus without hanging", () => {
    let state = 0x5eed1234;
    const next = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const tokens = [
      "\r\n",
      "--boundary",
      "Content-Type:",
      "Content-Transfer-Encoding: base64",
      "<script>",
      "\0",
      "=?UTF-8?B?",
      "A".repeat(128),
    ];
    for (let sample = 0; sample < 500; sample += 1) {
      let input = "";
      const count = 1 + (next() % 40);
      for (let index = 0; index < count; index += 1) {
        input += tokens[next() % tokens.length];
      }
      try {
        const parsed = parseMime(input);
        expect(sanitizeHtml(parsed.html ?? parsed.text ?? "")).not.toMatch(
          /<script/i,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });
});

describe("mail content security", () => {
  const malicious = [
    '<script src="https://evil.invalid/x"></script><p>ok</p>',
    '<svg><a href="javascript:alert(1)">x</a></svg><p>ok</p>',
    '<img src="https://tracker.invalid/open.gif" onerror="alert(1)">',
    '<form action="https://evil.invalid"><input autofocus></form><p>ok</p>',
    '<a href="https://example.com/?utm_source=x&ok=1">safe link</a>',
  ];

  test.each(malicious)("sanitizes malicious fixture %#", (fixture) => {
    const clean = sanitizeHtml(fixture);
    expect(clean).not.toMatch(
      /script|svg|form|onerror|javascript:|utm_source/i,
    );
  });

  test("builds a locked-down document with remote images disabled", () => {
    const document = buildIsolatedMailDocument(
      '<img src="https://tracker.invalid/pixel"><p>body</p>',
    );
    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain("tracker.invalid");
    expect(document).toContain("color-scheme:light");
  });

  test("builds a dark reading document when colorScheme is dark", () => {
    const document = buildIsolatedMailDocument("<p>Hello</p>", {
      colorScheme: "dark",
    });
    expect(document).toContain("color-scheme:dark");
    expect(document).toContain("#0d0e10");
    expect(document).toContain("<p>Hello</p>");
    expect(document).toContain("<body>");
  });

  test("flags tracking and dangerous attachments", () => {
    expect(isTrackingImage({ width: 1, height: 1, url: "https://x/img" })).toBe(
      true,
    );
    expect(
      attachmentQuarantineReason({
        filename: "invoice.pdf.exe",
        mimeType: "application/octet-stream",
        size: 10,
      }),
    ).toContain("Executable");
  });
});

describe("local search operators", () => {
  test("maps Gmail-like textual operators to safe FTS5 terms", () => {
    const parsed = parseMailSearch(
      'from:alex@example.com subject:"quarterly plan" is:unread has:attachment',
    );
    expect(parsed.isUnread).toBe(true);
    expect(parsed.hasAttachment).toBe(true);
    expect(toFts5Query(parsed)).toBe(
      'sender:"alex@example.com" AND subject:"quarterly plan"',
    );
  });
});
