// The plan document: parsing and validation. No imports, so it runs in Node tests too.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RULES = ['fixed', 'remainder', 'stays'];
const ROLES = ['none', 'deposit', 'emergency'];

// Text a person typed -> dollars rounded to cents, or null when it isn't a usable amount.
export function parseMoney(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNumOrNull = (v) => v === null || v === undefined || isNum(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isDate = (v) => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

function checkList(errors, list, label) {
  if (!Array.isArray(list)) {
    errors.push(`${label} is missing.`);
    return [];
  }
  const seen = new Set();
  list.forEach((item, i) => {
    if (!item || !isText(item.id)) errors.push(`${label} ${i + 1} has no id.`);
    else if (seen.has(item.id)) errors.push(`${label} id "${item.id}" is used more than once.`);
    else seen.add(item.id);
  });
  return list.filter(Boolean);
}

export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return ['The plan is missing.'];

  const people = checkList(errors, plan.people, 'Person');
  const sources = checkList(errors, plan.incomeSources, 'Income source');
  const loans = checkList(errors, plan.loans, 'Loan');
  const categories = checkList(errors, plan.categories, 'Category');
  const accounts = checkList(errors, plan.accounts, 'Account');
  const transfers = checkList(errors, plan.transfers, 'Transfer');
  const goals = checkList(errors, plan.goals, 'Goal');
  const personIds = new Set(people.map((p) => p.id));
  const sourceIds = new Set(sources.map((s) => s.id));
  const accountIds = new Set(accounts.map((a) => a.id));

  for (const s of sources) {
    const name = s.name || s.id;
    if (!personIds.has(s.personId)) errors.push(`Income source "${name}" points at an unknown person.`);
    if (!isNum(s.takeHome)) errors.push(`Income source "${name}" needs a take-home amount.`);
    if (!isNumOrNull(s.gross)) errors.push(`Income source "${name}" has a gross amount that isn't a number.`);
    if (s.weekOfFortnight !== 1 && s.weekOfFortnight !== 2) errors.push(`Income source "${name}" needs week 1 or week 2.`);
    for (const sac of s.sacrifices || []) {
      if (!isNum(sac.amount)) errors.push(`A salary-sacrifice amount on "${name}" isn't a number.`);
    }
  }

  for (const l of loans) {
    if (!isNumOrNull(l.balance)) errors.push(`Loan "${l.name || l.id}" has a balance that isn't a number.`);
  }

  for (const c of categories) {
    if (!isNumOrNull(c.measured)) errors.push(`Category "${c.name || c.id}" has a measured amount that isn't a number.`);
    if (!isNumOrNull(c.budget)) errors.push(`Category "${c.name || c.id}" has a budget that isn't a number.`);
  }

  const fuel = plan.fuel;
  if (!fuel || !isNum(fuel.pricePerLitre) || !Array.isArray(fuel.trips)) {
    errors.push('The fuel calculator needs a price and a list of trips.');
  } else {
    for (const t of fuel.trips) {
      if (![t.returnKm, t.tripsPerWeek, t.litresPer100].every(isNum)) {
        errors.push(`Fuel trip "${t.name || t.id}" has a value that isn't a number.`);
      }
    }
  }

  for (const a of accounts) {
    if (!ROLES.includes(a.role)) errors.push(`Account "${a.name || a.id}" has an unknown role.`);
  }
  const deposits = accounts.filter((a) => a.role === 'deposit').length;
  if (deposits !== 1) errors.push(`There must be exactly one house-deposit account (found ${deposits}).`);

  const remainderBySource = new Map();
  for (const t of transfers) {
    if (!RULES.includes(t.rule)) { errors.push(`Transfer "${t.id}" has an unknown rule.`); continue; }
    if (!sourceIds.has(t.incomeSourceId)) errors.push(`Transfer "${t.id}" points at an unknown income source.`);
    if (!accountIds.has(t.fromAccountId)) errors.push(`Transfer "${t.id}" comes from an unknown account.`);
    if (t.rule !== 'stays' && !accountIds.has(t.toAccountId)) errors.push(`Transfer "${t.id}" goes to an unknown account.`);
    if (!isNum(t.amount)) errors.push(`Transfer "${t.id}" has an amount that isn't a number.`);
    if (t.rule === 'remainder') {
      remainderBySource.set(t.incomeSourceId, (remainderBySource.get(t.incomeSourceId) || 0) + 1);
    }
  }
  for (const [sourceId, count] of remainderBySource) {
    if (count > 1) errors.push(`Income source "${sourceId}" has more than one "the rest" transfer.`);
  }

  for (const g of goals) {
    if (!isNum(g.target)) errors.push(`Goal "${g.name || g.id}" needs a target amount.`);
    if (!isDate(g.targetDate)) errors.push(`Goal "${g.name || g.id}" needs a target date.`);
  }

  if (!plan.savings || !isNum(plan.savings.perFortnight)) {
    errors.push('Savings needs an amount per fortnight.');
  }
  return errors;
}

export function validateExport(obj) {
  if (!obj || typeof obj !== 'object') return ['This file is not a budget export.'];
  if (obj.version !== 1) return ['This file is not a version 1 budget export.'];
  const errors = validatePlan(obj.plan);
  const accountIds = new Set(((obj.plan && obj.plan.accounts) || []).filter(Boolean).map((a) => a.id));

  (obj.balances || []).forEach((b, i) => {
    if (!b || !accountIds.has(b.accountId) || !isDate(b.onDate) || !isNum(b.balance)) {
      errors.push(`Balance entry ${i + 1} needs a known account, a date and an amount.`);
    }
  });
  (obj.history || []).forEach((h, i) => {
    if (!h || !isDate(h.closedOn) || ![h.transfersDone, h.transfersTotal, h.depositTransferred].every(isNum)) {
      errors.push(`History entry ${i + 1} needs a date and three numbers.`);
    }
  });
  return errors;
}

// ---- Edits typed into a page ----------------------------------------------
// Each edit is { path: 'incomeSources.0.takeHome', type, value }.
// Returns a changed copy plus one error per value that could not be used;
// a rejected value leaves that field as it was.
const EDIT_MESSAGES = {
  money: 'Enter an amount, like 1600 or 1,600.50.',
  moneyOrNull: 'Enter an amount, or leave it empty.',
  number: 'Enter a number, zero or more.',
  date: 'Choose a date.',
  dateOrNull: 'Choose a date, or leave it empty.',
  text: 'This can\'t be empty.',
};

function readEdit(type, value) {
  const text = typeof value === 'string' ? value.trim() : value;
  switch (type) {
    case 'money': {
      const n = parseMoney(value);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'moneyOrNull': {
      if (text === '' || text === null || text === undefined) return { ok: true, value: null };
      const n = parseMoney(value);
      return n === null ? { ok: false } : { ok: true, value: n };
    }
    case 'number': {
      const cleaned = String(text ?? '').replace(/,/g, '');
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return { ok: false };
      return { ok: true, value: Number(cleaned) };
    }
    case 'date':
      return isDate(text) ? { ok: true, value: text } : { ok: false };
    case 'dateOrNull':
      if (text === '' || text === null || text === undefined) return { ok: true, value: null };
      return isDate(text) ? { ok: true, value: text } : { ok: false };
    case 'choiceInt':
      return /^\d+$/.test(String(text)) ? { ok: true, value: Number(text) } : { ok: false };
    case 'text':
      return isText(text) ? { ok: true, value: text } : { ok: false };
    case 'textOptional':
      return { ok: true, value: text ?? '' };
    case 'choice':
      return { ok: true, value: text === '' || text === undefined ? null : text };
    case 'bool':
      return { ok: true, value: Boolean(value) };
    default:
      return { ok: false };
  }
}

export function applyEdits(plan, edits) {
  const copy = structuredClone(plan);
  const errors = [];
  for (const edit of edits) {
    const result = readEdit(edit.type, edit.value);
    if (!result.ok) {
      errors.push({ path: edit.path, message: EDIT_MESSAGES[edit.type] || 'This value can\'t be used.' });
      continue;
    }
    const keys = edit.path.split('.');
    let target = copy;
    for (const key of keys.slice(0, -1)) {
      if (target == null) break;
      target = target[key];
    }
    if (target == null) {
      errors.push({ path: edit.path, message: 'This field no longer exists.' });
      continue;
    }
    target[keys[keys.length - 1]] = result.value;
  }
  return { plan: copy, errors };
}

// ---- What kind of failure was that? ---------------------------------------
// 'offline': the server could not be reached. 'auth': the sign-in is no longer good.
export function classifyError(error) {
  if (!error) return 'other';
  const message = String(error.message || '');
  if (error.status === 401 || error.code === 'PGRST301' || /jwt|refresh token|not authenticated|session/i.test(message)) {
    return 'auth';
  }
  if (error instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return 'offline';
  }
  return 'other';
}

// ---- New empty rows for the lists a person can add to ----------------------
export function blankRow(list, plan) {
  const key = list.replace(/\.\d+\./g, '.');
  const firstId = (items) => (items && items[0] ? items[0].id : null);
  switch (key) {
    case 'loans':
      return { id: newId('l'), personId: firstId(plan.people), name: 'New loan', balance: 0, asAt: null };
    case 'categories':
      return { id: newId('c'), name: 'New category', measured: null, budget: 0, basis: '', link: null };
    case 'fuel.trips':
      return { id: newId('f'), name: 'New trip', car: '', returnKm: 0, tripsPerWeek: 0, litresPer100: 0 };
    case 'goals':
      return { id: newId('g'), name: 'New goal', target: 0, targetDate: (plan.period && plan.period.end) || '2027-12-31' };
    case 'accounts':
      return { id: newId('a'), name: 'New account', job: '', role: 'none' };
    case 'transfers': {
      const from = firstId(plan.accounts);
      const to = plan.accounts.length > 1 ? plan.accounts[1].id : from;
      return { id: newId('t'), incomeSourceId: firstId(plan.incomeSources), fromAccountId: from, toAccountId: to, amount: 0, rule: 'fixed' };
    }
    case 'incomeSources':
      return { id: newId('s'), personId: firstId(plan.people), name: 'New income', takeHome: 0, isEstimate: false,
        payday: 'Thursday', weekOfFortnight: 1, note: '', gross: 0, sacrifices: [] };
    case 'incomeSources.sacrifices':
      return { label: 'Salary sacrifice', amount: 0 };
    default:
      throw new Error(`No blank row for ${list}`);
  }
}
