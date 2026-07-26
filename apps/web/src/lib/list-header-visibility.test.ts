import { describe, expect, test } from "bun:test";
import { nextListHeaderHidden } from "./list-header-visibility";

describe("nextListHeaderHidden", () => {
  test("shows at the top and hides on downward scroll", () => {
    expect(
      nextListHeaderHidden({
        scrollTop: 0,
        lastScrollTop: 40,
        currentlyHidden: true,
      }),
    ).toBe(false);
    expect(
      nextListHeaderHidden({
        scrollTop: 80,
        lastScrollTop: 20,
        currentlyHidden: false,
      }),
    ).toBe(true);
  });

  test("reveals again when scrolling up", () => {
    expect(
      nextListHeaderHidden({
        scrollTop: 120,
        lastScrollTop: 180,
        currentlyHidden: true,
      }),
    ).toBe(false);
  });
});
