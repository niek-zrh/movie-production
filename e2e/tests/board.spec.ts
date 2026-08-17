import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  createProduction,
  createStudio,
  signIn,
  signUp,
  trackErrors,
  uniqueEmail,
} from "./helpers";

/**
 * signUp with a fallback: under parallel-agent load the auth roundtrip can
 * outlive the shared helper's 20s wait even though the account was created.
 * Wait a little longer, then fall back to signing in.
 */
async function signUpResilient(page: Page, name: string, email: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await signUp(page, name, email);
      return;
    } catch {
      // Mid-compile chunk errors or stalled navigations can break an
      // attempt while other agents hammer the same dev server. Check
      // whether the account actually landed, otherwise retry.
    }
    const landed = await page
      .waitForURL("**/", { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
    await page
      .goto("/", { waitUntil: "domcontentloaded" })
      .catch(() => undefined);
    // Authenticated users bounce off /sign-in; anywhere else means success.
    if (!new URL(page.url()).pathname.startsWith("/sign-in")) return;
    try {
      await signIn(page, email);
      return;
    } catch {
      // Account presumably never got created — loop for a fresh sign-up.
    }
  }
  throw new Error(`could not sign up ${email}`);
}

/**
 * createProduction with a fallback: the shared helper's final waitForURL can
 * expire while the client-side navigation is still in flight under load.
 */
async function createProductionResilient(
  page: Page,
  name: string,
): Promise<string> {
  try {
    return await createProduction(page, name);
  } catch {
    // The wizard usually completed — recover the base path from the URL.
  }
  await page.waitForURL(/\/p\/[a-z0-9]+/, { timeout: 120_000 });
  return new URL(page.url()).pathname.match(/^\/p\/[a-z0-9]+/)![0];
}

/**
 * Local fix for helpers.bulkCreateShots: the shared helper fills the first
 * textarea on the page, which races the empty-state inline form against the
 * "Paste codes" dialog (both match). Scope everything to the open dialog.
 */
async function bulkCreateShotsSafe(page: Page, base: string, codes: string[]) {
  await page.goto(`${base}/shots`);
  const openButton = page.getByRole("button", { name: "Paste codes" });
  try {
    await openButton.waitFor({ timeout: 30_000 });
  } catch {
    await page.reload(); // recover from a mid-compile chunk error
    await openButton.waitFor({ timeout: 30_000 });
  }
  await openButton.click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole("textbox", { name: "Shot codes" }).fill(codes.join("\n"));
  await dialog
    .getByRole("button", { name: new RegExp(`^Create ${codes.length} shots?$`) })
    .click();
  // Wait for the modal to fully close so its overlay can't swallow clicks.
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Board: six fixed stage columns, native HTML5 drag between stages,
 * and the stage-gate sign-off flow (request → reject-with-note → approve).
 */

test.describe.configure({ mode: "serial" });

const COLUMN_LABELS = [
  "Development",
  "Pre-Production",
  "Previews & Review",
  "Production",
  "Post-Production",
  "Final Edit & Delivery",
] as const;

const CODES = ["SC010_SH010", "SC010_SH020", "SC010_SH030"];

let context: BrowserContext;
let page: Page;
let errors: string[];
let base: string;

const OWNER_NAME = "Board Owner";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  context = await browser.newContext();
  page = await context.newPage();
  errors = trackErrors(page);
  await signUpResilient(page, OWNER_NAME, uniqueEmail("board-owner"));
  await createStudio(page, "Board Studio");
  base = await createProductionResilient(page, "Board Feature");
  await bulkCreateShotsSafe(page, base, CODES);
});

test.afterAll(async () => {
  await context?.close();
});

function column(name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/**
 * Native HTML5 drag-and-drop. Playwright's dragTo drives real input events
 * (works for HTML5 dnd in Chromium); if the card did not move we fall back to
 * dispatching DragEvents with a shared DataTransfer, which exercises the same
 * app handlers (dragstart sets application/x-slate-shot, drop reads it).
 */
async function dragCardToColumn(card: Locator, target: Locator, code: string) {
  await card.dragTo(target).catch(() => undefined);
  await page.waitForTimeout(500);
  const moved = await target.getByText(code, { exact: true }).count();
  if (moved > 0) return;

  const src = await card.elementHandle();
  const tgt = await target.elementHandle();
  if (!src || !tgt) throw new Error("drag: element handles not available");
  await page.evaluate(
    ([source, dest]) => {
      const dt = new DataTransfer();
      const rect = dest.getBoundingClientRect();
      const at = {
        clientX: Math.floor(rect.x + rect.width / 2),
        clientY: Math.floor(rect.y + rect.height / 2),
      };
      const opts = { bubbles: true, cancelable: true, composed: true };
      source.dispatchEvent(
        new DragEvent("dragstart", { ...opts, dataTransfer: dt }),
      );
      dest.dispatchEvent(
        new DragEvent("dragenter", { ...opts, dataTransfer: dt, ...at }),
      );
      dest.dispatchEvent(
        new DragEvent("dragover", { ...opts, dataTransfer: dt, ...at }),
      );
      dest.dispatchEvent(
        new DragEvent("drop", { ...opts, dataTransfer: dt, ...at }),
      );
      source.dispatchEvent(
        new DragEvent("dragend", { ...opts, dataTransfer: dt }),
      );
    },
    [src, tgt] as const,
  );
}

test("renders the six fixed stage columns with every shot in Production", async () => {
  await page.goto(`${base}/board`);
  for (const label of COLUMN_LABELS) {
    await expect(column(label)).toBeVisible({ timeout: 15_000 });
  }
  // All three shots land in the Production column by default.
  const production = column("Production");
  for (const code of CODES) {
    await expect(production.getByText(code, { exact: true })).toBeVisible();
  }
  // The other five columns are empty.
  for (const label of COLUMN_LABELS) {
    if (label === "Production") continue;
    await expect(
      column(label).getByText("No shots in this stage"),
    ).toBeVisible();
  }
});

test("dragging a card from Production to Post-Production persists across reload", async () => {
  await page.goto(`${base}/board`);
  const production = column("Production");
  const post = column("Post-Production");
  await expect(
    production.getByText(CODES[0], { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  const card = production
    .locator("a")
    .filter({ hasText: CODES[0] })
    .first();
  await dragCardToColumn(card, post, CODES[0]);

  // Optimistic move lands the card in Post immediately.
  await expect(post.getByText(CODES[0], { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    production.getByText(CODES[0], { exact: true }),
  ).toHaveCount(0);

  // Server persisted it — the move survives a full reload.
  await page.reload();
  await expect(
    column("Post-Production").getByText(CODES[0], { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    column("Production").getByText(CODES[0], { exact: true }),
  ).toHaveCount(0);
});

test("gate flow: request sign-off, reject requires a note, approve marks stage done", async () => {
  test.setTimeout(120_000);

  // --- Settings: make the owner a Development gate approver -----------------
  await page.goto(`${base}/settings`);
  const stages = page.locator("#stages");
  await expect(stages.getByText("Stages & gates")).toBeVisible({
    timeout: 15_000,
  });
  // Rows are in stage order — the first "No approvers" trigger is Development.
  await stages.getByRole("button", { name: "No approvers" }).first().click();
  await expect(
    page.getByText("Gate approvers — Development"),
  ).toBeVisible();
  // Only member with an account is the owner; tick them.
  await page.getByRole("checkbox").first().click();
  await expect(
    stages.getByText(OWNER_NAME, { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  // --- Board: request sign-off ---------------------------------------------
  await page.goto(`${base}/board`);
  const dev = column("Development");
  await expect(dev).toBeVisible({ timeout: 15_000 });
  await expect(dev.getByText("Gate open")).toBeVisible();

  await dev.getByRole("button", { name: "Development menu" }).click();
  await page.getByRole("menuitem", { name: "Request sign-off" }).click();
  await expect(dev.getByText("Gate requested")).toBeVisible({
    timeout: 10_000,
  });

  // --- Reject: confirm disabled until a note is typed ----------------------
  await dev.getByRole("button", { name: "Development menu" }).click();
  await page.getByRole("menuitem", { name: /Reject gate/ }).click();
  const rejectDialog = page.getByRole("dialog");
  await expect(
    rejectDialog.getByText("Reject gate — Development"),
  ).toBeVisible();
  const rejectButton = rejectDialog.getByRole("button", {
    name: "Reject gate",
  });
  await expect(rejectButton).toBeDisabled();
  await rejectDialog.locator("#gate-note").fill("Opening beat needs work");
  await expect(rejectButton).toBeEnabled();
  await rejectButton.click();
  await expect(dev.getByText("Gate rejected")).toBeVisible({
    timeout: 10_000,
  });

  // --- Request again, then approve (note optional) -------------------------
  await dev.getByRole("button", { name: "Development menu" }).click();
  await page.getByRole("menuitem", { name: "Request sign-off" }).click();
  await expect(dev.getByText("Gate requested")).toBeVisible({
    timeout: 10_000,
  });

  await dev.getByRole("button", { name: "Development menu" }).click();
  await page.getByRole("menuitem", { name: /Approve gate/ }).click();
  const approveDialog = page.getByRole("dialog");
  await expect(
    approveDialog.getByText("Approve gate — Development"),
  ).toBeVisible();
  // Note stays empty — it is optional for an approval.
  await approveDialog.getByRole("button", { name: "Approve gate" }).click();
  await expect(dev.getByText("Gate approved")).toBeVisible({
    timeout: 10_000,
  });
  // Approving the gate also completes the stage.
  await expect(dev.getByText("Done", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

test("no unexpected page errors during the board flows", () => {
  expect(errors).toEqual([]);
});
