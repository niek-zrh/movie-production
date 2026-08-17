import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createStudio, PASSWORD, trackErrors, uniqueEmail } from "./helpers";

/**
 * Local copy of helpers.signUp — the shared helper clicks the
 * "New here? Create an account" toggle immediately after goto; before React
 * hydration finishes the click is lost and the spec dies on #name. Retry the
 * toggle until the create-account form actually appears.
 */
async function signUpSafe(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  await expect(async () => {
    await page.getByText("New here? Create an account").click();
    await expect(page.locator("#name")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 45_000 });
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 45_000 });
}

/**
 * Production wizard + production settings.
 *
 * - Full wizard run: episodic kind with 2 episodes, code auto-suggestion,
 *   budget-sheet link in step 3 → Overview quick-links shows it.
 * - Settings: rename (rail updates), status paused/active round-trip,
 *   add + remove an external link, gate approvers (avatars in the row).
 */
test.describe.serial("production wizard + settings", () => {
  let context: BrowserContext;
  let page: Page;
  let errors: string[] = [];
  let base = "";

  const OWNER = "Wanda Wizard";
  const PROD_NAME = "Northern Lights E2E";
  const RENAMED = "Northern Lights Renamed";
  const BUDGET_URL = "https://docs.google.com/spreadsheets/d/slate-e2e-budget";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000); // signup can stall when other suites hammer the dev server
    context = await browser.newContext();
    page = await context.newPage();
    errors = trackErrors(page);
    await signUpSafe(page, OWNER, uniqueEmail("wizard-owner"));
    await createStudio(page, "Wizard Studio E2E");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("wizard creates an episodic production; budget link lands in quick links", async () => {
    await page.goto("/new");
    await expect(
      page.getByRole("heading", { name: "New production" }),
    ).toBeVisible();

    // Step 1 — code auto-suggestion: initials, uppercase, visible in the field.
    await page.locator("#prod-name").fill(PROD_NAME);
    await expect(page.locator("#prod-code")).toHaveValue("NLE");

    await page.getByRole("button", { name: "Episodic" }).click();
    await page.locator("#prod-episodes").fill("2");
    await page.getByRole("button", { name: "Create & continue" }).click();

    // Step 2 — Drive; skip.
    await page.getByRole("button", { name: "Skip for now" }).click();

    // Step 3 — add the budget sheet URL explicitly, then finish.
    await page.locator("#link-sheet").fill(BUDGET_URL);
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Added" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open production" }).click();

    await page.waitForURL(/\/p\/[a-z0-9]+/, { timeout: 15_000 });
    base = new URL(page.url()).pathname.match(/^\/p\/[a-z0-9]+/)![0];

    // Production opened: Overview renders, rail shows name + episodic marker.
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.locator("aside").getByText(PROD_NAME)).toBeVisible();
    await expect(page.locator("aside").getByText("NLE · Series")).toBeVisible();

    // Quick links card shows the budget sheet added in step 3.
    const quickLink = page.getByRole("link", { name: "Budget sheet" });
    await expect(quickLink).toBeVisible();
    await expect(quickLink).toHaveAttribute("href", BUDGET_URL);
  });

  test("settings: renaming the production updates the rail", async () => {
    await page.goto(`${base}/settings`);
    // Episodic details from the wizard round-tripped.
    await expect(page.getByText("Series · 2 episodes")).toBeVisible();

    const nameInput = page.locator("#prod-name");
    await expect(nameInput).toHaveValue(PROD_NAME);
    await nameInput.fill(RENAMED);
    await nameInput.blur();

    await expect(page.locator("aside").getByText(RENAMED)).toBeVisible();
  });

  test("settings: status can be paused and set back to active", async () => {
    await page.goto(`${base}/settings`);
    const statusSelect = page.locator('#details [role="combobox"]').first();
    await expect(statusSelect).toContainText(/active/i);

    await statusSelect.click();
    await page.getByRole("option", { name: "paused" }).click();
    await expect(statusSelect).toContainText(/paused/i);

    // Persisted server-side, not just local state.
    await page.reload();
    const statusAfterReload = page.locator('#details [role="combobox"]').first();
    await expect(statusAfterReload).toContainText(/paused/i);

    await statusAfterReload.click();
    await page.getByRole("option", { name: "active" }).click();
    await expect(statusAfterReload).toContainText(/active/i);
  });

  test("settings: add and remove an external link", async () => {
    await page.goto(`${base}/settings`);
    await page.getByRole("button", { name: "Add link" }).click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#link-title").fill("Test Miro Board");
    await dialog.locator("#link-url").fill("https://miro.com/app/board/e2e");
    await dialog.getByRole("button", { name: "Add link" }).click();

    // Row appears in the links table (URL cell carries an aria-label).
    await expect(page.getByLabel("Open Test Miro Board")).toBeVisible();

    const row = page
      .getByRole("row")
      .filter({ has: page.getByLabel("Open Test Miro Board") });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByLabel("Open Test Miro Board")).toHaveCount(0);

    // The wizard's budget-sheet link is untouched.
    await expect(page.getByLabel("Open Budget sheet")).toBeVisible();
  });

  test("settings: gate approvers show avatars in the stage row", async () => {
    await page.goto(`${base}/settings`);

    // First stage row (Development) has no approvers yet.
    await page
      .locator("#stages")
      .getByRole("button", { name: "No approvers" })
      .first()
      .click();
    await expect(page.getByText("Gate approvers — Development")).toBeVisible();

    const checkbox = page.locator('[role="checkbox"]').first();
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Gate approvers — Development")).toHaveCount(0);

    // The stage row now previews the approver: avatar initials + name.
    await expect(
      page.locator("#stages").getByText(OWNER).first(),
    ).toBeVisible();
    await expect(
      page.locator("#stages").getByText("WW", { exact: true }).first(),
    ).toBeVisible();

    const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
    expect(pageErrors).toEqual([]);
  });
});
