import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => console.log("[console." + msg.type() + "]", msg.text().slice(0, 300)));
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));
page.on("requestfailed", (req) =>
  console.log("[requestfailed]", req.url().slice(0, 120), req.failure()?.errorText),
);

await page.goto(`${BASE}/sign-in`);
await page.waitForLoadState("networkidle");
await page.getByText("New here? Create an account").click();
await page.fill("#name", "QA Producer");
await page.fill("#email", "qa@slate.test");
await page.fill("#password", "slate-qa-password-1");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForTimeout(6000);
console.log("URL now:", page.url());
console.log("BODY:", (await page.locator("body").innerText()).slice(0, 600));
await page.screenshot({ path: `${SHOTS}/debug-signup.png` });
await browser.close();
