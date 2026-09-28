import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStockTotals } from '../Service/stockTotals.js';
import { statusTotals } from '../../frontend/src/pages/shared/workflow/stockSummary.js';

test('Approved Kg and kg totals merge into one card and add batches', () => {
  const totals = mergeStockTotals([
    { _id: { status: 'Approved', unit: 'Kg' }, quantity: 500, count: 1 },
    { _id: { status: 'Approved', unit: ' kg ' }, quantity: 70, count: 1 },
    { _id: { status: 'Available', unit: 'Kg' }, quantity: 80, count: 3 },
  ]);
  assert.equal(totals.length, 2);
  assert.equal(totals[0].quantity, 570);
  assert.equal(totals[0].count, 2);
  assert.equal(statusTotals(totals).length, 2);
});

test('available totals accumulate without an extra zero kg group', () => {
  assert.deepEqual(mergeStockTotals([{ _id: 'Kg', available: 80, batches: 3 }, { _id: 'kg', available: 0, batches: 1 }]), [{ _id: 'Kg', available: 80, batches: 4 }]);
});

test('one status card preserves unlike units and statuses separately', () => {
  const totals = mergeStockTotals([{ _id: { status: 'Available', unit: 'Kg' }, quantity: 80, count: 3 }, { _id: { status: 'Available', unit: 'Nos' }, quantity: 10, count: 1 }]);
  const cards = statusTotals(totals);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].count, 4);
  assert.deepEqual(cards[0].quantities, ['80 Kg', '10 Nos']);
});
