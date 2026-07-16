/**
 * Theme + layout definitions for GalMail.
 *
 * Two intentional themes:
 *  - "dark"  : Linear-inspired. Dark charcoal, near-black surfaces, single
 *              indigo accent, dense, small crisp sans-serif, kbd badges, flat,
 *              no shadows.
 *  - "light" : Readwise Reader-inspired. Cream/paper background, serif body
 *              typography for the reading pane, sans-serif chrome, generous
 *              margins, highlighter accents, calm and literary.
 *
 * Themes are pure CSS-variable swaps (see styles/themes.css) applied via
 * [data-theme="..."] on the app root.
 */

export type ThemeId = "dark" | "light";

export interface ThemeMeta {
  id: ThemeId;
  /** Short label shown in the toggle. */
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
    id: "dark",
    label: "Dark",
    blurb: "Charcoal surfaces, single indigo accent, dense, flat, kbd badges.",
    inspiredBy: "Linear",
    scheme: "dark",
    swatch: ["#08090a", "#161719", "#5e6ad2"],
  },
  {
    id: "light",
    label: "Light",
    blurb: "Cream paper, serif reading, generous margins, highlighter accents.",
    inspiredBy: "Readwise Reader",
    scheme: "light",
    swatch: ["#f6f1e7", "#fdfaf3", "#f0c040"],
  },
];

export type LayoutMode = "fullscreen" | "two-panel" | "three-panel";

export type LayoutIconId = "layoutSingle" | "layoutSplit" | "layoutThree";

export interface LayoutMeta {
  id: LayoutMode;
  label: string;
  shortLabel: string;
  icon: LayoutIconId;
  blurb: string;
}

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "fullscreen",
    label: "Single panel",
    shortLabel: "Single",
    icon: "layoutSingle",
    blurb: "Open the selected thread full-screen; Back returns to the inbox.",
  },
  {
    id: "two-panel",
    label: "Split view",
    shortLabel: "Split",
    icon: "layoutSplit",
    blurb: "Thread list and reading pane, without an overlay sidebar.",
  },
  {
    id: "three-panel",
    label: "Three panel",
    shortLabel: "Three",
    icon: "layoutThree",
    blurb: "Sidebar + thread list + reading pane. Classic triage layout.",
  },
];

export const DEFAULT_THEME: ThemeId = "dark";
export const DEFAULT_LAYOUT: LayoutMode = "three-panel";
export const DEFAULT_SIDEBAR_COLLAPSED = false;

const THEME_STORAGE_KEY = "galmail.theme";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "galmail.sidebarCollapsed";

/** Load persisted theme, falling back to the default / OS preference. */
export function loadPersistedTheme(): ThemeId {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  const prefersLight =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : DEFAULT_THEME;
}

/** Persist the user's theme choice. */
export function persistTheme(theme: ThemeId): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** Load persisted sidebar collapsed preference. */
export function loadPersistedSidebarCollapsed(): boolean {
  if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_COLLAPSED;
  const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (stored === "1" || stored === "true") return true;
  if (stored === "0" || stored === "false") return false;
  return DEFAULT_SIDEBAR_COLLAPSED;
}

/** Persist the user's sidebar collapsed preference. */
export function persistSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
}
