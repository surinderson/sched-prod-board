// Records the ack race: the pointer is on one row, a new incident lands and shifts the list,
// and the click lands on the row that moved under the pointer.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, outDir, resultFile] = process.argv.slice(2);
if (!url || !outDir || !resultFile) throw new Error('usage: record3.mjs <board url> <video dir> <result json>');

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(resultFile), { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  viewport: { width: 1180, height: 600 },
  recordVideo: { dir: outDir, size: { width: 1180, height: 600 } },
});
const page = await context.newPage();

const started = Date.now();
const stamp = (ms) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const events = [];
const log = (what, extra = {}) => {
  events.push({ at: stamp(Date.now() - started), atMs: Date.now() - started, what, ...extra });
  console.log(stamp(Date.now() - started), what, JSON.stringify(extra));
};

let ackReply = null;
page.on('console', (message) => {
  const text = message.text();
  if (text.startsWith('ack ')) {
    const [, id, ackedAt, receipt] = text.split(' ');
    ackReply = { id, ackedAt, receipt, atMs: Date.now() - started, at: stamp(Date.now() - started) };
    log(`ack reply for ${id}`);
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="incident-row"]').first().waitFor({ timeout: 30000 });
const opening = await page.$$eval('[data-testid="incident-row"]', (rows) => rows.map((r) => r.dataset.id));
log(`board open with ${opening.length} incidents`);

// Aim at the top row's Ack button, then keep the pointer still while the list moves under it.
const aimed = page.locator('[data-testid="incident-row"]').first();
const aimedId = await aimed.getAttribute('data-id');
const aimedOpenedAt = await aimed.locator('time').getAttribute('datetime');
const box = await aimed.locator('[data-testid="ack"]').boundingBox();
if (!box) throw new Error('no Ack button to aim at');
const x = Math.round(box.x + box.width / 2);
const y = Math.round(box.y + box.height / 2);
await page.mouse.move(x, y);
log(`pointer on row ${aimedId}`, { x, y });

const fresh = await page.waitForFunction(
  (seen) => {
    const row = [...document.querySelectorAll('[data-testid="incident-row"]')].find((r) => !seen.includes(r.dataset.id));
    return row ? row.dataset.id : false;
  },
  opening,
  { timeout: 600000, polling: 100 },
);
const landedId = await fresh.jsonValue();
const underPointer = await page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el?.closest('[data-testid="incident-row"]')?.dataset.id ?? null;
}, [x, y]);
log(`new incident ${landedId} landed; row under the pointer is now ${underPointer}`, { landedId, underPointer });

await page.waitForTimeout(800);
await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.up();
log('clicked where the aimed row had been');

await page.waitForTimeout(1500);
const ackedRowId = await page.evaluate(() => {
  const mark = document.querySelector('[data-testid="incident-row"] [data-testid="acked"]');
  return mark?.closest('[data-testid="incident-row"]')?.dataset.id ?? null;
});
log(`row showing the acked mark: ${ackedRowId}`, { ackedRowId });

const build = await page.locator('[data-testid="build-sha"]').textContent();
await page.waitForTimeout(5000);
await page.screenshot({ path: resultFile.replace(/\.json$/, '.png') });
await page.close();
const videoPath = await page.video().path();
await context.close();
await browser.close();

const result = {
  url,
  build,
  aimedAt: aimedId,
  aimedOpenedAt,
  landed: landedId,
  rowUnderPointerAfterLanding: underPointer,
  ackedRowMarked: ackedRowId,
  receiptId: ackReply?.id ?? null,
  expected: aimedId,
  got: ackReply?.id ?? null,
  misHit: Boolean(ackReply && ackReply.id !== aimedId),
  ack: ackReply,
  events,
  videoPath,
  videoBytes: statSync(videoPath).size,
};
writeFileSync(resultFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, events: undefined }, null, 2));
