import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDashboardDistribution } from './dashboardCharts';
import { normalizeBatteryRecord } from '../services/api';

const labels = [
  { label: 'In Stock', color: '#16a34a' },
  { label: 'Floor Stock', color: '#2563eb' },
  { label: 'Scrap', color: '#ef4444' },
];

test('dashboard distributions normalize missing categories and percentages to 100%', () => {
  const distribution = buildDashboardDistribution([
    { label: 'In Stock', value: 1 },
    { label: 'In Stock', value: 2 },
    { label: 'Scrap', value: null },
  ], labels, 3);

  assert.equal(distribution.total, 3);
  assert.equal(distribution.percentageTotal, 100);
  assert.equal(distribution.reconciles, true);
  assert.deepEqual(distribution.rows.map(row => row.value), [3, 0, 0]);
});

test('dashboard distributions flag a mismatch with the authoritative total', () => {
  const distribution = buildDashboardDistribution([{ label: 'In Stock', value: 2 }], labels, 3);
  assert.equal(distribution.reconciles, false);
});

test('dashboard distributions preserve three populated battery models', () => {
  const distribution = buildDashboardDistribution([
    { label: 'WallMount 5kWh', value: 100 },
    { label: '5 kWh Battery Pack', value: 75 },
    { label: '7.5 kWh Battery Pack', value: 51 },
  ], [
    { label: 'WallMount 5kWh', color: '#2563eb' },
    { label: '5 kWh Battery Pack', color: '#f59e0b' },
    { label: '7.5 kWh Battery Pack', color: '#16a34a' },
  ], 226);

  assert.equal(distribution.rows.filter(row => row.value > 0).length, 3);
  assert.equal(distribution.percentageTotal, 100);
  assert.equal(distribution.reconciles, true);
});

test('battery normalization prevents blank-screen crashes on incomplete records', () => {
  const normalized = normalizeBatteryRecord({
    id: 'b-1',
    serial_number: 'B-1001',
    status: 'RELEASED',
  });

  assert.equal(normalized.serialNumber, 'B-1001');
  assert.equal(normalized.productName, 'Unknown Pack');
  assert.equal(normalized.currentStep, 'UNKNOWN');
});
