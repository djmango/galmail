import { describe, expect, test } from "bun:test";
import {
  canBeginSwipeBack,
  shouldCompleteSwipeBack,
  swipeBackProgress,
} from "./swipe-back";

describe("swipe-back helpers", () => {
  test("only starts from the left edge", () => {
    expect(canBeginSwipeBack(12, 390)).toBe(true);
    expect(canBeginSwipeBack(40, 390)).toBe(false);
  });

  test("progress clamps to 1", () => {
    expect(swipeBackProgress(-10, 390)).toBe(0);
    expect(swipeBackProgress(44, 390)).toBeGreaterThan(0);
    expect(swipeBackProgress(400, 390)).toBe(1);
  });

  test("completes by distance or flick", () => {
    expect(shouldCompleteSwipeBack(40)).toBe(false);
    expect(shouldCompleteSwipeBack(90)).toBe(true);
    expect(shouldCompleteSwipeBack(60, 0.6)).toBe(true);
  });
});
