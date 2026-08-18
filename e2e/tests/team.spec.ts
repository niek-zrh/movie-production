import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createStudio,
  createProduction,
  trackErrors,
  uniqueEmail,
  PASSWORD,
} from "./helpers";

/**
 * Team management: invite → pending badge → invitee auto-joins → live badge
 * clear (Convex reactivity), craft titles, live role changes, removal rules.
 *
 * The owner tab and the member tab are separate browser contexts that stay
 * open across tests, so the whole describe is serial.
 */

/**
 * Local copy of helpers.bulkCreateShots.
 * HELPER ISSUE: the shared helper opens the "Paste codes" dialog but then
 * fills `page.locator("textarea").first()` (the inline empty-state form) and
 * clicks `getByRole("button", { name: /create/i }).first()` (the dialog's
 * disabled "Create shots" button) — two different forms, so it times out.
 * This version uses the inline empty-state form directly.
 */
async function bulkCreateShotsLocal(page: Page, base: string, codes: string[]) {
  await page.goto(`${base}/shots`);
  const textarea = page.getByLabel("Shot codes").first();
  await textarea.fill(codes.join("\n"));
  const noun = codes.length === 1 ? "shot" : "shots";
  await page
    .getByRole("button", { name: `Create ${codes.length} ${noun}` })
    .first()
    .click();
  await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Local copy of helpers.inviteMember.
 * HELPER ISSUE: `dialog.getByLabel("Role")` matches nothing (the "Role"
 * label has no htmlFor) and, with no actionTimeout configured, the click
 * waits until the test times out — the `.catch` fallback never gets a
 * chance to run. This version targets the role combobox directly.
 */
async function inviteMemberLocal(page: Page, email: string, roleLabel: string) {
  await page.goto("/team");
  await page.getByRole("button", { name: /Invite member/i }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("#invite-email").fill(email);
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: roleLabel, exact: true }).click();
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Robust full-page navigation for a signed-in user.
 * BUG (reported): intermittently, the first full page load after a fresh
 * sign-in/sign-up lands half-authenticated — the middleware accepts the
 * session cookie but the Convex client sees no user, so the app shell
 * renders literally nothing (blank page, no redirect to /sign-in). A
 * reload — or, if the session died, signing in again — recovers. This
 * wrapper does exactly that so the tests can assert their real subject.
 */
async function gotoSignedIn(page: Page, email: string, path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(path);
    if (/\/sign-in/.test(page.url())) {
      await waitForSignInHydration(page);
      await page.fill("#email", email);
      await page.fill("#password", PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("**/", { timeout: 10_000 }).catch(() => {});
      continue;
    }
    const topbarVisible = await page
      .getByLabel("Switch studio")
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (topbarVisible) return;
  }
  throw new Error(`Could not reach ${path} signed in as ${email}`);
}

/**
 * Deterministically wait until the /sign-in page is hydrated: React attaches
 * its internal __reactProps$ key to DOM nodes once handlers are wired up.
 * Blind clicking before that point is lost (and blind retry-clicking can
 * toggle the flow back and forth under CPU starvation).
 */
async function waitForSignInHydration(page: Page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const hydrated = await page
      .waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          const btn = btns.find((x) =>
            (x.textContent || "").includes("New here? Create an account"),
          );
          return (
            !!btn && Object.keys(btn).some((k) => k.startsWith("__reactProps"))
          );
        },
        undefined,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (hydrated) return;
    // Infra artifact, not an app bug: under concurrent compile load the
    // Next dev server sometimes serves a corrupt JS chunk ("SyntaxError:
    // Invalid or unexpected token" pageerror) which kills hydration for
    // that page load entirely. A reload fetches a good chunk.
    await page.reload().catch(() => {});
  }
  throw new Error("sign-in page never hydrated");
}

/**
 * Local, hydration-safe copy of helpers.signUp.
 * HELPER ISSUE: the shared signUp clicks "New here? Create an account"
 * immediately after goto; under dev-server load that click can land before
 * React hydrates, the listener is missing, the flow never flips to signUp
 * and the helper hangs on `fill("#name")`. Retrying the toggle until the
 * Name field appears makes it deterministic.
 */
async function signUpRobust(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  await waitForSignInHydration(page);
  await page.getByText("New here? Create an account").click();
  await expect(page.locator("#name")).toBeVisible({ timeout: 10_000 });
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 20_000 }).catch(async () => {
    // BUG (reported): successful auth can bounce back to /sign-in even
    // though the session was established. If we are signed in, / sticks.
    await page.goto("/");
    await page.waitForURL("**/", { timeout: 10_000 });
  });
}

/** Local copy of helpers.signUpInvited on top of signUpRobust. */
async function signUpInvitedRobust(
  browser: Browser,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpRobust(page, name, email);
  return { context, page };
}

test.describe.serial("team", () => {
  const ownerEmail = uniqueEmail("team-owner");
  const artistEmail = uniqueEmail("team-artist");
  const studioName = `Team Studio ${Date.now()}`;

  let ownerContext: BrowserContext;
  let ownerPage: Page;
  let ownerErrors: string[];
  let memberContext: BrowserContext | undefined;
  let memberPage: Page | undefined;
  let sharedBrowser: Browser;
  let shotPath: string;

  test.beforeAll(async ({ browser }) => {
    sharedBrowser = browser;
    ownerContext = await browser.newContext();
    ownerPage = await ownerContext.newPage();
    ownerErrors = trackErrors(ownerPage);
  });

  test.afterAll(async () => {
    // A wedged in-flight auth request can hang context.close() forever
    // (same root cause as the duplicate-sign-up bug) — don't let teardown
    // block the run.
    await Promise.race([
      Promise.allSettled([memberContext?.close(), ownerContext?.close()]),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
  });

  test("owner signs up and creates the studio", async () => {
    await signUpRobust(ownerPage, "Tessa Owner", ownerEmail);
    await createStudio(ownerPage, studioName);
    await expect(ownerPage.getByLabel("Switch studio")).toContainText(
      studioName,
    );
  });

  test("owner sets up a production with one shot", async () => {
    test.setTimeout(150_000);
    // Stabilize the fresh session across its first full page load (see
    // gotoSignedIn) before the wizard helper navigates on its own.
    await gotoSignedIn(ownerPage, ownerEmail, "/new");
    const base = await createProduction(ownerPage, "Team Feature");
    await bulkCreateShotsLocal(ownerPage, base, ["TS010_SH010"]);
    await ownerPage.getByRole("link", { name: "TS010_SH010" }).click();
    await ownerPage.waitForURL(/\/shots\/[a-z0-9]+$/, { timeout: 15_000 });
    shotPath = new URL(ownerPage.url()).pathname;
  });

  test("inviting an artist shows a pending Invited badge", async () => {
    await inviteMemberLocal(ownerPage, artistEmail, "Artist");
    const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Invited", { exact: true })).toBeVisible();
  });

  test("invited user signs up and lands in the studio", async () => {
    ({ context: memberContext, page: memberPage } = await signUpInvitedRobust(
      sharedBrowser,
      artistEmail,
      "Ivy Artist",
    ));
    // Topbar shows the studio name — not the create-studio screen.
    await expect(memberPage.getByLabel("Switch studio")).toContainText(
      studioName,
      { timeout: 15_000 },
    );
    await expect(memberPage.getByText("Welcome to Kinolab")).toHaveCount(0);
    await expect(memberPage.locator("#studio-name")).toHaveCount(0);
  });

  test("pending badge clears in the owner tab without a reload", async () => {
    // ownerPage is still sitting on /team from the invite test — no goto, no
    // reload; Convex reactivity must update the row by itself.
    const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
    await expect(row.getByText("Ivy Artist")).toBeVisible();
    await expect(row.getByText("Invited", { exact: true })).toHaveCount(0);
  });

  test("owner edits the member's craft title and it persists", async () => {
    const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
    const input = row.getByPlaceholder("e.g. Animation Supervisor");
    await input.fill("Lead Compositor");
    await input.blur(); // commit happens on blur
    await ownerPage.waitForTimeout(1_000); // let the mutation land
    await ownerPage.reload();
    await expect(
      ownerPage
        .getByRole("row")
        .filter({ hasText: artistEmail })
        .getByPlaceholder("e.g. Animation Supervisor"),
    ).toHaveValue("Lead Compositor");
  });

  test("role change Artist → Viewer updates the member's UI live", async () => {
    // The artist opens the shot and sees the upload dropzone.
    await gotoSignedIn(memberPage!, artistEmail, shotPath);
    const dropzone = memberPage!.getByRole("button", { name: /Add options/ });
    await expect(dropzone).toBeVisible({ timeout: 15_000 });

    // Owner flips the role to Viewer from the team page.
    const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
    await row.getByRole("combobox").click();
    await ownerPage.getByRole("option", { name: "Viewer", exact: true }).click();

    // Without any navigation, the member's upload affordance disappears.
    await expect(dropzone).toHaveCount(0);
    await expect(memberPage!.locator('input[type="file"]')).toHaveCount(0);
  });

  // BUG (minor, cosmetic): the role <Select> renders the raw role key
  // ("artist", "creative_director") in its closed trigger instead of the
  // human label ("Artist", "Creative Director") — SelectValue is not given
  // the items to map keys to labels. Verified via aria snapshot on both the
  // invite dialog and the team table. The label-based assertion is parked:
  test(
    "role select trigger shows the human label, not the raw key",
    async () => {
      const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
      await expect(row.getByRole("combobox")).toContainText("Viewer");
    },
  );

  // Removal revokes studio-wide access instantly, so it confirms first.
  test("owner removes the member", async () => {
    const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await ownerPage
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(row).toHaveCount(0);
  });

  test("owner cannot remove themselves", async () => {
    const ownRow = ownerPage.getByRole("row").filter({ hasText: ownerEmail });
    await ownRow.getByRole("button", { name: "Remove", exact: true }).click();
    await ownerPage
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(
      ownerPage.getByText(/can't remove yourself/).first(),
    ).toBeVisible();
    // Row is still there.
    await expect(ownRow).toHaveCount(1);
    expect(ownerErrors.filter(
        (e) =>
          e.startsWith("PAGEERROR") &&
          !e.includes("Invalid or unexpected token"),
      )).toEqual([]);
  });
});
