import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCellInventoryBuckets, getCellInventoryStatus } from './cellInventoryStatus';

test('cell inventory classification gives each cell one authoritative status', () => {
  const cells = [
    { id: 'stock', status: 'AVAILABLE' },
    { id: 'floor', lifecycle_status: 'FLOOR_STOCK' },
    { id: 'module', lifecycle_status: 'IN_MODULE' },
    { id: 'pack', lifecycle_status: 'IN_PACK' },
    { id: 'rack', lifecycle_status: 'IN_RACK' },
    { id: 'karachi', lifecycle_status: 'IN_PACK' },
    { id: 'lahore', lifecycle_status: 'IN_STOCK' },
    { id: 'sold', lifecycle_status: 'SOLD' },
    { id: 'damage', status: 'QUARANTINED' },
    { id: 'reusable', status: 'QUARANTINED' },
  ];

  const buckets = buildCellInventoryBuckets(cells, cell => ({
    warehouseLocation: cell.id === 'karachi' ? 'KARACHI' : cell.id === 'lahore' ? 'LAHORE' : undefined,
    isReusable: cell.id === 'reusable',
  }));

  assert.deepEqual(Object.fromEntries(buckets.map(bucket => [bucket.label, bucket.value])), {
    'In Stock': 1,
    'Floor Stock': 1,
    'In Module': 1,
    'In Pack': 1,
    'In Rack': 1,
    'Karachi Warehouse': 1,
    'Lahore Warehouse': 1,
    Sold: 1,
    Damage: 1,
    Reusable: 1,
  });
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.value, 0), cells.length);
});

test('cell inventory classification prefers damage and assignment relationships consistently', () => {
  assert.equal(getCellInventoryStatus({ lifecycle_status: 'SCRAP' }), 'DAMAGE');
  assert.equal(getCellInventoryStatus({ lifecycle_status: 'IN_MODULE' }, { moduleBatteryId: 'battery-1' }), 'IN_PACK');
  assert.equal(getCellInventoryStatus({ lifecycle_status: 'AVAILABLE' }, { hasModuleAssignment: true }), 'IN_MODULE');
  assert.equal(getCellInventoryStatus({ lifecycle_status: 'IN_RACK' }, { isReusable: true }), 'REUSABLE');
});