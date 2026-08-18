# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> auth >> sign-out via the avatar menu returns to /sign-in
- Location: e2e/tests/auth.spec.ts:158:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - banner [ref=f1e3]:
      - link "Kinolab home" [ref=f1e4] [cursor=pointer]:
        - /url: /
      - button "Switch studio" [ref=f1e9]: Auth Studio 1787042249698
      - generic [ref=f1e13]:
        - button "Search ⌘K" [ref=f1e14]:
          - generic [ref=f1e15]: Search
          - generic [ref=f1e16]: ⌘K
        - button "Notifications" [ref=f1e17]
        - button "Account" [active] [ref=f1e18]:
          - generic [ref=f1e19]: AO
    - main [ref=f1e22]:
      - generic [ref=f1e23]:
        - heading "Productions" [level=1] [ref=f1e24]
        - link "New production" [ref=f1e25] [cursor=pointer]:
          - /url: /new
      - generic [ref=f1e26]:
        - paragraph [ref=f1e27]: No productions yet. Set one up to get your overview.
        - link "New production" [ref=f1e28] [cursor=pointer]:
          - /url: /new
    - generic [ref=f1e29]:
      - heading "Search" [level=2] [ref=f1e30]
      - paragraph [ref=f1e31]: Search for a command to run...
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=f1e37] [cursor=pointer]
  - alert [ref=f1e41]
```

# Test source

```ts
  76  |     await expect(
  77  |       page.getByRole("button", { name: "Create studio" }),
  78  |     ).toBeVisible();
  79  |     expect(errors.filter(
  80  |         (e) =>
  81  |           e.startsWith("PAGEERROR") &&
  82  |           // dev-server corrupt-chunk artifact, recovered by reload
  83  |           !e.includes("Invalid or unexpected token"),
  84  |       )).toEqual([]);
  85  |   });
  86  | 
  87  |   // BUG: duplicate sign-up (flow=signUp with an already-registered email)
  88  |   // never settles — the signIn("password") promise neither resolves nor
  89  |   // rejects, so the friendly error ("Could not create the account. Use at
  90  |   // least 8 characters for the password.") is never rendered and the
  91  |   // "Create account" button stays disabled indefinitely (verified for 30+
  92  |   // seconds; the wedged request even hangs browser-context teardown).
  93  |   // Expected per app/(auth)/sign-in/page.tsx: the catch branch shows the
  94  |   // friendly error. The test is parked until the app surfaces it.
  95  |   test("duplicate sign-up with the right password signs the user in", async ({
  96  |     page,
  97  |   }) => {
  98  |     // Convex Auth semantics: signUp on an existing account verifies the
  99  |     // credentials — matching password logs in rather than erroring.
  100 |     await page.goto("/sign-in");
  101 |     await waitForSignInHydration(page);
  102 |     await page.getByText("New here? Create an account").click();
  103 |     await page.fill("#name", "Copycat");
  104 |     await page.fill("#email", email);
  105 |     await page.fill("#password", PASSWORD);
  106 |     await page.getByRole("button", { name: "Create account" }).click();
  107 |     await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
  108 |   });
  109 | 
  110 |   test("duplicate sign-up with a wrong password shows the friendly error", async ({
  111 |     page,
  112 |   }) => {
  113 |     await page.goto("/sign-in");
  114 |     await waitForSignInHydration(page);
  115 |     await page.getByText("New here? Create an account").click();
  116 |     await page.fill("#name", "Copycat");
  117 |     await page.fill("#email", email);
  118 |     await page.fill("#password", "a-different-password-9");
  119 |     await page.getByRole("button", { name: "Create account" }).click();
  120 |     // Worst case the app's 15s hang-timeout surfaces the error.
  121 |     await expect(page.getByText(/Could not create the account/)).toBeVisible({
  122 |       timeout: 20_000,
  123 |     });
  124 |     await expect(page).toHaveURL(/\/sign-in/);
  125 |   });
  126 | 
  127 |   test("wrong password on sign-in shows the friendly error", async ({
  128 |     page,
  129 |   }) => {
  130 |     await page.goto("/sign-in");
  131 |     await waitForSignInHydration(page);
  132 |     await page.fill("#email", email);
  133 |     await page.fill("#password", "totally-wrong-password");
  134 |     await page.getByRole("button", { name: "Sign in" }).click();
  135 |     await expect(
  136 |       page.getByText(
  137 |         "Wrong email or password. New here? Switch to create account.",
  138 |       ),
  139 |     ).toBeVisible({ timeout: 15_000 });
  140 |     await expect(page).toHaveURL(/\/sign-in/);
  141 |   });
  142 | 
  143 |   // BUG: intermittently, a successful password sign-in bounces straight back
  144 |   // to an EMPTY /sign-in form with no error — the auth cookie is set (a
  145 |   // manual visit to / then stays on /), but the router.push("/") after
  146 |   // signIn() races the middleware's view of the session and the client
  147 |   // navigation is redirected back to /sign-in. The user is left on a blank
  148 |   // sign-in form while actually signed in. Parked until the app waits for
  149 |   // the session before navigating (or the middleware picks up the fresh
  150 |   // cookie).
  151 |   test(
  152 |     "sign-in lands on / on the first attempt (no bounce back)",
  153 |     async ({ page }) => {
  154 |       await signIn(page, email); // helpers.signIn asserts the URL becomes /
  155 |     },
  156 |   );
  157 | 
  158 |   test("sign-out via the avatar menu returns to /sign-in", async ({ page }) => {
  159 |     const errors = trackErrors(page);
  160 |     // Local resilient sign-in: works around the intermittent bounce-back
  161 |     // bug documented above (auth succeeded; only the redirect is lost).
  162 |     await page.goto("/sign-in");
  163 |     await waitForSignInHydration(page);
  164 |     await page.fill("#email", email);
  165 |     await page.fill("#password", PASSWORD);
  166 |     await page.getByRole("button", { name: "Sign in" }).click();
  167 |     await page.waitForURL("**/", { timeout: 10_000 }).catch(async () => {
  168 |       await page.goto("/");
  169 |       await page.waitForURL("**/", { timeout: 10_000 });
  170 |     });
  171 |     // The avatar menu only exists inside the app shell, so the user needs a
  172 |     // studio first (without one the create-studio screen has no topbar).
  173 |     await createStudio(page, `Auth Studio ${Date.now()}`);
  174 |     await page.getByLabel("Account").click();
  175 |     await page.getByRole("menuitem", { name: "Sign out" }).click();
> 176 |     await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
      |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  177 |     await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  178 |     expect(errors.filter(
  179 |         (e) =>
  180 |           e.startsWith("PAGEERROR") &&
  181 |           // dev-server corrupt-chunk artifact, recovered by reload
  182 |           !e.includes("Invalid or unexpected token"),
  183 |       )).toEqual([]);
  184 |   });
  185 | 
  186 |   test("middleware redirects / to /sign-in when signed out", async ({
  187 |     page,
  188 |   }) => {
  189 |     // The default fixture context carries no auth state.
  190 |     await page.goto("/");
  191 |     await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  192 |     await expect(page.locator("#email")).toBeVisible();
  193 |     await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  194 |   });
  195 | });
  196 | 
```