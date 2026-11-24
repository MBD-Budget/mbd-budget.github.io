// Router, render loop and event wiring. Hash-based routing, no build step.
import { configured, currentUser, sessionStatus, savedEmail, signIn, onAuthChange } from './auth.js';
import * as liveStore from './store.js';
import * as demoStore from './store-demo.js';
import { applyEdits, blankRow, removalBlocker, validatePlan, validateExport, parseMoney } from './plan.js';
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
  editing: false, editRoute: null, draft: null, errors: [], armed: null, busy: false, offline: false,
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
  if (!state) {
    return ui.notice
      ? `<div class="banner err" role="alert">${esc(ui.notice)} <button class="small-btn" data-action="retry">Try again</button></div>`
      : `<p class="hint">Loading…</p>`;
  }

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
    const focus = focusKey();
    app.innerHTML = body;
    window.scrollTo(0, scroll);
    refocus(focus);
  } else {
    root.innerHTML = `${headerHtml(page)}<main class="container" id="app">${body}</main>`;
    paintedKey = key;
  }
  repaintWaiting = false;
}

// Remember which control had focus so a repaint doesn't throw keyboard and screen-reader users to the top.
function focusKey() {
  const el = document.activeElement;
  const app = document.getElementById('app');
  if (!el || !app || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const d = el.dataset;
  if (d.path) return `[data-path="${CSS.escape(d.path)}"]`;
  if (d.action && d.id) return `[data-action="${CSS.escape(d.action)}"][data-id="${CSS.escape(d.id)}"]`;
  if (d.action && d.key) return `[data-key="${CSS.escape(d.key)}"], [data-action="disarm"]`;
  if (d.action && d.mode) return `[data-action="${CSS.escape(d.action)}"][data-mode="${CSS.escape(d.mode)}"]`;
  if (d.action) return `[data-action="${CSS.escape(d.action)}"]`;
  if (el.name && el.form && el.form.dataset.form) return `form[data-form="${CSS.escape(el.form.dataset.form)}"] [name="${CSS.escape(el.name)}"]`;
  return null;
}
function refocus(selector) {
  if (!selector) return;
  const el = document.querySelector(`#app ${selector.split(', ').join(', #app ')}`);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

// A form someone has started filling in (a balance, a new password, the landed amount).
function formDirty() {
  return [...document.querySelectorAll('#app form[data-form] input:not([type=hidden]), #app form[data-form] select, #app [data-input="landed"]')]
    .some((el) => (el.tagName === 'SELECT'
      ? [...el.options].some((o) => o.selected !== o.defaultSelected)
      : el.value !== el.defaultValue));
}

// A live update must not wipe what someone is typing.
function typing() {
  const el = document.activeElement;
  const app = document.getElementById('app');
  return Boolean(el && app && app.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox');
}

function paintWhenSafe() {
  if (ui.editing || typing() || formDirty()) { repaintWaiting = true; return; }
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
  if (ui.busy) return;
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
  Object.assign(ui, { editing: true, editRoute: currentPage().route, draft: structuredClone(state.plan), errors: [] });
  paint();
}

function cancelEdit() {
  Object.assign(ui, { editing: false, editRoute: null, draft: null, errors: [], notice: '' });
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
  ui.draft = plan;   // if the save fails, the page redraws from this, not from the old figures
  await act(async () => {
    await store.savePlan(plan);
    Object.assign(ui, { editing: false, editRoute: null, draft: null, errors: [] });
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
      ui.notice = '';
      // Start again from the sign-in check, so a sign-in that went stale while the database was away is renewed.
      return DEMO ? refresh() : start();
    case 'edit-start': return startEdit();
    case 'edit-cancel': return cancelEdit();
    case 'edit-save': return saveEdit();
    case 'row-add': {
      absorbEdits();
      if (el.dataset.list === 'debts' && !Array.isArray(ui.draft.debts)) ui.draft.debts = [];
      listAt(ui.draft, el.dataset.list).push(blankRow(el.dataset.list, ui.draft));
      return paint();
    }
    case 'row-remove': {
      absorbEdits();
      const blocker = removalBlocker(ui.draft, el.dataset.list, Number(el.dataset.index));
      if (blocker) {
        ui.notice = blocker;
        paint();
        return window.scrollTo(0, 0);
      }
      listAt(ui.draft, el.dataset.list).splice(Number(el.dataset.index), 1);
      ui.errors = [];
      ui.notice = '';
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
  setTimeout(() => { if (repaintWaiting && !ui.editing && !typing() && !formDirty()) paint(); }, 0);
});

window.addEventListener('hashchange', () => {
  if (ui.editing && ui.editRoute && currentPage().route !== ui.editRoute) {
    absorbEdits();
    history.replaceState(null, '', `#${ui.editRoute}`);
    ui.notice = 'Save or cancel your changes before leaving this page.';
    paint();
    window.scrollTo(0, 0);
    return;
  }
  absorbEdits();
  Object.assign(ui, { armed: null, errors: [], notice: '', landedError: '', balanceError: '', passwordError: '', passwordDone: false });
  paint();
  window.scrollTo(0, 0);
});

// Closing the tab with unsaved changes asks first.
window.addEventListener('beforeunload', (event) => {
  if (ui.editing) event.preventDefault();
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

async function start() {
  try {
    if (DEMO) {
      await signedIn({ email: 'demo' });
    } else if (!configured) {
      paint();
    } else {
      // Checking a stale sign-in against a database that isn't answering can take half a minute.
      // If this device has something to show, show it after a few seconds and keep checking.
      const showCached = (email) => {
        user = { email };
        ui.userEmail = email || '';
        state = store.cached();
        paint();
        hideSplash();
      };
      const pending = sessionStatus();
      const quick = await Promise.race([pending, new Promise((resolve) => { setTimeout(() => resolve(null), 4000); })]);
      const email = savedEmail();
      const waiting = !quick && email !== null && store.cached();
      if (waiting) showCached(email);
      const session = quick || await pending;
      if (session.status === 'in') {
        await signedIn(session.user);
      } else if (session.status === 'unreachable' && store.cached()) {
        if (!waiting) showCached(session.user.email);
      } else if (waiting) {
        signedOut();
      } else {
        paint();
      }
    }
  } catch (error) {
    ui.notice = error.message;
    paint();
  }
  hideSplash();
}
start();
