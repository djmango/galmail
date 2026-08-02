import { expect, type Page } from "@playwright/test";

export async function openMobileInbox(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-mobile", "true");
  await expect(page.getByLabel("Thread list")).toBeVisible();
  await expect(page.locator(".thread")).not.toHaveCount(0);
}

export async function swipeThread(
  page: Page,
  direction: "left" | "right",
  distance: number,
) {
  // Drive the swipe row (pointer handlers live on `.swipe-row`, not `.thread`).
  const row = page.locator(".swipe-row").first();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  if (!box) throw new Error("swipe row bounding box missing");
  const y = box.height / 2;
  const startX = direction === "left" ? box.width * 0.85 : box.width * 0.15;
  const endX =
    direction === "left"
      ? Math.max(8, startX - distance)
      : Math.min(box.width - 8, startX + distance);
  await row.dragTo(row, {
    sourcePosition: { x: startX, y },
    targetPosition: { x: endX, y },
    force: true,
  });
  // Dismiss actions animate out before presentUndoToast runs (~240ms).
  await page.waitForTimeout(400);
}

/** Dispatch a horizontal touch swipe on a target element. */
export async function touchSwipe(
  page: Page,
  target: ReturnType<Page["locator"]>,
  input: { startX: number; endX: number; clientY?: number },
) {
  await target.evaluate(
    (node, args) => {
      const el = node as HTMLElement;
      const y = args.clientY;
      const fire = (type: string, clientX: number) => {
        el.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches:
              type === "touchend"
                ? []
                : [
                    new Touch({
                      identifier: 7,
                      target: el,
                      clientX,
                      clientY: y,
                    }),
                  ],
            changedTouches: [
              new Touch({
                identifier: 7,
                target: el,
                clientX,
                clientY: y,
              }),
            ],
          }),
        );
      };
      fire("touchstart", args.startX);
      fire("touchmove", args.endX);
      fire("touchend", args.endX);
    },
    {
      startX: input.startX,
      endX: input.endX,
      clientY: input.clientY ?? 160,
    },
  );
}

export async function openFirstThread(page: Page) {
  const first = page.locator(".thread").first();
  const subject = (await first.locator(".thread-subject").textContent()) ?? "";
  await first.click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-mobile-surface",
    "thread",
  );
  const reading = page.getByLabel("Reading pane");
  await expect(reading).toBeVisible();
  await expect(
    reading.getByRole("button", { name: /Back to inbox/i }),
  ).toBeVisible();
  await expect(reading.getByText("No thread selected.")).toHaveCount(0);
  await expect
    .poll(async () => {
      const loading = await reading.getByText(/Loading email|Opening/i).count();
      const heading = await reading.locator("h1").count();
      const frame = await reading.locator("iframe.mail-html-frame").count();
      return loading + heading + frame;
    })
    .toBeGreaterThan(0);
  return { reading, subject };
}
