import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared helpers for the Kinolab E2E suite. Every spec creates its own
 * throwaway users/studios (multi-tenant isolation keeps them invisible to
 * real accounts), so specs can run in parallel against one dev server.
 */

export const PASSWORD = "slate-e2e-password-1";

let counter = 0;
export function uniqueEmail(tag: string): string {
  counter += 1;
  return `${tag}-${Date.now()}-${counter}@e2e.slate`;
}

/** Sign UP a brand-new user; lands on / (create-studio screen or studio home). */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  // Hydration-safe: retry the toggle until the name field actually appears.
  await expect(async () => {
    await page.getByText("New here? Create an account").click();
    await expect(page.locator("#name")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 45_000 });
}

/** Sign IN an existing user. */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/", { timeout: 20_000 });
}

export async function createStudio(page: Page, name: string) {
  await page.fill("#studio-name", name);
  await page.getByRole("button", { name: "Create studio" }).click();
  await expect(page.getByText("Productions").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Create a production through the wizard (skipping the Drive step) and
 * return its base URL path ("/p/{id}").
 */
export async function createProduction(
  page: Page,
  name: string,
  opts: { episodic?: boolean; episodes?: number } = {},
): Promise<string> {
  await page.goto("/new");
  await page.getByLabel(/name/i).first().fill(name);
  if (opts.episodic) {
    await page.getByRole("button", { name: /episodic/i }).click();
    if (opts.episodes) {
      await page.getByLabel(/episode/i).fill(String(opts.episodes));
    }
  }
  await page.getByRole("button", { name: /Create & continue/i }).click();
  await page.getByText(/Skip for now/i).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /Skip for now/i }).click();
  await page.getByRole("button", { name: /Open production/i }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Open production/i }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+/, { timeout: 15_000 });
  const url = new URL(page.url());
  const base = url.pathname.match(/^\/p\/[a-z0-9]+/)![0];
  return base;
}

/**
 * Bulk-create shots from codes on the Shots tab. Uses the inline empty-state
 * form when present (fresh production); otherwise the "Paste codes" dialog —
 * both scoped so the two copies of the form can't be confused.
 */
export async function bulkCreateShots(page: Page, base: string, codes: string[]) {
  await page.goto(`${base}/shots`);
  await page.waitForLoadState("networkidle");
  const inline = page.getByLabel("Shot codes");
  if (await inline.count()) {
    await inline.fill(codes.join("\n"));
    await page.getByRole("button", { name: /Create \d+ shots?/i }).click();
  } else {
    await page.getByRole("button", { name: /bulk|paste/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill(codes.join("\n"));
    await dialog.getByRole("button", { name: /create/i }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
  }
  await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible({
    timeout: 15_000,
  });
}

const PNG_RED =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQowMTAwMAAAJgYBLZ01WQAAAABJRU5ErkJggg==";
const PNG_BLUE =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVR4nGNkYPj/n4GBgYGJAQYwMzAwMAAAJgIBFeXY+MAAAAAASUVORK5CYII=";

/** Upload n placeholder images as versions on the CURRENT shot-detail page. */
export async function uploadOptions(page: Page, n: number) {
  const files = Array.from({ length: n }, (_, i) => ({
    name: `option-${i + 1}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(i % 2 === 0 ? PNG_RED : PNG_BLUE, "base64"),
  }));
  await page.locator('input[type="file"]').first().setInputFiles(files);
  await expect(page.getByText(`v${n}`).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Invite an email to the CURRENT user's studio from the /team page.
 * rolelabel: "Producer" | "Creative Director" | "Supervisor" | "Artist" | "Viewer"
 */
export async function inviteMember(page: Page, email: string, roleLabel: string) {
  await page.goto("/team");
  await page.getByRole("button", { name: /Invite member/i }).click();
  await page.fill("#invite-email", email);
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: roleLabel, exact: true }).click();
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText(email).first()).toBeVisible({ timeout: 10_000 });
}

/** New context + page signed up as an invited member (claims the invite). */
export async function signUpInvited(
  browser: Browser,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, name, email);
  return { context, page };
}

/** Collect console/page errors; assert none at the end of a spec. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${String(err).slice(0, 200)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Convex mutation rejections surface as console errors by design when
      // a test intentionally triggers a server refusal; filter those.
      if (text.includes("[CONVEX")) return;
      if (text.includes("Failed to load resource")) return;
      errors.push(text.slice(0, 200));
    }
  });
  return errors;
}
