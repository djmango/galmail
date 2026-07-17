import { describe, expect, it } from "bun:test";
import { resolveMobileSurface } from "./mobile-layout";

describe("resolveMobileSurface", () => {
  it("shows the inbox list by default", () => {
    expect(
      resolveMobileSurface({ mainView: "mail", openedId: null }),
    ).toBe("list");
  });

  it("opens a single thread reading surface", () => {
    expect(
      resolveMobileSurface({ mainView: "mail", openedId: "t1" }),
    ).toBe("thread");
  });

  it("prefers calendar over thread when calendar is active", () => {
    expect(
      resolveMobileSurface({ mainView: "calendar", openedId: "t1" }),
    ).toBe("calendar");
  });
});
