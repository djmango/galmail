import type { SyncCursor } from "./types.js";

/**
 * Reconcile provider cursors after duplicate delivery / stale history.
 * Property: applying the same delta twice must be idempotent at the cursor layer.
 */
export function reconcileCursor(
  current: SyncCursor | null,
  incoming: SyncCursor,
): SyncCursor {
  if (!current) return incoming;
  if (current.accountId !== incoming.accountId) {
    throw new Error("cursor account mismatch");
  }
  if (current.provider !== incoming.provider) {
    throw new Error("cursor provider mismatch");
  }
  // Prefer the newer opaque token. Numeric history IDs compare numerically;
  // otherwise fall back to length-then-lexicographic ordering.
  return compareOpaqueToken(current.token, incoming.token) >= 0
    ? current
    : incoming;
}

export function compareOpaqueToken(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && a.trim() !== "" && b.trim() !== "") {
    return an === bn ? 0 : an > bn ? 1 : -1;
  }
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}


export function isStaleHistoryError(message: string): boolean {
  return /history.*(invalid|expired|not found)/i.test(message);
}
