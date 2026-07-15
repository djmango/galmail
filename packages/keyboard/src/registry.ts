export type CommandId =
  | "navigate_down"
  | "navigate_up"
  | "archive"
  | "trash"
  | "mark_read_toggle"
  | "compose"
  | "reply"
  | "command_palette"
  | "undo"
  | "search"
  | "snooze";

export interface CommandDef {
  id: CommandId;
  title: string;
  /** Superhuman-compatible defaults */
  defaultKeys: string[];
  scope: "list" | "thread" | "global" | "compose";
}

export const SUPERHUMAN_DEFAULTS: CommandDef[] = [
  { id: "navigate_down", title: "Next thread", defaultKeys: ["j"], scope: "list" },
  { id: "navigate_up", title: "Previous thread", defaultKeys: ["k"], scope: "list" },
  { id: "archive", title: "Archive", defaultKeys: ["e"], scope: "list" },
  { id: "trash", title: "Trash", defaultKeys: ["#"], scope: "list" },
  { id: "mark_read_toggle", title: "Toggle read", defaultKeys: ["u"], scope: "list" },
  { id: "compose", title: "Compose", defaultKeys: ["c"], scope: "global" },
  { id: "reply", title: "Reply", defaultKeys: ["r"], scope: "thread" },
  {
    id: "command_palette",
    title: "Command palette",
    defaultKeys: ["meta+k", "ctrl+k"],
    scope: "global",
  },
  { id: "undo", title: "Undo", defaultKeys: ["z"], scope: "global" },
  { id: "search", title: "Search", defaultKeys: ["/"], scope: "global" },
  { id: "snooze", title: "Snooze", defaultKeys: ["h"], scope: "list" },
];

export class CommandRegistry {
  private bindings = new Map<string, CommandId>();
  private handlers = new Map<CommandId, () => void>();

  constructor(defs: CommandDef[] = SUPERHUMAN_DEFAULTS) {
    for (const d of defs) {
      for (const key of d.defaultKeys) {
        const conflict = this.bindings.get(key);
        if (conflict && conflict !== d.id) {
          throw new Error(`Key conflict: ${key} -> ${conflict} and ${d.id}`);
        }
        this.bindings.set(key, d.id);
      }
    }
  }

  on(id: CommandId, handler: () => void): void {
    this.handlers.set(id, handler);
  }

  /** Normalize KeyboardEvent into binding key. */
  match(event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }): CommandId | null {
    const parts: string[] = [];
    if (event.metaKey) parts.push("meta");
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase());
    const chord = parts.join("+");
    // Also try bare key when no modifiers
    return this.bindings.get(chord) ?? this.bindings.get(event.key.toLowerCase()) ?? null;
  }

  dispatch(id: CommandId): boolean {
    const h = this.handlers.get(id);
    if (!h) return false;
    h();
    return true;
  }

  list(): CommandDef[] {
    return SUPERHUMAN_DEFAULTS;
  }
}
