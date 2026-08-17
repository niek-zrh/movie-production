import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createProduction,
  createStudio,
  PASSWORD,
  trackErrors,
  uniqueEmail,
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

/**
 * Delivery QC (spec F11).
 *
 * Seed the standard template (25 checks), add a custom required Audio
 * parameter, run a QC checklist through failed → in progress → passed,
 * verify the N/A tri-state keeps required checks from passing (+ tooltip),
 * and confirm the Delivery approval lands in the Decisions ledger.
 */

/** Default-template parameters with required=true (convex/qc.ts). */
const REQUIRED_DEFAULTS = [
  "Container",
  "Filename convention",
  "MD5 checksum delivered",
  "Start timecode",
  "Head: black before program",
  "Duration matches slate",
  "Codec",
  "Resolution",
  "Frame rate",
  "Scan",
  "Color space",
  "Video bitrate",
  "No dropped/frozen frames",
  "No visible upscaling artifacts",
  "Loudness (EBU R128)",
  "True peak",
  "Sample rate",
  "Bit depth",
  "Channel layout",
  "A/V sync",
  "No clipping/dropouts",
  "Slate info correct",
  "Language/version tag",
];

const CUSTOM_CHECK = "Dialogue stems delivered";
const RUN_NAME = "EP01 Master QC";

test.describe.serial("delivery QC", () => {
  let context: BrowserContext;
  let page: Page;
  let errors: string[] = [];
  let base = "";

  const checkRow = (name: string) =>
    page.locator("li").filter({ has: page.getByText(name, { exact: true }) });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000); // signup + production creation on a shared dev server
    context = await browser.newContext();
    page = await context.newPage();
    errors = trackErrors(page);
    await signUpSafe(page, "Quinn Qc", uniqueEmail("qc-owner"));
    await createStudio(page, "QC Studio E2E");
    base = await createProduction(page, "QC Feature E2E");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("seeding the standard template yields 25 checks", async () => {
    await page.goto(`${base}/qc`);
    await page
      .getByRole("button", { name: /Seed the standard TV-delivery template/ })
      .click();
    await expect(page.getByText("25 checks")).toBeVisible();
  });

  test("a custom required Audio parameter appears in the template", async () => {
    // Section collapses once seeded — expand it to reach "Add check".
    await page.getByRole("button", { name: /QC template/ }).click();
    await page.getByRole("button", { name: "Add check" }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(
      dialog.getByRole("heading", { name: "Add a QC check" }),
    ).toBeVisible();
    await dialog.locator('[role="combobox"]').click();
    await page.getByRole("option", { name: "Audio" }).click();
    await dialog.locator("#qc-param-name").fill(CUSTOM_CHECK);
    await dialog.locator("#qc-param-spec").fill("Stems folder present");
    // "Required" checkbox defaults to checked — leave it.
    await expect(dialog.locator('[role="checkbox"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await dialog.getByRole("button", { name: "Add check" }).click();

    await expect(page.getByText("26 checks")).toBeVisible();
    await expect(
      page.locator('h3:has-text("Audio") + ul').getByText(CUSTOM_CHECK),
    ).toBeVisible();
  });

  test("New QC run opens the run page with all checks pending", async () => {
    await page.getByRole("button", { name: "New QC run" }).first().click();
    await page.locator("#qc-run-name").fill(RUN_NAME);
    await page.getByRole("button", { name: "Start QC run" }).click();
    await page.waitForURL(/\/qc\/[a-z0-9]+$/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: RUN_NAME })).toBeVisible();
    await expect(page.getByText("QC in progress")).toBeVisible();
    await expect(page.getByText("0/26 checked")).toBeVisible();

    // Owner has the full tri-state controls on every row.
    const firstRow = checkRow("Codec");
    await expect(
      firstRow.getByRole("button", { name: "Pass", exact: true }),
    ).toBeVisible();
    await expect(
      firstRow.getByRole("button", { name: "Fail", exact: true }),
    ).toBeVisible();
    await expect(firstRow.getByRole("button", { name: "N/A" })).toBeVisible();
  });

  test("failing a required check fails the run; passing it clears the banner", async () => {
    const loudness = checkRow("Loudness (EBU R128)");
    await loudness.getByRole("button", { name: "Fail", exact: true }).click();

    await expect(
      page.getByText("Master failed QC — fix and re-check"),
    ).toBeVisible();
    await expect(page.getByText("1 required check failing")).toBeVisible();

    // Note field appears once failing; save on blur.
    const note = page.getByLabel("Failure note for Loudness (EBU R128)");
    await note.fill("Measured -18 LUFS, too hot");
    await note.blur();

    await loudness.getByRole("button", { name: "Pass", exact: true }).click();
    // Other required checks still pending → back to in progress, not passed.
    await expect(page.getByText("QC in progress")).toBeVisible();
  });

  test("passing every required check turns the banner to passed", async () => {
    for (const name of REQUIRED_DEFAULTS) {
      if (name === "Loudness (EBU R128)") continue; // already passed
      await checkRow(name)
        .getByRole("button", { name: "Pass", exact: true })
        .click();
    }
    await checkRow(CUSTOM_CHECK)
      .getByRole("button", { name: "Pass", exact: true })
      .click();

    await expect(page.getByText("Passed — ready for delivery")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("24/26 checked")).toBeVisible();
  });

  test("a required check on N/A keeps the run from passing (tri-state + tooltip)", async () => {
    const sampleRate = checkRow("Sample rate");
    const naButton = sampleRate.getByRole("button", { name: "N/A" });

    await naButton.click();
    await expect(page.getByText("QC in progress")).toBeVisible();
    await expect(page.getByText("Passed — ready for delivery")).toHaveCount(0);
    // N/A still counts as checked — the run just can't pass.
    await expect(page.getByText("24/26 checked")).toBeVisible();

    await naButton.hover();
    await expect(
      page.getByText("Required — N/A keeps the run open"),
    ).toBeVisible();

    // Tri-state: clicking the active state again resets the check to pending.
    await naButton.click();
    await expect(page.getByText("23/26 checked")).toBeVisible();
    await expect(page.getByText("QC in progress")).toBeVisible();

    await sampleRate.getByRole("button", { name: "Pass", exact: true }).click();
    await expect(page.getByText("Passed — ready for delivery")).toBeVisible();
    await expect(page.getByText("24/26 checked")).toBeVisible();
  });

  test("the pass lands as an approved Delivery row in Decisions", async () => {
    await page.goto(`${base}/decisions`);
    const approvedDelivery = page
      .getByRole("row")
      .filter({ hasText: `QC: ${RUN_NAME}` })
      .filter({ hasText: "Approved" });
    await expect(approvedDelivery.first()).toBeVisible();
    await expect(
      approvedDelivery.first().getByText("Delivery", { exact: true }),
    ).toBeVisible();

    const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
    expect(pageErrors).toEqual([]);
  });
});
