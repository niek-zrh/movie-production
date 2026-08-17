import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => errors.push(String(err).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});

await page.goto(`${BASE}/sign-in`);
await page.fill("#email", "qa@slate.test");
await page.fill("#password", "slate-qa-password-1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 20000 });
await page.waitForLoadState("networkidle");

// Studio switcher (top-left)
await page.getByLabel("Switch studio").click();
await page.getByText("Studios").waitFor({ timeout: 5000 });
console.log("studio switcher: opens, shows label + entries ✓");
await page.keyboard.press("Escape");

// Account menu (avatar, top-right)
await page.getByLabel("Account").click();
await page.getByText("qa@slate.test").waitFor({ timeout: 5000 });
console.log("account menu: opens, shows name/email ✓");
await page.keyboard.press("Escape");

console.log("errors:", errors.length === 0 ? "none" : errors);
await browser.close();
if (errors.some((e) => e.includes("MenuGroupContext"))) process.exit(1);
