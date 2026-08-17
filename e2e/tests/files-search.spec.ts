import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  createProduction,
  createStudio,
  trackErrors,
  uniqueEmail,
  uploadOptions,
  PASSWORD,
} from "./helpers";

/**
 * Local hardened replacement for helpers.signUp — that helper has two flake
 * modes under a busy dev server (both observed while building this suite):
 *  1. it clicks "New here? Create an account" before React hydration, the
 *     click is swallowed and the #name field never appears;
 *  2. the sign-up submit itself occasionally hangs with the button stuck
 *     disabled; a reload followed by signing in (or a fresh attempt) recovers.
 */
async function signUpRobust(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await page.locator("#name").isVisible())) {
      await page
        .getByText("New here? Create an account")
        .click({ timeout: 5_000 })
        .catch(() => {});
      const appeared = await page
        .locator("#name")
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) continue;
    }
    await page.fill("#name", name);
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    try {
      await page.waitForURL("**/", { timeout: 25_000 });
      return;
    } catch {
      // Submit hung. Reload; if the account did get created, sign in works.
      await page.reload();
      const signedIn = await page
        .fill("#email", email, { timeout: 5_000 })
        .then(async () => {
          await page.fill("#password", PASSWORD);
          await page.getByRole("button", { name: "Sign in" }).click();
          await page.waitForURL("**/", { timeout: 15_000 });
          return true;
        })
        .catch(() => false);
      if (signedIn) return;
      await page.goto("/sign-in");
    }
  }
  throw new Error(`sign-up for ${email} did not complete`);
}

/**
 * Production Files page (App uploads grouping + unassigned filter) and the
 * global ⌘K search palette (navigate by shot code, type-more hint).
 */

const SHOT = "FS010_SH010";
const PALETTE_PLACEHOLDER = "Search shots, scenes, files…";

test.describe.serial("files & search", () => {
  let context: BrowserContext;
  let page: Page;
  let errors: string[];
  let base: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    context = await browser.newContext();
    page = await context.newPage();
    errors = trackErrors(page);
    await signUpRobust(page, "Fern Filefinder", uniqueEmail("files-owner"));
    await createStudio(page, "Files E2E Studio");
    base = await createProduction(page, "Files E2E Feature");

    // One shot with two uploaded options.
    await page.goto(`${base}/shots`);
    await page.getByRole("button", { name: "Paste codes" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Shot codes").fill(SHOT);
    await dialog.getByRole("button", { name: "Create 1 shot" }).click();
    await page.getByRole("link", { name: SHOT }).click();
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible();
    await uploadOptions(page, 2);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("Files page groups the uploads under App uploads", async () => {
    await page.goto(`${base}/files`);
    await expect(
      page.getByRole("heading", { name: "App uploads" }),
    ).toBeVisible();
    await expect(page.getByText("option-1.png")).toBeVisible();
    await expect(page.getByText("option-2.png")).toBeVisible();
    // Both rows link back to the shot they're attached to.
    await expect(page.getByRole("link", { name: SHOT }).first()).toBeVisible();
  });

  test("unassigned filter shows nothing (uploads are shot-attached)", async () => {
    await page.goto(`${base}/files`);
    await expect(page.getByText("option-1.png")).toBeVisible();
    await page.getByRole("button", { name: "Unassigned" }).click();
    await expect(page.getByText("No files match.")).toBeVisible();
    await expect(page.getByText("option-1.png")).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("option-1.png")).toBeVisible();
  });

  test("searching a single character shows the type-more hint", async () => {
    await page.goto(`${base}/files`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    const input = palette.getByPlaceholder(PALETTE_PLACEHOLDER);
    await expect(input).toBeVisible();
    await input.fill("f");
    await expect(
      palette.getByText("Type at least two characters."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("⌘K search finds the shot code and Enter navigates to it", async () => {
    await page.goto(`${base}/files`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    const input = palette.getByPlaceholder(PALETTE_PLACEHOLDER);
    await input.fill(SHOT);
    await expect(palette.getByText("Shots", { exact: true })).toBeVisible();
    const hit = palette.getByRole("option").filter({ hasText: SHOT });
    await expect(hit).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/shots\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible();
  });

  test("clicking a search result also navigates", async () => {
    await page.goto(`${base}/files`);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await palette.getByPlaceholder(PALETTE_PLACEHOLDER).fill(SHOT);
    const hit = palette.getByRole("option").filter({ hasText: SHOT });
    await expect(hit).toBeVisible();
    await hit.click();
    await page.waitForURL(/\/shots\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible();
  });

  test("no unexpected page errors surfaced during the suite", () => {
    expect(errors).toEqual([]);
  });
});
