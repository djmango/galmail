/** List-Unsubscribe / RFC 8058 capability parsing. */

export type UnsubscribeCapabilityKind =
  | "one_click"
  | "mailto"
  | "https_link"
  | "body_heuristic"
  | "none";

export interface MailtoUnsubscribe {
  address: string;
  subject?: string;
  body?: string;
}

export interface UnsubscribeCapability {
  kind: UnsubscribeCapabilityKind;
  /** HTTPS URL for RFC 8058 one-click POST when available. */
  oneClickUrl?: string;
  mailto?: MailtoUnsubscribe;
  /** First https List-Unsubscribe URI (also set when used for one-click). */
  httpsUrl?: string;
  /** Body-scanned unsubscribe link when headers yield nothing. */
  bodyUrl?: string;
}

const ONE_CLICK_POST = "List-Unsubscribe=One-Click";
const BODY_UNSUB_TEXT =
  /unsubscribe|opt[\s_-]?out|manage\s+(?:email\s+)?preferences|email\s+preferences/i;

function headerGet(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/** Extract angle-bracket URIs from a List-Unsubscribe header value (RFC 2369). */
export function parseAngleBracketUris(value: string): string[] {
  const uris: string[] = [];
  for (const match of value.matchAll(/<([^>\s]+)>/g)) {
    const uri = match[1]?.trim();
    if (uri) uris.push(uri);
  }
  return uris;
}

function parseMailto(uri: string): MailtoUnsubscribe | undefined {
  if (!uri.toLowerCase().startsWith("mailto:")) return undefined;
  const rest = uri.slice("mailto:".length);
  const qIndex = rest.indexOf("?");
  const address = (qIndex < 0 ? rest : rest.slice(0, qIndex)).trim();
  if (!address || !address.includes("@")) return undefined;
  const mailto: MailtoUnsubscribe = { address };
  if (qIndex < 0) return mailto;
  const params = new URLSearchParams(rest.slice(qIndex + 1));
  const subject = params.get("subject");
  const body = params.get("body");
  if (subject !== null) mailto.subject = subject;
  if (body !== null) mailto.body = body;
  return mailto;
}

function isHttpsUrl(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Scan message HTML for an unsubscribe / opt-out / preferences link.
 * Returns the first HTTPS href only (never http/javascript/data).
 */
export function findBodyUnsubscribeLink(
  bodyHtml: string | undefined,
): string | undefined {
  if (!bodyHtml) return undefined;
  const re =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of bodyHtml.matchAll(re)) {
    const attrs = match[1] ?? "";
    const text = stripTags(match[2] ?? "");
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
      attrs,
    );
    const rawHref = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
    if (!rawHref) continue;
    const href = decodeHtmlAttr(rawHref).trim();
    if (!isHttpsUrl(href)) continue;
    if (BODY_UNSUB_TEXT.test(href) || BODY_UNSUB_TEXT.test(text)) {
      return href;
    }
  }
  return undefined;
}

/**
 * Parse List-Unsubscribe (+ optional List-Unsubscribe-Post) into a capability.
 * Does not scan the body; call {@link resolveUnsubscribeCapability} for that.
 */
export function parseListUnsubscribe(
  headers: Record<string, string> | undefined,
): UnsubscribeCapability {
  const listUnsub = headerGet(headers, "List-Unsubscribe");
  if (!listUnsub) {
    return { kind: "none" };
  }

  const uris = parseAngleBracketUris(listUnsub);
  let httpsUrl: string | undefined;
  let mailto: MailtoUnsubscribe | undefined;

  for (const uri of uris) {
    if (!httpsUrl && isHttpsUrl(uri)) {
      httpsUrl = uri;
      continue;
    }
    if (!mailto) {
      const parsed = parseMailto(uri);
      if (parsed) mailto = parsed;
    }
  }

  const post = headerGet(headers, "List-Unsubscribe-Post")?.trim();
  const supportsOneClick = post === ONE_CLICK_POST;

  if (supportsOneClick && httpsUrl) {
    return {
      kind: "one_click",
      oneClickUrl: httpsUrl,
      httpsUrl,
      mailto,
    };
  }

  if (mailto) {
    return {
      kind: "mailto",
      mailto,
      httpsUrl,
    };
  }

  if (httpsUrl) {
    return {
      kind: "https_link",
      httpsUrl,
    };
  }

  return { kind: "none" };
}

/** Header capability first; fall back to body-link heuristics. */
export function resolveUnsubscribeCapability(
  headers: Record<string, string> | undefined,
  bodyHtml?: string,
): UnsubscribeCapability {
  const fromHeaders = parseListUnsubscribe(headers);
  if (fromHeaders.kind !== "none") return fromHeaders;
  const bodyUrl = findBodyUnsubscribeLink(bodyHtml);
  if (bodyUrl) {
    return { kind: "body_heuristic", bodyUrl, httpsUrl: bodyUrl };
  }
  return { kind: "none" };
}

export function unsubscribeHost(
  capability: UnsubscribeCapability,
): string | undefined {
  const url =
    capability.oneClickUrl ?? capability.httpsUrl ?? capability.bodyUrl;
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
