import { bench, describe } from "vitest";
import { reconcileCursor } from "./cursor.js";
import { asAccountId } from "./types.js";

describe("cursor reconcile budget proxy", () => {
  bench("reconcileCursor x1000", () => {
    let cur = {
      accountId: asAccountId("gmail:demo"),
      provider: "gmail" as const,
      token: "0",
      updatedAt: "t",
    };
    for (let i = 0; i < 1000; i++) {
      cur = reconcileCursor(cur, {
        ...cur,
        token: String(i),
      });
    }
  });
});
