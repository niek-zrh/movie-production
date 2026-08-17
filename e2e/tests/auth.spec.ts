import { test, expect, type Page } from "@playwright/test";
import { signIn, createStudio, trackErrors, uniqueEmail, PASSWORD } from "./helpers";

/**
 * Auth flows: sign-up, duplicate sign-up, wrong password, sign-out and the
 * middleware redirect. Tests share one throwaway user, created in the first
 * test, hence the serial ordering.
 */

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

/**
 * Deterministically wait until the /sign-in page is hydrated: React attaches
 * its internal __reactProps$ key to DOM nodes once handlers are wired up.
 * Clicking before that point is silently lost.
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

test.describe.serial("auth", () => {
  const email = uniqueEmail("auth-owner");

  test("sign-up lands on the create-studio screen", async ({ page }) => {
    const errors = trackErrors(page);
    await signUpRobust(page, "Auth Owner", email);
    await expect(page.getByText("Welcome to Slate")).toBeVisible();
    await expect(page.locator("#studio-name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create studio" }),
    ).toBeVisible();
    expect(errors.filter(
        (e) =>
          e.startsWith("PAGEERROR") &&
          // dev-server corrupt-chunk artifact, recovered by reload
          !e.includes("Invalid or unexpected token"),
      )).toEqual([]);
  });

  // BUG: duplicate sign-up (flow=signUp with an already-registered email)
  // never settles — the signIn("password") promise neither resolves nor
  // rejects, so the friendly error ("Could not create the account. Use at
  // least 8 characters for the password.") is never rendered and the
  // "Create account" button stays disabled indefinitely (verified for 30+
  // seconds; the wedged request even hangs browser-context teardown).
  // Expected per app/(auth)/sign-in/page.tsx: the catch branch shows the
  // friendly error. The test is parked until the app surfaces it.
  test("duplicate sign-up with the right password signs the user in", async ({
    page,
  }) => {
    // Convex Auth semantics: signUp on an existing account verifies the
    // credentials — matching password logs in rather than erroring.
    await page.goto("/sign-in");
    await waitForSignInHydration(page);
    await page.getByText("New here? Create an account").click();
    await page.fill("#name", "Copycat");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
  });

  test("duplicate sign-up with a wrong password shows the friendly error", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await waitForSignInHydration(page);
    await page.getByText("New here? Create an account").click();
    await page.fill("#name", "Copycat");
    await page.fill("#email", email);
    await page.fill("#password", "a-different-password-9");
    await page.getByRole("button", { name: "Create account" }).click();
    // Worst case the app's 15s hang-timeout surfaces the error.
    await expect(page.getByText(/Could not create the account/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("wrong password on sign-in shows the friendly error", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await waitForSignInHydration(page);
    await page.fill("#email", email);
    await page.fill("#password", "totally-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText(
        "Wrong email or password. New here? Switch to create account.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/sign-in/);
  });

  // BUG: intermittently, a successful password sign-in bounces straight back
  // to an EMPTY /sign-in form with no error — the auth cookie is set (a
  // manual visit to / then stays on /), but the router.push("/") after
  // signIn() races the middleware's view of the session and the client
  // navigation is redirected back to /sign-in. The user is left on a blank
  // sign-in form while actually signed in. Parked until the app waits for
  // the session before navigating (or the middleware picks up the fresh
  // cookie).
  test(
    "sign-in lands on / on the first attempt (no bounce back)",
    async ({ page }) => {
      await signIn(page, email); // helpers.signIn asserts the URL becomes /
    },
  );

  test("sign-out via the avatar menu returns to /sign-in", async ({ page }) => {
    const errors = trackErrors(page);
    // Local resilient sign-in: works around the intermittent bounce-back
    // bug documented above (auth succeeded; only the redirect is lost).
    await page.goto("/sign-in");
    await waitForSignInHydration(page);
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/", { timeout: 10_000 }).catch(async () => {
      await page.goto("/");
      await page.waitForURL("**/", { timeout: 10_000 });
    });
    // The avatar menu only exists inside the app shell, so the user needs a
    // studio first (without one the create-studio screen has no topbar).
    await createStudio(page, `Auth Studio ${Date.now()}`);
    await page.getByLabel("Account").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(errors.filter(
        (e) =>
          e.startsWith("PAGEERROR") &&
          // dev-server corrupt-chunk artifact, recovered by reload
          !e.includes("Invalid or unexpected token"),
      )).toEqual([]);
  });

  test("middleware redirects / to /sign-in when signed out", async ({
    page,
  }) => {
    // The default fixture context carries no auth state.
    await page.goto("/");
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
