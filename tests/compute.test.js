import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as c from '../assets/js/compute.js';

const example = JSON.parse(readFileSync(new URL('../seed/plan.example.json', import.meta.url)));
const plan = example.plan;
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.005, `${msg || ''} expected ${expected}, got ${actual}`);

// ---- Income ----------------------------------------------------------------
test('toMonthly turns a fortnightly amount into a monthly one (x 26 / 12)', () => {
  assert.equal(c.toMonthly(4500), 9750);
  near(c.toMonthly(1000), 2166.67);
});

test('incomeSummary totals take-home, sacrifice and gross', () => {
  const s = c.incomeSummary(plan);
  assert.equal(s.takeHomeFortnight, 4500);
  assert.equal(s.takeHomeMonthly, 9750);
  assert.equal(s.sacrificeFortnight, 900);
  assert.equal(s.grossFortnight, 6600);
  assert.equal(s.grossAnnual, 171600);
  assert.equal(s.loansTotal, 10000);
});

test('incomeSummary describes each source', () => {
  const s = c.incomeSummary(plan);
  assert.deepEqual(s.sources.map((x) => x.id), ['a1', 'b1', 'b2']);
  const b1 = s.sources[1];
  assert.equal(b1.isEstimate, true);
  assert.equal(b1.personName, 'Person B');
  near(b1.monthly, 2166.67);
  assert.equal(b1.grossAnnual, 31200);
  assert.equal(s.sources[0].isEstimate, false);
});

test('incomeSummary treats a missing gross or loan balance as zero in totals', () => {
  const p = structuredClone(plan);
  p.incomeSources[0].gross = null;
  p.loans.push({ id: 'l2', personId: 'pb', name: 'Unknown', balance: null, asAt: null });
  const s = c.incomeSummary(p);
  assert.equal(s.grossFortnight, 3600);
  assert.equal(s.loansTotal, 10000);
  assert.equal(s.sources[0].grossAnnual, null);
});

// ---- Cost of living -----------------------------------------------------------
test('fuelSummary works out litres and cost per trip, week and month', () => {
  const f = c.fuelSummary(plan.fuel);
  assert.equal(f.litresPerWeek, 22);
  assert.equal(f.costPerWeek, 44);
  near(f.costPerMonth, 190.67);
  assert.equal(f.trips[0].litresPerWeek, 16);
  assert.equal(f.trips[1].costPerWeek, 12);
});

test('categoryRows takes the fuel budget from the calculator and gives a six-month figure', () => {
  const rows = c.categoryRows(plan);
  const fuel = rows.find((r) => r.name === 'Fuel');
  near(fuel.budget, 190.67);
  assert.equal(fuel.linked, true);
  near(fuel.sixMonth, 1144);
  const rent = rows.find((r) => r.name === 'Rent');
  assert.equal(rent.sixMonth, 2400);
  assert.equal(rent.linked, false);
  assert.equal(rows.find((r) => r.name === 'Fun').measured, null);
});

test('costSummary totals measured and budget, counting a missing figure as zero', () => {
  const s = c.costSummary(plan);
  assert.equal(s.income, 9750);
  assert.equal(s.measuredTotal, 2300);
  near(s.budgetTotal, 890.67);
  near(s.leftOver, 8859.33);
});

test('barData sorts largest first, drops zero rows and gives each a share', () => {
  const measured = c.barData(plan, 'measured');
  assert.deepEqual(measured.map((r) => r.name), ['Holidays', 'Rent', 'Fuel', 'Power']);
  near(measured.reduce((t, r) => t + r.share, 0), 1);
  near(measured[0].share, 1000 / 2300);
  const budget = c.barData(plan, 'budget');
  assert.deepEqual(budget.map((r) => r.name), ['Rent', 'Power', 'Fuel', 'Fun']);
});

test('barData copes with nothing to show', () => {
  const p = structuredClone(plan);
  p.categories = [];
  assert.deepEqual(c.barData(p, 'budget'), []);
});

// ---- Payday checklist -----------------------------------------------------------
const t = (id) => plan.transfers.find((x) => x.id === id);

test('transferAmount: a fixed transfer is its amount', () => {
  assert.deepEqual(c.transferAmount(plan, t('t1'), null), { amount: 700, isEstimate: false });
});

test('transferAmount: "the rest" is the landed amount minus the other transfers from that pay', () => {
  assert.deepEqual(c.transferAmount(plan, t('t8'), 1100), { amount: 900, isEstimate: false });
  assert.deepEqual(c.transferAmount(plan, t('t8'), null), { amount: 800, isEstimate: true });
  assert.deepEqual(c.transferAmount(plan, t('t8'), 150), { amount: 0, isEstimate: false });
});

test('checklistGroups puts pays in order and separates money that stays put', () => {
  const groups = c.checklistGroups(plan, ['t1'], null);
  assert.deepEqual(groups.map((g) => g.source.id), ['a1', 'b1', 'b2']);
  const a1 = groups[0];
  assert.deepEqual(a1.rows.map((r) => r.transfer.id), ['t1', 't2', 't3', 't4', 't5']);
  assert.deepEqual(a1.stays, [{ accountName: 'Joint everyday', amount: 500 }]);
  assert.equal(a1.rows[0].ticked, true);
  assert.equal(a1.rows[0].toName, 'Deposit saver');
  assert.equal(a1.rows[0].fromName, 'Joint everyday');
  assert.equal(a1.rows[1].ticked, false);
  assert.equal(a1.hasRemainder, false);
  assert.equal(groups[1].hasRemainder, true);
});

test('checklistGroups: "the rest" cannot be ticked until the landed amount is in', () => {
  const rest = (landed) => c.checklistGroups(plan, [], landed)[1].rows.find((r) => r.transfer.id === 't8');
  assert.equal(rest(null).tickable, false);
  assert.equal(rest(null).isEstimate, true);
  assert.equal(rest(1100).tickable, true);
  assert.equal(rest(1100).amount, 900);
});

test('checklistGroups orders by week of the fortnight, then day of the week', () => {
  const p = structuredClone(plan);
  p.incomeSources.reverse();
  assert.deepEqual(c.checklistGroups(p, [], null).map((g) => g.source.id), ['a1', 'b1', 'b2']);
});

test('checklistProgress counts ticks and the deposit, ignoring money that stays and stale ticks', () => {
  assert.deepEqual(c.checklistProgress(plan, [], null), { done: 0, total: 11, depositTransferred: 0 });
  assert.deepEqual(c.checklistProgress(plan, ['t1', 't8', 't9'], 1100), { done: 3, total: 11, depositTransferred: 2200 });
  assert.deepEqual(c.checklistProgress(plan, ['t1', 'gone', 't6'], null), { done: 1, total: 11, depositTransferred: 700 });
  assert.deepEqual(c.checklistProgress(plan, ['t2', 't11'], null), { done: 2, total: 11, depositTransferred: 0 });
});

// ---- Savings ------------------------------------------------------------------
const TODAY = '2026-11-24';
const balances = example.balances;
const closed = (closedOn, depositTransferred) => ({ closedOn, transfersDone: 1, transfersTotal: 11, depositTransferred });

test('savingsSeries follows the logged balances of the deposit account', () => {
  const s = c.savingsSeries(plan, balances, [], TODAY);
  assert.deepEqual(s.actual, [{ date: '2026-10-31', amount: 5000 }, { date: '2026-11-21', amount: 3000 }]);
  assert.equal(s.saved, 3000);
});

test('savingsSeries adds deposits made after the latest logged balance, and only those', () => {
  assert.equal(c.savingsSeries(plan, balances, [closed('2026-11-23', 500)], TODAY).saved, 3500);
  assert.equal(c.savingsSeries(plan, balances, [closed('2026-11-20', 500)], TODAY).saved, 3000);
  assert.equal(c.savingsSeries(plan, balances, [closed('2026-11-21', 500)], TODAY).saved, 3000);
  const s = c.savingsSeries(plan, balances, [closed('2026-11-23', 500), closed('2026-11-22', 100)], TODAY);
  assert.deepEqual(s.actual.slice(2), [{ date: '2026-11-22', amount: 3100 }, { date: '2026-11-23', amount: 3600 }]);
});

test('savingsSeries with no logged balance starts from the deposits alone', () => {
  const s = c.savingsSeries(plan, [], [closed('2026-11-23', 500)], TODAY);
  assert.equal(s.saved, 500);
  assert.equal(c.savingsSeries(plan, [], [], TODAY).saved, 0);
});

test('savingsSeries projects from today at the planned amount each fortnight, to the last goal date', () => {
  const s = c.savingsSeries(plan, balances, [], TODAY);
  assert.deepEqual(s.projection[0], { date: TODAY, amount: 3000 });
  assert.deepEqual(s.projection[1], { date: '2026-12-08', amount: 5000 });
  assert.deepEqual(s.projection[2], { date: '2026-12-22', amount: 7000 });
  const last = s.projection[s.projection.length - 1];
  assert.ok(last.date <= '2028-12-31' && last.date > '2028-12-17');
});

test('accountSeries lists one account in date order', () => {
  assert.deepEqual(c.accountSeries(balances, 'emg'), [{ date: '2026-11-21', amount: 1000 }]);
  assert.deepEqual(c.accountSeries(balances, 'nope'), []);
});

test('goalProgress gives fortnights left and the amount needed each fortnight', () => {
  const g = c.goalProgress(plan.goals[0], 3000, TODAY, 2000);
  assert.equal(g.fortnightsLeft, 13);
  near(g.neededPerFortnight, 1769.23);
  near(g.pct, 3000 / 26000);
  assert.equal(g.remaining, 23000);
  assert.equal(g.onTrack, true);
  assert.equal(c.goalProgress(plan.goals[0], 3000, TODAY, 1500).onTrack, false);
});

test('goalProgress never gives a silly number once the date has passed or the goal is met', () => {
  const past = c.goalProgress({ target: 26000, targetDate: '2026-11-01' }, 3000, TODAY, 2000);
  assert.equal(past.fortnightsLeft, 0);
  assert.equal(past.neededPerFortnight, null);
  assert.equal(past.onTrack, false);
  const met = c.goalProgress(plan.goals[0], 30000, TODAY, 2000);
  assert.equal(met.pct, 1);
  assert.equal(met.neededPerFortnight, 0);
  assert.equal(met.remaining, 0);
  assert.equal(met.onTrack, true);
  const soon = c.goalProgress({ target: 26000, targetDate: '2026-11-30' }, 3000, TODAY, 2000);
  assert.equal(soon.fortnightsLeft, 0);
  assert.equal(soon.neededPerFortnight, null);
  assert.equal(soon.datePassed, false);
  assert.equal(past.datePassed, true);
  assert.equal(c.goalProgress({ target: 26000, targetDate: TODAY }, 3000, TODAY, 2000).datePassed, false);
});

test('ingCheck flags a month where the deposit account is not above last month\'s close', () => {
  const r = c.ingCheck(plan, balances, [], TODAY);
  assert.equal(r.previousMonthEnd, 5000);
  assert.equal(r.current, 3000);
  assert.equal(r.ok, false);
  assert.equal(r.shortfall, 2000);
  assert.equal(r.deadline, '2026-11-30');
});

test('ingCheck passes once the balance is higher, and counts deposits not yet logged', () => {
  const up = c.ingCheck(plan, balances, [closed('2026-11-23', 2500)], TODAY);
  assert.equal(up.current, 5500);
  assert.equal(up.ok, true);
  assert.equal(up.shortfall, 0);
  const level = c.ingCheck(plan, balances, [closed('2026-11-23', 2000)], TODAY);
  assert.equal(level.ok, false);
  assert.equal(level.shortfall, 0);
});

test('ingCheck cannot judge without a balance from last month', () => {
  const r = c.ingCheck(plan, balances, [], '2027-01-15');
  assert.equal(r.previousMonthEnd, null);
  assert.equal(r.ok, null);
  assert.equal(r.deadline, '2027-01-31');
  assert.equal(c.ingCheck(plan, [], [], '2027-02-10').deadline, '2027-02-28');
});
