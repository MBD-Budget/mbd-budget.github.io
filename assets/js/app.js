// Router, render loop and event wiring. Hash-based routing, no build step.
import { configured, currentUser, signIn, onAuthChange } from './auth.js';
import * as liveStore from './store.js';
import * as demoStore from './store-demo.js';
import { applyEdits, blankRow, validatePlan, validateExport, parseMoney } from './plan.js';
import { esc, isoToday } from './format.js';
import { LOGO_SVG } from './logo.js';
import * as signinView from './views/signin.js';
import * as checklistView from './views/checklist.js';
import * as incomeView from './views/income.js';
import * as costView from './views/cost.js';
import * as savingsView from './views/savings.js';
import * as settingsView from './views/settings.js';

const root = document.getElementById('root');

// ?demo runs the whole app on made-up figures held in memory: no sign-in, nothing saved.
const DEMO = new URLSearchParams(location.search).has('demo');
const store = DEMO ? demoStore : liveStore;

const PAGES = [
  { route: '/',         key: 'checklist', label: 'Checklist', icon: '✓', view: checklistView },
  { route: '/income',   key: 'income',    label: 'Income',    icon: '$', view: incomeView },
  { route: '/cost',     key: 'cost',      label: 'Cost of living', short: 'Costs', icon: '◎', view: costView },
  { route: '/savings',  key: 'savings',   label: 'Savings',   icon: '★', view: savingsView },
  { route: '/settings', key: 'settings',  label: 'Settings',  icon: '⚙', view: settingsView },
];

let user = null;
let state = null;
// Everything about the screen that isn't data: edit mode, armed confirms, messages.
const ui = {
  editing: false, draft: null, errors: [], armed: null, busy: false, offline: false,
  signinError: '', signinEmail: '', userEmail: '',
  importErrors: [], pendingImport: null,
  costMode: 'budget', notice: '', isDemo: false,
};
ui.isDemo = DEMO;
let repaintWaiting = false;

// ---- Theme and toast -------------------------------------------------------
function applyTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('budget_theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f0f0f' : '#ffffff';
}
let savedTheme = null;
try { savedTheme = localStorage.getItem('budget_theme'); } catch { /* ignore */ }
applyTheme(savedTheme !== 'light');

function toast(message) {
  let el = document.getElementById('undo-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'undo-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 2600);
}

// ---- Routing ---------------------------------------------------------------
function currentPage() {
  const route = location.hash.replace(/^#/, '') || '/';
  return PAGES.find((p) => p.route === route) || PAGES[0];
}

function headerHtml(page) {
  const isDark = document.body.dataset.theme !== 'light';
  const links = user
    ? PAGES.map((p) => `<a href="#${p.route}" class="${p.key === page.key ? 'active' : ''}">${esc(p.label)}</a>`).join('')
    : '';
  const bottom = user
    ? `<nav class="bottom-nav" aria-label="Pages">${PAGES.map((p) => `
        <a href="#${p.route}" class="bnav-item ${p.key === page.key ? 'active' : ''}"${p.key === page.key ? ' aria-current="page"' : ''}>
          <span class="bnav-icon" aria-hidden="true">${p.icon}</span><span class="bnav-label">${esc(p.short || p.label)}</span>
        </a>`).join('')}</nav>`
    : '';
  return `
  <header class="topbar">
    <a class="brand" href="#/">${LOGO_SVG}</a>
    <nav class="topbar-nav">${links}</nav>
    <div class="topbar-end">
      <button class="theme-toggle" data-action="toggle-theme">${isDark ? '☀ Light' : '☾ Dark'}</button>
    </div>
  </header>${bottom}`;
}

function bodyHtml(page) {
  if (!configured && !DEMO) {
    return `<h1>Not connected</h1><div class="card"><p class="hint">This copy of the app has not been connected to its database yet.</p></div>`;
  }
  if (!user) return signinView.render(ui);
  if (!state) return `<p class="hint">Loading…</p>`;

  const banner = state.offline
    ? `<div class="banner warn" role="status">Can't reach the database. Showing what this phone last saw. If this lasts, the database may be paused: open the Supabase dashboard and press Restore.
        <button class="small-btn" data-action="retry">Try again</button></div>`
    : '';
  const demo = DEMO ? `<div class="banner warn" role="status">Demo with made-up figures. Nothing here is saved.</div>` : '';
  const notice = ui.notice ? `<div class="banner err" role="alert">${esc(ui.notice)}</div>` : '';

  if (!state.plan && page.key !== 'settings') {
    return `${demo}${banner}<h1>${esc(page.label)}</h1>
      <div class="card"><p>No plan loaded yet.</p>
      <p class="hint">Go to <a href="#/settings">Settings</a> and import a plan file to get started.</p></div>`;
  }
  const view = { ...state, plan: ui.draft || state.plan, today: isoToday() };
  return demo + banner + notice + page.view.render(view, ui);
}

let paintedKey = null;
function paint() {
  const page = currentPage();
  const key = `${user ? page.key : 'signin'}|${document.body.dataset.theme}`;
  document.body.dataset.route = user ? page.key : 'checklist';
  document.title = user ? `${page.label} · MBD Budget` : 'MBD Budget';
  ui.offline = Boolean(state && state.offline);
  const body = bodyHtml(page);
  const app = document.getElementById('app');
  if (app && paintedKey === key) {
    const scroll = window.scrollY;
    app.innerHTML = body;
    window.scrollTo(0, scroll);
  } else {
    root.innerHTML = `${headerHtml(page)}<main class="container" id="app">${body}</main>`;
    paintedKey = key;
  }
  repaintWaiting = false;
}

// A live update must not wipe what someone is typing.
function typing() {
  const el = document.activeElement;
  const app = document.getElementById('app');
  return Boolean(el && app && app.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox');
}

function paintWhenSafe() {
  if (ui.editing || typing()) { repaintWaiting = true; return; }
  paint();
}

// ---- Loading ---------------------------------------------------------------
async function refresh({ quiet = false } = {}) {
  try {
    state = await store.load();
  } catch (error) {
    if (error instanceof store.SignedOutError) return signedOut();
    ui.notice = error.message;
  }
  if (quiet) paintWhenSafe(); else paint();
}

function signedOut() {
  user = null;
  state = null;
  store.stopChanges();
  Object.assign(ui, { editing: false, draft: null, errors: [], armed: null, busy: false, notice: '', pendingImport: null, importErrors: [] });
  paint();
}

async function signedIn(newUser) {
  user = newUser;
  ui.userEmail = newUser.email || '';
  paint();
  await refresh();
  store.onChange(() => refresh({ quiet: true }));
}

// Run a write, then reload. Shows a message instead of failing silently.
async function act(fn, { reload = true } = {}) {
  ui.busy = true;
  ui.notice = '';
  try {
    await fn();
  } catch (error) {
    if (error instanceof store.SignedOutError) { ui.busy = false; return signedOut(); }
    toast(error.message);
    reload = true;
  }
  ui.busy = false;
  if (reload) await refresh(); else paint();
}

// ---- Edit mode -------------------------------------------------------------
function collectEdits() {
  return [...document.querySelectorAll('#app [data-path]')].map((el) => ({
    path: el.dataset.path,
    type: el.dataset.type,
    value: el.type === 'checkbox' ? el.checked : el.value,
  }));
}

// Fold whatever is on screen into the draft, keeping the old value where an input is unusable.
function absorbEdits() {
  if (!ui.editing) return;
  ui.draft = applyEdits(ui.draft, collectEdits()).plan;
}

function startEdit() {
  if (!state || !state.plan || state.offline) return;
  Object.assign(ui, { editing: true, draft: structuredClone(state.plan), errors: [] });
  paint();
}

function cancelEdit() {
  Object.assign(ui, { editing: false, draft: null, errors: [] });
  paint();
}

async function saveEdit() {
  const { plan, errors } = applyEdits(ui.draft, collectEdits());
  if (errors.length) {
    ui.draft = plan;
    ui.errors = errors;
    paint();
    const first = document.querySelector('#app .invalid');
    if (first) first.focus();
    return;
  }
  const problems = validatePlan(plan);
  if (problems.length) {
    ui.draft = plan;
    ui.notice = problems.join(' ');
    paint();
    return;
  }
  await act(async () => {
    await store.savePlan(plan);
    Object.assign(ui, { editing: false, draft: null, errors: [] });
    toast('Saved');
  });
}

function listAt(plan, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), plan);
}

// ---- Settings: export and import -------------------------------------------
async function exportFile() {
  await act(async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mbd-budget-${isoToday()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { reload: false });
}

async function chooseImport(file) {
  ui.importErrors = [];
  ui.pendingImport = null;
  ui.armed = null;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    ui.importErrors = ['It isn\'t a JSON file.'];
    return paint();
  }
  const errors = validateExport(obj);
  if (errors.length) ui.importErrors = errors;
  else ui.pendingImport = { name: file.name, data: obj };
  paint();
}

// ---- Page actions (filled in as each page is built) ------------------------
// Each view may export `actions`: { name(ctx), 'submit:form'(ctx), 'change:input'(ctx), 'input:input'(ctx) }.
const pageActions = Object.assign({}, ...PAGES.map((p) => p.view.actions || {}));

// ---- Events ----------------------------------------------------------------
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;

  if (action !== 'arm' && ui.armed && !el.closest('.confirm-pair')) ui.armed = null;

  switch (action) {
    case 'toggle-theme':
      absorbEdits();
      applyTheme(document.body.dataset.theme !== 'dark');
      return paint();
    case 'retry':
      return refresh();
    case 'edit-start': return startEdit();
    case 'edit-cancel': return cancelEdit();
    case 'edit-save': return saveEdit();
    case 'row-add': {
      absorbEdits();
      listAt(ui.draft, el.dataset.list).push(blankRow(el.dataset.list, ui.draft));
      return paint();
    }
    case 'row-remove': {
      absorbEdits();
      listAt(ui.draft, el.dataset.list).splice(Number(el.dataset.index), 1);
      ui.errors = [];
      return paint();
    }
    case 'arm':
      absorbEdits();
      ui.armed = el.dataset.key;
      return paint();
    case 'disarm':
      absorbEdits();
      ui.armed = null;
      return paint();
    case 'export': return exportFile();
    case 'import-cancel':
      Object.assign(ui, { pendingImport: null, importErrors: [], armed: null });
      return paint();
    case 'import-confirm': {
      const pending = ui.pendingImport;
      if (!pending) return undefined;
      return act(async () => {
        await store.importAll(pending.data);
        Object.assign(ui, { pendingImport: null, importErrors: [], armed: null });
        toast('Imported');
      });
    }
    case 'sign-out':
      await store.signOut();
      return signedOut();
    default:
      if (pageActions[action]) {
        return pageActions[action]({ el, state, ui, store, act, paint, refresh, toast, absorbEdits, parseMoney });
      }
      return undefined;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'signin') {
    const email = form.elements.email.value;
    const password = form.elements.password.value;
    Object.assign(ui, { busy: true, signinError: '', signinEmail: email });
    paint();
    try {
      await signIn(email, password);
      ui.busy = false;
      await signedIn(await currentUser());
    } catch (error) {
      Object.assign(ui, { busy: false, signinError: error.message });
      paint();
    }
    return;
  }
  const handler = pageActions[`submit:${form.dataset.form}`];
  if (handler) await handler({ form, state, ui, store, act, paint, refresh, toast, parseMoney });
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.dataset && el.dataset.input === 'import-file' && el.files && el.files[0]) {
    chooseImport(el.files[0]);
    return;
  }
  const handler = el.dataset && pageActions[`change:${el.dataset.input}`];
  if (handler) handler({ el, state, ui, store, act, paint, refresh, toast, parseMoney });
});

document.addEventListener('input', (event) => {
  const el = event.target;
  const handler = el.dataset && pageActions[`input:${el.dataset.input}`];
  if (handler) handler({ el, state, ui, paint, parseMoney });
});

// Catch up on a live update that arrived while someone was typing.
document.addEventListener('focusout', () => {
  setTimeout(() => { if (repaintWaiting && !ui.editing && !typing()) paint(); }, 0);
});

window.addEventListener('hashchange', () => {
  absorbEdits();
  ui.armed = null;
  ui.errors = [];
  ui.notice = '';
  paint();
  window.scrollTo(0, 0);
});

onAuthChange((event) => {
  if (event === 'SIGNED_OUT' && user) signedOut();
});

// ---- Start -----------------------------------------------------------------
const splash = document.getElementById('splash');
function hideSplash() {
  if (!splash || splash.classList.contains('splash-out')) return;
  splash.classList.add('splash-out');
  setTimeout(() => splash.remove(), 520);
}

(async function start() {
  try {
    const existing = DEMO ? { email: 'demo' } : (configured ? await currentUser() : null);
    if (existing) await signedIn(existing); else paint();
  } catch (error) {
    ui.notice = error.message;
    paint();
  }
  hideSplash();
})();
