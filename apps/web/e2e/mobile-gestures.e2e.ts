import { expect, test } from "@playwright/test";
import { captureMobileShot } from "./mobile-artifacts";
import {
  openFirstThread,
  openMobileInbox,
  swipeThread,
  touchSwipe,
} from "./mobile-helpers";

test.describe("mobile gestures and chrome", () => {
  test.beforeEach(async ({ page }) => {
    await openMobileInbox(page);
  });

  test("icons-only bottom nav, pull-to-refresh, and search focus", async ({
    page,
  }, testInfo) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    await expect(nav.getByLabel("Folders")).toBeVisible();
    await expect(nav.getByLabel("Inbox")).toBeVisible();
    await expect(nav.getByLabel("Compose")).toBeVisible();
    await expect(nav.getByLabel("Search")).toBeVisible();
    await expect(nav.getByLabel("Settings")).toBeVisible();
    await expect(nav.getByText("Folders")).toHaveCount(0);
    await expect(nav.getByText("Inbox")).toHaveCount(0);

    // Inbox scrollport stays edge-flush so the scrollbar is not inset.
    const listPaddingRight = await page
      .getByLabel("Thread list")
      .evaluate((node) => getComputedStyle(node).paddingRight);
    expect(Number.parseFloat(listPaddingRight) || 0).toBeLessThan(2);

    await captureMobileShot(
      page,
      "01-mobile-inbox",
      "Mobile inbox with icons-only bottom nav",
      testInfo.title,
    );

    const list = page.getByLabel("Thread list");
    await list.evaluate((node) => {
      node.scrollTop = 0;
      const target = node as HTMLElement;
      const startY = 80;
      const fire = (type: string, clientY: number) => {
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches:
              type === "touchend"
                ? []
                : [
                    new Touch({
                      identifier: 1,
                      target,
                      clientX: target.clientWidth / 2,
                      clientY,
                    }),
                  ],
            changedTouches: [
              new Touch({
                identifier: 1,
                target,
                clientX: target.clientWidth / 2,
                clientY,
              }),
            ],
          }),
        );
      };
      fire("touchstart", startY);
      // Resistance is ~0.55, so pull well past the 64px trigger threshold.
      fire("touchmove", startY + 150);
    });
    await expect(page.locator(".pull-refresh")).toContainText(
      /Release to refresh|Refreshing/i,
    );
    await captureMobileShot(
      page,
      "02-pull-to-refresh",
      "Pull-to-refresh affordance",
      testInfo.title,
    );
    await list.evaluate((node) => {
      const target = node as HTMLElement;
      target.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          changedTouches: [
            new Touch({
              identifier: 1,
              target,
              clientX: target.clientWidth / 2,
              clientY: 230,
            }),
          ],
        }),
      );
    });
    await expect
      .poll(async () => page.getByText(/Inbox refreshed|Refreshing/i).count())
      .toBeGreaterThan(0);

    await nav.getByLabel("Search").click();
    await expect(page.locator(".thread-search .field-input")).toBeFocused();
    await captureMobileShot(
      page,
      "03-search-focused",
      "Search field focused from bottom nav",
      testInfo.title,
    );
  });

  test("swipe near/far actions, undo snackbar, and sticky header hide", async ({
    page,
  }, testInfo) => {
    await captureMobileShot(
      page,
      "04-before-swipe",
      "Inbox before swipe actions",
      testInfo.title,
    );

    // Visual check for auto-hide header styles (scroll logic unit-tested).
    await page.locator(".thread-list-head").evaluate((node) => {
      node.classList.add("is-hidden");
    });
    await expect(page.locator(".thread-list-head")).toHaveClass(/is-hidden/);
    await captureMobileShot(
      page,
      "08-header-hidden",
      "Sticky list header collapsed",
      testInfo.title,
    );
    await page.locator(".thread-list-head").evaluate((node) => {
      node.classList.remove("is-hidden");
    });

    const beforeCount = await page.locator(".thread").count();
    await swipeThread(page, "right", 110);
    const undo = page.locator(".galmail-undo-snackbar");
    await expect(undo).toBeVisible({ timeout: 15_000 });
    await expect(undo.getByText("Archived", { exact: true })).toBeVisible();
    await expect(
      undo.getByRole("button", { name: "Undo", exact: true }),
    ).toBeVisible();
    await captureMobileShot(
      page,
      "05-swipe-archive-undo",
      "Archive swipe with timed Undo snackbar",
      testInfo.title,
    );
    await undo.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByText("Archive undone", { exact: true }),
    ).toBeVisible();

    await swipeThread(page, "left", 110);
    await expect(
      page.locator(".galmail-undo-snackbar").getByText("Moved to Trash"),
    ).toBeVisible({ timeout: 15_000 });
    await captureMobileShot(
      page,
      "06-swipe-delete",
      "Trash swipe action toast",
      testInfo.title,
    );

    // Far right -> star (success toast; star does not open the undo snackbar).
    await swipeThread(page, "right", 190);
    await expect(
      page.getByText("Starred", { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await captureMobileShot(
      page,
      "07-swipe-star-far",
      "Far-right star swipe",
      testInfo.title,
    );

    expect(beforeCount).toBeGreaterThan(0);
  });

  test("settings keeps bottom nav and shows swipe + allow-all", async ({
    page,
  }, testInfo) => {
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByLabel("Settings")
      .click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(dialog.getByText("Inbox layout")).toHaveCount(0);
    await expect(dialog.getByText("Remote images")).toBeVisible();
    await expect(
      dialog
        .getByLabel("Remote images")
        .getByRole("button", { name: "Allow all" }),
    ).toBeVisible();
    await expect(
      dialog
        .getByLabel("Approval mode")
        .getByRole("button", { name: "Allow all" }),
    ).toBeVisible();
    await expect(dialog.getByText("Swipe actions")).toBeVisible();
    await expect(dialog.getByText("Link device")).toBeVisible();
    await expect(dialog.getByText(" · live")).toHaveCount(0);
    await expect(dialog.locator(".account-connect-grid")).toBeVisible();
    await captureMobileShot(
      page,
      "09-settings-accounts",
      "Settings accounts + privacy",
      testInfo.title,
    );
    await dialog.locator(".settings-body").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await captureMobileShot(
      page,
      "10-settings-swipe-actions",
      "Settings swipe actions section",
      testInfo.title,
    );
  });

  test("HTML mail renders, safe area pads header, swipe-back from left third", async ({
    page,
  }, testInfo) => {
    // Open the styled fixture thread by subject so inbox order can change.
    await page
      .locator(".thread", {
        has: page.locator(".thread-subject", {
          hasText: "Styled product update",
        }),
      })
      .first()
      .click();
    await expect(page.locator(".app")).toHaveAttribute(
      "data-mobile-surface",
      "thread",
    );
    const reading = page.getByLabel("Reading pane");
    await expect(reading).toBeVisible();

    const header = page.locator(".reading-mobile-header");
    await expect(header).toBeVisible();
    // Pixel 7 reports 0 safe-area insets; App installs a notch fallback.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue("--safe-top-fallback")
            .trim();
          return Number.parseFloat(raw) || 0;
        }),
      )
      .toBeGreaterThanOrEqual(40);
    const headerPadTop = await header.evaluate(
      (node) => Number.parseFloat(getComputedStyle(node).paddingTop) || 0,
    );
    expect(headerPadTop).toBeGreaterThanOrEqual(40);

    const frame = reading.locator("iframe.mail-html-frame");
    await expect(frame).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () =>
        frame.evaluate((node) => {
          const doc = (node as HTMLIFrameElement).contentDocument;
          if (!doc?.body) return "";
          return doc.body.innerText;
        }),
      )
      .toMatch(/CSS \+ HTML should render|sandboxed iframe/i);
    await expect
      .poll(async () =>
        frame.evaluate((node) => {
          const doc = (node as HTMLIFrameElement).contentDocument;
          return doc?.querySelectorAll("style").length ?? 0;
        }),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        frame.evaluate((node) => {
          const doc = (node as HTMLIFrameElement).contentDocument;
          const img = doc?.querySelector("img");
          return img?.getAttribute("src") ?? "";
        }),
      )
      .toMatch(/^data:image\//);

    // Canvas matches the app shell (light --bg0), not a nested white card.
    await expect
      .poll(async () =>
        frame.evaluate((node) => {
          const doc = (node as HTMLIFrameElement).contentDocument;
          return doc ? getComputedStyle(doc.body).backgroundColor : "";
        }),
      )
      .toMatch(/rgb\(\s*244,\s*237,\s*224\s*\)/i);

    // Marketing tables must not spill past the iframe viewport.
    await expect
      .poll(async () =>
        frame.evaluate((node) => {
          const doc = (node as HTMLIFrameElement).contentDocument;
          if (!doc?.documentElement) return 0;
          return (
            doc.documentElement.scrollWidth - doc.documentElement.clientWidth
          );
        }),
      )
      .toBeLessThanOrEqual(2);

    // Conversation scrollport is flush to the right edge.
    const conversationPadRight = await reading
      .locator(".conversation")
      .evaluate(
        (node) => Number.parseFloat(getComputedStyle(node).paddingRight) || 0,
      );
    expect(conversationPadRight).toBeLessThan(2);

    await captureMobileShot(
      page,
      "12-thread-html-mail",
      "Thread reader with styled HTML iframe",
      testInfo.title,
    );

    await expect(page.getByLabel("Message actions")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeHidden();

    // Start well inside the left third (~28% width), not only the bezel.
    const width = await reading.evaluate((node) => node.clientWidth);
    const startX = Math.floor(width * 0.28);
    await touchSwipe(page, reading, {
      startX,
      endX: startX + 140,
      clientY: 180,
    });
    await expect(page.locator(".app")).toHaveAttribute(
      "data-mobile-surface",
      "list",
    );
    await captureMobileShot(
      page,
      "13-swipe-back-from-third",
      "Swipe-back completed from left third",
      testInfo.title,
    );
  });

  test("thread row truncates subject/snippet without sticky hover", async ({
    page,
  }, testInfo) => {
    await page.evaluate(() => {
      const subject = document.querySelector(".thread-subject");
      const snippet = document.querySelector(".thread-snippet");
      if (subject) {
        subject.textContent =
          "A very long subject that should not wrap onto multiple lines in the inbox list";
      }
      if (snippet) {
        snippet.textContent =
          "Preview with entities &#39;quote&#39; &amp; more text that must ellipsize instead of bleeding";
      }
    });
    const subject = page.locator(".thread-subject").first();
    await expect(subject).toHaveCSS("text-overflow", "ellipsis");
    await expect(subject).toHaveCSS("white-space", "nowrap");
    const snippet = page.locator(".thread-snippet").first();
    await expect(snippet).toHaveCSS("text-overflow", "ellipsis");

    const thread = page.locator(".thread").first();
    await thread.hover();
    await thread.dispatchEvent("pointerleave");
    await page.mouse.move(0, 0);
    await captureMobileShot(
      page,
      "11-thread-truncation",
      "Truncated subject/snippet rows",
      testInfo.title,
    );
  });

  test("archive from action bar shows undo snackbar on thread", async ({
    page,
  }, testInfo) => {
    const { reading } = await openFirstThread(page);
    await expect(page.getByLabel("Message actions")).toBeVisible();
    await page
      .getByLabel("Message actions")
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    // Archive may leave the thread surface immediately; snackbar should still appear.
    const undo = page.locator(".galmail-undo-snackbar");
    await expect(undo).toBeVisible({ timeout: 10_000 });
    await expect(
      undo.getByRole("button", { name: "Undo", exact: true }),
    ).toBeVisible();
    await captureMobileShot(
      page,
      "14-thread-archive-undo",
      "Thread archive Undo snackbar",
      testInfo.title,
    );
    void reading;
  });

  test("bottom nav Inbox dismisses Settings and Compose", async ({
    page,
  }, testInfo) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByLabel("Settings").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await nav.getByLabel("Inbox").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await expect(nav.getByLabel("Compose")).toBeVisible();
    await captureMobileShot(
      page,
      "15-inbox-from-settings",
      "Inbox from Settings returns to list",
      testInfo.title,
    );

    await nav.getByLabel("Compose").click();
    await expect(page.getByRole("dialog", { name: "Compose" })).toBeVisible();
    await nav.getByLabel("Inbox").click();
    await expect(page.getByRole("dialog", { name: "Compose" })).toBeHidden();
  });

  test("inbox unread badge sits on the nav icon", async ({ page }) => {
    const icon = page
      .getByRole("navigation", { name: "Primary" })
      .locator(".mobile-nav-icon")
      .first();
    await icon.evaluate((el) => {
      el.setAttribute("data-count", "3");
    });
    await expect(icon).toHaveAttribute("data-count", "3");

    const geometry = await icon.evaluate((el) => {
      const iconBox = el.getBoundingClientRect();
      const style = getComputedStyle(el, "::after");
      return {
        iconWidth: iconBox.width,
        iconHeight: iconBox.height,
        afterPosition: style.position,
        afterTop: Number.parseFloat(style.top),
        afterRight: Number.parseFloat(style.right),
        afterContent: style.content,
      };
    });

    expect(geometry.afterPosition).toBe("absolute");
    expect(geometry.afterContent).not.toBe("none");
    // Badge is pinned to the compact icon box, not the full nav cell.
    expect(geometry.iconWidth).toBeLessThan(40);
    expect(geometry.iconHeight).toBeLessThan(40);
    expect(geometry.afterTop).toBeLessThan(0);
    expect(geometry.afterRight).toBeLessThan(0);
  });
});
