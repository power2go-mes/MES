import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModuleTraceNodes, getCellTraceStatus } from '../components/traceability/TraceabilityView';

test('module trace should keep only that module’s cells and avoid a nested battery module tree', () => {
  const battery = {
    id: 'battery-1',
    serialNumber: 'BAT-001',
    status: 'IN_STOCK',
    finalQcResult: { status: 'PASSED' },
  };

  const module = {
    id: 'mod-1',
    serialNumber: 'P2G-MOD-01',
    status: 'READY',
    batteryId: 'battery-1',
  };

  const cells = [
    { id: 'cell-1', supplierBarcode: 'CELL-001', moduleSlotIndex: 0 },
    { id: 'cell-2', supplierBarcode: 'CELL-002', moduleSlotIndex: 1 },
  ];

  const nodes = buildModuleTraceNodes({ module, cells, battery, bms: null, bmu: null });
  const moduleNode = nodes[0];

  assert.equal(moduleNode.type, 'MODULE');
  assert.equal(moduleNode.title, 'P2G-MOD-01');
  assert.equal(moduleNode.children?.filter(node => node.type === 'CELL').length, 2);

  const batterySummary = moduleNode.children?.find(node => node.type === 'BATTERY');
  assert.ok(batterySummary);
  assert.equal(batterySummary?.children?.some(child => child.type === 'MODULE'), false);
});

test('cell trace keeps the prior lifecycle status while handover is pending', () => {
  const cell = {
    lifecycle_status: 'IN_STOCK',
    issued_to_person: 'Baqir',
    issued_to_department: 'R&D',
    handoverStatus: 'PENDING_SIGNATURE',
  };

  assert.equal(getCellTraceStatus(cell), 'IN_STOCK');
  assert.equal(getCellTraceStatus({ ...cell, handoverStatus: 'COMPLETED' }), 'ISSUED (R&D)');
  assert.equal(getCellTraceStatus({ ...cell, issued_to_person: null, handoverStatus: null }), 'IN_STOCK');
});
