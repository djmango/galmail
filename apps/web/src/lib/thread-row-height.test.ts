import { describe, expect, test } from "bun:test";
import {
  THREAD_ROW_HEIGHT_DESKTOP,
  THREAD_ROW_HEIGHT_MOBILE,
  threadRowHeightForLayout,
} from "./thread-row-height";

describe("threadRowHeightForLayout", () => {
  test("keeps mobile/desktop constants used by CSS virtualization", () => {
    expect(THREAD_ROW_HEIGHT_MOBILE).toBe(86);
    expect(THREAD_ROW_HEIGHT_DESKTOP).toBe(84);
    expect(threadRowHeightForLayout(true)).toBe(86);
    expect(threadRowHeightForLayout(false)).toBe(84);
  });
});
