import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, money0, shortDate, pct, isoToday } from '../assets/js/format.js';

test('money formats AUD with cents', () => {
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(0), '$0.00');
});
test('money0 rounds to whole dollars', () => {
  assert.equal(money0(1234.5), '$1,235');
  assert.equal(money0(321.78), '$322');
});
test('money shows a dash for a missing amount', () => {
  assert.equal(money(null), '–');
  assert.equal(money0(undefined), '–');
});
test('shortDate reads an ISO date without shifting the day', () => {
  assert.equal(shortDate('2026-11-24'), '24 Nov 2026');
  assert.equal(shortDate('2027-01-01'), '1 Jan 2027');
});
test('pct rounds a share to a whole per cent', () => {
  assert.equal(pct(0.1234), '12%');
  assert.equal(pct(1), '100%');
});
test('isoToday gives the local calendar date', () => {
  assert.equal(isoToday(new Date(2026, 10, 24, 23, 30)), '2026-11-24');
});
