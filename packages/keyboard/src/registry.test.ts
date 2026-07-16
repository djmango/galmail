import { describe, expect, it, mock } from "bun:test";
import {
  CommandRegistry,
  formatShortcutChord,
  isEditableTarget,
  resolveEscapeAction,
  shortcutTooltip,
} from "./registry.js";

describe("CommandRegistry", () => {
  it("matches Superhuman-style navigation, open, and palette", () => {
    const reg = new CommandRegistry();
    expect(reg.match({ key: "j", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "navigate_down",
    );
    expect(reg.match({ key: "e", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "archive",
    );
    expect(
      reg.match({ key: "Enter", metaKey: false, ctrlKey: false, altKey: false }),
    ).toBe("open_thread");
    expect(
      reg.match(
        { key: "Enter", metaKey: false, ctrlKey: false, altKey: false },
        { activeScope: "list" },
      ),
    ).toBe("open_thread");
    expect(
      reg.match(
        { key: "Enter", metaKey: false, ctrlKey: false, altKey: false },
        { activeScope: "thread" },
      ),
    ).toBe("reply");
    expect(reg.match({ key: "r", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "reply",
    );
    expect(reg.match({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBe(
      "command_palette",
    );
    expect(reg.match({ key: ",", metaKey: true, ctrlKey: false, altKey: false })).toBe(
      "open_settings",
    );
    expect(reg.match({ key: ",", metaKey: false, ctrlKey: true, altKey: false })).toBe(
      "open_settings",
    );
  });

  it("binds Enter to reply in thread scope without conflicting list open", () => {
    const reg = new CommandRegistry();
    const reply = reg.list().find((c) => c.id === "reply");
    expect(reply?.defaultKeys).toEqual(["r", "enter"]);
  });

  it("maps bare i to insert mode and g-then-i to inbox", () => {
    const reg = new CommandRegistry();
    expect(reg.match({ key: "i", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "enter_insert",
    );

    expect(reg.match({ key: "g", metaKey: false, ctrlKey: false, altKey: false })).toBeNull();
    expect(reg.match({ key: "i", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "go_to_inbox",
    );
  });

  it("matches Escape as back", () => {
    const reg = new CommandRegistry();
    expect(reg.match({ key: "Escape", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "back",
    );
  });

  it("dispatches handlers", () => {
    const reg = new CommandRegistry();
    const spy = mock();
    reg.on("archive", spy);
    expect(reg.dispatch("archive")).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("lists go_to_inbox as g i only", () => {
    const reg = new CommandRegistry();
    const inbox = reg.list().find((c) => c.id === "go_to_inbox");
    expect(inbox?.defaultKeys).toEqual(["g i"]);
  });

  it("matches [ as toggle_sidebar", () => {
    const reg = new CommandRegistry();
    expect(reg.match({ key: "[", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "toggle_sidebar",
    );
  });
});

describe("shortcut helpers", () => {
  it("formats chords for tooltips", () => {
    expect(formatShortcutChord("e", false)).toBe("E");
    expect(formatShortcutChord("meta+k", true)).toBe("⌘K");
    expect(formatShortcutChord("g i", true)).toBe("G I");
    expect(shortcutTooltip("Archive", ["e"], true)).toBe("Archive · E");
  });

  it("detects editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    const input = { tagName: "INPUT", isContentEditable: false } as HTMLElement;
    const div = { tagName: "DIV", isContentEditable: false } as HTMLElement;
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
  });

  it("resolves Escape as Insert→Normal before dismiss", () => {
    expect(
      resolveEscapeAction({ mode: "insert", editableFocused: false }),
    ).toBe("enter_normal");
    expect(
      resolveEscapeAction({ mode: "normal", editableFocused: true }),
    ).toBe("enter_normal");
    expect(
      resolveEscapeAction({ mode: "normal", editableFocused: false }),
    ).toBe("dismiss");
  });
});
