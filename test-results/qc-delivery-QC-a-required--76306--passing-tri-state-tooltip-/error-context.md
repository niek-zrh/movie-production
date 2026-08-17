# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qc.spec.ts >> delivery QC >> a required check on N/A keeps the run from passing (tri-state + tooltip)
- Location: e2e/tests/qc.spec.ts:186:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Required — N/A keeps the run open')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Required — N/A keeps the run open')

```

```yaml
- banner:
  - link "Slate home":
    - /url: /
  - button "Switch studio": QC Studio E2E
  - button "Search ⌘K"
  - button "Notifications"
  - button "Account": QQ
- complementary:
  - paragraph: QC Feature E2E
  - paragraph: QFE
  - navigation:
    - link "Overview":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n
    - link "Board":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/board
    - link "Shots":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/shots
    - link "Review":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/review
    - link "Files":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/files
    - link "Decisions":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/decisions
    - link "Reports":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/reports
    - link "QC":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/qc
    - link "Settings":
      - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/settings
- main:
  - link "All QC runs":
    - /url: /p/m570rd6zm935jas66ef0cxvwg58cm18n/qc
  - heading "EP01 Master QC" [level=1]
  - text: In progress Started 09:35
  - paragraph: QC in progress
  - paragraph: All required checks must pass before this master can ship.
  - text: 24/26 checked
  - heading "Video" [level=2]
  - text: 8/8
  - list:
    - listitem:
      - text: Codec XDCAM HD 50 / ProRes 422 HQ QQ 09:35
      - textbox "Measured value for Codec":
        - /placeholder: XDCAM HD 50 / ProRes 422 HQ
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Resolution 3840×2160 QQ 09:35
      - textbox "Measured value for Resolution":
        - /placeholder: 3840×2160
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Frame rate 25p QQ 09:35
      - textbox "Measured value for Frame rate":
        - /placeholder: 25p
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Scan Progressive QQ 09:35
      - textbox "Measured value for Scan":
        - /placeholder: Progressive
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Color space Rec.709, gamma 2.4 QQ 09:35
      - textbox "Measured value for Color space":
        - /placeholder: Rec.709, gamma 2.4
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Video bitrate Within channel spec QQ 09:35
      - textbox "Measured value for Video bitrate":
        - /placeholder: Within channel spec
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: No dropped/frozen frames None present QQ 09:35
      - textbox "Measured value for No dropped/frozen frames":
        - /placeholder: None present
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: No visible upscaling artifacts None visible QQ 09:35
      - textbox "Measured value for No visible upscaling artifacts":
        - /placeholder: None visible
      - button "Pass"
      - button "Fail"
      - button "N/A"
  - heading "Audio" [level=2]
  - text: 8/8
  - list:
    - listitem:
      - text: Loudness (EBU R128) -23 LUFS · ±0.5 LU QQ 09:35
      - textbox "Measured value for Loudness (EBU R128)":
        - /placeholder: "-23 LUFS"
      - button "Pass"
      - button "Fail"
      - button "N/A"
      - textbox "Failure note for Loudness (EBU R128)":
        - /placeholder: What failed?
        - text: Measured -18 LUFS, too hot
    - listitem:
      - text: True peak ≤ -1 dBTP QQ 09:35
      - textbox "Measured value for True peak":
        - /placeholder: ≤ -1 dBTP
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Sample rate 48 kHz QQ 09:35
      - textbox "Measured value for Sample rate":
        - /placeholder: 48 kHz
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Bit depth 24-bit QQ 09:35
      - textbox "Measured value for Bit depth":
        - /placeholder: 24-bit
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Channel layout Stereo (+5.1 if required) QQ 09:35
      - textbox "Measured value for Channel layout":
        - /placeholder: Stereo (+5.1 if required)
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: A/V sync Within ±1 frame · ±1 frame QQ 09:35
      - textbox "Measured value for A/V sync":
        - /placeholder: Within ±1 frame
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: No clipping/dropouts None present QQ 09:35
      - textbox "Measured value for No clipping/dropouts":
        - /placeholder: None present
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Dialogue stems delivered Stems folder present QQ 09:35
      - textbox "Measured value for Dialogue stems delivered":
        - /placeholder: Stems folder present
      - button "Pass"
      - button "Fail"
      - button "N/A"
  - heading "Container" [level=2]
  - text: 6/6
  - list:
    - listitem:
      - text: Container MXF OP1a (or ProRes .mov per channel spec) QQ 09:35
      - textbox "Measured value for Container":
        - /placeholder: MXF OP1a (or ProRes .mov per channel spec)
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: "Filename convention {CODE}_{EP}_MASTER_v{n} QQ 09:35"
      - textbox "Measured value for Filename convention":
        - /placeholder: "{CODE}_{EP}_MASTER_v{n}"
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: MD5 checksum delivered Checksum file accompanies master QQ 09:35
      - textbox "Measured value for MD5 checksum delivered":
        - /placeholder: Checksum file accompanies master
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Start timecode 10:00:00:00 QQ 09:35
      - textbox "Measured value for Start timecode":
        - /placeholder: 10:00:00:00
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: "Head: black before program 1s black QQ 09:35"
      - 'textbox "Measured value for Head: black before program"':
        - /placeholder: 1s black
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Duration matches slate ±1 frame · ±1 frame QQ 09:35
      - textbox "Measured value for Duration matches slate":
        - /placeholder: ±1 frame
      - button "Pass"
      - button "Fail"
      - button "N/A"
  - heading "Content" [level=2]
  - text: 1/3
  - list:
    - listitem:
      - text: Poster frame provided Delivered alongside master
      - textbox "Measured value for Poster frame provided":
        - /placeholder: Delivered alongside master
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Subtitles file present SRT/STL
      - textbox "Measured value for Subtitles file present":
        - /placeholder: SRT/STL
      - button "Pass"
      - button "Fail"
      - button "N/A"
    - listitem:
      - text: Slate info correct Title, episode, duration, date QQ 09:35
      - textbox "Measured value for Slate info correct":
        - /placeholder: Title, episode, duration, date
      - button "Pass"
      - button "Fail"
      - button "N/A"
  - heading "Metadata" [level=2]
  - text: 1/1
  - list:
    - listitem:
      - text: Language/version tag Correct per delivery QQ 09:35
      - textbox "Measured value for Language/version tag":
        - /placeholder: Correct per delivery
      - button "Pass"
      - button "Fail"
      - button "N/A"
  - heading "Comments" [level=2]
  - paragraph: No comments yet — notes about this master land here.
  - textbox "Add a note for the team…"
  - button "Comment" [disabled]
- heading "Search" [level=2]
- paragraph: Search for a command to run...
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  99  |       .click();
  100 |     await expect(page.getByText("25 checks")).toBeVisible();
  101 |   });
  102 | 
  103 |   test("a custom required Audio parameter appears in the template", async () => {
  104 |     // Section collapses once seeded — expand it to reach "Add check".
  105 |     await page.getByRole("button", { name: /QC template/ }).click();
  106 |     await page.getByRole("button", { name: "Add check" }).click();
  107 | 
  108 |     const dialog = page.locator('[role="dialog"]');
  109 |     await expect(
  110 |       dialog.getByRole("heading", { name: "Add a QC check" }),
  111 |     ).toBeVisible();
  112 |     await dialog.locator('[role="combobox"]').click();
  113 |     await page.getByRole("option", { name: "Audio" }).click();
  114 |     await dialog.locator("#qc-param-name").fill(CUSTOM_CHECK);
  115 |     await dialog.locator("#qc-param-spec").fill("Stems folder present");
  116 |     // "Required" checkbox defaults to checked — leave it.
  117 |     await expect(dialog.locator('[role="checkbox"]')).toHaveAttribute(
  118 |       "aria-checked",
  119 |       "true",
  120 |     );
  121 |     await dialog.getByRole("button", { name: "Add check" }).click();
  122 | 
  123 |     await expect(page.getByText("26 checks")).toBeVisible();
  124 |     await expect(
  125 |       page.locator('h3:has-text("Audio") + ul').getByText(CUSTOM_CHECK),
  126 |     ).toBeVisible();
  127 |   });
  128 | 
  129 |   test("New QC run opens the run page with all checks pending", async () => {
  130 |     await page.getByRole("button", { name: "New QC run" }).first().click();
  131 |     await page.locator("#qc-run-name").fill(RUN_NAME);
  132 |     await page.getByRole("button", { name: "Start QC run" }).click();
  133 |     await page.waitForURL(/\/qc\/[a-z0-9]+$/, { timeout: 15_000 });
  134 | 
  135 |     await expect(page.getByRole("heading", { name: RUN_NAME })).toBeVisible();
  136 |     await expect(page.getByText("QC in progress")).toBeVisible();
  137 |     await expect(page.getByText("0/26 checked")).toBeVisible();
  138 | 
  139 |     // Owner has the full tri-state controls on every row.
  140 |     const firstRow = checkRow("Codec");
  141 |     await expect(
  142 |       firstRow.getByRole("button", { name: "Pass", exact: true }),
  143 |     ).toBeVisible();
  144 |     await expect(
  145 |       firstRow.getByRole("button", { name: "Fail", exact: true }),
  146 |     ).toBeVisible();
  147 |     await expect(firstRow.getByRole("button", { name: "N/A" })).toBeVisible();
  148 |   });
  149 | 
  150 |   test("failing a required check fails the run; passing it clears the banner", async () => {
  151 |     const loudness = checkRow("Loudness (EBU R128)");
  152 |     await loudness.getByRole("button", { name: "Fail", exact: true }).click();
  153 | 
  154 |     await expect(
  155 |       page.getByText("Master failed QC — fix and re-check"),
  156 |     ).toBeVisible();
  157 |     await expect(page.getByText("1 required check failing")).toBeVisible();
  158 | 
  159 |     // Note field appears once failing; save on blur.
  160 |     const note = page.getByLabel("Failure note for Loudness (EBU R128)");
  161 |     await note.fill("Measured -18 LUFS, too hot");
  162 |     await note.blur();
  163 | 
  164 |     await loudness.getByRole("button", { name: "Pass", exact: true }).click();
  165 |     // Other required checks still pending → back to in progress, not passed.
  166 |     await expect(page.getByText("QC in progress")).toBeVisible();
  167 |   });
  168 | 
  169 |   test("passing every required check turns the banner to passed", async () => {
  170 |     for (const name of REQUIRED_DEFAULTS) {
  171 |       if (name === "Loudness (EBU R128)") continue; // already passed
  172 |       await checkRow(name)
  173 |         .getByRole("button", { name: "Pass", exact: true })
  174 |         .click();
  175 |     }
  176 |     await checkRow(CUSTOM_CHECK)
  177 |       .getByRole("button", { name: "Pass", exact: true })
  178 |       .click();
  179 | 
  180 |     await expect(page.getByText("Passed — ready for delivery")).toBeVisible({
  181 |       timeout: 20_000,
  182 |     });
  183 |     await expect(page.getByText("24/26 checked")).toBeVisible();
  184 |   });
  185 | 
  186 |   test("a required check on N/A keeps the run from passing (tri-state + tooltip)", async () => {
  187 |     const sampleRate = checkRow("Sample rate");
  188 |     const naButton = sampleRate.getByRole("button", { name: "N/A" });
  189 | 
  190 |     await naButton.click();
  191 |     await expect(page.getByText("QC in progress")).toBeVisible();
  192 |     await expect(page.getByText("Passed — ready for delivery")).toHaveCount(0);
  193 |     // N/A still counts as checked — the run just can't pass.
  194 |     await expect(page.getByText("24/26 checked")).toBeVisible();
  195 | 
  196 |     await naButton.hover();
  197 |     await expect(
  198 |       page.getByText("Required — N/A keeps the run open"),
> 199 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  200 | 
  201 |     // Tri-state: clicking the active state again resets the check to pending.
  202 |     await naButton.click();
  203 |     await expect(page.getByText("23/26 checked")).toBeVisible();
  204 |     await expect(page.getByText("QC in progress")).toBeVisible();
  205 | 
  206 |     await sampleRate.getByRole("button", { name: "Pass", exact: true }).click();
  207 |     await expect(page.getByText("Passed — ready for delivery")).toBeVisible();
  208 |     await expect(page.getByText("24/26 checked")).toBeVisible();
  209 |   });
  210 | 
  211 |   test("the pass lands as an approved Delivery row in Decisions", async () => {
  212 |     await page.goto(`${base}/decisions`);
  213 |     const approvedDelivery = page
  214 |       .getByRole("row")
  215 |       .filter({ hasText: `QC: ${RUN_NAME}` })
  216 |       .filter({ hasText: "Approved" });
  217 |     await expect(approvedDelivery.first()).toBeVisible();
  218 |     await expect(
  219 |       approvedDelivery.first().getByText("Delivery", { exact: true }),
  220 |     ).toBeVisible();
  221 | 
  222 |     const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
  223 |     expect(pageErrors).toEqual([]);
  224 |   });
  225 | });
  226 | 
```