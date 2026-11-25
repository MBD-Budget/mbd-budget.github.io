import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMoney, validatePlan, validateExport, newId } from '../assets/js/plan.js';

const example = JSON.parse(readFileSync(new URL('../seed/plan.example.json', import.meta.url)));
const clone = () => structuredClone(example);

test('parseMoney accepts plain, comma and dollar forms and rounds to cents', () => {
  assert.equal(parseMoney('1,600'), 1600);
  assert.equal(parseMoney('$1600'), 1600);
  assert.equal(parseMoney(' 12.345 '), 12.35);
  assert.equal(parseMoney('0'), 0);
  assert.equal(parseMoney(42), 42);
});

test('parseMoney rejects empty, negative and non-numeric text', () => {
  for (const bad of ['', '   ', '-5', 'abc', '1.2.3', null, undefined, NaN, Infinity]) {
    assert.equal(parseMoney(bad), null, `should reject ${String(bad)}`);
  }
});

test('the example export is valid', () => {
  assert.deepEqual(validateExport(example), []);
  assert.deepEqual(validatePlan(example.plan), []);
});

test('rejects an empty object and a wrong version', () => {
  assert.ok(validateExport({}).length > 0);
  assert.ok(validateExport(null).length > 0);
  assert.ok(validateExport({ ...example, version: 2 }).length > 0);
});

test('reports one error each for an unknown account, a duplicate id and a non-number', () => {
  const p = clone();
  p.plan.transfers[0].toAccountId = 'nope';
  p.plan.transfers.push({ ...example.plan.transfers[1], id: 't2' });
  p.plan.categories[0].budget = 'lots';
  assert.equal(validateExport(p).length, 3);
});

test('allows only one "rest of this pay" transfer in the whole plan (there is one landed amount)', () => {
  const same = clone();
  same.plan.transfers.push({ id: 't13', incomeSourceId: 'b1', fromAccountId: 'joint', toAccountId: 'emg', amount: 0, rule: 'remainder' });
  assert.equal(validateExport(same).length, 1);
  const other = clone();
  other.plan.transfers.push({ id: 't13', incomeSourceId: 'b2', fromAccountId: 'joint', toAccountId: 'emg', amount: 0, rule: 'remainder' });
  assert.equal(validateExport(other).length, 1);
});

test('requires a budget period, so Settings can always open', () => {
  const p = clone();
  delete p.plan.period;
  assert.equal(validateExport(p).length, 1);
});

test('requires exactly one deposit account', () => {
  const none = clone();
  none.plan.accounts.find((a) => a.id === 'dep').role = 'none';
  assert.equal(validateExport(none).length, 1);
  const two = clone();
  two.plan.accounts.find((a) => a.id === 'hub').role = 'deposit';
  assert.equal(validateExport(two).length, 1);
});

test('a stays transfer needs no to-account, every other rule does', () => {
  const p = clone();
  p.plan.transfers.find((t) => t.id === 't2').toAccountId = null;
  assert.equal(validateExport(p).length, 1);
});

test('rejects balances with an unknown account, a bad date or a bad amount', () => {
  const p = clone();
  p.balances.push({ accountId: 'zzz', onDate: '2026-11-01', balance: 1 });
  p.balances.push({ accountId: 'dep', onDate: '1 Nov', balance: 1 });
  p.balances.push({ accountId: 'dep', onDate: '2026-11-02', balance: -1 });
  assert.equal(validateExport(p).length, 3);
});

test('rejects history rows with missing numbers', () => {
  const p = clone();
  p.history.push({ closedOn: '2026-11-20', transfersDone: 3, transfersTotal: 11, depositTransferred: 500 });
  assert.deepEqual(validateExport(p), []);
  p.history.push({ closedOn: '2026-11-20', transfersDone: 'x', transfersTotal: 11, depositTransferred: 500 });
  assert.equal(validateExport(p).length, 1);
});

test('newId gives a prefixed id that does not repeat', () => {
  const a = newId('t');
  const b = newId('t');
  assert.match(a, /^t-[a-z0-9]+$/);
  assert.notEqual(a, b);
});

test('debts are optional, and each one needs a name and an amount owing', () => {
  const ok = clone();
  ok.plan.debts = [{ id: 'd1', name: 'Card', owing: 1000 }, { id: 'd2', name: 'Loan', owing: 0 }];
  assert.deepEqual(validateExport(ok), []);
  const bad = clone();
  bad.plan.debts = [{ id: 'd1', name: 'Card', owing: 'some' }, { id: 'd1', name: '', owing: 5 }];
  assert.equal(validateExport(bad).length, 3);
});

test('history may record what went to debts', () => {
  const p = clone();
  p.history.push({ closedOn: '2026-11-20', transfersDone: 3, transfersTotal: 11, depositTransferred: 0, debtPaid: 2200 });
  assert.deepEqual(validateExport(p), []);
  p.history.push({ closedOn: '2026-11-20', transfersDone: 3, transfersTotal: 11, depositTransferred: 0, debtPaid: 'x' });
  assert.equal(validateExport(p).length, 1);
});

test('parseMoney takes commas only as thousands separators', () => {
  assert.equal(parseMoney('1,600.50'), 1600.5);
  assert.equal(parseMoney('$12,345,678'), 12345678);
  assert.equal(parseMoney('1,60'), null);      // a slip for 1.60, not 160
  assert.equal(parseMoney('16,00'), null);
  assert.equal(parseMoney('1,6000'), null);
  assert.equal(parseMoney(',500'), null);
});

test('a category may say which account pays for it, and it must be a real account', () => {
  const ok = clone();
  ok.plan.categories[0].accountId = 'joint';
  ok.plan.categories[0].accountId2 = null;
  assert.deepEqual(validateExport(ok), []);
  ok.plan.categories[0].accountId2 = 'nowhere';
  assert.equal(validateExport(ok).length, 1);
});

test('history may record the day the fortnight began', () => {
  const row = { closedOn: '2026-12-14', transfersDone: 1, transfersTotal: 11, depositTransferred: 100 };
  const withStart = clone(); withStart.history = [{ ...row, startedOn: '2026-12-01' }];
  assert.deepEqual(validateExport(withStart), []);
  const none = clone(); none.history = [{ ...row, startedOn: null }];
  assert.deepEqual(validateExport(none), []);
  const bad = clone(); bad.history = [{ ...row, startedOn: 'last week' }];
  assert.equal(validateExport(bad).length, 1);
});
