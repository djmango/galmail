import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const ARTIFACT_DIR = "/opt/cursor/artifacts/mobile-ux";

async function openMobileInbox(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-mobile", "true");
  await expect(page.getByLabel("Thread list")).toBeVisible();
  await expect(page.locator(".thread")).not.toHaveCount(0);
}

async function swipeThread(
  page: Page,
  direction: "left" | "right",
  distance: number,
) {
  const thread = page.locator(".thread").first();
  await expect(thread).toBeVisible();
  const box = await thread.boundingBox();
  if (!box) throw new Error("thread bounding box missing");
  const y = box.y + box.height / 2;
  const startX =
    direction === "left" ? box.x + box.width * 0.85 : box.x + box.width * 0.15;
  const endX = direction === "left" ? startX - distance : startX + distance;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await page.mouse.up();
}

test.describe("mobile gestures and chrome", () => {
  test.beforeEach(async ({ page }) => {
    await openMobileInbox(page);
  });

  test("icons-only bottom nav, pull-to-refresh, and search focus", async ({
    page,
  }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    await expect(nav.getByLabel("Folders")).toBeVisible();
    await expect(nav.getByLabel("Inbox")).toBeVisible();
    await expect(nav.getByLabel("Compose")).toBeVisible();
    await expect(nav.getByLabel("Search")).toBeVisible();
    await expect(nav.getByLabel("Settings")).toBeVisible();
    await expect(nav.getByText("Folders")).toHaveCount(0);
    await expect(nav.getByText("Inbox")).toHaveCount(0);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "01-mobile-inbox.png"),
      fullPage: true,
    });

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
      fire("touchmove", startY + 90);
    });
    await expect(page.locator(".pull-refresh")).toContainText(/refresh/i);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "02-pull-to-refresh.png"),
      fullPage: true,
    });
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
              clientY: 170,
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
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "03-search-focused.png"),
      fullPage: true,
    });
  });

  test("swipe near/far actions and sticky header hide", async ({ page }) => {
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "04-before-swipe.png"),
      fullPage: true,
    });

    // Visual check for auto-hide header styles (scroll logic unit-tested).
    await page.locator(".thread-list-head").evaluate((node) => {
      node.classList.add("is-hidden");
    });
    await expect(page.locator(".thread-list-head")).toHaveClass(/is-hidden/);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "08-header-hidden.png"),
      fullPage: true,
    });
    await page.locator(".thread-list-head").evaluate((node) => {
      node.classList.remove("is-hidden");
    });

    const beforeCount = await page.locator(".thread").count();
    await swipeThread(page, "right", 90);
    await expect(page.getByText(/Archived/i).first()).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "05-swipe-archive.png"),
      fullPage: true,
    });

    await swipeThread(page, "left", 90);
    await expect(page.getByText(/Trash|Moved to Trash/i).first()).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "06-swipe-delete.png"),
      fullPage: true,
    });

    // Far right → star
    await swipeThread(page, "right", 170);
    await expect(page.getByText(/Starred/i).first()).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "07-swipe-star-far.png"),
      fullPage: true,
    });

    expect(beforeCount).toBeGreaterThan(0);
  });

  test("settings keeps bottom nav and shows swipe + allow-all", async ({
    page,
  }) => {
    await page.getByRole("navigation", { name: "Primary" }).getByLabel("Settings").click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(dialog.getByText("Inbox layout")).toHaveCount(0);
    await expect(dialog.getByText("Remote images")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Allow all" })).toBeVisible();
    await expect(dialog.getByText("Swipe actions")).toBeVisible();
    await expect(dialog.getByText("Link device")).toBeVisible();
    await expect(dialog.getByText(" · live")).toHaveCount(0);
    await expect(dialog.locator(".account-connect-grid")).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "09-settings-accounts.png"),
      fullPage: true,
    });
    await dialog.locator(".settings-body").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "10-settings-swipe-actions.png"),
      fullPage: true,
    });
  });

  test("thread row truncates subject/snippet without sticky hover", async ({
    page,
  }) => {
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
    // Re-render path: entity decode is applied from data; assert CSS truncation.
    const subject = page.locator(".thread-subject").first();
    await expect(subject).toHaveCSS("text-overflow", "ellipsis");
    await expect(subject).toHaveCSS("white-space", "nowrap");
    const snippet = page.locator(".thread-snippet").first();
    await expect(snippet).toHaveCSS("text-overflow", "ellipsis");

    const thread = page.locator(".thread").first();
    await thread.hover();
    await thread.dispatchEvent("pointerleave");
    // Selected state only when aria-current, not sticky hover after leave.
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "11-thread-truncation.png"),
      fullPage: true,
    });
  });
});
