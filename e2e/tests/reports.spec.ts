import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createProduction,
  createStudio,
  PASSWORD,
  trackErrors,
  uniqueEmail,
  uploadOptions,
} from "./helpers";

/**
 * Local copy of helpers.signUp — the shared helper clicks the sign-up toggle
 * before hydration can attach its handler, losing the click. Retry until the
 * create-account form appears. (Same issue noted in wizard.spec.ts.)
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

/** Local signUpInvited built on signUpSafe (helpers version uses helpers.signUp). */
async function signUpInvitedSafe(
  browser: Browser,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpSafe(page, name, email);
  return { context, page };
}

/**
 * Local copy of helpers.inviteMember — the shared helper tries
 * `dialog.getByLabel("Role")` first, but the invite dialog's Role <Label> has
 * no htmlFor, so that click waits the full 30s action timeout before its
 * fallback runs, blowing the test timeout. This copy goes straight to the
 * dialog's only combobox.
 */
async function inviteMemberLocal(page: Page, email: string, roleLabel: string) {
  await page.goto("/team");
  await page.getByRole("button", { name: /Invite member/i }).click();
  await page.fill("#invite-email", email);
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('[role="combobox"]').first().click();
  await page.getByRole("option", { name: roleLabel }).click();
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Local copy of helpers.bulkCreateShots — the shared helper opens the
 * "Paste codes" modal but fills the inline empty-state textarea behind the
 * overlay, so its create click times out. See decisions.spec.ts for details.
 */
async function bulkCreateShotsLocal(page: Page, base: string, codes: string[]) {
  await page.goto(`${base}/shots`);
  await page.getByLabel("Shot codes").first().fill(codes.join("\n"));
  await page
    .getByRole("button", { name: /^Create \d+ shots?$/ })
    .first()
    .click();
  await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Daily reports (spec F10).
 *
 * A precisely known day of activity in a fresh production: 2 versions added
 * on one shot, 1 pick (supersedes the other option), 1 gate decided. Then:
 * Generate now → tiles; Publish → frozen + badge; Generate again → error
 * toast; a second member sees the "report published" bell notification.
 *
 * Rejections tile: reports.ts counts activity type "version.rejected".
 * A pick supersedes siblings by patching their status WITHOUT logging a
 * version.rejected activity row (convex/versions.ts pick), so the tile
 * stays 0 for a superseding pick.
 */
test.describe.serial("daily reports", () => {
  let ownerContext: BrowserContext;
  let producerContext: BrowserContext | undefined;
  let page: Page;
  let producerPage: Page;
  let errors: string[] = [];
  let base = "";

  const OWNER = "Rex Reporter";
  const PROD = "Reports Feature E2E";
  const SHOT = "SC010_SH010";
  const producerEmail = uniqueEmail("reports-producer");

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000); // signup can stall when other suites hammer the dev server
    ownerContext = await browser.newContext();
    page = await ownerContext.newPage();
    errors = trackErrors(page);
    await signUpSafe(page, OWNER, uniqueEmail("reports-owner"));
    await createStudio(page, "Report Studio E2E");
  });

  test.afterAll(async () => {
    await producerContext?.close();
    await ownerContext?.close();
  });

  test("build the day: invite producer, decide a gate, add 2 options, pick 1", async ({
    browser,
  }) => {
    test.setTimeout(150_000); // two signups + long build flow on a shared dev server
    base = await createProduction(page, PROD);

    // Second member joins before the publish so the notification reaches them.
    await inviteMemberLocal(page, producerEmail, "Producer");
    ({ context: producerContext, page: producerPage } = await signUpInvitedSafe(
      browser,
      producerEmail,
      "Paula Producer",
    ));

    // Owner as gate approver for Development (Settings), then request+approve.
    await page.goto(`${base}/settings`);
    await page
      .locator("#stages")
      .getByRole("button", { name: "No approvers" })
      .first()
      .click();
    await expect(page.getByText("Gate approvers — Development")).toBeVisible();
    await page
      .locator("label")
      .filter({ hasText: OWNER })
      .locator('[role="checkbox"]')
      .click();
    await expect(
      page
        .locator("label")
        .filter({ hasText: OWNER })
        .locator('[role="checkbox"]'),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.goto(`${base}/board`);
    await page.getByRole("button", { name: "Development menu" }).click();
    await page.getByRole("menuitem", { name: "Request sign-off" }).click();
    await expect(
      page.getByText("Sign-off requested for Development").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Development menu" }).click();
    await page.getByRole("menuitem", { name: /Approve gate/ }).click();
    await page.locator("#gate-note").fill("Gate cleared for launch");
    await page.getByRole("button", { name: "Approve gate" }).click();
    await expect(
      page.getByText("Development gate approved").first(),
    ).toBeVisible();

    // Exactly 2 options on one shot; pick v1 (supersedes v2).
    await bulkCreateShotsLocal(page, base, [SHOT]);
    await page.getByRole("link", { name: SHOT }).click();
    await page.waitForURL(/\/shots\/[a-z0-9]+/);
    const shotId = page.url().match(/\/shots\/([a-z0-9]+)/)![1];
    await uploadOptions(page, 2);

    await page.goto(`${base}/review/${shotId}`);
    await expect(page.getByText("v1").first()).toBeVisible();
    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pick this version" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pick this version" }).click();
    await expect(page.getByText("v1 picked").first()).toBeVisible();
    await page.waitForURL(new RegExp(`${base}/review$`));
  });

  test("Generate now compiles accurate tiles", async () => {
    await page.goto(`${base}/reports`);
    await page.getByRole("button", { name: "Generate now" }).first().click();
    await expect(
      page.getByText("Report generated for today").first(),
    ).toBeVisible();

    const tileValue = (label: string) =>
      page
        .getByText(label, { exact: true })
        .locator("xpath=preceding-sibling::div[1]");

    await expect(tileValue("Versions added")).toHaveText("2");
    await expect(tileValue("Picks")).toHaveText("1");
    await expect(tileValue("Gates decided")).toHaveText("1");
    // Superseded rejections log no version.rejected activity → tile stays 0.
    await expect(tileValue("Rejections")).toHaveText("0");
  });

  test("Publish freezes the report and shows the published badge", async () => {
    await page.getByRole("button", { name: "Publish report" }).click();
    await expect(
      page.getByText("Report published — the team has been notified").first(),
    ).toBeVisible();
    await expect(page.getByText(`Published by ${OWNER}`)).toBeVisible();
    await expect(page.getByText("Published reports are frozen")).toBeVisible();
  });

  test("Generate now again errors: report is frozen", async () => {
    await page.getByRole("button", { name: "Generate now" }).first().click();
    await expect(
      page
        .getByText("Today's report is already published and frozen")
        .first(),
    ).toBeVisible();
  });

  test("invited producer gets the report-published bell notification", async () => {
    await producerPage
      .getByRole("button", { name: "Notifications" })
      .click();
    await expect(
      producerPage.getByText(`Daily report published — ${PROD}`).first(),
    ).toBeVisible();

    const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
    expect(pageErrors).toEqual([]);
  });
});
