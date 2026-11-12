import { fetchIncidents, ack } from './api.js';

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const panel = document.querySelector('[data-testid="incident-panel"]');

/** id -> incident, merged across refreshes (R1). */
const byId = new Map();
/** id -> <li>, kept so a refresh updates rows instead of rebuilding them. */
const rows = new Map();
/** ids taken on this board; survives every refresh (R2). */
const acked = new Set();
/** the incident whose panel is open - the ack on that panel names this id, so a landing cannot retarget it. */
let openId = null;
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

function ackedMark() {
  const mark = document.createElement('span');
  mark.dataset.testid = 'acked';
  mark.className = 'acked';
  mark.textContent = "I've got this";
  return mark;
}

/* ---------- the panel: product moved the Ack off the row and into the incident panel ---------- */

function buildPanel(incident) {
  panel.replaceChildren();
  panel.dataset.id = incident.id;

  const head = document.createElement('div');
  head.className = 'panel-head';
  const title = document.createElement('h2');
  title.className = 'panel-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    openId = null;
    renderPanel();
  });
  head.append(title, close);

  const what = document.createElement('p');
  what.className = 'panel-what';
  const when = document.createElement('p');
  when.className = 'panel-when';
  const action = document.createElement('div');
  action.className = 'panel-act';

  panel.append(head, what, when, action);
  panel.parts = { title, what, when, action };
  fillPanel(incident);
}

function fillPanel(incident) {
  panel.dataset.id = incident.id;
  panel.parts.title.textContent = `${incident.id} · ${incident.service} — ${incident.region}`;
  panel.parts.what.textContent = incident.summary;
  panel.parts.when.textContent = `${incident.severity} · opened ${timeText(incident.openedAt)}`;
  fillPanelAction(incident.id);
}

function fillPanelAction(id) {
  const slot = panel.parts.action;
  if (slot.dataset.forId !== id) {
    slot.replaceChildren();
    slot.dataset.forId = id;
    slot.dataset.state = '';
  }
  if (acked.has(id)) {
    if (slot.dataset.state === 'acked') return;
    const done = document.createElement('span');
    done.className = 'acked';
    done.textContent = "I've got this";
    slot.replaceChildren(done);
    slot.dataset.state = 'acked';
    return;
  }
  if (slot.dataset.state === 'ack') return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'panel-ack';
  button.className = 'ack';
  button.textContent = 'Ack';
  button.addEventListener('click', () => onAck(button, id));
  slot.replaceChildren(button);
  slot.dataset.state = 'ack';
}

async function onAck(button, id) {
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
  const row = rows.get(id);
  if (row) row.parts.slot.replaceChildren(ackedMark());
  fillPanelAction(id);
}

function openPanel(id) {
  openId = id;
  renderPanel();
}

function renderPanel() {
  const incident = openId ? byId.get(openId) : null;
  if (!incident) {
    panel.hidden = true;
    panel.replaceChildren();
    panel.removeAttribute('data-id');
    delete panel.parts;
    return;
  }
  panel.hidden = false;
  if (panel.dataset.id !== incident.id || !panel.parts) buildPanel(incident);
  else fillPanel(incident);
}

/* ---------- the list ---------- */

function makeRow(incident) {
  const id = incident.id;
  const row = document.createElement('li');
  row.dataset.testid = 'incident-row';
  row.dataset.id = id;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.addEventListener('click', () => openPanel(id));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel(id);
    }
  });

  const idPart = document.createElement('span');
  idPart.className = 'id';
  const severity = document.createElement('span');
  severity.className = 'sev';
  const what = document.createElement('span');
  what.className = 'what';
  const time = document.createElement('time');
  const slot = document.createElement('span');
  slot.className = 'act';

  row.append(idPart, severity, what, time, slot);
  row.parts = { id: idPart, severity, what, time, slot };
  fillRow(row, incident);
  return row;
}

function fillRow(row, incident) {
  row.parts.id.textContent = incident.id;
  row.parts.severity.textContent = incident.severity;
  row.parts.what.textContent = `${incident.service} — ${incident.region} — ${incident.summary}`;
  row.parts.time.dateTime = incident.openedAt;
  row.parts.time.textContent = timeText(incident.openedAt);
  row.className = `row ${incident.severity}${incident.id === openId ? ' selected' : ''}`;
  row.parts.slot.replaceChildren();
  if (acked.has(incident.id)) row.parts.slot.append(ackedMark());
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
  renderPanel();
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
