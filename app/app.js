import { fetchIncidents, ack } from './api.js';

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');

/** id -> incident, merged across refreshes (R1). */
const byId = new Map();
/** id -> <li>, kept so a refresh updates rows instead of rebuilding them. */
const rows = new Map();
/** ids taken on this board; survives every refresh (R2). */
const acked = new Set();
let loaded = false;

// R6: the page names its build. scripts/build.mjs writes the sha into the meta tag.
const build = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? 'dev';
document.querySelector('[data-testid="build-sha"]').textContent = build;

// R5: the viewer's own locale decides the order (dd/mm for EU viewers), the viewer's zone the hour.
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

function timeText(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : timeFormat.format(at);
}

function actionSlot(incident) {
  const slot = document.createElement('span');
  slot.className = 'act';
  fillAction(slot, incident.id);
  return slot;
}

function fillAction(slot, id) {
  slot.replaceChildren();
  if (acked.has(id)) {
    const mark = document.createElement('span');
    mark.dataset.testid = 'acked';
    mark.className = 'acked';
    mark.textContent = "I've got this";
    slot.append(mark);
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'ack';
  button.className = 'ack';
  button.textContent = 'Ack';
  button.addEventListener('click', () => onAck(button, id, slot));
  slot.append(button);
}

async function onAck(button, id, slot) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    await ack(id);
    acked.add(id);
  } catch (error) {
    console.error('ack failed', id, error);
    button.disabled = false;
    button.textContent = 'Ack failed — retry';
    return;
  }
  fillAction(slot, id);
}

function makeRow(incident) {
  const row = document.createElement('li');
  row.dataset.testid = 'incident-row';
  row.dataset.id = incident.id;

  const id = document.createElement('span');
  id.className = 'id';
  const severity = document.createElement('span');
  severity.className = 'sev';
  const what = document.createElement('span');
  what.className = 'what';
  const time = document.createElement('time');

  row.append(id, severity, what, time, actionSlot(incident));
  row.parts = { id, severity, what, time };
  fillRow(row, incident);
  return row;
}

function fillRow(row, incident) {
  row.parts.id.textContent = incident.id;
  row.parts.severity.textContent = incident.severity;
  row.parts.what.textContent = `${incident.service} — ${incident.region} — ${incident.summary}`;
  row.parts.time.dateTime = incident.openedAt;
  row.parts.time.textContent = timeText(incident.openedAt);
  row.className = `row ${incident.severity}`;
}

/** R1: newest first, in place, so a refresh never steals a click. */
function render() {
  const ordered = [...byId.values()].sort((a, b) => {
    const delta = new Date(b.openedAt) - new Date(a.openedAt);
    return delta !== 0 ? delta : b.id.localeCompare(a.id);
  });

  ordered.forEach((incident, index) => {
    let row = rows.get(incident.id);
    if (!row) {
      row = makeRow(incident);
      rows.set(incident.id, row);
    } else {
      fillRow(row, incident);
    }
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
  });

  while (list.children.length > ordered.length) list.lastElementChild.remove();
  empty.hidden = ordered.length > 0;
}

function loadedOnce() {
  if (!loaded) {
    loaded = true;
    loader?.remove();
  }
  empty.hidden = byId.size > 0;
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    for (const incident of page.incidents) byId.set(incident.id, incident);
    render();
    loadedOnce();
  } catch (error) {
    console.error('refresh failed', error);
    const waiting = document.querySelector('[data-testid="loader"]');
    if (waiting) waiting.textContent = 'incidents did not load — retrying…';
  }
}

await refresh();

// R4: the board stays current while it is open.
setInterval(refresh, 2000);
