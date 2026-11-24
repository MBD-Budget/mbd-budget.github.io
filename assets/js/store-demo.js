// A stand-in for store.js that keeps everything in memory, seeded with made-up figures.
// Open the app with ?demo to use it. Nothing is saved and no database is touched.
import { validateExport } from './plan.js';
import { checklistProgress, payDebts } from './compute.js';
import { isoToday } from './format.js';

export class SignedOutError extends Error {}
export class OfflineError extends Error {}

let state = null;
let nextId = 1;
let listener = null;
const changed = () => { if (listener) setTimeout(listener, 0); };

async function seed() {
  const res = await fetch(new URL('../../seed/plan.example.json', import.meta.url));
  const data = await res.json();
  state = { plan: data.plan, ticks: [], landed: null, startedOn: isoToday(), history: [], balances: [], offline: false };
  data.balances.forEach((b) => state.balances.push({ id: nextId++, ...b }));
}

export async function load() {
  if (!state) await seed();
  return structuredClone(state);
}
export async function savePlan(plan) { state.plan = structuredClone(plan); }
export async function setTick(transferId, on) {
  state.ticks = state.ticks.filter((id) => id !== transferId);
  if (on) state.ticks.push(transferId);
}
export async function setLanded(amount) { state.landed = amount; }
export function cached() { return null; }
export async function closeFortnight() {
  const p = checklistProgress(state.plan, state.ticks, state.landed);
  if (p.done === 0) return false;
  state.history.unshift({ id: nextId++, closedOn: isoToday(), transfersDone: p.done, transfersTotal: p.total, depositTransferred: p.depositTransferred, debtPaid: p.debtPaid });
  if (p.debtPaid > 0) state.plan.debts = payDebts(state.plan.debts, p.debtPaid).debts;
  state.ticks = [];
  state.landed = null;
  state.startedOn = isoToday();
  return true;
}
export async function addBalance({ accountId, onDate, balance }) {
  state.balances = state.balances.filter((b) => !(b.accountId === accountId && b.onDate === onDate));
  state.balances.push({ id: nextId++, accountId, onDate, balance });
  state.balances.sort((a, b) => a.onDate.localeCompare(b.onDate));
}
export async function deleteBalance(id) { state.balances = state.balances.filter((b) => b.id !== id); }
export async function exportAll() {
  return {
    version: 1,
    plan: structuredClone(state.plan),
    balances: state.balances.map(({ accountId, onDate, balance }) => ({ accountId, onDate, balance })),
    history: [...state.history].reverse().map(({ closedOn, transfersDone, transfersTotal, depositTransferred, debtPaid }) =>
      ({ closedOn, transfersDone, transfersTotal, depositTransferred, debtPaid: debtPaid || 0 })),
  };
}
export async function importAll(obj) {
  const errors = validateExport(obj);
  if (errors.length) throw new Error(errors.join(' '));
  state.plan = structuredClone(obj.plan);
  state.ticks = [];
  state.balances = (obj.balances || []).map((b) => ({ id: nextId++, ...b }));
  state.history = [...(obj.history || [])].reverse().map((h) => ({ id: nextId++, ...h }));
}
export async function signOut() { state = null; }
export function onChange(fn) { listener = fn; }
export function stopChanges() { listener = null; }
export { changed };
