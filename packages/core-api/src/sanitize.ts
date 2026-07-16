/** Defense-in-depth sanitizer. Mail HTML must additionally render in a sandboxed iframe. */
const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const SUPPRESSED_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "form",
]);
const ALLOWED_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "class",
  "colspan",
  "height",
  "href",
  "rel",
  "role",
  "rowspan",
  "src",
  "title",
  "width",
]);

export type MailColorScheme = "light" | "dark";

export interface HtmlSanitizeOptions {
  allowRemoteImages?: boolean;
  stripTrackingParameters?: boolean;
  /** Base chrome for the sandboxed reading document. Defaults to light. */
  colorScheme?: MailColorScheme;
}

const MAIL_DOCUMENT_THEME: Record<
  MailColorScheme,
  {
    bg: string;
    fg: string;
    muted: string;
    link: string;
    linkVisited: string;
    quote: string;
    preBg: string;
    hr: string;
  }
> = {
  dark: {
    // Match app `--bg1` (reading / message-card), not elevated `--bg2`.
    bg: "#0d0e10",
    fg: "#e6e8ec",
    muted: "#969cab",
    link: "#6d78dd",
    linkVisited: "#8b93e0",
    quote: "rgba(255, 255, 255, 0.18)",
    preBg: "rgba(255, 255, 255, 0.05)",
    hr: "rgba(255, 255, 255, 0.12)",
  },
  light: {
    bg: "#fbf6ec",
    fg: "#2b2620",
    muted: "#5d5346",
    link: "#955e0a",
    linkVisited: "#7d4d06",
    quote: "rgba(43, 38, 32, 0.2)",
    preBg: "rgba(43, 38, 32, 0.05)",
    hr: "rgba(43, 38, 32, 0.12)",
  },
};

function mailDocumentBaseStyles(scheme: MailColorScheme): string {
  const t = MAIL_DOCUMENT_THEME[scheme];
  return [
    `html{color-scheme:${scheme};background:${t.bg}}`,
    `body{margin:0;padding:0;background:${t.bg};color:${t.fg};font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere;word-break:break-word}`,
    `a{color:${t.link}}`,
    `a:visited{color:${t.linkVisited}}`,
    "img{max-width:100%;height:auto}",
    "table{border-collapse:collapse;max-width:100%}",
    "td,th{vertical-align:top}",
    "ul,ol{padding-left:1.4em}",
    "p,li{margin:0.55em 0}",
    "h1,h2,h3,h4,h5,h6{line-height:1.25;margin:0.8em 0 0.4em;font-weight:600}",
    `hr{border:0;border-top:1px solid ${t.hr};margin:1em 0}`,
    `pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em}`,
    `pre{margin:0.7em 0;padding:10px 12px;border-radius:6px;background:${t.preBg};overflow-x:auto;white-space:pre-wrap}`,
    `blockquote{margin:0.6em 0;padding:0 0 0 12px;border-left:3px solid ${t.quote};color:${t.muted}}`,
  ].join("");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function stripTrackingParameters(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_[ce]id|mkt_tok|vero_.+|trk)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function safeAttribute(
  name: string,
  value: string,
  options: HtmlSanitizeOptions,
): string | undefined {
  if (!ALLOWED_ATTRIBUTES.has(name) || name.startsWith("on")) return undefined;
  if (name === "src") {
    if (/^cid:/i.test(value)) return value;
    if (!options.allowRemoteImages || !/^https?:/i.test(value))
      return undefined;
  }
  if (name === "href") {
    if (!isSafeHttpUrl(value)) return "#";
    return options.stripTrackingParameters === false
      ? value
      : stripTrackingParameters(value);
  }
  return value;
}

export function sanitizeHtml(
  input: string,
  options: HtmlSanitizeOptions = {},
): string {
  const tokens =
    input.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+|</g) ?? [];
  const output: string[] = [];
  const suppressed: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || /^<!/i.test(token)) continue;
    if (!token.startsWith("<")) {
      if (suppressed.length === 0) output.push(token);
      continue;
    }
    const close = token.match(/^<\s*\/\s*([a-z0-9-]+)/i);
    if (close) {
      const tag = close[1]!.toLowerCase();
      if (suppressed.at(-1) === tag) {
        suppressed.pop();
      } else if (
        suppressed.length === 0 &&
        ALLOWED_TAGS.has(tag) &&
        !VOID_TAGS.has(tag)
      ) {
        output.push(`</${tag}>`);
      }
      continue;
    }
    const open = token.match(/^<\s*([a-z0-9-]+)/i);
    if (!open) {
      if (suppressed.length === 0) output.push(escapeText(token));
      continue;
    }
    const tag = open[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (SUPPRESSED_CONTENT_TAGS.has(tag) && !/\/\s*>$/.test(token)) {
        suppressed.push(tag);
      }
      continue;
    }
    if (suppressed.length > 0) continue;
    const attributes: string[] = [];
    const source = token.slice(open[0].length, token.lastIndexOf(">"));
    for (const match of source.matchAll(
      /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    )) {
      const name = match[1]!.toLowerCase();
      const safe = safeAttribute(
        name,
        match[2] ?? match[3] ?? match[4] ?? "",
        options,
      );
      if (safe !== undefined) {
        attributes.push(
          `${name}="${escapeText(safe).replace(/"/g, "&quot;")}"`,
        );
      }
    }
    if (tag === "a")
      attributes.push('target="_blank"', 'rel="noopener noreferrer"');
    output.push(
      `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`,
    );
  }
  return output.join("");
}

export function buildIsolatedMailDocument(
  html: string,
  options: HtmlSanitizeOptions = {},
): string {
  const sanitized = sanitizeHtml(html, options);
  const scheme: MailColorScheme =
    options.colorScheme === "dark" ? "dark" : "light";
  const csp = `default-src 'none'; img-src ${options.allowRemoteImages ? "https: http:" : "'none'"} cid: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${mailDocumentBaseStyles(scheme)}</style></head><body>${sanitized}</body></html>`;
}

export function isTrackingImage(input: {
  width?: number;
  height?: number;
  url: string;
}): boolean {
  return (
    (input.width !== undefined && input.width <= 2) ||
    (input.height !== undefined && input.height <= 2) ||
    /(?:pixel|open|track|beacon)(?:[./?_-]|$)/i.test(input.url)
  );
}

export function attachmentQuarantineReason(input: {
  filename: string;
  mimeType: string;
  size: number;
}): string | undefined {
  if (input.size > 25 * 1024 * 1024)
    return "Attachment exceeds the 25 MiB safety limit";
  if (
    /\.(app|bat|cmd|com|exe|hta|jar|js|jse|lnk|msi|ps1|scr|vbs|wsf)$/i.test(
      input.filename,
    )
  ) {
    return "Executable or script attachment";
  }
  if (
    /^(application\/x-(?:dosexec|msdownload|sh|executable)|text\/javascript)$/i.test(
      input.mimeType,
    )
  ) {
    return "Potentially executable content type";
  }
  return undefined;
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}
