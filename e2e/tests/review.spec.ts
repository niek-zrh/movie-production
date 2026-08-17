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
 * Review queue + Review Room: keyboard-first compare, shortlist, reject,
 * pick (with the canonical Approved/ filename), the pick-status guard once
 * a shot is approved, and Esc back to the queue.
 */

test.describe.configure({ mode: "serial" });

const SHOT_CODE = "SC010_SH010";

let context: BrowserContext;
let page: Page;
let errors: string[];
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

/** Filmstrip tile for a version in a given state, e.g. tile(2, "Shortlisted"). */
function tile(index: number, state: string) {
  return page.locator(`button[title="v${index} — ${state}"]`);
}

/** Pane headers in the compare canvas (one per pane, in order). */
function paneHeaders() {
  return page.locator("div.z-10 > span.font-mono");
}

/** The right rail's focused-version header, e.g. "v2". */
function railVersion() {
  return page.locator("aside span.font-mono").first();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  context = await browser.newContext();
  page = await context.newPage();
  errors = trackErrors(page);
  await signUpResilient(page, "Review Owner", uniqueEmail("review-owner"));
  await createStudio(page, "Review Studio");
  base = await createProductionResilient(page, "Review Feature");
  await bulkCreateShotsSafe(page, base, [SHOT_CODE]);
  // Navigate by href — a click's client-side navigation can stall under
  // parallel-agent dev-server load.
  const shotHref = await page
    .getByRole("link", { name: SHOT_CODE })
    .getAttribute("href");
  if (!shotHref) throw new Error("shot link missing");
  shotUrl = shotHref;
  roomUrl = `${base}/review/${shotUrl.split("/").pop()!}`;
  await page.goto(shotUrl);
  await uploadOptions(page, 4);
});

test.afterAll(async () => {
  await context?.close();
});

test("queue lists the shot; the room shows filmstrip v1–v4", async () => {
  await page.goto(`${base}/review`);
  const card = page.getByRole("link", { name: new RegExp(SHOT_CODE) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("4 options")).toBeVisible();
  await card.click();
  await page.waitForURL(new RegExp(`${roomUrl}$`), { timeout: 15_000 });
  for (const i of [1, 2, 3, 4]) {
    await expect(tile(i, "Candidate")).toBeVisible({ timeout: 15_000 });
  }
});

test("2 shows two panes; ArrowRight moves focus", async () => {
  await page.keyboard.press("2");
  await expect(page.locator("[data-pane-canvas]")).toHaveCount(2);
  await expect(paneHeaders()).toHaveText(["v1", "v2"]);
  await expect(railVersion()).toHaveText("v1");

  await page.keyboard.press("ArrowRight");
  await expect(railVersion()).toHaveText("v2");
  await expect(paneHeaders()).toHaveText(["v2", "v3"]);
});

test("s shortlists the focused version", async () => {
  await page.keyboard.press("s");
  await expect(tile(2, "Shortlisted")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("aside").getByText("Shortlisted")).toBeVisible();
});

test("x opens the reject dialog; a note and confirm reject the version", async () => {
  await page.keyboard.press("ArrowRight"); // focus v3
  await expect(railVersion()).toHaveText("v3");
  await page.keyboard.press("x");
  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByRole("heading", { name: "Reject v3" }),
  ).toBeVisible();
  await dialog.locator("textarea").fill("Too dark for the scene");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(tile(3, "Rejected")).toBeVisible({ timeout: 10_000 });
  await expect(tile(3, "Rejected")).toHaveClass(/opacity-40/);
});

test("p picks a shortlisted version via the canonical filename and lands on the queue", async () => {
  await page.keyboard.press("ArrowLeft"); // back to shortlisted v2
  await expect(railVersion()).toHaveText("v2");
  await page.keyboard.press("p");
  const dialog = page.locator('[role="dialog"]');
  // Canonical Approved/ filename ends _v2.png for this version.
  await expect(
    dialog.getByText(new RegExp(`_${SHOT_CODE}_v2\\.png$`)),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Pick this version" }).click();
  // The room closes itself back to the queue after the pick.
  await page.waitForURL(new RegExp(`${base}/review$`), { timeout: 30_000 });

  // Shot detail reflects the decision.
  await page.goto(shotUrl);
  await expect(page.getByLabel("Status")).toContainText("Picked", {
    timeout: 15_000,
  });
  const pickedCard = page
    .locator('[class*="ring-tape"]')
    .filter({ hasText: "v2" });
  await expect(pickedCard).toBeVisible();
  await expect(pickedCard.getByText("Picked", { exact: true })).toBeVisible();
  // Non-picked candidates were rejected as superseded by the pick.
  await expect(page.getByText("superseded by v2")).toHaveCount(2);
  await expect(page.getByText(/Too dark for the scene/)).toBeVisible();
});

test("re-picking another version is allowed while the shot is picked", async () => {
  await page.goto(roomUrl);
  await expect(tile(2, "Picked")).toBeVisible({ timeout: 15_000 });
  await expect(railVersion()).toHaveText("v1");
  await page.keyboard.press("p");
  const dialog = page.locator('[role="dialog"]');
  await expect(
    dialog.getByText(new RegExp(`_${SHOT_CODE}_v1\\.png$`)),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Pick this version" }).click();
  await page.waitForURL(new RegExp(`${base}/review$`), { timeout: 30_000 });

  await page.goto(shotUrl);
  await expect(page.getByLabel("Status")).toContainText("Picked", {
    timeout: 15_000,
  });
  const pickedCard = page
    .locator('[class*="ring-tape"]')
    .filter({ hasText: "v1" });
  await expect(pickedCard).toBeVisible();
  // The previous pick (v2) was superseded by the re-pick.
  await expect(page.getByText("superseded by v1")).toHaveCount(1);
});

test("picking is refused once the shot is approved; Esc returns to the queue", async () => {
  // Approve the shot (it has a pick, so the transition is legal).
  await page.goto(shotUrl);
  await page.getByLabel("Status").click();
  await page.getByRole("option", { name: "Approved" }).click();
  await expect(page.getByLabel("Status")).toContainText("Approved", {
    timeout: 15_000,
  });

  // In the room, try to pick a non-picked version → server refuses.
  await page.goto(roomUrl);
  await expect(tile(1, "Picked")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("ArrowRight"); // v2 (rejected — dialog still opens)
  await expect(railVersion()).toHaveText("v2");
  await page.keyboard.press("p");
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole("button", { name: "Pick this version" }).click();

  // The server refuses the pick: an error toast appears, the dialog stays
  // open, and the version's state does not change.
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
  // BUG (see fixme test below): the toast should say "This shot is already
  // approved — reopen it (set an earlier status) before re-picking" but shows
  // the raw Convex header instead.
  await expect(toast).toContainText(/already approved|Server Error/);
  await expect(dialog).toBeVisible();
  await expect(tile(2, "Rejected")).toBeVisible();

  // Esc closes the dialog, a second Esc leaves the room for the queue.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.waitForURL(new RegExp(`${base}/review$`), { timeout: 30_000 });
});

// BUG: the pick-refusal toast reads "[CONVEX M(versions:pick)] [Request ID:
// …] Server Error" instead of the server's message "This shot is already
// approved — reopen it (set an earlier status) before re-picking".
// firstErrorLine() in app/(app)/p/[productionId]/review/_components/
// review-utils.ts searches for the marker "Uncaught Error: ", but Convex
// mutations throw ConvexError whose message contains "Uncaught ConvexError: ",
// so the human line is never extracted (board-helpers.tsx handles this
// correctly with /Uncaught [A-Za-z]*(?:Error)?:?/). Repro: approve a shot with
// a pick, open its review room, press "p" on a non-picked version, confirm.
test(
  "pick-refusal toast surfaces the server's 'already approved' message",
  async () => {
    await page.goto(roomUrl);
    await expect(tile(1, "Picked")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("p");
    await page
      .locator('[role="dialog"]')
      .getByRole("button", { name: "Pick this version" })
      .click();
    await expect(page.getByText(/already approved/).first()).toBeVisible({
      timeout: 10_000,
    });
  },
);

test("no unexpected page errors during the review flows", () => {
  expect(errors).toEqual([]);
});
