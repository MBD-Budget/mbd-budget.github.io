// Every read and write goes through here. Keeps a copy of the last loaded state on the
// device so the app can still show something when the database can't be reached.
import { db, currentUser, signOut as authSignOut } from './auth.js';
import { validateExport, classifyError } from './plan.js';

const CACHE_KEY = 'mbd_state_v1';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function writeCache(state) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...state, offline: false })); } catch { /* storage full or blocked */ }
}
function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

const emptyState = () => ({ plan: null, ticks: [], landed: null, startedOn: null, history: [], balances: [], offline: false });

export class SignedOutError extends Error {}
export class OfflineError extends Error {
  constructor() { super('Can\'t reach the database, so that change wasn\'t saved.'); }
}

// Turn a failed call into the right kind of error for the app to act on.
async function fail(error) {
  const kind = classifyError(error);
  if (kind === 'auth') {
    await authSignOut();
    clearCache();
    throw new SignedOutError('Please sign in again.');
  }
  if (kind === 'offline') throw new OfflineError();
  throw new Error(error.message || 'Something went wrong.');
}

async function check(promise) {
  let result;
  try {
    result = await promise;
  } catch (error) {
    await fail(error);
  }
  if (result.error) await fail({ ...result.error, message: result.error.message, status: result.error.status || result.status });
  return result.data;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

// What this device last saw, for when the database can't be reached at all.
export function cached() {
  const state = readCache();
  return state ? { ...state, offline: true } : null;
}

export async function load() {
  try {
    const [planRow, ticks, fortnight, history, balances] = await Promise.all([
      check(db.from('plan').select('data').eq('id', 1).maybeSingle()),
      check(db.from('ticks').select('transfer_id')),
      check(db.from('fortnight').select('landed_amount, started_on').eq('id', 1).maybeSingle()),
      check(db.from('history').select('*').order('closed_on', { ascending: false }).order('id', { ascending: false })),
      check(db.from('balances').select('*').order('on_date', { ascending: true })),
    ]);
    const state = {
      plan: planRow ? planRow.data : null,
      ticks: ticks.map((t) => t.transfer_id),
      landed: fortnight ? num(fortnight.landed_amount) : null,
      startedOn: fortnight ? fortnight.started_on : null,
      history: history.map((h) => ({
        id: h.id, closedOn: h.closed_on, transfersDone: h.transfers_done,
        transfersTotal: h.transfers_total, depositTransferred: num(h.deposit_transferred),
      })),
      balances: balances.map((b) => ({ id: b.id, accountId: b.account_id, onDate: b.on_date, balance: num(b.balance) })),
      offline: false,
    };
    writeCache(state);
    return state;
  } catch (error) {
    if (error instanceof OfflineError) {
      return { ...(readCache() || emptyState()), offline: true };
    }
    throw error;
  }
}

export async function savePlan(plan) {
  const user = await currentUser();
  await check(db.from('plan').upsert({ id: 1, data: plan, updated_at: new Date().toISOString(), updated_by: user ? user.id : null }));
}

// Safe to repeat: ticking a ticked row or unticking an unticked row changes nothing.
export async function setTick(transferId, on) {
  if (on) {
    await check(db.from('ticks').upsert({ transfer_id: transferId }, { onConflict: 'transfer_id', ignoreDuplicates: true }));
  } else {
    await check(db.from('ticks').delete().eq('transfer_id', transferId));
  }
}

export async function setLanded(amount) {
  await check(db.from('fortnight').update({ landed_amount: amount }).eq('id', 1));
}

// Resolves to false when there was nothing to close (for example, the other phone got there first).
export async function closeFortnight(today) {
  try {
    await check(db.rpc('close_fortnight', { p_today: today }));
    return true;
  } catch (error) {
    if (/nothing to close/i.test(error.message)) return false;
    throw error;
  }
}

export async function addBalance({ accountId, onDate, balance }) {
  await check(db.from('balances').upsert(
    { account_id: accountId, on_date: onDate, balance },
    { onConflict: 'account_id,on_date' },
  ));
}

export async function deleteBalance(id) {
  await check(db.from('balances').delete().eq('id', id));
}

export async function exportAll() {
  const state = await load();
  if (state.offline) throw new OfflineError();
  return {
    version: 1,
    plan: state.plan,
    balances: state.balances.map(({ accountId, onDate, balance }) => ({ accountId, onDate, balance })),
    history: [...state.history].reverse().map(({ closedOn, transfersDone, transfersTotal, depositTransferred }) =>
      ({ closedOn, transfersDone, transfersTotal, depositTransferred })),
  };
}

// Replaces the plan, every balance entry and the whole history. Ticks are cleared.
export async function importAll(obj) {
  const errors = validateExport(obj);
  if (errors.length) throw new Error(errors.join(' '));
  await savePlan(obj.plan);
  await check(db.from('balances').delete().gte('id', 0));
  await check(db.from('history').delete().gte('id', 0));
  await check(db.from('ticks').delete().neq('transfer_id', ''));
  await check(db.from('fortnight').update({ landed_amount: null }).eq('id', 1));
  if ((obj.balances || []).length) {
    await check(db.from('balances').insert(obj.balances.map((b) => ({ account_id: b.accountId, on_date: b.onDate, balance: b.balance }))));
  }
  if ((obj.history || []).length) {
    await check(db.from('history').insert(obj.history.map((h) => ({
      closed_on: h.closedOn, transfers_done: h.transfersDone,
      transfers_total: h.transfersTotal, deposit_transferred: h.depositTransferred,
    }))));
  }
}

export async function signOut() {
  await authSignOut();
  clearCache();
}

// Calls fn whenever the other phone changes something, and when the app comes back to the front.
let channel = null;
let listener = null;
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(() => listener && listener(), 250); };
let windowHooked = false;

export function onChange(fn) {
  listener = fn;
  if (channel) db.removeChannel(channel);
  channel = db.channel('household')
    .on('postgres_changes', { event: '*', schema: 'public' }, soon)
    .subscribe();
  if (!windowHooked) {
    windowHooked = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
    window.addEventListener('online', soon);
  }
}

export function stopChanges() {
  listener = null;
  if (channel) { db.removeChannel(channel); channel = null; }
}
