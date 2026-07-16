import type { ComposeDraft, DraftAttachment, MailAddress } from "./types.js";

export interface ParsedMimePart {
  headers: Record<string, string>;
  mimeType: string;
  charset?: string;
  disposition?: "inline" | "attachment";
  filename?: string;
  contentId?: string;
  body: Uint8Array;
  parts: ParsedMimePart[];
}

export interface ParsedMimeMessage {
  headers: Record<string, string>;
  subject: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  text?: string;
  html?: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    disposition: "inline" | "attachment";
    contentId?: string;
    data: Uint8Array;
  }>;
  root: ParsedMimePart;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_MIME_BYTES = 50 * 1024 * 1024;
const MAX_PARTS = 1_000;

function unfoldHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let current = "";
  for (const line of value.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split <= 0) continue;
    current = line.slice(0, split).trim().toLowerCase();
    headers[current] = line.slice(split + 1).trim();
  }
  return headers;
}

function parameter(value: string, name: string): string | undefined {
  const match = value.match(
    new RegExp(`(?:^|;)\\s*${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i"),
  );
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const encoded = raw.match(/^[^']*'[^']*'(.*)$/)?.[1];
  try {
    return decodeURIComponent(encoded ?? raw);
  } catch {
    return raw;
  }
}

function base64Bytes(value: string): Uint8Array {
  const clean = value.replace(/\s/g, "");
  if (typeof Buffer !== "undefined")
    return Uint8Array.from(Buffer.from(clean, "base64"));
  const binary = atob(clean);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function quotedPrintable(value: string): Uint8Array {
  const unwrapped = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < unwrapped.length; index += 1) {
    const hex = unwrapped.slice(index + 1, index + 3);
    if (unwrapped[index] === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(unwrapped.charCodeAt(index) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function decodeBody(body: string, encoding: string): Uint8Array {
  if (/base64/i.test(encoding)) return base64Bytes(body);
  if (/quoted-printable/i.test(encoding)) return quotedPrintable(body);
  return encoder.encode(body);
}

function parsePart(raw: string, counter: { value: number }): ParsedMimePart {
  counter.value += 1;
  if (counter.value > MAX_PARTS) throw new Error("MIME part limit exceeded");
  const separator = raw.search(/\r?\n\r?\n/);
  const headers = unfoldHeaders(separator < 0 ? raw : raw.slice(0, separator));
  const bodyText =
    separator < 0 ? "" : raw.slice(separator).replace(/^\r?\n\r?\n/, "");
  const contentType = headers["content-type"] ?? "text/plain; charset=utf-8";
  const mimeType = contentType.split(";")[0]!.trim().toLowerCase();
  const dispositionHeader = headers["content-disposition"] ?? "";
  const disposition = /attachment/i.test(dispositionHeader)
    ? "attachment"
    : /inline/i.test(dispositionHeader)
      ? "inline"
      : undefined;
  const boundary = parameter(contentType, "boundary");
  const parts: ParsedMimePart[] = [];
  if (mimeType.startsWith("multipart/") && boundary) {
    const marker = `--${boundary}`;
    for (const section of bodyText.split(marker).slice(1)) {
      if (section.startsWith("--")) break;
      const cleaned = section.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (cleaned.trim()) parts.push(parsePart(cleaned, counter));
    }
  }
  return {
    headers,
    mimeType,
    charset: parameter(contentType, "charset"),
    disposition,
    filename:
      parameter(dispositionHeader, "filename") ??
      parameter(contentType, "name"),
    contentId: headers["content-id"]?.replace(/^<|>$/g, ""),
    body: parts.length
      ? new Uint8Array()
      : decodeBody(bodyText, headers["content-transfer-encoding"] ?? ""),
    parts,
  };
}

function decodeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (_all, _charset: string, mode: string, body: string) => {
      const bytes =
        mode.toLowerCase() === "b"
          ? base64Bytes(body)
          : quotedPrintable(body.replace(/_/g, " "));
      return decoder.decode(bytes);
    },
  );
}

export function decodeMimeHeader(value: string): string {
  return decodeWords(value);
}

export function parseAddressList(value = ""): MailAddress[] {
  const items = value.match(/(?:[^,"<]|"[^"]*"|<[^>]*>)+/g) ?? [];
  return items.flatMap((item) => {
    const trimmed = item.trim();
    if (!trimmed) return [];
    const angle = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
    return angle
      ? [
          {
            name: angle[1] ? decodeWords(angle[1].trim()) : undefined,
            email: angle[2]!.trim(),
          },
        ]
      : [{ email: trimmed }];
  });
}

export function parseMime(input: string | Uint8Array): ParsedMimeMessage {
  const raw = typeof input === "string" ? input : decoder.decode(input);
  if (encoder.encode(raw).byteLength > MAX_MIME_BYTES) {
    throw new Error("MIME message exceeds safety limit");
  }
  const root = parsePart(raw, { value: 0 });
  let text: string | undefined;
  let html: string | undefined;
  const attachments: ParsedMimeMessage["attachments"] = [];
  const visit = (part: ParsedMimePart): void => {
    if (part.parts.length) {
      for (const child of part.parts) visit(child);
      return;
    }
    if (part.disposition === "attachment" || part.filename) {
      attachments.push({
        filename: part.filename || "attachment",
        mimeType: part.mimeType,
        disposition: part.disposition ?? "attachment",
        contentId: part.contentId,
        data: part.body,
      });
    } else if (part.mimeType === "text/plain" && text === undefined) {
      text = decoder.decode(part.body);
    } else if (part.mimeType === "text/html" && html === undefined) {
      html = decoder.decode(part.body);
    }
  };
  visit(root);
  return {
    headers: root.headers,
    subject: decodeWords(root.headers.subject ?? ""),
    from: parseAddressList(root.headers.from)[0],
    to: parseAddressList(root.headers.to),
    cc: parseAddressList(root.headers.cc),
    bcc: parseAddressList(root.headers.bcc),
    text,
    html,
    attachments,
    root,
  };
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value.replace(/[\r\n]/g, " ");
  const bytes = encoder.encode(value.replace(/[\r\n]/g, " "));
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(String.fromCharCode(...bytes));
  return `=?UTF-8?B?${base64}?=`;
}

function formatAddress(address: MailAddress): string {
  return address.name
    ? `${encodeHeader(address.name)} <${address.email.replace(/[\r\n]/g, "")}>`
    : address.email.replace(/[\r\n]/g, "");
}

function base64(value: Uint8Array): string {
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(value).toString("base64")
      : btoa(String.fromCharCode(...value));
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function attachmentPart(attachment: DraftAttachment): string {
  const disposition = attachment.disposition ?? "attachment";
  return [
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename.replace(/["\r\n]/g, "_")}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${disposition}; filename="${attachment.filename.replace(/["\r\n]/g, "_")}"`,
    ...(attachment.contentId ? [`Content-ID: <${attachment.contentId}>`] : []),
    "",
    base64(base64Bytes(attachment.data)),
  ].join("\r\n");
}

export function generateMime(draft: ComposeDraft): string {
  const mixed = `galmail-mixed-${crypto.randomUUID()}`;
  const alternative = `galmail-alt-${crypto.randomUUID()}`;
  const from =
    draft.alias?.email?.trim()
      ? draft.alias
      : { email: "me", name: draft.alias?.name };
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@galmail.local>`,
    `From: ${formatAddress(from)}`,
    ...(draft.to.length
      ? [`To: ${draft.to.map(formatAddress).join(", ")}`]
      : []),
    ...(draft.cc?.length
      ? [`Cc: ${draft.cc.map(formatAddress).join(", ")}`]
      : []),
    ...(draft.bcc?.length
      ? [`Bcc: ${draft.bcc.map(formatAddress).join(", ")}`]
      : []),
    `Subject: ${encodeHeader(draft.subject)}`,
    ...(draft.inReplyTo ? [`In-Reply-To: <${draft.inReplyTo}>`] : []),
    ...(draft.references?.length
      ? [`References: ${draft.references.map((id) => `<${id}>`).join(" ")}`]
      : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ...(draft.requestReadReceipt && from.email.trim()
      ? [`Disposition-Notification-To: ${formatAddress(from)}`]
      : []),
    "",
  ];
  const body = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `${draft.bodyText}${draft.signature ? `\r\n\r\n${draft.signature}` : ""}`,
    `--${alternative}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `${draft.bodyHtml}${draft.signature ? `<br><br>${draft.signature}` : ""}`,
    `--${alternative}--`,
    ...(draft.attachments ?? []).flatMap((attachment) => [
      `--${mixed}`,
      attachmentPart(attachment),
    ]),
    `--${mixed}--`,
    "",
  ];
  return [...headers, ...body].join("\r\n");
}

export function splitQuotedHistory(text: string): {
  visible: string;
  quoted?: string;
} {
  const patterns = [
    /^\s*On .+wrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*From:\s.+\n(?:Sent|Date):\s/im,
  ];
  const indexes = patterns
    .map((pattern) => pattern.exec(text)?.index)
    .filter((index): index is number => index !== undefined);
  const quotedLine = text.search(/^\s*>/m);
  if (quotedLine >= 0) indexes.push(quotedLine);
  const split = indexes.length ? Math.min(...indexes) : -1;
  return split < 0
    ? { visible: text }
    : { visible: text.slice(0, split).trimEnd(), quoted: text.slice(split) };
}
