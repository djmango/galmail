import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Thread list")).toBeVisible();
  await expect(page.locator(".thread")).not.toHaveCount(0);
});

test("keyboard mail and compose flows remain usable", async ({ page }) => {
  const initial = await page
    .locator('.thread[aria-current="true"]')
    .textContent();
  await page.keyboard.press("j");
  await expect
    .poll(() => page.locator('.thread[aria-current="true"]').textContent())
    .not.toBe(initial);

  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Reading pane").getByRole("heading"),
  ).toBeVisible();
  // Enter while reading starts a reply (same as R).
  await page.keyboard.press("Enter");
  const reply = page.getByRole("dialog", { name: "Compose" });
  await expect(reply).toBeVisible();
  await expect(reply.getByPlaceholder("Subject", { exact: true })).toHaveValue(
    /^Re:/,
  );
  // Compose uses Insert → Normal → dismiss, so Esc twice closes the dialog.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Compose" })).toBeHidden();

  await page.keyboard.press("c");
  const compose = page.getByRole("dialog", { name: "Compose" });
  await compose.getByPlaceholder("To").fill("reader@example.com");
  await compose
    .getByPlaceholder("Subject", { exact: true })
    .fill("Deterministic E2E message");
  await compose.getByPlaceholder("Message").fill("Queued while local-first.");
  await compose.locator('button[type="submit"]').click();
  await expect(page.getByText(/send · (?:pending|scheduled)/i)).toBeVisible();
});

test("settings persist and offline navigation stays local", async ({
  context,
  page,
}) => {
  await page
    .getByLabel("Folders")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Light" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "light");

  await context.setOffline(true);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Conversation history")).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByLabel("Thread list")).toBeVisible();
});

test("has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );
  expect(blocking).toEqual([]);
});

test("keyboard feedback meets the local browser budget", async ({ page }) => {
  const samples = await page.evaluate(async () => {
    const values: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const start = performance.now();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: index % 2 ? "k" : "j",
          bubbles: true,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      values.push(performance.now() - start);
    }
    return values.slice(2).sort((a, b) => a - b);
  });
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity;
  expect(p95).toBeLessThan(50);
});
