import { describe, expect, it } from "bun:test";
import { UNDO_WINDOW_MS, undoDeadline } from "./undo-toast";

describe("undoDeadline", () => {
  it("returns an ISO timestamp about UNDO_WINDOW_MS ahead", () => {
    const before = Date.now();
    const iso = undoDeadline();
    const at = Date.parse(iso);
    expect(Number.isFinite(at)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(before + UNDO_WINDOW_MS - 50);
    expect(at).toBeLessThanOrEqual(Date.now() + UNDO_WINDOW_MS + 50);
  });

  it("honors a custom window", () => {
    const before = Date.now();
    const at = Date.parse(undoDeadline(1_000));
    expect(at).toBeGreaterThanOrEqual(before + 950);
    expect(at).toBeLessThanOrEqual(Date.now() + 1_100);
  });
});
