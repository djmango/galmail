import { describe, expect, test } from "bun:test";
import {
  canBeginPull,
  pullDistanceFromDelta,
  resolvePullAxis,
  shouldTriggerRefresh,
  PULL_TRIGGER_PX,
} from "./pull-to-refresh";

describe("pull-to-refresh helpers", () => {
  test("allows near-zero scrollTop for iOS rubber-band", () => {
    expect(canBeginPull(0)).toBe(true);
    expect(canBeginPull(1.5)).toBe(true);
    expect(canBeginPull(2)).toBe(true);
    expect(canBeginPull(3)).toBe(false);
  });

  test("applies resistance and caps distance", () => {
    expect(pullDistanceFromDelta(-10)).toBe(0);
    expect(pullDistanceFromDelta(40)).toBeCloseTo(22);
    expect(pullDistanceFromDelta(400)).toBe(96);
  });

  test("triggers at threshold", () => {
    expect(shouldTriggerRefresh(PULL_TRIGGER_PX - 1)).toBe(false);
    expect(shouldTriggerRefresh(PULL_TRIGGER_PX)).toBe(true);
  });

  test("locks axis after small movement", () => {
    expect(resolvePullAxis(2, 2, "undecided")).toBe("undecided");
    expect(resolvePullAxis(20, 4, "undecided")).toBe("x");
    expect(resolvePullAxis(4, 20, "undecided")).toBe("y");
    expect(resolvePullAxis(40, 2, "y")).toBe("y");
  });
});
