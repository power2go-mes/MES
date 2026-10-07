import test from 'node:test';
import assert from 'node:assert/strict';

import { getControllerInventoryBucket, getInventoryStatusPageIds } from './inventoryStatus';

test('controller status normalization matches the four inventory KPI buckets', () => {
  assert.equal(getControllerInventoryBucket('AVAILABLE'), 'AVAILABLE');
  assert.equal(getControllerInventoryBucket('IN_STOCK'), 'AVAILABLE');
  assert.equal(getControllerInventoryBucket('ASSIGNED'), 'USED');
  assert.equal(getControllerInventoryBucket('IN_MODULE'), 'USED');
  assert.equal(getControllerInventoryBucket('QUARANTINED'), 'DAMAGE');
  assert.equal(getControllerInventoryBucket('RELEASE_APPROVED'), 'REUSABLE');
  assert.equal(getControllerInventoryBucket(''), 'UNKNOWN');
});

test('status results are fetched in exact 25-item pages', () => {
  const ids = Array.from({ length: 61 }, (_, index) => `id-${index + 1}`);

  assert.equal(getInventoryStatusPageIds(ids, 0).length, 25);
  assert.equal(getInventoryStatusPageIds(ids, 1)[0], 'id-26');
  assert.equal(getInventoryStatusPageIds(ids, 2).length, 11);
  assert.deepEqual(getInventoryStatusPageIds(ids, -1), []);
});