import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + String(err).slice(0, 300)));

async function shot(name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log("📸 " + name);
}

// --- Sign up as QA producer (claims Aurora North invite) --------------------
await page.goto(`${BASE}/sign-in`);
await page.waitForLoadState("networkidle");
await shot("00-signin");
const signUp = process.env.QA_SIGNUP === "1";
if (signUp) {
  await page.getByText("New here? Create an account").click();
  await page.fill("#name", "QA Producer");
}
await page.fill("#email", "qa@slate.test");
await page.fill("#password", "slate-qa-password-1");
await page
  .getByRole("button", { name: signUp ? "Create account" : "Sign in" })
  .click();
await page.waitForURL(`${BASE}/`, { timeout: 20000 });
await page.waitForLoadState("networkidle");
await shot("01-studio-home");

// --- Into SIGNAL LOST -------------------------------------------------------
await page.getByText("SIGNAL LOST").first().click();
await page.waitForURL(/\/p\//, { timeout: 15000 });
await page.waitForLoadState("networkidle");
const prodUrl = page.url();
await shot("02-overview");

const tab = async (label, name) => {
  await page.goto(prodUrl.replace(/\/$/, "") + label);
  await page.waitForLoadState("networkidle");
  await shot(name);
};

await tab("/board", "03-board");
await tab("/shots", "04-shots-table");
// grid view
await page.getByRole("button", { name: /grid/i }).click().catch(() => console.log("no grid toggle button by name"));
await shot("05-shots-grid");

// shot detail SC010_SH020
await page.goto(prodUrl + "/shots");
await page.waitForLoadState("networkidle");
await page.getByText("SC010_SH020").first().click();
await page.waitForURL(/shots\/[a-z0-9]+/, { timeout: 15000 });
await page.waitForLoadState("networkidle");
await shot("06-shot-detail-options");
await page.getByRole("tab", { name: /discussion/i }).click().catch(async () => {
  await page.getByText("Discussion").first().click().catch(() => console.log("no discussion tab"));
});
await shot("07-shot-discussion");

await tab("/review", "08-review-queue");
// enter review room for SC010_SH020
await page.getByText("SC010_SH020").first().click();
await page.waitForURL(/review\/[a-z0-9]+/, { timeout: 15000 });
await page.waitForLoadState("networkidle");
await shot("09-review-room-1up");
await page.keyboard.press("2");
await shot("10-review-room-2up");
await page.keyboard.press("4");
await shot("11-review-room-4up");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Escape");
await page.waitForURL(/\/review$/, { timeout: 10000 }).catch(() => console.log("esc did not return to queue"));

await tab("/files", "12-files");
await tab("/decisions", "13-decisions");
await tab("/reports", "14-reports");
await tab("/qc", "15-qc");
await tab("/settings", "16-settings");

await page.goto(`${BASE}/team`);
await page.waitForLoadState("networkidle");
await shot("17-team");

// bell
await page.getByRole("button", { name: "Notifications" }).click();
await shot("18-bell");

// command palette
await page.keyboard.press("Escape");
await page.keyboard.press("Meta+k");
await page.keyboard.type("SC020");
await page.waitForTimeout(600);
await shot("19-palette");

console.log("\nCONSOLE ERRORS (" + consoleErrors.length + "):");
for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log(" - " + e);
await browser.close();
