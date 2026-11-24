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
  return rows.map((r) => ({ ...r, share: r.amount / total }));
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
  return plan.incomeSources
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
  return { done, total: real.length, depositTransferred: Math.round(depositTransferred * 100) / 100 };
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
  const later = history
    .filter((h) => !latest || h.closedOn > latest.date)
    .sort((a, b) => a.closedOn.localeCompare(b.closedOn));
  for (const h of later) {
    running = Math.round((running + h.depositTransferred) * 100) / 100;
    actual.push({ date: h.closedOn, amount: running });
  }
  const saved = running;

  const perFortnight = (plan.savings && plan.savings.perFortnight) || 0;
  const end = (plan.goals || []).reduce((max, g) => (g.targetDate > max ? g.targetDate : max), today);
  const projection = [{ date: today, amount: saved }];
  for (let i = 1; i <= 260; i += 1) {
    const date = addDays(today, i * 14);
    if (date > end) break;
    projection.push({ date, amount: saved + perFortnight * i });
  }
  return { actual, projection, saved };
}

export function goalProgress(goal, saved, today, perFortnight = 0) {
  const remaining = Math.max(0, goal.target - saved);
  const fortnightsLeft = Math.max(0, Math.floor(daysBetween(today, goal.targetDate) / 14));
  let neededPerFortnight;
  if (remaining === 0) neededPerFortnight = 0;
  else if (fortnightsLeft === 0) neededPerFortnight = null;
  else neededPerFortnight = remaining / fortnightsLeft;
  return {
    pct: goal.target > 0 ? Math.min(1, saved / goal.target) : 1,
    remaining,
    fortnightsLeft,
    neededPerFortnight,
    onTrack: neededPerFortnight === null ? false : perFortnight >= neededPerFortnight,
    datePassed: goal.targetDate < today,
  };
}

// ING pays bonus interest only if the deposit account ends the month higher than it ended
// the month before. Compares the latest known balance with last month's last known balance.
export function ingCheck(plan, balances, history, today) {
  const { actual, saved } = savingsSeries(plan, balances, history, today);
  const thisMonth = today.slice(0, 7);
  const firstOfMonth = `${thisMonth}-01`;
  const lastMonth = addDays(firstOfMonth, -1).slice(0, 7);
  const nextMonthFirst = addDays(firstOfMonth, 32).slice(0, 7) + '-01';
  const deadline = addDays(nextMonthFirst, -1);
  const previous = actual.filter((p) => p.date.slice(0, 7) === lastMonth).pop();
  if (!previous) return { previousMonthEnd: null, current: saved, ok: null, shortfall: 0, deadline };
  return {
    previousMonthEnd: previous.amount,
    current: saved,
    ok: saved > previous.amount,
    shortfall: Math.max(0, Math.round((previous.amount - saved) * 100) / 100),
    deadline,
  };
}
