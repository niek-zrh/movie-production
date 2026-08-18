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
  uploadOptions,
  uniqueEmail,
  PASSWORD,
} from "./helpers";

/**
 * Role-gated UI: owner sets up a studio + production + shot with one option,
 * then an Artist and a Viewer join via invite and we verify what each role
 * can and cannot see/do. Serial — three long-lived contexts share state.
 */

/**
 * Local copy of helpers.bulkCreateShots (shared helper fills the inline
 * empty-state textarea but clicks the dialog's disabled button — see the
 * helper-issue note in team.spec.ts). Uses the inline empty-state form.
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
 * Local copy of helpers.inviteMember (shared helper hangs on
 * `getByLabel("Role")` — see the helper-issue note in team.spec.ts).
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
    // The sign-in page finishes with window.location.assign("/"), and the
    // middleware redirects on top of that — a goto issued into either one
    // dies with "net::ERR_ABORTED; maybe frame was detached". That is what
    // this loop exists to survive, so the goto has to be inside it.
    const navigated = await page
      .goto(path)
      .then(() => true)
      .catch(() => false);
    if (!navigated) continue;
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

test.describe.serial("permissions", () => {
  const ownerEmail = uniqueEmail("perm-owner");
  const artistEmail = uniqueEmail("perm-artist");
  const viewerEmail = uniqueEmail("perm-viewer");
  const studioName = `Perm Studio ${Date.now()}`;

  let sharedBrowser: Browser;
  let ownerContext: BrowserContext;
  let ownerPage: Page;
  let artistContext: BrowserContext | undefined;
  let artistPage: Page | undefined;
  let viewerContext: BrowserContext | undefined;
  let viewerPage: Page | undefined;

  let base: string; // "/p/{productionId}"
  let shotPath: string; // "/p/{productionId}/shots/{shotId}"
  let shotId: string;

  test.beforeAll(async ({ browser }) => {
    sharedBrowser = browser;
    ownerContext = await browser.newContext();
    ownerPage = await ownerContext.newPage();
  });

  test.afterAll(async () => {
    // A wedged in-flight auth request can hang context.close() forever
    // (same root cause as the duplicate-sign-up bug) — don't let teardown
    // block the run.
    await Promise.race([
      Promise.allSettled([
        viewerContext?.close(),
        artistContext?.close(),
        ownerContext?.close(),
      ]),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
  });

  test("owner sets up studio, production and a shot with one option", async () => {
    test.setTimeout(180_000);
    await signUpRobust(ownerPage, "Pia Owner", ownerEmail);
    await createStudio(ownerPage, studioName);
    // Stabilize the fresh session across its first full page load (see
    // gotoSignedIn) before the wizard helper navigates on its own.
    await gotoSignedIn(ownerPage, ownerEmail, "/new");
    base = await createProduction(ownerPage, "Perm Feature");
    await bulkCreateShotsLocal(ownerPage, base, ["PRM010_SH010"]);
    await ownerPage.getByRole("link", { name: "PRM010_SH010" }).click();
    await ownerPage.waitForURL(/\/shots\/[a-z0-9]+$/, { timeout: 15_000 });
    shotPath = new URL(ownerPage.url()).pathname;
    shotId = shotPath.split("/").pop()!;
    await uploadOptions(ownerPage, 1);

    // Positive control for the role-gated board selectors used below: the
    // OWNER does see stage-status selects and gate menus.
    await ownerPage.goto(`${base}/board`);
    await expect(
      ownerPage.getByText("PRM010_SH010").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      ownerPage.locator('[aria-label$=" status"]').first(),
    ).toBeVisible();
    await expect(
      ownerPage.locator('[aria-label$=" menu"]').first(),
    ).toBeVisible();

    await inviteMemberLocal(ownerPage, artistEmail, "Artist");
    await inviteMemberLocal(ownerPage, viewerEmail, "Viewer");
  });

  test("artist joins; production rail has no Settings tab", async () => {
    ({ context: artistContext, page: artistPage } = await signUpInvitedRobust(
      sharedBrowser,
      artistEmail,
      "Arlo Artist",
    ));
    // Wait for the viewer/membership to load so the role is applied.
    await expect(artistPage.getByLabel("Switch studio")).toContainText(
      studioName,
      { timeout: 15_000 },
    );
    await gotoSignedIn(artistPage, artistEmail, base);
    const rail = artistPage.locator("aside");
    await expect(rail.getByRole("link", { name: "Shots" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Board" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("artist gets a read-only /settings page via direct URL", async () => {
    await gotoSignedIn(artistPage!, artistEmail, `${base}/settings`);
    await expect(
      artistPage!.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    // Details card is rendered as plain text for non-managers.
    await expect(artistPage!.getByText("active", { exact: true })).toBeVisible();
    await expect(artistPage!.locator("#prod-name")).toHaveCount(0);
    await expect(artistPage!.getByText("changes save as you go")).toHaveCount(0);
    // No editable controls in the Details section, no link management.
    await expect(
      artistPage!.locator('#details [data-slot="select-trigger"]'),
    ).toHaveCount(0);
    await expect(
      artistPage!.getByRole("button", { name: "Add link" }),
    ).toHaveCount(0);
  });

  test("artist board shows no stage-status selects and no gate menus", async () => {
    await gotoSignedIn(artistPage!, artistEmail, `${base}/board`);
    await expect(
      artistPage!.getByText("PRM010_SH010").first(),
    ).toBeVisible({ timeout: 15_000 });
    // Column status is a plain read-only chip for artists…
    await expect(artistPage!.locator('[aria-label$=" status"]')).toHaveCount(0);
    // …and there is no column menu (request sign-off / approve / reject).
    await expect(artistPage!.locator('[aria-label$=" menu"]')).toHaveCount(0);
  });

  test("artist can open the shot and sees the upload dropzone", async () => {
    await gotoSignedIn(artistPage!, artistEmail, shotPath);
    await expect(artistPage!.getByText("PRM010_SH010").first()).toBeVisible();
    await expect(artistPage!.getByText("v1").first()).toBeVisible();
    await expect(
      artistPage!.getByRole("button", { name: /Add options/ }),
    ).toBeVisible();
  });

  test("artist cannot pick in the review room (quiet toast, no dialog)", async () => {
    await gotoSignedIn(artistPage!, artistEmail, `${base}/review/${shotId}`);
    // Room is loaded once the focused version shows up.
    await expect(artistPage!.getByText("v1").first()).toBeVisible({
      timeout: 15_000,
    });
    await artistPage!.keyboard.press("p");
    await expect(
      artistPage!.getByText("Your role can't decide picks"),
    ).toBeVisible();
    // No pick dialog opened.
    await expect(artistPage!.getByRole("dialog")).toHaveCount(0);
  });

  test("viewer joins; sees the shot but no upload dropzone", async () => {
    ({ context: viewerContext, page: viewerPage } = await signUpInvitedRobust(
      sharedBrowser,
      viewerEmail,
      "Vera Viewer",
    ));
    await expect(viewerPage.getByLabel("Switch studio")).toContainText(
      studioName,
      { timeout: 15_000 },
    );
    await gotoSignedIn(viewerPage, viewerEmail, shotPath);
    // The existing option is visible to the viewer…
    await expect(viewerPage.getByText("v1").first()).toBeVisible({
      timeout: 15_000,
    });
    // …but there is no upload affordance at all (source: OptionsTab renders
    // the dropzone only when canUpload, and canUpload excludes "viewer").
    await expect(
      viewerPage.getByRole("button", { name: /Add options/ }),
    ).toHaveCount(0);
    await expect(viewerPage.locator('input[type="file"]')).toHaveCount(0);
  });

  test("viewer can write a comment", async () => {
    const text = `Gallery note ${Date.now()}`;
    await viewerPage!.getByRole("tab", { name: "Discussion" }).click();
    await viewerPage!.getByPlaceholder(/Add a comment/).fill(text);
    await viewerPage!.getByRole("button", { name: "Comment" }).click();
    await expect(viewerPage!.getByText(text, { exact: true })).toBeVisible();
    await expect(viewerPage!.getByText("Vera Viewer").first()).toBeVisible();
  });
});
