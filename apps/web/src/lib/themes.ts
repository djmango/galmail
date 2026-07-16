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
 * [data-theme="..."] on the app root. Preference may also be "system", which
 * resolves to light/dark via prefers-color-scheme.
 */

/** Resolved theme applied to `data-theme` (never "system"). */
export type ResolvedTheme = "dark" | "light";

/** Persisted user preference, including follow-system. */
export type ThemePreference = ResolvedTheme | "system";

/** @deprecated Prefer ResolvedTheme / ThemePreference. */
export type ThemeId = ThemePreference;

export interface ThemeMeta {
  id: ResolvedTheme;
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

export const DEFAULT_THEME: ThemePreference = "system";
export const DEFAULT_LAYOUT: LayoutMode = "three-panel";
export const DEFAULT_SIDEBAR_COLLAPSED = false;
export const DEFAULT_LOAD_REMOTE_IMAGES = true;
export const DEFAULT_TRASH_AFTER_UNSUBSCRIBE = true;

const THEME_STORAGE_KEY = "galmail.theme";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "galmail.sidebarCollapsed";
const LOAD_REMOTE_IMAGES_STORAGE_KEY = "galmail.loadRemoteImages";
const TRASH_AFTER_UNSUBSCRIBE_STORAGE_KEY = "galmail.trashAfterUnsubscribe";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

/** Current OS light/dark preference. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof matchMedia === "undefined") return "dark";
  return matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

/** Resolve a stored preference to the theme applied on the document. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

/**
 * Subscribe to OS theme changes. Call when preference is "system".
 * Returns an unsubscribe function.
 */
export function subscribeSystemTheme(
  onChange: (theme: ResolvedTheme) => void,
): () => void {
  if (typeof matchMedia === "undefined") return () => undefined;
  const media = matchMedia(SYSTEM_DARK_QUERY);
  const handler = () => {
    onChange(media.matches ? "dark" : "light");
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

/** Load persisted theme preference, defaulting to system. */
export function loadPersistedTheme(): ThemePreference {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (isThemePreference(stored)) return stored;
  return DEFAULT_THEME;
}

/** Persist the user's theme preference (including system). */
export function persistTheme(theme: ThemePreference): void {
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

/** Load persisted remote-image default for the reading pane. */
export function loadPersistedLoadRemoteImages(): boolean {
  if (typeof localStorage === "undefined") return DEFAULT_LOAD_REMOTE_IMAGES;
  const stored = localStorage.getItem(LOAD_REMOTE_IMAGES_STORAGE_KEY);
  if (stored === "1" || stored === "true") return true;
  if (stored === "0" || stored === "false") return false;
  return DEFAULT_LOAD_REMOTE_IMAGES;
}

/** Persist whether remote images load by default in the reading pane. */
export function persistLoadRemoteImages(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOAD_REMOTE_IMAGES_STORAGE_KEY, enabled ? "1" : "0");
}

/** Load persisted trash-after-unsubscribe preference (default on). */
export function loadPersistedTrashAfterUnsubscribe(): boolean {
  if (typeof localStorage === "undefined") return DEFAULT_TRASH_AFTER_UNSUBSCRIBE;
  const stored = localStorage.getItem(TRASH_AFTER_UNSUBSCRIBE_STORAGE_KEY);
  if (stored === "1" || stored === "true") return true;
  if (stored === "0" || stored === "false") return false;
  return DEFAULT_TRASH_AFTER_UNSUBSCRIBE;
}

/** Persist whether to trash the message after a successful unsubscribe. */
export function persistTrashAfterUnsubscribe(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    TRASH_AFTER_UNSUBSCRIBE_STORAGE_KEY,
    enabled ? "1" : "0",
  );
}
