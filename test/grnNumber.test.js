import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import WarehouseReceiving from '../Model/wareHouse.js';
import { Sequence } from '../Model/workflow.js';
import { nextGrnNumber } from '../Service/grnNumberService.js';

afterEach(() => mock.restoreAll());

test('GRN counter starts at 001, continues existing numbers and grows past 999', async () => {
  for (const maximum of [0, 42, 999]) {
    mock.restoreAll();
    let value = 0;
    mock.method(WarehouseReceiving, 'aggregate', async () => maximum ? [{ maximum }] : []);
    mock.method(Sequence, 'updateOne', async (query, update) => { value = Math.max(value, update.$max.value); });
    mock.method(Sequence, 'findOneAndUpdate', async (query, update, options) => {
      assert.equal(query._id, 'GRN-');
      assert.equal(update.$inc.value, 1);
      assert.equal(options.new, true);
      return { value: ++value };
    });
    assert.equal(await nextGrnNumber(), 'GRN-' + String(maximum + 1).padStart(3, '0'));
    assert.equal(await nextGrnNumber(), 'GRN-' + String(maximum + 2).padStart(3, '0'));
  }
});

test('concurrent first counter initialization retries duplicate key safely', async () => {
  mock.method(WarehouseReceiving, 'aggregate', async () => []);
  let attempts = 0;
  mock.method(Sequence, 'updateOne', async () => {
    if (++attempts === 1) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
  });
  mock.method(Sequence, 'findOneAndUpdate', async () => ({ value: 2 }));
  assert.equal(await nextGrnNumber(), 'GRN-002');
  assert.equal(attempts, 2);
});
