// Records the board while a fresh incident lands, then acks that incident at once.
// Why: the course refused an ack that sat 46 minutes after its incident opened.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, outDir, resultFile] = process.argv.slice(2);
if (!url || !outDir || !resultFile) throw new Error('usage: record2.mjs <board url> <video dir> <result json>');

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
const log = (what) => {
  events.push({ at: stamp(Date.now() - started), atMs: Date.now() - started, what });
  console.log(stamp(Date.now() - started), what);
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

// Wait for an incident that was not on the board when it opened.
const fresh = await page.waitForFunction(
  (seen) => {
    const row = [...document.querySelectorAll('[data-testid="incident-row"]')].find((r) => !seen.includes(r.dataset.id));
    return row ? row.dataset.id : false;
  },
  opening,
  { timeout: 600000, polling: 100 },
);
const id = await fresh.jsonValue();
log(`new incident ${id} landed`);

const row = page.locator(`[data-testid="incident-row"][data-id="${id}"]`);
const openedAt = await row.locator('time').getAttribute('datetime');
await row.locator('[data-testid="ack"]').click({ timeout: 5000 });
log(`clicked Ack on ${id}`);
await row.locator('[data-testid="acked"]').waitFor({ timeout: 20000 });
log(`row ${id} marked acked`);
await page.waitForTimeout(6000);

const build = await page.locator('[data-testid="build-sha"]').textContent();
await page.screenshot({ path: resultFile.replace(/\.json$/, '.png') });
await page.close();
const videoPath = await page.video().path();
await context.close();
await browser.close();

const result = {
  url,
  build,
  ackedIncident: id,
  openedAt,
  ack: ackReply,
  ackAt: ackReply?.at ?? null,
  gapSeconds: ackReply ? Math.round((new Date(ackReply.ackedAt) - new Date(openedAt)) / 1000) : null,
  events,
  videoPath,
  videoBytes: statSync(videoPath).size,
};
writeFileSync(resultFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, events: `${events.length} events` }, null, 2));
