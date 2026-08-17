import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createProduction,
  createStudio,
  signIn,
  signUp,
  trackErrors,
  uniqueEmail,
  uploadOptions,
} from "./helpers";

/**
 * Convex live-query propagation between two members of the same studio:
 * an upload, a pick and a status change made by one member appear for the
 * other WITHOUT any reload.
 */

test.describe.configure({ mode: "serial" });

const SHOT_CODE = "SC010_SH010";
const LIVE_TIMEOUT = 30_000; // generous — covers websocket round-trips

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQowMTAwMAAAJgYBLZ01WQAAAABJRU5ErkJggg==";

let contextA: BrowserContext; // studio owner
let contextB: BrowserContext; // invited producer
let pageA: Page;
let pageB: Page;
let errorsA: string[];
let errorsB: string[];
let base: string;
let shotUrl: string;
let roomUrl: string;

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
 * Local fix for helpers.inviteMember: its dialog.getByLabel("Role") matches
 * nothing (the Label has no htmlFor), and with no actionTimeout configured the
 * click waits until the hook timeout, so its .catch() fallback never runs.
 * Target the dialog's Role combobox directly.
 */
async function inviteMemberSafe(page: Page, email: string, roleLabel: string) {
  await page.goto("/team");
  await page.getByRole("button", { name: /Invite member/i }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("#invite-email").fill(email);
  await dialog.locator('[role="combobox"]').first().click();
  await page.getByRole("option", { name: roleLabel }).click();
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
}

/** Filmstrip tile in the review room of the given page. */
function tile(page: Page, index: number, state: string) {
  return page.locator(`button[title="v${index} — ${state}"]`);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);

  // A — the studio owner, with a production and a shot carrying 2 options.
  contextA = await browser.newContext();
  pageA = await contextA.newPage();
  errorsA = trackErrors(pageA);
  await signUpResilient(pageA, "Realtime Owner", uniqueEmail("rt-owner"));
  await createStudio(pageA, "Realtime Studio");
  base = await createProductionResilient(pageA, "Realtime Feature");
  await bulkCreateShotsSafe(pageA, base, [SHOT_CODE]);
  // Navigate by href — a click's client-side navigation can stall under
  // parallel-agent dev-server load.
  const shotHref = await pageA
    .getByRole("link", { name: SHOT_CODE })
    .getAttribute("href");
  if (!shotHref) throw new Error("shot link missing");
  shotUrl = shotHref;
  roomUrl = `${base}/review/${shotUrl.split("/").pop()!}`;
  await pageA.goto(shotUrl);
  await uploadOptions(pageA, 2);

  // B — an invited producer in the same studio, second browser context.
  const producerEmail = uniqueEmail("rt-producer");
  await inviteMemberSafe(pageA, producerEmail, "Producer");
  contextB = await browser.newContext();
  pageB = await contextB.newPage();
  errorsB = trackErrors(pageB);
  await signUpResilient(pageB, "Rita Producer", producerEmail);
});

test.afterAll(async () => {
  await contextA?.close();
  await contextB?.close();
});

// Two live sessions against a shared dev server — give every step headroom.
test.beforeEach(() => {
  test.slow();
});

test("an option uploaded by B appears on A's open shot page without reload", async () => {
  await pageA.goto(shotUrl);
  await expect(pageA.getByText(/^v2 · /)).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByText(/^v3 · /)).toHaveCount(0);

  // B uploads a third option from their own session.
  await pageB.goto(shotUrl);
  await pageB.locator('input[type="file"]').first().setInputFiles({
    name: "option-3.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG, "base64"),
  });
  await expect(pageB.getByText(/^v3 · /)).toBeVisible({ timeout: 30_000 });

  // A sees v3 arrive live — no reload, no navigation.
  await expect(pageA.getByText(/^v3 · /)).toBeVisible({
    timeout: LIVE_TIMEOUT,
  });
});

test("a pick made by B updates A's open review room without reload", async () => {
  await pageA.goto(roomUrl);
  await expect(tile(pageA, 1, "Candidate")).toBeVisible({ timeout: 15_000 });
  await expect(tile(pageA, 3, "Candidate")).toBeVisible();

  // B picks v1 from their own review room (focus starts on v1).
  await pageB.goto(roomUrl);
  await expect(tile(pageB, 1, "Candidate")).toBeVisible({ timeout: 15_000 });
  await pageB.keyboard.press("p");
  const dialog = pageB.locator('[role="dialog"]');
  await expect(
    dialog.getByRole("button", { name: "Pick this version" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Pick this version" }).click();
  await pageB.waitForURL(new RegExp(`${base}/review$`), { timeout: 30_000 });

  // A's filmstrip reflects the decision live: v1 picked, the rest rejected.
  await expect(tile(pageA, 1, "Picked")).toBeVisible({ timeout: LIVE_TIMEOUT });
  await expect(tile(pageA, 2, "Rejected")).toBeVisible();
  await expect(tile(pageA, 3, "Rejected")).toBeVisible();
});

test("a status change by B on the shots table updates A's board live", async () => {
  await pageA.goto(`${base}/board`);
  const productionColumn = pageA.getByRole("region", {
    name: "Production",
    exact: true,
  });
  await expect(
    productionColumn.getByText(SHOT_CODE, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  // The card still shows the status B's pick produced.
  await expect(productionColumn.getByText("Picked")).toBeVisible();

  // B flips the shot to Rework from the shots table.
  await pageB.goto(`${base}/shots`);
  await pageB.getByLabel(`Change status of ${SHOT_CODE}`).click();
  await pageB.getByRole("option", { name: "Rework" }).click();
  await expect(
    pageB.getByLabel(`Change status of ${SHOT_CODE}`),
  ).toContainText("Rework", { timeout: 15_000 });

  // A's board card updates live — no reload.
  await expect(productionColumn.getByText("Rework")).toBeVisible({
    timeout: LIVE_TIMEOUT,
  });
  await expect(productionColumn.getByText("Picked")).toHaveCount(0);
});

test("no unexpected page errors in either session", () => {
  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});
