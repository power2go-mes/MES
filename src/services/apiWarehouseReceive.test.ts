import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWarehouseLocationBuckets, buildWarehouseReceiveResult, preferredLifecycleStatus } from './api';
import { normalizeBatteryName, normalizeBatterySerial } from '../lib/batteryNaming';

test('battery names and serials use the 7.5KWH label', () => {
  assert.equal(normalizeBatterySerial('P2G-BP-8KWH-0001'), 'P2G-BP-7.5KWH-0001');
  assert.equal(normalizeBatteryName('8 kWh Battery Pack'), '7.5 kWh Battery Pack');
});

test('sold lifecycle status remains authoritative over a warehouse location', () => {
  assert.equal(preferredLifecycleStatus('SOLD', 'KARACHI_WAREHOUSE'), 'SOLD');
  assert.equal(preferredLifecycleStatus('IN_RACK', 'KARACHI_WAREHOUSE'), 'KARACHI_WAREHOUSE');
});

test('buildWarehouseReceiveResult preserves the warehouse state for each entity type', () => {
  assert.deepEqual(buildWarehouseReceiveResult('BATTERY', 'bat-123', 'LAHORE'), {
    success: true,
    entityType: 'BATTERY',
    entityId: 'bat-123',
    location: 'LAHORE',
    status: 'WAREHOUSE',
  });

  assert.deepEqual(buildWarehouseReceiveResult('MODULE', 'mod-456', 'KARACHI'), {
    success: true,
    entityType: 'MODULE',
    entityId: 'mod-456',
    location: 'KARACHI',
    status: 'IN_STOCK',
  });

  assert.deepEqual(buildWarehouseReceiveResult('RACK', 'rack-789', 'KARACHI'), {
    success: true,
    entityType: 'RACK',
    entityId: 'rack-789',
    location: 'KARACHI',
    status: 'IN_STOCK',
  });
});

test('warehouse cell buckets do not double-count cells already in lifecycle buckets', () => {
  const buckets = buildWarehouseLocationBuckets([
    { label: 'In Stock', value: 4255 },
    { label: 'Floor Stock', value: 541 },
    { label: 'In Module', value: 456 },
    { label: 'In Pack', value: 1928 },
    { label: 'In Rack', value: 2760 },
    { label: 'Sold', value: 0 },
    { label: 'Scrap', value: 60 },
  ], new Map(Array.from({ length: 2912 }, (_, index) => [
    `cell-${index}`,
    index < 2080 ? 'KARACHI' : 'LAHORE',
  ])));

  assert.equal(buckets.reduce((sum, row) => sum + row.value, 0), 10000);
});

test('warehouse cells move out of their exact lifecycle buckets', () => {
  const lifecycleByCell = new Map<string, string>();
  for (let index = 0; index < 2080; index += 1) lifecycleByCell.set(`rack-${index}`, 'IN_RACK');
  for (let index = 0; index < 832; index += 1) lifecycleByCell.set(`pack-${index}`, 'IN_PACK');
  const buckets = buildWarehouseLocationBuckets([
    { label: 'In Stock', value: 4255 },
    { label: 'Floor Stock', value: 541 },
    { label: 'In Module', value: 456 },
    { label: 'In Pack', value: 1928 },
    { label: 'In Rack', value: 2760 },
    { label: 'Sold', value: 0 },
    { label: 'Scrap', value: 60 },
  ], new Map([
    ...Array.from({ length: 2080 }, (_, index) => [`rack-${index}`, 'KARACHI'] as [string, string]),
    ...Array.from({ length: 832 }, (_, index) => [`pack-${index}`, 'LAHORE'] as [string, string]),
  ]), lifecycleByCell);

  assert.deepEqual(Object.fromEntries(buckets.map(row => [row.label, row.value])), {
    'In Stock': 4255,
    'Floor Stock': 541,
    'In Module': 456,
    'In Pack': 1096,
    'In Rack': 680,
    Sold: 0,
    Scrap: 60,
    'Karachi Warehouse': 2080,
    'Lahore Warehouse': 832,
  });
  assert.equal(buckets.reduce((sum, row) => sum + row.value, 0), 10000);
});
