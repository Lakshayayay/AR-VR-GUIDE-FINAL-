// End-to-end check of a whole call, in two browsers with fake cameras.
//
// Needs both servers running (see README) and three accounts:
//   technician "ravi", expert "mehta" (Dr. Mehta), both with password E2E_PASSWORD.
// Run: npm run e2e        Screenshots go to SHOTS_DIR (default: ./test-results).
// If Playwright's own browser is not installed: npx playwright install chromium (or set CHROME_PATH).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-pass-1";
const SHOTS = process.env.SHOTS_DIR ?? "test-results";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function signIn(context, username) {
  await context.grantPermissions(["camera", "microphone"], { origin: BASE });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[${username}] page error:`, e.stack));
  page.on("console", (m) => m.type() === "error" && console.error(`[${username}] console:`, m.text()));
  pages.push(page);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); // let the page's script load first
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

const step = (text) => console.log(`- ${text}`);
const pages = [];

try {
  const expert = await signIn(await browser.newContext({ viewport: { width: 1440, height: 900 } }), "mehta");
  await expert.waitForURL("**/expert");
  await expert.getByText("No one is waiting").waitFor();
  await shot(expert, "01-expert-waiting");
  step("expert signed in and waiting");

  const techContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const tech = await signIn(techContext, "ravi");
  await tech.waitForURL("**/tech");
  await tech.getByLabel("Aircraft").fill("VT-ABC");
  await tech.getByLabel("Checklist").selectOption({ label: "Engine assembly check" });
  await shot(tech, "02-tech-home");
  await tech.getByRole("button", { name: "Call an expert" }).click();
  await tech.waitForURL(/\/tech\/session\/\d+/);
  const sessionId = tech.url().split("/").pop();
  await tech.getByText("Calling an expert…").waitFor();
  await shot(tech, "03-tech-calling");
  step(`technician is calling (session ${sessionId})`);

  const dialog = expert.getByRole("dialog", { name: "Incoming call" });
  await dialog.getByText("Ravi Kumar").waitFor();
  await shot(expert, "04-expert-incoming");
  await dialog.getByRole("button", { name: "Accept" }).click();
  await expert.waitForURL(`**/expert/session/${sessionId}`);
  step("expert accepted");

  await expert.waitForFunction(() => {
    const v = document.querySelector("video");
    return v && v.videoWidth > 0 && v.currentTime > 0;
  }, null, { timeout: 20000 });
  await tech.getByRole("button", { name: "End call" }).waitFor();
  step("video is flowing from the technician to the expert");

  // Expert draws an arrow; it must appear on the technician's screen.
  const box = await expert.locator("canvas").boundingBox();
  await expert.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expert.mouse.down();
  await expert.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 8 });
  await expert.mouse.up();
  await tech.waitForFunction(() => {
    const c = document.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 16) if (d[i] > 220 && d[i + 1] > 80 && d[i + 1] < 130 && d[i + 2] < 60) return true; // orange
    return false;
  }, null, { timeout: 5000 });
  step("expert's arrow appears on the technician's phone");

  await expert.getByRole("button", { name: "Freeze" }).click();
  await tech.getByText("Picture frozen by Dr. Mehta").waitFor();
  await shot(tech, "05-tech-live-frozen");
  await shot(expert, "06-expert-console-frozen");
  await expert.getByRole("button", { name: "Resume" }).click();
  await tech.getByText("Picture frozen by Dr. Mehta").waitFor({ state: "detached" });
  step("freeze and resume reach the technician");

  await tech.getByRole("region", { name: "Current step" }).getByRole("button", { name: "Done" }).click();
  await expert.getByText(/Done, Ravi Kumar/).first().waitFor();
  step("technician's step result shows on the expert's checklist");

  await expert.getByRole("tab", { name: /Chat/ }).click();
  await expert.getByLabel("Message").fill("Check the clamp near the fuel line");
  await expert.getByRole("button", { name: "Send" }).click();
  await tech.getByRole("button", { name: "Chat (1)" }).waitFor();
  step("chat message arrives");

  await expert.getByRole("button", { name: "Photo" }).click();
  await expert.getByText("Photo saved to the session.").waitFor();
  step("photo saved");

  await expert.getByRole("button", { name: "Record" }).click();
  await tech.getByRole("dialog", { name: "Recording request" }).getByRole("button", { name: "Allow", exact: true }).click();
  await tech.getByText("Recording", { exact: true }).waitFor();
  await expert.waitForTimeout(2500);
  await expert.getByRole("button", { name: "Stop recording" }).click();
  await expert.getByText("Recording saved to the session.").waitFor({ timeout: 15000 });
  step("recording asked for, allowed, and saved");

  await expert.getByRole("tab", { name: "Checklist" }).click();
  const panel = expert.getByRole("tabpanel");
  for (let i = 0; i < 6; i++) {
    await panel.getByRole("button", { name: "Done", exact: true }).and(panel.locator(":enabled")).first().click();
    await expert.waitForTimeout(150);
  }
  await panel.getByRole("button", { name: "Sign off checklist" }).click();
  await panel.getByText("SIGNED OFF").waitFor();
  await tech.getByText("SIGNED OFF").waitFor();
  await shot(tech, "07-tech-signed-off");
  await shot(expert, "08-expert-signed-off");
  step("checklist signed off; stamp shows on both sides");

  await expert.getByRole("button", { name: "End call" }).click();
  await tech.getByText("Call ended").waitFor();
  await shot(tech, "09-tech-ended");
  step("call ended on both sides");

  await expert.goto(`${BASE}/sessions/${sessionId}`);
  await expert.getByRole("heading", { name: "Session report" }).waitFor();
  await expert.getByRole("img", { name: /Photo by Dr. Mehta/ }).waitFor();
  assert.equal(await expert.locator("video").count(), 1, "the recording is on the report");
  await expert.screenshot({ path: `${SHOTS}/10-report.png`, fullPage: true });
  await expert.goto(`${BASE}/sessions`);
  await expert.getByRole("link", { name: /SES-0*\d+/ }).first().waitFor();
  await shot(expert, "11-sessions");
  await expert.goto(`${BASE}/expert`);
  await expert.getByText("Last 7 days").waitFor();
  await shot(expert, "12-expert-home-stats");
  step("report, session list and numbers show the call");

  console.log("\nAll end-to-end checks passed.");
} catch (e) {
  console.error("\nEnd-to-end check FAILED:", e.message);
  process.exitCode = 1;
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/failure-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
}
