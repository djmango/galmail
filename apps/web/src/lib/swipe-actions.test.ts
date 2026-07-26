import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_SWIPE_ACTIONS,
  loadPersistedSwipeActions,
  persistSwipeActions,
  resolveSwipeAction,
  SWIPE_FAR_PX,
  SWIPE_NEAR_PX,
} from "./swipe-actions";

const KEYS = ["galmail.swipeActions"];

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: (() => {
      const store = new Map<string, string>();
      return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      };
    })(),
  });
  for (const key of KEYS) localStorage.removeItem(key);
});

describe("swipe actions", () => {
  test("defaults map near/far stops for both directions", () => {
    expect(resolveSwipeAction(SWIPE_NEAR_PX, DEFAULT_SWIPE_ACTIONS)).toBe(
      "archive",
    );
    expect(resolveSwipeAction(SWIPE_FAR_PX, DEFAULT_SWIPE_ACTIONS)).toBe(
      "star",
    );
    expect(resolveSwipeAction(-SWIPE_NEAR_PX, DEFAULT_SWIPE_ACTIONS)).toBe(
      "trash",
    );
    expect(resolveSwipeAction(-SWIPE_FAR_PX, DEFAULT_SWIPE_ACTIONS)).toBe(
      "spam",
    );
    expect(resolveSwipeAction(10, DEFAULT_SWIPE_ACTIONS)).toBeNull();
  });

  test("persists and reloads custom bindings", () => {
    const next = {
      ...DEFAULT_SWIPE_ACTIONS,
      leftNear: "mark_read" as const,
      rightFar: "none" as const,
    };
    persistSwipeActions(next);
    expect(loadPersistedSwipeActions()).toEqual(next);
  });
});
