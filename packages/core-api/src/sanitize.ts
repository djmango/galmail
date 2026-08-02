/**
 * Defense-in-depth mail HTML sanitizer.
 *
 * Mail must still render inside a sandboxed iframe. Prefer
 * `sandbox="allow-same-origin"` without `allow-scripts` so the parent can
 * measure layout while attacker script cannot run even if sanitization fails.
 */
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

export type MailColorScheme = "light" | "dark";

export interface HtmlSanitizeOptions {
  allowRemoteImages?: boolean;
  stripTrackingParameters?: boolean;
  /** Base chrome for the sandboxed reading document. Defaults to light. */
  colorScheme?: MailColorScheme;
  /**
   * Map Content-ID (with or without angle brackets / cid: prefix) to a
   * `data:` or `blob:` URL so inline images render inside the sandboxed iframe.
   */
  cidMap?: Record<string, string>;
}

const ALLOWED_TAGS = [
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "center",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "picture",
  "pre",
  "section",
  "source",
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
] as const;

/** Legacy mail layout attrs + modern safe presentation attrs. */
const ALLOWED_ATTR = [
  "align",
  "alt",
  "aria-label",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "class",
  "color",
  "colspan",
  "dir",
  "face",
  "height",
  "href",
  "rel",
  "role",
  "rowspan",
  "size",
  "src",
  "style",
  "target",
  "title",
  "valign",
  "width",
] as const;

/**
 * HTML email is authored for a light paper surface. Keep the reading canvas
 * light even when the app chrome is dark so dark text / marketing CSS remains
 * readable.
 */
const MAIL_DOCUMENT_THEME = {
  bg: "#ffffff",
  fg: "#1a1a1a",
  muted: "#5c5c5c",
  link: "#0b57d0",
  linkVisited: "#681da8",
  quote: "rgba(0, 0, 0, 0.18)",
  preBg: "rgba(0, 0, 0, 0.04)",
  hr: "rgba(0, 0, 0, 0.12)",
} as const;

type PurifyWindow = Parameters<typeof createDOMPurify>[0];
let purify: ReturnType<typeof createDOMPurify> | undefined;

function resolveWindow(): PurifyWindow {
  const existing = (globalThis as typeof globalThis & { window?: PurifyWindow })
    .window;
  if (existing && "document" in existing) return existing;
  return new JSDOM("<!doctype html><html><body></body></html>")
    .window as unknown as PurifyWindow;
}

function getPurify(): ReturnType<typeof createDOMPurify> {
  if (!purify) {
    // jsdom Window and DOM lib Window differ slightly from DOMPurify's WindowLike.
    purify = createDOMPurify(resolveWindow() as never);
  }
  return purify;
}

function mailDocumentBaseStyles(): string {
  const t = MAIL_DOCUMENT_THEME;
  return [
    `html{color-scheme:light;background:${t.bg};width:100%;max-width:100%;height:auto;overflow:hidden}`,
    `body{margin:0;padding:12px 14px;width:100%;max-width:100%;height:auto;overflow:hidden;background:${t.bg};color:${t.fg};font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere;word-break:break-word;-webkit-text-size-adjust:100%}`,
    `a{color:${t.link}}`,
    `a:visited{color:${t.linkVisited}}`,
    "img,video{max-width:100%!important;height:auto!important}",
    "table{border-collapse:collapse;max-width:100%!important}",
    "td,th{word-break:break-word}",
    "div,p,span,font,center,table{max-width:100%!important}",
    "ul,ol{padding-left:1.4em}",
    "p,li{margin:0.55em 0}",
    "h1,h2,h3,h4,h5,h6{line-height:1.25;margin:0.8em 0 0.4em;font-weight:600}",
    `hr{border:0;border-top:1px solid ${t.hr};margin:1em 0}`,
    `pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em}`,
    `pre{margin:0.7em 0;padding:10px 12px;border-radius:6px;background:${t.preBg};overflow-x:auto;white-space:pre-wrap}`,
    `blockquote{margin:0.6em 0;padding:0 0 0 12px;border-left:3px solid ${t.quote};color:${t.muted}}`,
    "@media (max-width:640px){",
    "body{padding:10px 12px;font-size:16px}",
    "table,td,th{width:auto!important}",
    "img{width:auto!important}",
    "}",
  ].join("");
}

/** Strip dangerous CSS; gate remote url() behind the remote-image policy. */
export function sanitizeMailCss(
  css: string,
  options: Pick<HtmlSanitizeOptions, "allowRemoteImages"> = {},
): string {
  let next = css
    .replace(/<\/style/gi, "<\\/style")
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/-moz-binding\s*:[^;]*/gi, "")
    .replace(/behavior\s*:[^;]*/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/vbscript\s*:/gi, "")
    .replace(/-webkit-binding\s*:[^;]*/gi, "");
  if (!options.allowRemoteImages) {
    next = next.replace(
      /url\s*\(\s*(['"]?)(https?:\/\/[^)'"\s]+)\1\s*\)/gi,
      "none",
    );
  }
  return next;
}

/**
 * Pull author `<style>` blocks out before DOMPurify (which drops them) and
 * wrap orphan table fragments so FORCE_BODY does not collapse them to text.
 */
export function prepareMailHtml(input: string): {
  html: string;
  styles: string[];
} {
  const styles: string[] = [];
  let html = input.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_match, css: string) => {
      styles.push(css);
      return "";
    },
  );
  const trimmed = html.trim();
  if (/^<(td|th|tr|tbody|thead|tfoot)\b/i.test(trimmed)) {
    html = `<table>${trimmed}</table>`;
  }
  return { html, styles };
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

function normalizeCidKey(value: string): string {
  return value.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

function resolveCidSrc(
  value: string,
  cidMap?: Record<string, string>,
): string | undefined {
  if (!cidMap) return undefined;
  const key = normalizeCidKey(value);
  if (!key) return undefined;
  return (
    cidMap[key] ?? cidMap[value] ?? cidMap[`cid:${key}`] ?? cidMap[`<${key}>`]
  );
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

function rewriteSrc(
  value: string,
  options: HtmlSanitizeOptions,
): string | null {
  if (/^cid:/i.test(value)) {
    return resolveCidSrc(value, options.cidMap) ?? null;
  }
  if (/^data:image\//i.test(value)) return value;
  if (/^https?:/i.test(value)) {
    return options.allowRemoteImages ? value : null;
  }
  return null;
}

export function sanitizeHtml(
  input: string,
  options: HtmlSanitizeOptions = {},
): string {
  const DOMPurify = getPurify();
  const stripTracking = options.stripTrackingParameters !== false;
  const prepared = prepareMailHtml(input);

  DOMPurify.clearConfig();
  DOMPurify.setConfig({
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    SAFE_FOR_TEMPLATES: false,
    WHOLE_DOCUMENT: false,
  });

  DOMPurify.removeAllHooks();
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const name = data.attrName?.toLowerCase() ?? "";
    const value = data.attrValue ?? "";

    if (name.startsWith("on")) {
      data.keepAttr = false;
      return;
    }

    if (name === "href") {
      if (!isSafeHttpUrl(value)) {
        data.attrValue = "#";
        return;
      }
      data.attrValue = stripTracking ? stripTrackingParameters(value) : value;
      return;
    }

    if (name === "src") {
      const next = rewriteSrc(value, options);
      if (next == null) {
        data.keepAttr = false;
        return;
      }
      data.attrValue = next;
      return;
    }

    if (name === "style") {
      data.attrValue = sanitizeMailCss(value, options).replace(
        /position\s*:\s*(fixed|sticky)/gi,
        "position:relative",
      );
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      const el = node as unknown as Element;
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });

  const clean = DOMPurify.sanitize(prepared.html);
  DOMPurify.removeAllHooks();
  return typeof clean === "string" ? clean : "";
}

export function buildIsolatedMailDocument(
  html: string,
  options: HtmlSanitizeOptions = {},
): string {
  // Extract author CSS once; sanitizeHtml also runs prepareMailHtml, which is
  // idempotent on style-stripped markup.
  const prepared = prepareMailHtml(html);
  const sanitized = sanitizeHtml(html, options);
  const authorStyles = prepared.styles
    .map((css) => sanitizeMailCss(css, options))
    .filter((css) => css.trim().length > 0)
    .map((css) => `<style>${css}</style>`)
    .join("");
  // No script-src: the reading iframe must not execute mail (or bridge) script.
  const imgSrc = options.allowRemoteImages
    ? "https: http: data: blob:"
    : "data: blob:";
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; script-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${mailDocumentBaseStyles()}</style>${authorStyles}</head><body>${sanitized}</body></html>`;
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
