// Checks the four issues against a mocked incident API, so no real ack is spent before the recording.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const appDir = fileURLToPath(new URL('../app/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const port = 4173;

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(appDir, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(port, resolve));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const base = [
  { id: 'INC-1002', service: 'bookings', region: 'eu-west-1', summary: 'reorder loop slow', severity: 'sev1', openedAt: '2026-11-12T03:03:00.000Z' },
  { id: 'INC-1001', service: 'scheduler', region: 'us-east-1', summary: 'queue backlog', severity: 'sev2', openedAt: '2026-11-12T02:40:00.000Z' },
];

const browser = await chromium.launch({ channel: 'msedge' });

async function openBoard({ locale, timezone, incidents, hostname }) {
  const context = await browser.newContext({ locale, timezoneId: timezone, viewport: { width: 1100, height: 620 } });
  const page = await context.newPage();
  const acks = [];
  await page.route('https://hq.mega.dev/challenges/show-me-when/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ack')) {
      const reply = { id: url.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: 'mock-receipt' };
      acks.push(reply);
      await route.fulfill({ json: reply });
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents, cursor: `c${Date.now()}` } });
  });
  await page.goto(`http://localhost:${port}/`);
  return { context, page, acks };
}

// R3: loader shows on open and is gone once incidents are on screen.
{
  const { context, page } = await openBoard({ locale: 'en-GB', timezone: 'Europe/London', incidents: base });
  check('R3 loader visible on open', await page.locator('[data-testid="loader"]').isVisible());
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  check('R3 loader gone after load', (await page.locator('[data-testid="loader"]').count()) === 0);
  check('R1 newest first', (await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id')) === 'INC-1002');
  check('R6 build-sha in footer', (await page.locator('[data-testid="build-sha"]').textContent()) === 'dev');
  check('R6 meta build present', (await page.locator('meta[name="build"]').getAttribute('content')) === 'dev');
  check('empty hidden when rows exist', !(await page.locator('[data-testid="empty"]').isVisible()));
  await context.close();
}

// R5: each viewer sees their own zone and order; the full UTC value stays in the attribute.
{
  const berlin = await openBoard({ locale: 'de-DE', timezone: 'Europe/Berlin', incidents: base });
  const berlinText = await berlin.page.locator('[data-testid="incident-row"] time').first().textContent();
  const datetime = await berlin.page.locator('[data-testid="incident-row"] time').first().getAttribute('datetime');
  check('R5 Berlin shows 04:03 local, day before month', berlinText.includes('04:03') && /\b12\.11/.test(berlinText), berlinText);
  check('R5 datetime keeps UTC', datetime === '2026-11-12T03:03:00.000Z', datetime);
  await berlin.context.close();

  const auckland = await openBoard({ locale: 'en-NZ', timezone: 'Pacific/Auckland', incidents: base });
  const aucklandText = await auckland.page.locator('[data-testid="incident-row"] time').first().textContent();
  const inPageOrder = await auckland.page.evaluate(() =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date('2026-11-12T03:03:00Z')),
  );
  check('R5 Auckland shows 16:03 local, day before month', aucklandText.includes('16:03') && /\b12[./]11/.test(aucklandText), aucklandText);
  check('R5 order comes from the viewer, not a fixed format', /\b12[./]11/.test(inPageOrder), `${inPageOrder} / ${await auckland.page.evaluate(() => navigator.language)}`);
  await auckland.context.close();
}

// R2: Ack sends the ack and marks the row; R4: a new incident arrives at the top without a reload.
{
  const { context, page, acks } = await openBoard({ locale: 'de-DE', timezone: 'Europe/Berlin', incidents: [...base] });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  await page.locator('[data-testid="incident-row"] [data-testid="ack"]').first().click();
  await page.locator('[data-testid="incident-row"] [data-testid="acked"]').first().waitFor();
  check('R2 ack called once for the clicked row', acks.length === 1 && acks[0].id === 'INC-1002');
  check('R2 row marked acked', (await page.locator('[data-id="INC-1002"] [data-testid="acked"]').count()) === 1);
  check('R2 acked row has no Ack button', (await page.locator('[data-id="INC-1002"] [data-testid="ack"]').count()) === 0);

  const next = [{ id: 'INC-1003', service: 'notify', region: 'eu-west-1', summary: 'pager fan-out stuck', severity: 'sev1', openedAt: '2026-11-12T03:10:00.000Z' }, ...base];
  await page.route('https://hq.mega.dev/challenges/show-me-when/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ack')) return route.fulfill({ json: { id: url.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: 'mock-receipt' } });
    route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: next, cursor: `c${Date.now()}` } });
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="incident-row"]').length === 3, null, { timeout: 6000 });
  check('R1 new incident at the top without reload', (await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id')) === 'INC-1003');
  check('R2 ack mark survives a refresh', (await page.locator('[data-id="INC-1002"] [data-testid="acked"]').count()) === 1);
  await context.close();
}

// R3/R1: an empty night shows the empty mark, not an empty board.
{
  const { context, page } = await openBoard({ locale: 'en-GB', timezone: 'Europe/London', incidents: [] });
  await page.locator('[data-testid="empty"]').waitFor({ state: 'visible' });
  check('empty shown when there are no incidents', await page.locator('[data-testid="empty"]').isVisible());
  check('loader gone on an empty night', (await page.locator('[data-testid="loader"]').count()) === 0);
  await context.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
