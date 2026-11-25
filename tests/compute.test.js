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
  assert.equal(measured.reduce((t, r) => t + r.percent, 0), 100);
  const budget = c.barData(plan, 'budget');
  assert.deepEqual(budget.map((r) => r.name), ['Rent', 'Power', 'Fuel', 'Fun']);
});

test('barData gives whole per cents that always add up to 100', () => {
  const p = structuredClone(plan);
  p.categories = [1, 1, 1, 1, 1, 1, 1].map((budget, i) => ({ id: `x${i}`, name: `x${i}`, measured: null, budget, link: null }));
  const rows = c.barData(p, 'budget');   // seven equal shares of 14.29% each
  assert.equal(rows.reduce((t, r) => t + r.percent, 0), 100);
  assert.deepEqual(rows.map((r) => r.percent).sort(), [14, 14, 14, 14, 14, 15, 15]);
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
  assert.deepEqual(c.checklistProgress(plan, [], null), { done: 0, total: 11, depositTransferred: 0, debtPaid: 0 });
  assert.deepEqual(c.checklistProgress(plan, ['t1', 't8', 't9'], 1100), { done: 3, total: 11, depositTransferred: 2200, debtPaid: 0 });
  assert.deepEqual(c.checklistProgress(plan, ['t1', 'gone', 't6'], null), { done: 1, total: 11, depositTransferred: 700, debtPaid: 0 });
  assert.deepEqual(c.checklistProgress(plan, ['t2', 't11'], null), { done: 2, total: 11, depositTransferred: 0, debtPaid: 0 });
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
  assert.equal(c.savingsSeries(plan, balances, [], TODAY).hasData, true);
  assert.equal(c.savingsSeries(plan, [], [], TODAY).hasData, false);
  const s = c.savingsSeries(plan, balances, [closed('2026-11-23', 500), closed('2026-11-22', 100)], TODAY);
  assert.deepEqual(s.actual.slice(2), [{ date: '2026-11-22', amount: 3100 }, { date: '2026-11-23', amount: 3600 }]);
});

test('savingsSeries does not count a fortnight twice when a balance was logged part-way through it', () => {
  const started = (startedOn, closedOn, amount) => ({ ...closed(closedOn, amount), startedOn });
  const midway = [{ accountId: 'dep', onDate: '2026-12-04', balance: 700 }];
  // The balance already holds the first transfer of the fortnight that began on 1 December.
  assert.equal(c.savingsSeries(plan, midway, [started('2026-12-01', '2026-12-14', 2000)], '2026-12-14').saved, 700);
  // The next fortnight began after the balance, so all of it is added.
  assert.equal(c.savingsSeries(plan, midway, [started('2026-12-01', '2026-12-14', 2000), started('2026-12-14', '2026-12-28', 2000)], '2026-12-28').saved, 2700);
  // A balance logged at the reset (the day the next fortnight begins) still gets that next fortnight.
  const atReset = [{ accountId: 'dep', onDate: '2026-12-14', balance: 2000 }];
  assert.equal(c.savingsSeries(plan, atReset, [started('2026-12-01', '2026-12-14', 2000), started('2026-12-14', '2026-12-28', 2000)], '2026-12-28').saved, 4000);
});

test('savingsSeries with no logged balance starts from the deposits alone', () => {
  const s = c.savingsSeries(plan, [], [closed('2026-11-23', 500)], TODAY);
  assert.equal(s.saved, 500);
  assert.equal(c.savingsSeries(plan, [], [], TODAY).saved, 0);
});

test('savingsSeries projects at the planned amount each fortnight, to the last goal date', () => {
  const s = c.savingsSeries(plan, balances, [], '2026-12-10');   // the plan is under way
  assert.deepEqual(s.projection.slice(0, 3), [
    { date: '2026-12-10', amount: 3000 }, { date: '2026-12-23', amount: 5000 }, { date: '2027-01-06', amount: 7000 },
  ]);
  const last = s.projection[s.projection.length - 1];
  assert.equal(last.date, '2028-12-31');   // the part fortnight at the end counts as a whole one
});

test('savingsSeries starts the projection at the plan\'s first day when that is still ahead', () => {
  const s = c.savingsSeries(plan, balances, [], TODAY);
  assert.equal(s.from, '2026-12-01');
  assert.deepEqual(s.projection.slice(0, 4), [
    { date: TODAY, amount: 3000 }, { date: '2026-12-01', amount: 3000 },
    { date: '2026-12-14', amount: 5000 }, { date: '2026-12-28', amount: 7000 },
  ]);
  // Thirteen fortnights of saving fit between 1 December and 31 May.
  const onGoalDate = s.projection.find((p) => p.date === '2027-05-31');
  assert.equal(onGoalDate.amount, 3000 + 13 * 2000);
});

test('accountSeries lists one account in date order', () => {
  assert.deepEqual(c.accountSeries(balances, 'emg'), [{ date: '2026-11-21', amount: 1000 }]);
  assert.deepEqual(c.accountSeries(balances, 'nope'), []);
});

test('goalProgress gives fortnights left and the amount needed each fortnight', () => {
  const g = c.goalProgress(plan.goals[0], 3000, TODAY, 2000, 0, c.countFrom(plan, TODAY));
  assert.equal(g.fortnightsLeft, 13);
  near(g.neededPerFortnight, 1769.23);
  near(g.pct, 3000 / 26000);
  assert.equal(g.remaining, 23000);
  assert.equal(g.onTrack, true);
  assert.equal(c.goalProgress(plan.goals[0], 3000, TODAY, 1500).onTrack, false);
});

test('goalProgress counts pay cycles still to come, so being exactly on plan reads as on track', () => {
  const goal = { target: 26000, targetDate: '2027-05-31' };   // 13 fortnights x 2,000 from 1 December
  const at = (saved, today) => c.goalProgress(goal, saved, today, 2000, 0, c.countFrom(plan, today));
  assert.equal(at(0, '2026-11-24').fortnightsLeft, 13);
  assert.equal(at(0, '2026-12-01').fortnightsLeft, 13);
  assert.equal(at(0, '2026-12-01').onTrack, true);
  assert.equal(at(0, '2026-12-14').fortnightsLeft, 13);     // the first fortnight is still running
  assert.equal(at(2000, '2026-12-15').fortnightsLeft, 12);  // one saved, twelve to go
  assert.equal(at(2000, '2026-12-15').neededPerFortnight, 2000);
  assert.equal(at(2000, '2026-12-15').onTrack, true);
  assert.equal(at(24000, '2027-05-30').fortnightsLeft, 1);
  assert.equal(c.countFrom(plan, '2026-12-15'), '2026-12-15');
  assert.equal(c.countFrom({ period: {} }, TODAY), TODAY);
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
  assert.equal(soon.fortnightsLeft, 1);       // six days left is one last pay cycle
  assert.equal(soon.neededPerFortnight, 23000);
  assert.equal(soon.datePassed, false);
  const lastDay = c.goalProgress({ target: 26000, targetDate: TODAY }, 3000, TODAY, 2000);
  assert.equal(lastDay.fortnightsLeft, 1);    // the last day still has its pay cycle
  assert.equal(lastDay.neededPerFortnight, 23000);
  assert.equal(past.datePassed, true);
  assert.equal(c.goalProgress({ target: 26000, targetDate: TODAY }, 3000, TODAY, 2000).datePassed, false);
});

// ---- Debts to clear before saving --------------------------------------------------
const withDebts = (...debts) => ({ ...structuredClone(plan), debts: debts.map(([id, name, owing]) => ({ id, name, owing })) });
const two = withDebts(['d1', 'Card', 1000], ['d2', 'Loan', 1500]);

test('payDebts pays debts in list order and hands back what is left over', () => {
  assert.deepEqual(c.payDebts(two.debts, 2200), {
    debts: [{ id: 'd1', name: 'Card', owing: 0 }, { id: 'd2', name: 'Loan', owing: 300 }], paid: 2200, left: 0,
  });
  const over = c.payDebts(two.debts, 3000);
  assert.equal(over.paid, 2500);
  assert.equal(over.left, 500);
  assert.deepEqual(c.payDebts([], 700), { debts: [], paid: 0, left: 700 });
  assert.deepEqual(c.payDebts(undefined, 700), { debts: [], paid: 0, left: 700 });
  assert.equal(two.debts[0].owing, 1000, 'the original list is not changed');
});

test('debtSummary says how much is owing and how many fortnights of saving it takes', () => {
  const s = c.debtSummary(two);
  assert.equal(s.total, 2500);
  assert.equal(s.fortnightsToClear, 2);
  assert.equal(s.savedInLastFortnight, 1500);
  assert.equal(c.debtSummary(plan).total, 0);
  assert.equal(c.debtSummary(plan).fortnightsToClear, 0);
  const stuck = withDebts(['d1', 'Card', 1000]);
  stuck.savings.perFortnight = 0;
  assert.equal(c.debtSummary(stuck).fortnightsToClear, null);
});

test('checklistProgress sends house-deposit money to debts first', () => {
  assert.deepEqual(c.checklistProgress(two, ['t1', 't8', 't9'], 1100), { done: 3, total: 11, depositTransferred: 0, debtPaid: 2200 });
  const small = withDebts(['d1', 'Card', 1000]);
  assert.deepEqual(c.checklistProgress(small, ['t1', 't8', 't9'], 1100), { done: 3, total: 11, depositTransferred: 1200, debtPaid: 1000 });
  assert.deepEqual(c.checklistProgress(two, ['t2', 't11'], 1100), { done: 2, total: 11, depositTransferred: 0, debtPaid: 0 });
});

test('checklistGroups says where each house-deposit transfer should go while debts are owing', () => {
  const routing = (p, landed) => Object.fromEntries(c.checklistGroups(p, [], landed).flatMap((g) => g.rows).filter((r) => r.routing).map((r) => [r.transfer.id, r.routing]));
  assert.deepEqual(routing(two, 1100), {
    t1: [{ name: 'Card', amount: 700, isDebt: true }],
    t8: [{ name: 'Card', amount: 300, isDebt: true }, { name: 'Loan', amount: 600, isDebt: true }],
    t9: [{ name: 'Loan', amount: 600, isDebt: true }],
  });
  const small = withDebts(['d1', 'Card', 1000]);
  assert.deepEqual(routing(small, 1100), {
    t1: [{ name: 'Card', amount: 700, isDebt: true }],
    t8: [{ name: 'Card', amount: 300, isDebt: true }, { name: 'Deposit saver', amount: 600, isDebt: false }],
  });
  assert.deepEqual(routing(plan, 1100), {});
  const cleared = withDebts(['d1', 'Card', 0]);
  assert.deepEqual(routing(cleared, 1100), {});
});

test('the projection stays flat until the debts are cleared', () => {
  const s = c.savingsSeries(two, balances, [], TODAY);
  assert.deepEqual(s.projection.slice(0, 4), [
    { date: TODAY, amount: 3000 }, { date: '2026-12-01', amount: 3000 },
    { date: '2026-12-14', amount: 3000 }, { date: '2026-12-28', amount: 4500 },
  ]);
});

test('goalProgress counts debts as part of what still has to be found', () => {
  const g = c.goalProgress(plan.goals[0], 3000, TODAY, 2000, 2500, '2026-12-01');
  near(g.neededPerFortnight, 25500 / 13);
  assert.equal(g.onTrack, true);
  assert.equal(c.goalProgress(plan.goals[0], 3000, TODAY, 1900, 2500, '2026-12-01').onTrack, false);
  assert.equal(g.remaining, 23000);
  const met = c.goalProgress(plan.goals[0], 30000, TODAY, 2000, 2500);
  assert.equal(met.neededPerFortnight, 0);
});

test('checklistGroups: rows already ticked take the debts first, so each row says what a reset will do', () => {
  const routing = (ticks) => Object.fromEntries(c.checklistGroups(two, ticks, 1100).flatMap((g) => g.rows).filter((r) => r.routing).map((r) => [r.transfer.id, r.routing]));
  // Only the last house-deposit row is ticked: its 600 goes to the first debt, as the reset will do.
  assert.deepEqual(routing(['t9']), {
    t9: [{ name: 'Card', amount: 600, isDebt: true }],
    t1: [{ name: 'Card', amount: 400, isDebt: true }, { name: 'Loan', amount: 300, isDebt: true }],
    t8: [{ name: 'Loan', amount: 900, isDebt: true }],
  });
  assert.deepEqual(c.payDebts(two.debts, 600).debts.map((d) => d.owing), [400, 1500]);
});

// ---- Plan check --------------------------------------------------------------------
const linkedPlan = () => {
  const p = structuredClone(plan);
  const link = { c1: ['joint'], c2: ['sub2'], c3: ['ppa', 'ppb'], c4: ['ppa', 'ppb'], c5: ['sub1'] };
  p.categories.forEach((cat) => { [cat.accountId, cat.accountId2 = null] = link[cat.id]; });
  return p;
};

test('planCheck: every pay is fully given a job, and a pass-through account passes it all on', () => {
  const r = c.planCheck(plan);
  assert.deepEqual(r.pays.map((p) => [p.id, p.allocated, p.unassigned, p.ok]), [['a1', 2000, 0, true], ['b1', 1000, 0, true], ['b2', 1500, 0, true]]);
  assert.deepEqual(r.hubs.map((h) => [h.accountName, h.in, h.out, h.ok]), [['Bills hub', 500, 500, true], ['Bills hub', 800, 800, true]]);
});

test('planCheck: flags cents left unassigned, a pay given away twice, and a hub that keeps money', () => {
  const p = structuredClone(plan);
  p.incomeSources.find((s) => s.id === 'b2').takeHome = 1500.1;
  p.transfers.find((x) => x.id === 't7').amount = 1200;   // more than the pay it comes from
  p.transfers.find((x) => x.id === 't5').amount = 150;    // hub gets 500, passes on 450
  const r = c.planCheck(p);
  assert.deepEqual(r.pays.map((x) => [x.id, x.unassigned, x.ok]), [['a1', 0, true], ['b1', -200, false], ['b2', 0.1, false]]);
  assert.deepEqual(r.hubs[0], { sourceName: 'Employer One', accountName: 'Bills hub', in: 500, out: 450, diff: 50, ok: false });
});

test('planCheck: compares each account\'s money with the budget paid from it, pooling shared accounts', () => {
  const r = c.planCheck(linkedPlan());
  const row = (name) => r.pools.find((x) => x.names.includes(name));
  near(row('Joint everyday').transferMonthly, 500 * 26 / 12);   // what stays for bills
  assert.equal(row('Joint everyday').budgetMonthly, 400);
  assert.equal(row('Joint everyday').ok, false);
  assert.deepEqual(row('Person A spending').names, ['Person A spending', 'Person B spending']);
  near(row('Person A spending').transferMonthly, 500 * 26 / 12);
  near(row('Person A spending').budgetMonthly, 100 + c.fuelSummary(plan.fuel).costPerMonth);
  assert.equal(r.pools.some((x) => x.names.includes('Bills hub')), false);   // keeps nothing
  assert.equal(r.pools.some((x) => x.names.includes('Deposit saver')), false);
  assert.deepEqual(r.unlinked, []);
});

test('planCheck: money sent to an account with no budget category is flagged, and so are categories with no account', () => {
  const p = linkedPlan();
  p.categories.find((x) => x.id === 'c2').accountId = null;
  const r = c.planCheck(p);
  const home = r.pools.find((x) => x.names.includes('Bills: home'));
  assert.equal(home.categories, 0);
  assert.equal(home.ok, false);
  assert.deepEqual(r.unlinked.map((u) => [u.name, u.budget]), [['Power', 200]]);
  assert.ok(r.issues >= 2);
});

test('planCheck: within the tolerance counts as adding up', () => {
  const p = linkedPlan();
  p.categories.find((x) => x.id === 'c2').budget = Math.round(200 * 26 / 12) + 5;   // sub2 gets 200 a fortnight
  assert.equal(c.planCheck(p).pools.find((x) => x.names.includes('Bills: home')).ok, true);
  p.categories.find((x) => x.id === 'c2').budget += 20;
  assert.equal(c.planCheck(p).pools.find((x) => x.names.includes('Bills: home')).ok, false);
});

test('planCheck: left over is compared with what the transfers send to savings', () => {
  const r = c.planCheck(plan);
  near(r.savings.toSavings, (700 + 800 + 600 + 100) * 26 / 12);   // deposit and emergency, the rest estimated
  near(r.savings.gap, c.costSummary(plan).leftOver - r.savings.toSavings);
  assert.equal(r.savings.ok, false);
  const p = structuredClone(plan);
  p.categories.push({ id: 'cx', name: 'Everything else', measured: null, budget: Math.round(r.savings.gap), link: null });
  assert.equal(c.planCheck(p).savings.ok, true);
});
