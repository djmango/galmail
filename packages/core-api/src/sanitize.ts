/** Minimal HTML sanitizer for security tests and reading-pane hardening. */

const DANGEROUS_TAGS =
  /<\/?(script|iframe|object|embed|link|meta|base|form|svg|math)[^>]*>/gi;
const EVENT_HANDLERS = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URLS = /(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi;

export function sanitizeHtml(input: string): string {
  return input
    .replace(DANGEROUS_TAGS, "")
    .replace(EVENT_HANDLERS, "")
    .replace(JAVASCRIPT_URLS, '$1="#"');
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}
