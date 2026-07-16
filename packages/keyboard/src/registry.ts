export type CommandId =
  | "navigate_down"
  | "navigate_up"
  | "open_thread"
  | "archive"
  | "trash"
  | "mark_read_toggle"
  | "compose"
  | "reply"
  | "command_palette"
  | "open_settings"
  | "undo"
  | "search"
  | "snooze"
  | "enter_insert"
  | "enter_normal"
  | "go_to_inbox"
  | "toggle_sidebar"
  | "back";

export interface CommandDef {
  id: CommandId;
  title: string;
  /** Superhuman-compatible defaults. Sequences use a space (e.g. "g i"). */
  defaultKeys: string[];
  scope: "list" | "thread" | "global" | "compose";
}

export const SUPERHUMAN_DEFAULTS: CommandDef[] = [
  { id: "navigate_down", title: "Next thread", defaultKeys: ["j"], scope: "list" },
  { id: "navigate_up", title: "Previous thread", defaultKeys: ["k"], scope: "list" },
  { id: "open_thread", title: "Open thread", defaultKeys: ["enter"], scope: "list" },
  { id: "archive", title: "Archive", defaultKeys: ["e"], scope: "list" },
  { id: "trash", title: "Trash", defaultKeys: ["#"], scope: "list" },
  { id: "mark_read_toggle", title: "Toggle read", defaultKeys: ["u"], scope: "list" },
  { id: "compose", title: "Compose", defaultKeys: ["c"], scope: "global" },
  // Enter also replies when a thread is open (scoped match; list uses Enter to open).
  { id: "reply", title: "Reply", defaultKeys: ["r", "enter"], scope: "thread" },
  {
    id: "command_palette",
    title: "Command palette",
    defaultKeys: ["meta+k", "ctrl+k"],
    scope: "global",
  },
  {
    id: "open_settings",
    title: "Settings",
    defaultKeys: ["meta+,", "ctrl+,"],
    scope: "global",
  },
  { id: "undo", title: "Undo", defaultKeys: ["z"], scope: "global" },
  { id: "search", title: "Search", defaultKeys: ["/"], scope: "global" },
  { id: "snooze", title: "Snooze", defaultKeys: ["h"], scope: "list" },
  // Vim-style: i enters Insert (type in search). G then I still goes to Inbox.
  {
    id: "enter_insert",
    title: "Enter insert mode",
    defaultKeys: ["i"],
    scope: "global",
  },
  {
    id: "enter_normal",
    title: "Enter normal mode",
    defaultKeys: [],
    scope: "global",
  },
  { id: "go_to_inbox", title: "Go to inbox", defaultKeys: ["g i"], scope: "global" },
  {
    id: "toggle_sidebar",
    title: "Toggle sidebar",
    defaultKeys: ["["],
    scope: "global",
  },
  { id: "back", title: "Back", defaultKeys: ["escape"], scope: "global" },
];

const SEQUENCE_TIMEOUT_MS = 800;

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (typeof tag !== "string") return false;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    Boolean(el.isContentEditable)
  );
}

export type EditorMode = "normal" | "insert";
export type EscapeAction = "enter_normal" | "dismiss";

/**
 * Vim-style Escape: leave Insert (or blur a focused field) before dismissing
 * overlays. Only Normal mode with nothing editable focused dismisses/back.
 */
export function resolveEscapeAction(state: {
  mode: EditorMode;
  editableFocused: boolean;
}): EscapeAction {
  if (state.mode === "insert" || state.editableFocused) {
    return "enter_normal";
  }
  return "dismiss";
}

/** Normalize a KeyboardEvent-like object into a binding token (e.g. "meta+k", "escape"). */
export function normalizeKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push("meta");
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  const key =
    event.key === " "
      ? "space"
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

function formatChordPart(part: string, mac: boolean): string {
  switch (part) {
    case "meta":
      return mac ? "⌘" : "Ctrl";
    case "ctrl":
      return mac ? "⌃" : "Ctrl";
    case "alt":
      return mac ? "⌥" : "Alt";
    case "shift":
      return "⇧";
    case "escape":
      return "Esc";
    case "enter":
      return "Enter";
    case "space":
      return "Space";
    default:
      return part.length === 1 ? part.toUpperCase() : part;
  }
}

/** Pretty-print a chord or sequence for UI ("meta+k" → "⌘K", "g i" → "G I"). */
export function formatShortcutChord(chord: string, mac = isMacPlatform()): string {
  if (chord.includes(" ")) {
    return chord
      .split(/\s+/)
      .map((step) => formatShortcutChord(step, mac))
      .join(" ");
  }
  const parts = chord.split("+");
  const labeled = parts.map((p) => formatChordPart(p, mac));
  // Compact modifier+key on Mac: ⌘K; keep spaces for multi-key sequences only.
  if (mac && parts.length > 1 && parts.every((p) => p !== " ")) {
    return labeled.join("");
  }
  return labeled.join("+");
}

export function formatShortcutKeys(keys: string[], mac = isMacPlatform()): string {
  // Prefer a single representative binding for tooltips (first key).
  const primary = keys[0];
  if (!primary) return "";
  if (keys.length === 1) return formatShortcutChord(primary, mac);
  // For meta/ctrl pairs, pick platform-appropriate one.
  if (mac) {
    const meta = keys.find((k) => k.startsWith("meta"));
    if (meta) return formatShortcutChord(meta, mac);
  } else {
    const ctrl = keys.find((k) => k.startsWith("ctrl"));
    if (ctrl) return formatShortcutChord(ctrl, mac);
  }
  return formatShortcutChord(primary, mac);
}

/** Accessible hover label, e.g. "Archive · E". */
export function shortcutTooltip(title: string, keys: string[], mac = isMacPlatform()): string {
  const chord = formatShortcutKeys(keys, mac);
  return chord ? `${title} · ${chord}` : title;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function keysForCommand(id: CommandId, defs: CommandDef[] = SUPERHUMAN_DEFAULTS): string[] {
  return defs.find((d) => d.id === id)?.defaultKeys ?? [];
}

export type MatchContext = {
  /** When a key is bound in multiple scopes, prefer this scope (e.g. thread vs list). */
  activeScope?: CommandDef["scope"];
};

type ScopedBinding = { id: CommandId; scope: CommandDef["scope"] };

/** Pick a command when one key is bound in multiple scopes (e.g. Enter: open vs reply). */
export function resolveScopedBinding(
  candidates: ScopedBinding[] | undefined,
  activeScope?: CommandDef["scope"],
): CommandId | null {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0]!.id;
  if (activeScope) {
    const scoped = candidates.find((b) => b.scope === activeScope);
    if (scoped) return scoped.id;
  }
  const global = candidates.find((b) => b.scope === "global");
  if (global) return global.id;
  return candidates[0]!.id;
}

export class CommandRegistry {
  private bindings = new Map<string, ScopedBinding[]>();
  private sequences = new Map<string, Map<string, CommandId>>();
  private handlers = new Map<CommandId, () => void>();
  private defs: CommandDef[];
  private pendingPrefix: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(defs: CommandDef[] = SUPERHUMAN_DEFAULTS) {
    this.defs = defs;
    for (const d of defs) {
      for (const key of d.defaultKeys) {
        if (key.includes(" ")) {
          const [prefix, next, ...rest] = key.split(/\s+/);
          if (!prefix || !next || rest.length > 0) {
            throw new Error(`Unsupported sequence binding: ${key}`);
          }
          let table = this.sequences.get(prefix);
          if (!table) {
            table = new Map();
            this.sequences.set(prefix, table);
          }
          const conflict = table.get(next);
          if (conflict && conflict !== d.id) {
            throw new Error(`Key conflict: ${key} -> ${conflict} and ${d.id}`);
          }
          table.set(next, d.id);
          continue;
        }
        const existing = this.bindings.get(key) ?? [];
        const sameScope = existing.find((b) => b.scope === d.scope && b.id !== d.id);
        if (sameScope) {
          throw new Error(`Key conflict: ${key} -> ${sameScope.id} and ${d.id}`);
        }
        if (!existing.some((b) => b.id === d.id)) {
          existing.push({ id: d.id, scope: d.scope });
          this.bindings.set(key, existing);
        }
      }
    }
  }

  on(id: CommandId, handler: () => void): void {
    this.handlers.set(id, handler);
  }

  clearPending(): void {
    this.pendingPrefix = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** Normalize KeyboardEvent into binding key / resolve sequences. */
  match(
    event: {
      key: string;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey?: boolean;
    },
    context: MatchContext = {},
  ): CommandId | null {
    const token = normalizeKey(event);

    if (this.pendingPrefix) {
      const table = this.sequences.get(this.pendingPrefix);
      this.clearPending();
      const sequenced = table?.get(token) ?? null;
      if (sequenced) return sequenced;
      // Fall through: unmatched second key may still be a bare binding.
    }

    if (this.sequences.has(token) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.pendingPrefix = token;
      this.pendingTimer = setTimeout(() => this.clearPending(), SEQUENCE_TIMEOUT_MS);
      // Prefix keys can also be bare bindings (rare); prefer waiting for sequence.
      return null;
    }

    return resolveScopedBinding(this.bindings.get(token), context.activeScope);
  }

  dispatch(id: CommandId): boolean {
    const h = this.handlers.get(id);
    if (!h) return false;
    h();
    return true;
  }

  list(): CommandDef[] {
    return this.defs;
  }

  keysFor(id: CommandId): string[] {
    return keysForCommand(id, this.defs);
  }
}
