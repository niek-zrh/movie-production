import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const errors = [];
let step = "start";
const fail = (msg) => {
  throw new Error(`[step: ${step}] ${msg}`);
};

// Two tiny valid PNGs (red / blue 8x8)
const png = (hex) => {
  const b64 = {
    red: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQowMTAwMAAAJgYBLZ01WQAAAABJRU5ErkJggg==",
    blue: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVR4nGNkYPj/n4GBgYGJAQYwMzAwMAAAJgIBFeXY+MAAAAAASUVORK5CYII=",
  }[hex];
  return Buffer.from(b64, "base64");
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => errors.push("PAGEERROR: " + String(err).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("📸 " + name);
};

// 1. Sign up fresh → create studio ------------------------------------------
step = "signup";
await page.goto(`${BASE}/sign-in`);
await page.getByText("New here? Create an account").click();
await page.fill("#name", "Flow Tester");
await page.fill("#email", `flow-${Date.now()}@slate.test`);
await page.fill("#password", "slate-qa-password-1");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 20000 });

step = "create-studio";
await page.fill("#studio-name", "QA Lab");
await page.getByRole("button", { name: "Create studio" }).click();
await page.getByText("Productions").first().waitFor({ timeout: 15000 });
await shot("f01-new-studio");

// 2. Wizard ------------------------------------------------------------------
step = "wizard";
await page.getByRole("link", { name: /New production/i }).first().click();
await page.waitForURL(/\/new/);
await page.getByLabel(/name/i).first().fill("Test Feature");
await shot("f02-wizard-step1");
await page.getByRole("button", { name: /Create & continue/i }).click();
await page.getByText(/Skip for now/i).waitFor({ timeout: 15000 });
await shot("f03-wizard-step2");
await page.getByRole("button", { name: /Skip for now/i }).click();
await page.getByRole("button", { name: /Open production/i }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: /Open production/i }).click();
await page.waitForURL(/\/p\//, { timeout: 15000 });
const prodUrl = page.url().replace(/\/$/, "");
console.log("production:", prodUrl);

// 3. Bulk create shots -------------------------------------------------------
step = "bulk-create";
await page.goto(prodUrl + "/shots");
await page.waitForLoadState("networkidle");
await shot("f04-shots-empty");
await page.locator("textarea").first().fill("SC001_SH010\nSC001_SH020\nSC001_SH030");
await page.getByRole("button", { name: /create/i }).first().click();
await page.getByText("SC001_SH030").waitFor({ timeout: 15000 });
await shot("f05-shots-bulk");

// 4. Upload two versions -----------------------------------------------------
step = "upload";
await page.getByText("SC001_SH010").first().click();
await page.waitForURL(/shots\/[a-z0-9]+/);
await page.waitForLoadState("networkidle");
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles([
  { name: "option-a.png", mimeType: "image/png", buffer: png("red") },
  { name: "option-b.png", mimeType: "image/png", buffer: png("blue") },
]);
await page.getByText(/v2/).first().waitFor({ timeout: 25000 });
await shot("f06-uploaded");

// 5. Review room keyboard flow ----------------------------------------------
step = "review-room";
await page.goto(prodUrl + "/review");
await page.waitForLoadState("networkidle");
await page.getByText("SC001_SH010").first().click();
await page.waitForURL(/review\/[a-z0-9]+/);
await page.waitForTimeout(1500);
await page.keyboard.press("s"); // shortlist v1
await page.waitForTimeout(600);
await page.keyboard.press("ArrowRight");
await page.keyboard.press("s"); // shortlist v2
await page.waitForTimeout(600);
await page.keyboard.press("2"); // 2-up
await shot("f07-room-2up-shortlisted");
await page.keyboard.press("p"); // pick dialog
await page.waitForTimeout(800);
await shot("f08-pick-dialog");
const dialogText = await page.locator('[role="dialog"]').innerText().catch(() => "");
if (!/_v\d+\./.test(dialogText)) fail("pick dialog lacks canonical filename: " + dialogText.slice(0, 200));
await page.locator('[role="dialog"] textarea').fill("Best silhouette — QA pick");
await page.getByRole("button", { name: /Pick this version/i }).click();
await page.waitForTimeout(2500);
await shot("f09-after-pick");

// 6. Verify pick took --------------------------------------------------------
step = "verify-pick";
await page.goto(prodUrl + "/shots");
await page.waitForLoadState("networkidle");
const row = page.locator("tr", { hasText: "SC001_SH010" });
const rowText = await row.innerText().catch(async () => await page.locator("body").innerText());
if (!/picked/i.test(rowText)) fail("shot not marked picked: " + rowText.slice(0, 200));
await shot("f10-shot-picked");

step = "decisions";
await page.goto(prodUrl + "/decisions");
await page.getByText(/Pick/).first().waitFor({ timeout: 10000 });
await shot("f11-decisions-pick");

// 7. Gate flow: set approver → request → approve ----------------------------
step = "gate-approvers";
await page.goto(prodUrl + "/settings");
await page.waitForLoadState("networkidle");
const approverBtn = page.getByRole("button", { name: /add approvers|approvers|set approvers/i }).first();
if (await approverBtn.count()) {
  await approverBtn.click();
} else {
  // popover trigger might be labeled differently; try first popover in stages section
  await page.getByText(/gate approver/i).first().click().catch(() => {});
}
await page.getByText("Flow Tester").first().click().catch(() => console.log("could not toggle approver checkbox"));
await page.keyboard.press("Escape");
await shot("f12-settings-approvers");

step = "gate-request";
await page.goto(prodUrl + "/board");
await page.waitForLoadState("networkidle");
const colMenu = page.getByLabel("Development menu");
await colMenu.click();
await page.waitForTimeout(900);
await shot("f13a-menu-open");
console.log(
  "menus:",
  await page.locator('[role="menu"], [data-slot="dropdown-menu-content"]').count(),
  "| text:",
  (await page.locator('[role="menu"], [data-slot="dropdown-menu-content"]').allInnerTexts()).join(" / ").slice(0, 200),
);
await page.getByText(/Request sign-off/i).click();
await page.waitForTimeout(1200);
await shot("f13-gate-requested");
await colMenu.click();
await page.getByText(/Approve gate/i).click();
await page.waitForTimeout(600);
await page.locator('[role="dialog"] textarea').fill("QA gate approval").catch(() => {});
await page.getByRole("button", { name: /Approve gate/i }).last().click();
await page.waitForTimeout(1500);
const boardText = await page.locator("body").innerText();
if (!/gate approved/i.test(boardText)) console.log("WARN: gate approved chip not found");
await shot("f14-gate-approved");

// 8. Report ------------------------------------------------------------------
step = "report";
await page.goto(prodUrl + "/reports");
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /Generate now/i }).first().click();
await page.waitForTimeout(2000);
await shot("f15-report");
const repText = await page.locator("body").innerText();
if (!/1/.test(repText)) console.log("WARN report numbers unclear");
await page.getByRole("button", { name: /Publish/i }).first().click().catch(() => console.log("no publish button"));
await page.waitForTimeout(1200);
await shot("f16-report-published");

// 9. QC ----------------------------------------------------------------------
step = "qc";
await page.goto(prodUrl + "/qc");
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /Seed the standard/i }).click({ timeout: 5000 }).catch(() => console.log("template maybe already seeded"));
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /New QC run/i }).first().click();
await page.locator('[role="dialog"] input').first().fill("EP01 — TV Master v1");
await page.locator('[role="dialog"]').getByRole("button", { name: /Start QC run/i }).click();
await page.waitForURL(/qc\/[a-z0-9]+/, { timeout: 15000 });
await page.waitForLoadState("networkidle");
await shot("f17-qc-run");
step = "qc-checks";
const passButtons = page.getByRole("button", { name: /^Pass$/ });
const total = await passButtons.count();
console.log("pass buttons:", total);
for (let i = 0; i < total; i++) {
  await passButtons.nth(i).click();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1500);
const qcText = await page.locator("body").innerText();
if (!/passed/i.test(qcText)) console.log("WARN: run not marked passed");
await shot("f18-qc-passed");

step = "qc-in-decisions";
await page.goto(prodUrl + "/decisions");
await page.waitForTimeout(1200);
const decText = await page.locator("body").innerText();
if (!/Delivery/i.test(decText)) console.log("WARN: delivery sign-off not in ledger");
await shot("f19-decisions-final");

console.log("\nFLOW COMPLETE. Console errors (" + errors.length + "):");
for (const e of [...new Set(errors)].slice(0, 15)) console.log(" - " + e);
await browser.close();
