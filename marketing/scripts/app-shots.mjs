/**
 * Capture REAL screenshots of the running Ryco web app (ryco-cli on :13773).
 * Pair ONCE, then drive the live page sequentially (no reloads — the pairing
 * token is session-bound). Each action is guarded.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const PORT = process.env.RYCO_PORT || "13773";
const TOKEN = process.env.RYCO_TOKEN;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = new URL("../app-screenshots/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(`${BASE}/pair#token=${TOKEN}`, { waitUntil: "networkidle" });
await sleep(2000);
// Single load of the app after pairing (repeated reloads drop the session token).
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.locator('[data-testid="command-palette-trigger"]').first().waitFor({ state: "visible", timeout: 20000 });
await sleep(1500);

let i = 0;
const shot = async (name) => {
  await sleep(700);
  await page.screenshot({ path: `${OUT}${String(++i).padStart(2, "0")}-${name}.png` });
  console.log("✓", name);
};
const act = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log("△", name, "-", e.message.split("\n")[0].slice(0, 70));
  }
};
const esc = async () => {
  await page.keyboard.press("Escape");
  await sleep(500);
};
const clickRole = (name, opts = {}) =>
  page.getByRole("button", { name, ...opts }).first().click({ force: true, timeout: 6000 });
const clickSel = (sel) => page.locator(sel).first().click({ force: true, timeout: 6000 });

// 1) Home (empty thread).
await shot("home");

// 2) Composer with a real prompt typed in.
await act("composer", async () => {
  await clickSel('[data-testid="composer-editor"]');
  await page.keyboard.type(
    "Refactor the reconnect loop to use capped exponential backoff, add a Vitest case, then open a PR.",
    { delay: 5 },
  );
});
await shot("composer-prompt");

// 3) Model picker open.
await act("model", () => clickRole(/GPT-5/i));
await shot("model-picker");
await esc();

// 4) Command palette (full list).
await act("palette", async () => {
  await clickSel('[data-testid="command-palette-trigger"]');
  await sleep(900);
});
await shot("command-palette");
await esc();

// 5) Terminal drawer.
await act("terminal", async () => {
  await clickRole(/Open Terminal/i);
  await sleep(1200);
});
await shot("terminal");
await esc();

// 6) Project overview panel.
await act("overview", () => clickSel('[data-testid="project-overview-button"]'));
await shot("project-overview");
await esc();

// 7) Settings → default tab.
await act("settings", async () => {
  await clickRole(/^Settings$/i);
  await sleep(1100);
});
await shot("settings");

// 8) Settings → Providers (blur account identities — PII — before the shot).
await act("providers", async () => {
  await page.getByText(/^Providers$/i).first().click({ force: true, timeout: 5000 });
  await sleep(900);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      const t = el.textContent || "";
      if (
        el.children.length === 0 &&
        /Authenticated as|GitHub User|opencode –|@|Subscription/i.test(t)
      ) {
        // Blur only the identity fragment, keep "Authenticated · …Subscription" legible.
        if (/Authenticated as|GitHub User|·\s*sak|@/i.test(t)) {
          el.style.filter = "blur(5px)";
          el.style.userSelect = "none";
        }
      }
    }
  });
  await sleep(300);
});
await shot("settings-providers");

// 9) Settings → Appearance/Themes.
await act("appearance", async () => {
  await page.getByText(/Appearance|Themes/i).first().click({ force: true, timeout: 5000 });
  await sleep(900);
});
await shot("settings-appearance");
await esc();

console.log("captures complete");
await browser.close();
