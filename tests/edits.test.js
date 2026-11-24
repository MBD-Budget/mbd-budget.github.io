import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits, classifyError } from '../assets/js/plan.js';

const example = JSON.parse(readFileSync(new URL('../seed/plan.example.json', import.meta.url))).plan;

test('applyEdits writes valid values to a copy and leaves the original alone', () => {
  const { plan, errors } = applyEdits(example, [
    { path: 'incomeSources.0.takeHome', type: 'money', value: '$2,100.50' },
    { path: 'incomeSources.0.name', type: 'text', value: '  New name ' },
    { path: 'fuel.trips.1.tripsPerWeek', type: 'number', value: '0.5' },
    { path: 'goals.0.targetDate', type: 'date', value: '2027-06-30' },
    { path: 'categories.3.measured', type: 'moneyOrNull', value: '' },
    { path: 'incomeSources.1.isEstimate', type: 'bool', value: false },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(plan.incomeSources[0].takeHome, 2100.5);
  assert.equal(plan.incomeSources[0].name, 'New name');
  assert.equal(plan.fuel.trips[1].tripsPerWeek, 0.5);
  assert.equal(plan.goals[0].targetDate, '2027-06-30');
  assert.equal(plan.categories[3].measured, null);
  assert.equal(plan.incomeSources[1].isEstimate, false);
  assert.equal(example.incomeSources[0].takeHome, 2000);
});

test('applyEdits rejects empty, negative and non-numeric money and keeps the old value', () => {
  for (const value of ['', '-5', 'abc']) {
    const { plan, errors } = applyEdits(example, [{ path: 'incomeSources.0.takeHome', type: 'money', value }]);
    assert.equal(errors.length, 1, `value "${value}"`);
    assert.equal(errors[0].path, 'incomeSources.0.takeHome');
    assert.equal(plan.incomeSources[0].takeHome, 2000);
  }
});

test('applyEdits rejects a bad date, a bad number and empty required text', () => {
  const { errors } = applyEdits(example, [
    { path: 'goals.0.targetDate', type: 'date', value: '31/05/2027' },
    { path: 'fuel.trips.0.returnKm', type: 'number', value: 'far' },
    { path: 'categories.0.name', type: 'text', value: '   ' },
  ]);
  assert.deepEqual(errors.map((e) => e.path), ['goals.0.targetDate', 'fuel.trips.0.returnKm', 'categories.0.name']);
});

test('applyEdits allows optional text to be empty', () => {
  const { plan, errors } = applyEdits(example, [{ path: 'categories.0.basis', type: 'textOptional', value: '' }]);
  assert.deepEqual(errors, []);
  assert.equal(plan.categories[0].basis, '');
});

test('applyEdits turns an empty choice into null', () => {
  const { plan, errors } = applyEdits(example, [{ path: 'transfers.5.toAccountId', type: 'choice', value: '' }]);
  assert.deepEqual(errors, []);
  assert.equal(plan.transfers[5].toAccountId, null);
});

test('classifyError tells a dropped connection from an expired sign-in', () => {
  assert.equal(classifyError(new TypeError('Failed to fetch')), 'offline');
  assert.equal(classifyError(new TypeError('Load failed')), 'offline');
  assert.equal(classifyError({ message: 'NetworkError when attempting to fetch resource.' }), 'offline');
  assert.equal(classifyError({ message: 'JWT expired', code: 'PGRST301' }), 'auth');
  assert.equal(classifyError({ message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 }), 'auth');
  assert.equal(classifyError({ message: 'x', status: 401 }), 'auth');
  assert.equal(classifyError({ message: 'duplicate key value', code: '23505' }), 'other');
  assert.equal(classifyError(null), 'other');
});

import { blankRow, validatePlan } from '../assets/js/plan.js';

test('a blank row added to any list leaves the plan valid', () => {
  for (const list of ['loans', 'categories', 'fuel.trips', 'goals', 'accounts', 'transfers', 'incomeSources', 'incomeSources.0.sacrifices']) {
    const plan = structuredClone(example);
    const target = list.split('.').reduce((o, k) => o[k], plan);
    const before = target.length;
    target.push(blankRow(list, plan));
    assert.equal(target.length, before + 1);
    assert.deepEqual(validatePlan(plan), [], `list ${list}`);
  }
});

test('blank rows get ids that do not clash with existing ones', () => {
  const plan = structuredClone(example);
  const a = blankRow('transfers', plan);
  plan.transfers.push(a);
  const b = blankRow('transfers', plan);
  assert.notEqual(a.id, b.id);
  assert.ok(!example.transfers.some((t) => t.id === a.id));
});
