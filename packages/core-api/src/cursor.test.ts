import { describe, expect, it } from "vitest";
import { isStaleHistoryError, reconcileCursor } from "./cursor.js";
import { asAccountId } from "./types.js";

describe("reconcileCursor", () => {
  it("returns incoming when current is null", () => {
    const incoming = {
      accountId: asAccountId("gmail:me"),
      provider: "gmail" as const,
      token: "100",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(reconcileCursor(null, incoming)).toEqual(incoming);
  });

  it("keeps the greater opaque token", () => {
    const a = {
      accountId: asAccountId("gmail:me"),
      provider: "gmail" as const,
      token: "100",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const b = { ...a, token: "99" };
    expect(reconcileCursor(a, b).token).toBe("100");
    expect(reconcileCursor(b, a).token).toBe("100");
  });

  it("rejects account mismatch", () => {
    expect(() =>
      reconcileCursor(
        {
          accountId: asAccountId("gmail:a"),
          provider: "gmail",
          token: "1",
          updatedAt: "t",
        },
        {
          accountId: asAccountId("gmail:b"),
          provider: "gmail",
          token: "2",
          updatedAt: "t",
        },
      ),
    ).toThrow(/account mismatch/);
  });
});

describe("isStaleHistoryError", () => {
  it("detects gmail stale history phrasing", () => {
    expect(isStaleHistoryError("Requested historyId is invalid or expired")).toBe(
      true,
    );
    expect(isStaleHistoryError("network timeout")).toBe(false);
  });
});
