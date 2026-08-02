/** Typical status-bar + Dynamic Island clearance when env() reports 0. */
export const SAFE_TOP_FALLBACK_PX = 54;

/**
 * Ensure CSS safe-area insets are usable on mobile WKWebView. Some Tauri/iOS
 * builds report env(safe-area-inset-*) as 0 even when edge-to-edge; fall back
 * so headers clear the status bar / Dynamic Island.
 */
export function ensureMobileSafeAreaFallback(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);padding-bottom:env(safe-area-inset-bottom, 0px);padding-left:env(safe-area-inset-left, 0px);padding-right:env(safe-area-inset-right, 0px);";
  document.body.appendChild(probe);
  const styles = getComputedStyle(probe);
  const top = Number.parseFloat(styles.paddingTop) || 0;
  document.body.removeChild(probe);

  // Always publish a floor so chrome can use max(env, fallback).
  root.style.setProperty(
    "--safe-top-fallback",
    top < 1 ? `${SAFE_TOP_FALLBACK_PX}px` : "0px",
  );
  // Home-indicator is usually reported correctly; keep a defined 0 fallback.
  root.style.setProperty("--safe-bottom-fallback", "0px");
  root.dataset.safeArea = top < 1 ? "fallback" : "env";
}
