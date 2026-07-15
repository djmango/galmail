import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./registry.js";

describe("CommandRegistry", () => {
  it("matches Superhuman-style j/k/e and palette", () => {
    const reg = new CommandRegistry();
    expect(reg.match({ key: "j", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "navigate_down",
    );
    expect(reg.match({ key: "e", metaKey: false, ctrlKey: false, altKey: false })).toBe(
      "archive",
    );
    expect(reg.match({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBe(
      "command_palette",
    );
  });

  it("dispatches handlers", () => {
    const reg = new CommandRegistry();
    const spy = vi.fn();
    reg.on("archive", spy);
    expect(reg.dispatch("archive")).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });
});
