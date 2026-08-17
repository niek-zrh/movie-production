import { readFile } from "node:fs/promises";
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

/**
 * Local copy of helpers.bulkCreateShots: the shared helper opens the
 * "Paste codes" modal, then fills `textarea.first()` — which resolves to the
 * inline empty-state form BEHIND the modal overlay, so the modal's create
 * button stays disabled and the click times out. This copy uses the inline
 * empty-state form directly (fresh productions always show it).
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
 * Decisions ledger (spec F9).
 *
 * Builds one pick (review room) + one decided gate (approver = owner set in
 * Settings, approved with a note on the Decisions page), then verifies the
 * ledger rows, the scope filter chips and the CSV export.
 */
test.describe.serial("decisions ledger", () => {
  let context: BrowserContext;
  let page: Page;
  let errors: string[] = [];
  let base = "";

  const OWNER = "Dana Decider";
  const PROD = "Decisions Feature E2E";
  const SHOT = "SC010_SH010";
  const GATE_NOTE = "Ship it, story locked";
  const PICK_NOTE = "Best composition of the two";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000); // signup can stall when other suites hammer the dev server
    context = await browser.newContext();
    page = await context.newPage();
    errors = trackErrors(page);
    await signUpSafe(page, OWNER, uniqueEmail("decisions-owner"));
    await createStudio(page, "Decision Studio E2E");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("build state: approve a gate (owner as approver) and pick a version", async () => {
    test.setTimeout(120_000); // long build flow; shared dev server can be slow under load
    base = await createProduction(page, PROD);

    // Owner becomes gate approver for Development via Settings.
    await page.goto(`${base}/settings`);
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
    await expect(page.locator("#stages").getByText(OWNER).first()).toBeVisible();

    // Request sign-off from the board.
    await page.goto(`${base}/board`);
    await page.getByRole("button", { name: "Development menu" }).click();
    await page.getByRole("menuitem", { name: "Request sign-off" }).click();
    await expect(
      page.getByText("Sign-off requested for Development").first(),
    ).toBeVisible();

    // Approve with a note from the Decisions page ("Needs your decision").
    await page.goto(`${base}/decisions`);
    await expect(page.getByText("Needs your decision")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByLabel("Note (optional)").fill(GATE_NOTE);
    await page.getByRole("button", { name: "Approve gate" }).click();
    await expect(page.getByText("Gate approved").first()).toBeVisible();

    // One shot, two options, pick v1 in the review room.
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
    await page.getByPlaceholder("Why this one? (optional)").fill(PICK_NOTE);
    await page.getByRole("button", { name: "Pick this version" }).click();
    await expect(page.getByText("v1 picked").first()).toBeVisible();
    await page.waitForURL(new RegExp(`${base}/review$`));
  });

  test("ledger shows the Pick and Gate rows with actor and notes", async () => {
    await page.goto(`${base}/decisions`);

    const gateRow = page
      .getByRole("row")
      .filter({ hasText: "Gate: Development" });
    await expect(gateRow).toHaveCount(1);
    await expect(gateRow.getByText("Gate", { exact: true })).toBeVisible();
    await expect(gateRow.getByText("Approved")).toBeVisible();
    await expect(gateRow.getByText(OWNER)).toBeVisible();
    await expect(gateRow.getByText(GATE_NOTE)).toBeVisible();

    const pickRow = page.getByRole("row").filter({ hasText: SHOT });
    await expect(pickRow).toHaveCount(1);
    await expect(pickRow.getByText("Pick", { exact: true })).toBeVisible();
    await expect(pickRow.getByText("Approved")).toBeVisible();
    await expect(pickRow.getByText(OWNER)).toBeVisible();
    await expect(pickRow.getByText(PICK_NOTE)).toBeVisible();
  });

  test("scope filter chips narrow the ledger (Gates → only gate rows)", async () => {
    await page.goto(`${base}/decisions`);
    await expect(page.locator("tbody tr")).toHaveCount(2);

    await page.getByRole("button", { name: "Gates" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.locator("tbody").getByText("Gate: Development"),
    ).toBeVisible();
    await expect(page.locator("tbody").getByText(SHOT)).toHaveCount(0);

    // Picks chip shows only the pick.
    await page.getByRole("button", { name: "Picks" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody").getByText(SHOT)).toBeVisible();

    await page.getByRole("button", { name: "All" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
  });

  test("CSV export downloads {code}-decisions.csv with header + data rows", async () => {
    await page.goto(`${base}/decisions`);
    await expect(page.locator("tbody tr")).toHaveCount(2);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/-decisions\.csv$/);

    const filePath = await download.path();
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "decidedAt,scope,target,status,requestedBy,approver,note",
    );
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + pick + gate
    expect(content).toContain(SHOT);
    expect(content).toContain("Gate: Development");

    const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
    expect(pageErrors).toEqual([]);
  });
});
