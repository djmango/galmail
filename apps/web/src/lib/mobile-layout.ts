import { useEffect, useState } from "react";

/** Phone / narrow tablet shell — desktop three-pane stays above this. */
export const MOBILE_LAYOUT_QUERY = "(max-width: 768px)";

export function readIsMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

/** Reactive mobile layout mode for GalMail's phone shell. */
export function useIsMobileLayout(): boolean {
  const [isMobile, setIsMobile] = useState(readIsMobileLayout);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export type MobileSurface = "list" | "thread" | "calendar";

export function resolveMobileSurface(input: {
  mainView: "mail" | "calendar";
  openedId: string | null;
}): MobileSurface {
  if (input.mainView === "calendar") return "calendar";
  if (input.openedId) return "thread";
  return "list";
}
