# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: team.spec.ts >> team >> invited user signs up and lands in the studio
- Location: e2e/tests/team.spec.ts:222:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByLabel('Switch studio')
Expected substring: "Team Studio 1787059479812"
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByLabel('Switch studio')

```

```yaml
- main:
  - heading "Welcome to Kinolab" [level=1]
  - paragraph: Name your studio to get started. Expecting an invite? Ask your producer to invite this email, then sign in again.
  - text: Studio name
  - textbox "Studio name":
    - /placeholder: Aurora North
  - button "Create studio" [disabled]
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  129 |  * Local, hydration-safe copy of helpers.signUp.
  130 |  * HELPER ISSUE: the shared signUp clicks "New here? Create an account"
  131 |  * immediately after goto; under dev-server load that click can land before
  132 |  * React hydrates, the listener is missing, the flow never flips to signUp
  133 |  * and the helper hangs on `fill("#name")`. Retrying the toggle until the
  134 |  * Name field appears makes it deterministic.
  135 |  */
  136 | async function signUpRobust(page: Page, name: string, email: string) {
  137 |   await page.goto("/sign-in");
  138 |   await waitForSignInHydration(page);
  139 |   await page.getByText("New here? Create an account").click();
  140 |   await expect(page.locator("#name")).toBeVisible({ timeout: 10_000 });
  141 |   await page.fill("#name", name);
  142 |   await page.fill("#email", email);
  143 |   await page.fill("#password", PASSWORD);
  144 |   await page.getByRole("button", { name: "Create account" }).click();
  145 |   await page.waitForURL("**/", { timeout: 20_000 }).catch(async () => {
  146 |     // BUG (reported): successful auth can bounce back to /sign-in even
  147 |     // though the session was established. If we are signed in, / sticks.
  148 |     await page.goto("/");
  149 |     await page.waitForURL("**/", { timeout: 10_000 });
  150 |   });
  151 | }
  152 | 
  153 | /** Local copy of helpers.signUpInvited on top of signUpRobust. */
  154 | async function signUpInvitedRobust(
  155 |   browser: Browser,
  156 |   email: string,
  157 |   name: string,
  158 | ): Promise<{ context: BrowserContext; page: Page }> {
  159 |   const context = await browser.newContext();
  160 |   const page = await context.newPage();
  161 |   await signUpRobust(page, name, email);
  162 |   return { context, page };
  163 | }
  164 | 
  165 | test.describe.serial("team", () => {
  166 |   const ownerEmail = uniqueEmail("team-owner");
  167 |   const artistEmail = uniqueEmail("team-artist");
  168 |   const studioName = `Team Studio ${Date.now()}`;
  169 | 
  170 |   let ownerContext: BrowserContext;
  171 |   let ownerPage: Page;
  172 |   let ownerErrors: string[];
  173 |   let memberContext: BrowserContext | undefined;
  174 |   let memberPage: Page | undefined;
  175 |   let sharedBrowser: Browser;
  176 |   let shotPath: string;
  177 | 
  178 |   test.beforeAll(async ({ browser }) => {
  179 |     sharedBrowser = browser;
  180 |     ownerContext = await browser.newContext();
  181 |     ownerPage = await ownerContext.newPage();
  182 |     ownerErrors = trackErrors(ownerPage);
  183 |   });
  184 | 
  185 |   test.afterAll(async () => {
  186 |     // A wedged in-flight auth request can hang context.close() forever
  187 |     // (same root cause as the duplicate-sign-up bug) — don't let teardown
  188 |     // block the run.
  189 |     await Promise.race([
  190 |       Promise.allSettled([memberContext?.close(), ownerContext?.close()]),
  191 |       new Promise((resolve) => setTimeout(resolve, 15_000)),
  192 |     ]);
  193 |   });
  194 | 
  195 |   test("owner signs up and creates the studio", async () => {
  196 |     await signUpRobust(ownerPage, "Tessa Owner", ownerEmail);
  197 |     await createStudio(ownerPage, studioName);
  198 |     await expect(ownerPage.getByLabel("Switch studio")).toContainText(
  199 |       studioName,
  200 |     );
  201 |   });
  202 | 
  203 |   test("owner sets up a production with one shot", async () => {
  204 |     test.setTimeout(150_000);
  205 |     // Stabilize the fresh session across its first full page load (see
  206 |     // gotoSignedIn) before the wizard helper navigates on its own.
  207 |     await gotoSignedIn(ownerPage, ownerEmail, "/new");
  208 |     const base = await createProduction(ownerPage, "Team Feature");
  209 |     await bulkCreateShotsLocal(ownerPage, base, ["TS010_SH010"]);
  210 |     await ownerPage.getByRole("link", { name: "TS010_SH010" }).click();
  211 |     await ownerPage.waitForURL(/\/shots\/[a-z0-9]+$/, { timeout: 15_000 });
  212 |     shotPath = new URL(ownerPage.url()).pathname;
  213 |   });
  214 | 
  215 |   test("inviting an artist shows a pending Invited badge", async () => {
  216 |     await inviteMemberLocal(ownerPage, artistEmail, "Artist");
  217 |     const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  218 |     await expect(row).toHaveCount(1);
  219 |     await expect(row.getByText("Invited", { exact: true })).toBeVisible();
  220 |   });
  221 | 
  222 |   test("invited user signs up and lands in the studio", async () => {
  223 |     ({ context: memberContext, page: memberPage } = await signUpInvitedRobust(
  224 |       sharedBrowser,
  225 |       artistEmail,
  226 |       "Ivy Artist",
  227 |     ));
  228 |     // Topbar shows the studio name — not the create-studio screen.
> 229 |     await expect(memberPage.getByLabel("Switch studio")).toContainText(
      |                                                          ^ Error: expect(locator).toContainText(expected) failed
  230 |       studioName,
  231 |       { timeout: 15_000 },
  232 |     );
  233 |     await expect(memberPage.getByText("Welcome to Kinolab")).toHaveCount(0);
  234 |     await expect(memberPage.locator("#studio-name")).toHaveCount(0);
  235 |   });
  236 | 
  237 |   test("pending badge clears in the owner tab without a reload", async () => {
  238 |     // ownerPage is still sitting on /team from the invite test — no goto, no
  239 |     // reload; Convex reactivity must update the row by itself.
  240 |     const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  241 |     await expect(row.getByText("Ivy Artist")).toBeVisible();
  242 |     await expect(row.getByText("Invited", { exact: true })).toHaveCount(0);
  243 |   });
  244 | 
  245 |   test("owner edits the member's craft title and it persists", async () => {
  246 |     const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  247 |     const input = row.getByPlaceholder("e.g. Animation Supervisor");
  248 |     await input.fill("Lead Compositor");
  249 |     await input.blur(); // commit happens on blur
  250 |     await ownerPage.waitForTimeout(1_000); // let the mutation land
  251 |     await ownerPage.reload();
  252 |     await expect(
  253 |       ownerPage
  254 |         .getByRole("row")
  255 |         .filter({ hasText: artistEmail })
  256 |         .getByPlaceholder("e.g. Animation Supervisor"),
  257 |     ).toHaveValue("Lead Compositor");
  258 |   });
  259 | 
  260 |   test("role change Artist → Viewer updates the member's UI live", async () => {
  261 |     // The artist opens the shot and sees the upload dropzone.
  262 |     await gotoSignedIn(memberPage!, artistEmail, shotPath);
  263 |     const dropzone = memberPage!.getByRole("button", { name: /Add options/ });
  264 |     await expect(dropzone).toBeVisible({ timeout: 15_000 });
  265 | 
  266 |     // Owner flips the role to Viewer from the team page.
  267 |     const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  268 |     await row.getByRole("combobox").click();
  269 |     await ownerPage.getByRole("option", { name: "Viewer", exact: true }).click();
  270 | 
  271 |     // Without any navigation, the member's upload affordance disappears.
  272 |     await expect(dropzone).toHaveCount(0);
  273 |     await expect(memberPage!.locator('input[type="file"]')).toHaveCount(0);
  274 |   });
  275 | 
  276 |   // BUG (minor, cosmetic): the role <Select> renders the raw role key
  277 |   // ("artist", "creative_director") in its closed trigger instead of the
  278 |   // human label ("Artist", "Creative Director") — SelectValue is not given
  279 |   // the items to map keys to labels. Verified via aria snapshot on both the
  280 |   // invite dialog and the team table. The label-based assertion is parked:
  281 |   test(
  282 |     "role select trigger shows the human label, not the raw key",
  283 |     async () => {
  284 |       const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  285 |       await expect(row.getByRole("combobox")).toContainText("Viewer");
  286 |     },
  287 |   );
  288 | 
  289 |   test("owner removes the member", async () => {
  290 |     const row = ownerPage.getByRole("row").filter({ hasText: artistEmail });
  291 |     await row.getByRole("button", { name: "Remove" }).click();
  292 |     await expect(row).toHaveCount(0);
  293 |   });
  294 | 
  295 |   test("owner cannot remove themselves", async () => {
  296 |     const ownRow = ownerPage.getByRole("row").filter({ hasText: ownerEmail });
  297 |     await ownRow.getByRole("button", { name: "Remove" }).click();
  298 |     await expect(
  299 |       ownerPage.getByText(/can't remove yourself/).first(),
  300 |     ).toBeVisible();
  301 |     // Row is still there.
  302 |     await expect(ownRow).toHaveCount(1);
  303 |     expect(ownerErrors.filter(
  304 |         (e) =>
  305 |           e.startsWith("PAGEERROR") &&
  306 |           !e.includes("Invalid or unexpected token"),
  307 |       )).toEqual([]);
  308 |   });
  309 | });
  310 | 
```