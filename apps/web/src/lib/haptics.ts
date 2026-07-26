import { isNativeShell } from "./account-session";

export type HapticKind =
  | "selection"
  | "impact-light"
  | "impact-medium"
  | "impact-heavy"
  | "success"
  | "warning"
  | "error";

let hapticsModule: typeof import("@tauri-apps/plugin-haptics") | null | undefined;

async function loadHaptics() {
  if (hapticsModule !== undefined) return hapticsModule;
  if (!isNativeShell()) {
    hapticsModule = null;
    return null;
  }
  try {
    hapticsModule = await import("@tauri-apps/plugin-haptics");
  } catch {
    hapticsModule = null;
  }
  return hapticsModule;
}

/** Fire-and-forget haptic; never throws into UI paths. */
export function haptic(kind: HapticKind = "selection"): void {
  void (async () => {
    try {
      const api = await loadHaptics();
      if (!api) {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.vibrate === "function"
        ) {
          navigator.vibrate(kind === "impact-heavy" ? 24 : 10);
        }
        return;
      }
      switch (kind) {
        case "selection":
          await api.selectionFeedback();
          break;
        case "impact-light":
          await api.impactFeedback("light");
          break;
        case "impact-medium":
          await api.impactFeedback("medium");
          break;
        case "impact-heavy":
          await api.impactFeedback("heavy");
          break;
        case "success":
          await api.notificationFeedback("success");
          break;
        case "warning":
          await api.notificationFeedback("warning");
          break;
        case "error":
          await api.notificationFeedback("error");
          break;
      }
    } catch {
      // Plugin unavailable or denied - ignore.
    }
  })();
}
