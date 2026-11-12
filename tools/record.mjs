// Records the deployed board in use and keeps the ack receipt that belongs to the moment shown.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, outDir, resultFile] = process.argv.slice(2);
if (!url || !outDir || !resultFile) throw new Error('usage: record.mjs <board url> <video dir> <result json>');

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(resultFile), { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  viewport: { width: 1280, height: 760 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 760 } },
});
const page = await context.newPage();

const started = Date.now();
const console_ = [];
let ack = null;

const stamp = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

page.on('console', (message) => {
  const text = message.text();
  console_.push({ atMs: Date.now() - started, type: message.type(), text });
  // api.js logs: ack <id> <ackedAt> <receipt>
  if (text.startsWith('ack ')) {
    const [, id, ackedAt, receipt] = text.split(' ');
    ack = { id, ackedAt, receipt, atMs: Date.now() - started };
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="incident-row"]').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);

const first = page.locator('[data-testid="incident-row"]').first();
const id = await first.getAttribute('data-id');

await first.locator('[data-testid="ack"]').click();
await page.locator(`[data-id="${id}"] [data-testid="acked"]`).waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);

// Keep the board open so the recording shows it staying current without a reload.
const rowsBefore = await page.locator('[data-testid="incident-row"]').count();
await page.waitForTimeout(14000);
const rowsAfter = await page.locator('[data-testid="incident-row"]').count();

await page.screenshot({ path: resultFile.replace(/\.json$/, '.png'), fullPage: false });
const build = await page.locator('[data-testid="build-sha"]').textContent();

await page.close();
const videoPath = await page.video().path();
await context.close();
await browser.close();

const result = {
  url,
  build,
  ackedIncident: id,
  clickedAt: ack ? stamp(ack.atMs) : null,
  ack,
  rowsBefore,
  rowsAfter,
  videoPath,
  videoBytes: (await import('node:fs')).statSync(videoPath).size,
  console: console_,
};
writeFileSync(resultFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, console: `${console_.length} lines` }, null, 2));
