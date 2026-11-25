// Every calculation in the app, as pure functions of the plan. No imports.

const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) || 0), 0);
const byId = (items) => new Map((items || []).map((item) => [item.id, item]));

// ---- Income -----------------------------------------------------------------
export const toMonthly = (fortnightly) => (fortnightly * 26) / 12;

export function incomeSummary(plan) {
  const people = byId(plan.people);
  const sources = plan.incomeSources.map((s) => ({
    ...s,
    personName: people.get(s.personId) ? people.get(s.personId).name : '',
    monthly: toMonthly(s.takeHome),
    grossAnnual: s.gross === null || s.gross === undefined ? null : s.gross * 26,
    sacrifices: s.sacrifices || [],
  }));
  const takeHomeFortnight = sum(sources, (s) => s.takeHome);
  const grossFortnight = sum(sources, (s) => s.gross);
  return {
    sources,
    takeHomeFortnight,
    takeHomeMonthly: toMonthly(takeHomeFortnight),
    sacrificeFortnight: sum(sources, (s) => sum(s.sacrifices, (x) => x.amount)),
    grossFortnight,
    grossAnnual: grossFortnight * 26,
    loansTotal: sum(plan.loans || [], (l) => l.balance),
  };
}

// ---- Cost of living -----------------------------------------------------------
const WEEKS_PER_MONTH = 52 / 12;

export function fuelSummary(fuel) {
  const trips = (fuel.trips || []).map((trip) => {
    const litresPerWeek = (trip.returnKm * trip.tripsPerWeek * trip.litresPer100) / 100;
    return { ...trip, litresPerWeek, costPerWeek: litresPerWeek * fuel.pricePerLitre };
  });
  const litresPerWeek = sum(trips, (trip) => trip.litresPerWeek);
  const costPerWeek = litresPerWeek * fuel.pricePerLitre;
  return { trips, litresPerWeek, costPerWeek, costPerMonth: costPerWeek * WEEKS_PER_MONTH };
}

const present = (v) => v !== null && v !== undefined;

export function categoryRows(plan) {
  const fuelMonthly = fuelSummary(plan.fuel).costPerMonth;
  return plan.categories.map((cat) => {
    const linked = cat.link === 'fuel';
    const budget = linked ? fuelMonthly : (present(cat.budget) ? cat.budget : null);
    return {
      id: cat.id,
      name: cat.name,
      measured: present(cat.measured) ? cat.measured : null,
      budget,
      sixMonth: budget === null ? null : budget * 6,
      basis: cat.basis || '',
      linked,
    };
  });
}

export function costSummary(plan) {
  const rows = categoryRows(plan);
  const income = incomeSummary(plan).takeHomeMonthly;
  const budgetTotal = sum(rows, (r) => r.budget);
  return { income, measuredTotal: sum(rows, (r) => r.measured), budgetTotal, leftOver: income - budgetTotal };
}

// Rows for the "where the money goes" chart: largest first, each with its share of the total.
export function barData(plan, mode) {
  const rows = categoryRows(plan)
    .map((r) => ({ id: r.id, name: r.name, amount: (mode === 'measured' ? r.measured : r.budget) || 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = sum(rows, (r) => r.amount);
  // Whole per cents that always add up to 100: round down, then hand the spare points
  // to the rows that lost the most in the rounding.
  const exact = rows.map((r) => (r.amount / total) * 100);
  const percents = exact.map(Math.floor);
  const spare = Math.round(100 - sum(percents, (n) => n));
  exact.map((value, i) => ({ i, lost: value - percents[i] }))
    .sort((a, b) => b.lost - a.lost || a.i - b.i)
    .slice(0, spare)
    .forEach(({ i }) => { percents[i] += 1; });
  return rows.map((r, i) => ({ ...r, share: r.amount / total, percent: percents[i] }));
}

// ---- Debts to clear before saving ---------------------------------------------
const cents = (n) => Math.round(n * 100) / 100;

// Pay debts in list order. Returns the reduced list, what was paid, and what is left over.
export function payDebts(debts, amount) {
  let left = amount;
  const next = (debts || []).map((debt) => {
    const pay = Math.min(debt.owing || 0, left);
    left = cents(left - pay);
    return { ...debt, owing: cents((debt.owing || 0) - pay) };
  });
  return { debts: next, paid: cents(amount - left), left };
}

export const debtsOwing = (plan) => cents(sum(plan.debts || [], (d) => d.owing));

export function debtSummary(plan) {
  const total = debtsOwing(plan);
  const perFortnight = (plan.savings && plan.savings.perFortnight) || 0;
  let fortnightsToClear = 0;
  if (total > 0) fortnightsToClear = perFortnight > 0 ? Math.ceil(total / perFortnight) : null;
  return {
    debts: (plan.debts || []).map((d) => ({ id: d.id, name: d.name, owing: d.owing || 0 })),
    total,
    perFortnight,
    fortnightsToClear,
    // What is left for the house deposit in the fortnight the debts are finished.
    savedInLastFortnight: fortnightsToClear ? cents(perFortnight * fortnightsToClear - total) : 0,
  };
}

// ---- Payday checklist ---------------------------------------------------------
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayIndex = (name) => {
  const i = WEEKDAYS.indexOf(String(name || '').trim().toLowerCase());
  return i === -1 ? 7 : i;
};

// A fixed transfer is its amount. "The rest" is what landed minus the other transfers out of
// the same account from the same pay. Until the landed amount is entered it is an estimate.
export function transferAmount(plan, transfer, landed) {
  if (transfer.rule !== 'remainder') return { amount: transfer.amount, isEstimate: false };
  const source = plan.incomeSources.find((s) => s.id === transfer.incomeSourceId);
  const isEstimate = landed === null || landed === undefined;
  const base = isEstimate ? (source ? source.takeHome : 0) : landed;
  const others = sum(
    plan.transfers.filter((o) => o.id !== transfer.id && o.rule !== 'remainder'
      && o.incomeSourceId === transfer.incomeSourceId && o.fromAccountId === transfer.fromAccountId),
    (o) => o.amount,
  );
  return { amount: Math.max(0, Math.round((base - others) * 100) / 100), isEstimate };
}

export function checklistGroups(plan, ticks, landed) {
  const accounts = byId(plan.accounts);
  const people = byId(plan.people);
  const ticked = new Set(ticks);
  const name = (id) => (accounts.get(id) ? accounts.get(id).name : '');
  const depositIds = new Set(plan.accounts.filter((a) => a.role === 'deposit').map((a) => a.id));
  // While debts are owing, house-deposit transfers go to them first, in checklist order.
  let owing = (plan.debts || []).filter((d) => d.owing > 0).map((d) => ({ name: d.name, owing: d.owing }));
  const anyOwing = owing.length > 0;
  const route = (transfer, amount) => {
    if (!anyOwing || !depositIds.has(transfer.toAccountId) || !owing.length) return null;
    const parts = [];
    let left = amount;
    owing = owing.filter((debt) => {
      if (left <= 0) return true;
      const pay = Math.min(debt.owing, left);
      parts.push({ name: debt.name, amount: cents(pay), isDebt: true });
      left = cents(left - pay);
      debt.owing = cents(debt.owing - pay);
      return debt.owing > 0;
    });
    if (left > 0) parts.push({ name: name(transfer.toAccountId), amount: left, isDebt: false });
    return parts.some((part) => part.isDebt) ? parts : null;
  };
  const groups = plan.incomeSources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => (a.source.weekOfFortnight - b.source.weekOfFortnight)
      || (dayIndex(a.source.payday) - dayIndex(b.source.payday)) || (a.index - b.index))
    .map(({ source }) => {
      const mine = plan.transfers.filter((tr) => tr.incomeSourceId === source.id);
      const rows = mine.filter((tr) => tr.rule !== 'stays').map((transfer) => {
        const { amount, isEstimate } = transferAmount(plan, transfer, landed);
        return {
          transfer, amount, isEstimate,
          fromName: name(transfer.fromAccountId),
          toName: name(transfer.toAccountId),
          ticked: ticked.has(transfer.id),
          tickable: !isEstimate,
          routing: null,
        };
      });
      return {
        source,
        personName: people.get(source.personId) ? people.get(source.personId).name : '',
        rows,
        stays: mine.filter((tr) => tr.rule === 'stays').map((tr) => ({ accountName: name(tr.fromAccountId), amount: tr.amount })),
        hasRemainder: mine.some((tr) => tr.rule === 'remainder'),
        done: rows.filter((r) => r.ticked).length,
      };
    });
  // What is already ticked is what a reset will pay first, so those rows take the debts
  // first; the rows still to do take whatever is owing after that. Checklist order within each.
  const all = groups.flatMap((g) => g.rows);
  for (const row of all.filter((r) => r.ticked)) row.routing = route(row.transfer, row.amount);
  for (const row of all.filter((r) => !r.ticked)) row.routing = route(row.transfer, row.amount);
  return groups;
}

export function checklistProgress(plan, ticks, landed) {
  const ticked = new Set(ticks);
  const deposit = new Set(plan.accounts.filter((a) => a.role === 'deposit').map((a) => a.id));
  const real = plan.transfers.filter((tr) => tr.rule !== 'stays');
  let done = 0;
  let depositTransferred = 0;
  for (const transfer of real) {
    if (!ticked.has(transfer.id)) continue;
    done += 1;
    if (!deposit.has(transfer.toAccountId)) continue;
    const { amount, isEstimate } = transferAmount(plan, transfer, landed);
    if (!isEstimate) depositTransferred += amount;   // an unlanded "rest" is worth nothing yet
  }
  const { paid, left } = payDebts(plan.debts, cents(depositTransferred));
  return { done, total: real.length, depositTransferred: left, debtPaid: paid };
}

// ---- Savings ------------------------------------------------------------------
const DAY = 86400000;
const toMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, days) => toIso(toMs(iso) + days * DAY);
export const daysBetween = (fromIso, toIsoDate) => Math.round((toMs(toIsoDate) - toMs(fromIso)) / DAY);

export function accountSeries(balances, accountId) {
  return balances
    .filter((b) => b.accountId === accountId)
    .map((b) => ({ date: b.onDate, amount: b.balance }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function depositAccount(plan) {
  return plan.accounts.find((a) => a.role === 'deposit') || null;
}
export function emergencyAccount(plan) {
  return plan.accounts.find((a) => a.role === 'emergency') || null;
}

// The real savings line: logged balances, then any deposits recorded after the latest one.
export function savingsSeries(plan, balances, history, today) {
  const account = depositAccount(plan);
  const actual = account ? accountSeries(balances, account.id) : [];
  const latest = actual.length ? actual[actual.length - 1] : null;
  let running = latest ? latest.amount : 0;
  // A logged balance is the truth. A past fortnight is added on top only if it began on or
  // after the day of that balance; one that was already under way may be partly in the balance,
  // and counting it again would overstate the savings. (Rows saved before fortnights recorded
  // their start are judged by the day they were closed.)
  const later = history
    .filter((h) => !latest || (h.startedOn ? h.startedOn >= latest.date : h.closedOn > latest.date))
    .sort((a, b) => a.closedOn.localeCompare(b.closedOn));
  for (const h of later) {
    running = Math.round((running + h.depositTransferred) * 100) / 100;
    actual.push({ date: h.closedOn, amount: running });
  }
  const saved = running;

  const perFortnight = (plan.savings && plan.savings.perFortnight) || 0;
  const owing = debtsOwing(plan);
  const end = (plan.goals || []).reduce((max, g) => (g.targetDate > max ? g.targetDate : max), today);
  // Saving starts with the plan: the fortnights are counted from the plan's first day if that
  // is still ahead. Each fortnight is 14 days counting its first day, so one that starts on the
  // 1st is banked by the 14th. A part fortnight at the end counts as a whole one, as in goalProgress.
  const from = countFrom(plan, today);
  const projection = [{ date: today, amount: saved }];
  if (from > today && from <= end) projection.push({ date: from, amount: saved });
  for (let i = 1; i <= 260; i += 1) {
    const amount = saved + Math.max(0, perFortnight * i - owing);
    const date = addDays(from, i * 14 - 1);
    if (date > end) {
      if (i === 1 || addDays(from, (i - 1) * 14 - 1) < end) projection.push({ date: end, amount });
      break;
    }
    projection.push({ date, amount });
  }
  return { actual, projection, saved, hasData: actual.length > 0, from };
}

// The day the fortnights are counted from: today, or the plan's first day if that is later.
export function countFrom(plan, today) {
  const start = plan && plan.period && plan.period.start;
  return start && start > today ? start : today;
}

// `owing` is debt that has to be cleared from the same money before any of it is saved.
// Fortnights left are pay cycles still to come: counted from `from` (see countFrom) when that
// is later than today, with a part fortnight counted as a whole one. Both end days count, so
// 1 December to 31 May is exactly 13 fortnights.
export function goalProgress(goal, saved, today, perFortnight = 0, owing = 0, from = null) {
  const remaining = Math.max(0, goal.target - saved);
  const start = from && from > today ? from : today;
  const fortnightsLeft = Math.max(0, Math.ceil((daysBetween(start, goal.targetDate) + 1) / 14));
  let neededPerFortnight;
  if (remaining === 0) neededPerFortnight = 0;
  else if (fortnightsLeft === 0) neededPerFortnight = null;
  else neededPerFortnight = (remaining + owing) / fortnightsLeft;
  return {
    pct: goal.target > 0 ? Math.min(1, saved / goal.target) : 1,
    remaining,
    fortnightsLeft,
    neededPerFortnight,
    onTrack: neededPerFortnight === null ? false : perFortnight >= neededPerFortnight,
    datePassed: goal.targetDate < today,
  };
}

// ---- Plan check ----------------------------------------------------------------
// Does the plan add up? Each pay against its transfers, each pass-through account in against
// out, each account's money against the budget categories paid from it, and what is left
// over against what the transfers really send to savings.
export const ACCOUNT_TOLERANCE = 10;   // dollars a month; rounding to whole dollars adds up
export const SAVINGS_TOLERANCE = 20;

export function planCheck(plan) {
  const accounts = byId(plan.accounts);
  const worth = (t) => (t.rule === 'remainder' ? transferAmount(plan, t, null).amount : t.amount || 0);
  const moving = plan.transfers.filter((t) => t.rule !== 'stays');

  const pays = plan.incomeSources.map((source) => {
    const mine = plan.transfers.filter((t) => t.incomeSourceId === source.id);
    const fedByThisPay = new Set(mine.filter((t) => t.rule !== 'stays').map((t) => t.toAccountId));
    const first = mine.filter((t) => !fedByThisPay.has(t.fromAccountId));   // out of where the pay lands
    const hasRemainder = first.some((t) => t.rule === 'remainder');
    const set = sum(first.filter((t) => t.rule !== 'remainder'), (t) => t.amount);
    const allocated = hasRemainder ? Math.max(set, source.takeHome) : set;
    const unassigned = cents(source.takeHome - allocated);
    return { id: source.id, name: source.name, takeHome: source.takeHome, allocated: cents(allocated), unassigned, hasRemainder, ok: unassigned === 0 };
  });

  const hubs = [];
  for (const source of plan.incomeSources) {
    const mine = moving.filter((t) => t.incomeSourceId === source.id);
    for (const account of plan.accounts) {
      const into = mine.filter((t) => t.toAccountId === account.id);
      const out = mine.filter((t) => t.fromAccountId === account.id);
      if (!into.length || !out.length) continue;
      const moneyIn = cents(sum(into, worth));
      const moneyOut = cents(sum(out, worth));
      hubs.push({ sourceName: source.name, accountName: account.name, in: moneyIn, out: moneyOut, diff: cents(moneyIn - moneyOut), ok: moneyIn === moneyOut });
    }
  }

  // Money that ends up in each account every fortnight, to be spent from there.
  const receives = new Set(moving.map((t) => t.toAccountId));
  const kept = (id) => sum(plan.transfers.filter((t) => t.rule === 'stays' && t.fromAccountId === id), (t) => t.amount)
    + (receives.has(id) ? sum(moving.filter((t) => t.toAccountId === id), worth) - sum(moving.filter((t) => t.fromAccountId === id), worth) : 0);

  // Categories can be paid from one account or shared by two; accounts that share a category
  // are checked together.
  const group = new Map(plan.accounts.map((a) => [a.id, a.id]));
  const find = (id) => { let at = id; while (group.get(at) !== at) at = group.get(at); return at; };
  const rows = categoryRows(plan);
  const linksOf = (cat) => [cat.accountId, cat.accountId2].filter((id) => id && accounts.has(id));
  const linked = [];
  const unlinked = [];
  plan.categories.forEach((cat, i) => {
    const links = linksOf(cat);
    const budget = rows[i].budget || 0;
    if (!links.length) { if (budget > 0) unlinked.push({ id: cat.id, name: cat.name, budget }); return; }
    if (links.length === 2) group.set(find(links[1]), find(links[0]));
    linked.push({ account: links[0], budget });
  });
  const pools = [];
  for (const account of plan.accounts) {
    if (account.role !== 'none' || find(account.id) !== account.id) continue;
    const members = plan.accounts.filter((a) => a.role === 'none' && find(a.id) === account.id);
    const mine = linked.filter((l) => find(l.account) === account.id);
    const transferMonthly = toMonthly(sum(members, (a) => kept(a.id)));
    const budgetMonthly = sum(mine, (l) => l.budget);
    if (Math.abs(transferMonthly) < 0.005 && budgetMonthly < 0.005) continue;
    const diff = transferMonthly - budgetMonthly;
    pools.push({
      names: members.filter((a) => members.length === 1 || Math.abs(kept(a.id)) >= 0.005 || linked.some((l) => l.account === a.id)).map((a) => a.name),
      transferMonthly, budgetMonthly, diff,
      categories: mine.length,
      ok: mine.length > 0 && Math.abs(diff) <= ACCOUNT_TOLERANCE,
    });
  }

  const cost = costSummary(plan);
  const savingIds = new Set(plan.accounts.filter((a) => a.role !== 'none').map((a) => a.id));
  const toSavings = toMonthly(sum(moving.filter((t) => savingIds.has(t.toAccountId)), worth));
  const gap = cost.leftOver - toSavings;
  const savings = { leftOver: cost.leftOver, toSavings, gap, ok: Math.abs(gap) <= SAVINGS_TOLERANCE };

  const issues = pays.filter((p) => !p.ok).length + hubs.filter((h) => !h.ok).length
    + pools.filter((p) => !p.ok).length + (unlinked.length ? 1 : 0) + (savings.ok ? 0 : 1);
  return { pays, hubs, pools, unlinked, savings, issues };
}
