import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
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

/** Local copy of helpers.signUpInvited built on the hardened sign-up. */
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

/**
 * Shot detail page: option uploads (v1/v2 cards + thumbnails), shortlist
 * toggle, discussion incl. the @mention → notification loop, Files and
 * History tabs, and the inline title editor (Enter/blur save, Escape cancel).
 */

const SHOT = "SD010_SH010";
const OWNER_NAME = "Dana Detail";
const MEMBER_NAME = "Mia Mention";

/**
 * Local replacement for helpers.inviteMember: that helper does
 * `dialog.getByLabel("Role").click()`, but the invite dialog's "Role" label
 * has no htmlFor/control association, so the locator never resolves and the
 * click hangs until the test times out (the .catch fallback fires too late).
 */
async function inviteMemberLocal(page: Page, email: string, roleLabel: string) {
  await page.goto("/team");
  await page.getByRole("button", { name: "Invite member" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#invite-email").fill(email);
  await dialog.locator('[data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: roleLabel }).click();
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
}

test.describe.serial("shot detail", () => {
  let context: BrowserContext;
  let page: Page;
  let errors: string[];
  let base: string;
  let shotPath: string;
  let memberContext: BrowserContext | undefined;
  let memberPage: Page;
  const memberEmail = uniqueEmail("mention-member");

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    context = await browser.newContext();
    page = await context.newPage();
    errors = trackErrors(page);
    await signUpRobust(page, OWNER_NAME, uniqueEmail("detail-owner"));
    await createStudio(page, "Detail E2E Studio");
    base = await createProduction(page, "Detail E2E Feature");

    // One shot to work on, created through the paste dialog.
    await page.goto(`${base}/shots`);
    await page.getByRole("button", { name: "Paste codes" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Shot codes").fill(SHOT);
    await dialog.getByRole("button", { name: "Create 1 shot" }).click();
    await expect(page.getByRole("link", { name: SHOT })).toBeVisible();
  });

  test.afterAll(async () => {
    await memberContext?.close();
    await context?.close();
  });

  test("uploading two options yields v1/v2 cards with thumbnails", async () => {
    await page.goto(`${base}/shots`);
    await page.getByRole("link", { name: SHOT }).click();
    await page.waitForURL(/\/shots\/[a-z0-9]+$/);
    shotPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible();

    await uploadOptions(page, 2);

    const v1Card = page.locator('[data-slot="card"]').filter({ hasText: "v1 ·" });
    const v2Card = page.locator('[data-slot="card"]').filter({ hasText: "v2 ·" });
    await expect(v1Card).toBeVisible();
    await expect(v2Card).toBeVisible();

    // Thumbnails render from the uploaded bytes (image uploads are their own
    // thumb) — assert the images actually load, not just exist.
    const thumb1 = page.locator('img[alt="option-1.png"]');
    const thumb2 = page.locator('img[alt="option-2.png"]');
    await expect(thumb1).toBeVisible();
    await expect(thumb2).toBeVisible();
    await expect
      .poll(() => thumb1.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    await expect
      .poll(() => thumb2.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("shortlist button toggles label and state", async () => {
    const v1Card = page.locator('[data-slot="card"]').filter({ hasText: "v1 ·" });
    await expect(v1Card.getByText("Candidate")).toBeVisible();

    await v1Card.getByRole("button", { name: "Shortlist", exact: true }).click();
    await expect(
      v1Card.getByRole("button", { name: "Unshortlist" }),
    ).toBeVisible();
    await expect(v1Card.getByText("Shortlisted")).toBeVisible();

    await v1Card.getByRole("button", { name: "Unshortlist" }).click();
    await expect(
      v1Card.getByRole("button", { name: "Shortlist", exact: true }),
    ).toBeVisible();
    await expect(v1Card.getByText("Candidate")).toBeVisible();
  });

  test("posting a comment shows it in the discussion", async () => {
    await page.getByRole("tab", { name: "Discussion" }).click();
    const composer = page.getByPlaceholder(
      "Add a comment — @ to mention someone",
    );
    await composer.fill("First pass looks promising");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByText("First pass looks promising")).toBeVisible();
    await expect(page.getByText(OWNER_NAME).first()).toBeVisible();
    await expect(composer).toHaveValue("");
  });

  test("@mention notifies the mentioned member and links to the shot", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await inviteMemberLocal(page, memberEmail, "Artist");
    ({ context: memberContext, page: memberPage } = await signUpInvitedRobust(
      browser,
      memberEmail,
      MEMBER_NAME,
    ));

    // Owner mentions the member from the discussion tab via the @ picker.
    await page.goto(shotPath);
    await page.getByRole("tab", { name: "Discussion" }).click();
    const composer = page.getByPlaceholder(
      "Add a comment — @ to mention someone",
    );
    await composer.click();
    await composer.pressSequentially("Heads up @Mia", { delay: 25 });
    const suggestion = page.getByRole("button", {
      name: new RegExp(MEMBER_NAME),
    });
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();
    await expect(composer).toHaveValue(/@Mia Mention/);
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByText(`@${MEMBER_NAME}`).first()).toBeVisible();

    // The member's bell shows an unread notification naming the author…
    const bell = memberPage.getByRole("button", {
      name: "Notifications",
      exact: true,
    });
    await expect(bell.locator("span.bg-tape")).toBeVisible({
      timeout: 15_000,
    });
    await bell.click();
    const item = memberPage
      .getByRole("button")
      .filter({ hasText: `${OWNER_NAME} mentioned you` });
    await expect(item).toBeVisible();

    // …and clicking it navigates to the shot.
    await item.click();
    await memberPage.waitForURL(`**${shotPath}`);
    await expect(memberPage.getByRole("heading", { name: SHOT })).toBeVisible();
  });

  test("Files tab lists both uploaded assets with sizes", async () => {
    await page.goto(shotPath);
    await page.getByRole("tab", { name: "Files" }).click();
    const row1 = page.locator("tr").filter({ hasText: "option-1.png" });
    const row2 = page.locator("tr").filter({ hasText: "option-2.png" });
    await expect(row1).toBeVisible();
    await expect(row2).toBeVisible();
    await expect(row1.getByText(/^\d+(\.\d+)? (B|KB)$/)).toBeVisible();
    await expect(row2.getByText(/^\d+(\.\d+)? (B|KB)$/)).toBeVisible();
    // Uploads are app-storage assets.
    await expect(row1.getByText("App", { exact: true })).toBeVisible();
  });

  test("History tab shows the added v1/v2 entries", async () => {
    await page.getByRole("tab", { name: "History" }).click();
    await expect(
      page.getByText(new RegExp(`added v1 to ${SHOT}`)),
    ).toBeVisible();
    await expect(
      page.getByText(new RegExp(`added v2 to ${SHOT}`)),
    ).toBeVisible();
  });

  test("inline title saves on Enter and on blur", async () => {
    const title = page.getByLabel("Shot title");
    await title.fill("Hero close-up");
    await title.press("Enter");
    await page.waitForTimeout(600); // let the mutation flush before reloading
    await page.reload();
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Shot title")).toHaveValue("Hero close-up");

    const title2 = page.getByLabel("Shot title");
    await title2.fill("Hero close-up wide");
    await page.getByRole("heading", { name: SHOT }).click(); // blur commits
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Shot title")).toHaveValue(
      "Hero close-up wide",
    );
  });

  test("Escape cancels a title edit without saving (regression)", async () => {
    const title = page.getByLabel("Shot title");
    await expect(title).toHaveValue("Hero close-up wide");
    await title.click();
    await title.fill("Discarded draft");
    await title.press("Escape");
    await expect(title).toHaveValue("Hero close-up wide");
    // If the discarded text were wrongly saved, the reactive query would
    // write it back into the input — give it time to prove itself.
    await page.waitForTimeout(800);
    await expect(title).toHaveValue("Hero close-up wide");
    await page.reload();
    await expect(page.getByRole("heading", { name: SHOT })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Shot title")).toHaveValue(
      "Hero close-up wide",
    );
  });

  test("no unexpected page errors surfaced during the suite", () => {
    expect(errors).toEqual([]);
  });
});
