/**
 * Theme + layout definitions for the GalMail interactive mockups.
 *
 * Themes are pure CSS-variable swaps (see styles/themes.css). Each theme
 * captures the *design principles* of a reference app — palette, roundedness,
 * typography, density, shadow style — without literally cloning it.
 */

export type ThemeId =
  | "linear"
  | "tesla"
  | "pocketcasts"
  | "readwise"
  | "robinhood"
  | "airbnb";

export interface ThemeMeta {
  id: ThemeId;
  /** Short label shown in the settings switcher. */
  label: string;
  /** One-line description of the design principle. */
  blurb: string;
  /** Reference app the principle is drawn from. */
  inspiredBy: string;
  /** Light or dark color-scheme hint. */
  scheme: "light" | "dark";
  /** Swatch colors for the switcher chip (bg, surface, accent). */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "linear",
    label: "Linear",
    blurb: "Dark charcoal, indigo accent, dense, flat, kbd badges.",
    inspiredBy: "Linear",
    scheme: "dark",
    swatch: ["#08090a", "#161719", "#5e6ad2"],
  },
  {
    id: "tesla",
    label: "Tesla",
    blurb: "Pure white/black, sparse, large rounded cards, negative space.",
    inspiredBy: "Tesla",
    scheme: "light",
    swatch: ["#ffffff", "#f7f7f7", "#e82127"],
  },
  {
    id: "pocketcasts",
    label: "Pocket Casts",
    blurb: "Deep purple/navy, vibrant, card-based, bold headings.",
    inspiredBy: "Pocket Casts",
    scheme: "dark",
    swatch: ["#1a0e2e", "#3d2360", "#c935f0"],
  },
  {
    id: "readwise",
    label: "Readwise",
    blurb: "Cream paper, serif body, generous margins, highlighter accents.",
    inspiredBy: "Readwise Reader",
    scheme: "light",
    swatch: ["#f6f1e7", "#fdfaf3", "#f0c040"],
  },
  {
    id: "robinhood",
    label: "Robinhood",
    blurb: "True black, monochrome + green/red priority, data-dense, sharp.",
    inspiredBy: "Robinhood",
    scheme: "dark",
    swatch: ["#000000", "#141414", "#00c805"],
  },
  {
    id: "airbnb",
    label: "Airbnb",
    blurb: "Warm, photographic avatars, large rounded cards, coral, friendly.",
    inspiredBy: "Airbnb",
    scheme: "light",
    swatch: ["#ffffff", "#ffffff", "#ff385c"],
  },
];

export type LayoutMode = "fullscreen" | "two-panel" | "three-panel";

export interface LayoutMeta {
  id: LayoutMode;
  label: string;
  blurb: string;
}

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "fullscreen",
    label: "1-panel · Fullscreen",
    blurb: "One thing at a time. Big inbox → tap a thread → full-screen email. Back returns to list.",
  },
  {
    id: "two-panel",
    label: "2-panel · Auto sidebar",
    blurb: "Sidebar auto-collapses to a rail (or hides until hover). Main area = list + reading pane.",
  },
  {
    id: "three-panel",
    label: "3-panel · Traditional",
    blurb: "Sidebar + thread list + reading pane. Classic triage layout.",
  },
];

/** Sidebar behavior within 2-panel mode. */
export type SidebarMode = "always" | "auto";

export const SIDEBAR_LABELS: Record<SidebarMode, string> = {
  auto: "Auto · hide until hover",
  always: "Always · icon rail",
};

export const DEFAULT_THEME: ThemeId = "linear";
export const DEFAULT_LAYOUT: LayoutMode = "three-panel";
export const DEFAULT_SIDEBAR: SidebarMode = "auto";
