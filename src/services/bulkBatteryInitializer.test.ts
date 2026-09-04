import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletedBatteryReleasePlan, buildModulePlan, createBulkBatteryInitialization, dedupeModuleCellAssignments, normalizeBatteryProductTemplate, validateBulkBatteryRows } from './bulkBatteryInitializer';

test('bulk battery rows validate unique serial numbers and required field mapping', () => {
  const rows = [
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-001' },
    { batterySerialNumber: 'P2G-7K5-2409-000002', bmuSerialNumber: 'P2G-BMU-002' },
    { batterySerialNumber: 'P2G-7K5-2409-000003', bmuSerialNumber: 'P2G-BMU-003' },
  ];

  const result = validateBulkBatteryRows(rows);

  assert.equal(result.valid, true);
  assert.equal(result.serials.length, 3);
  assert.deepEqual(result.serials, [
    'P2G-7K5-2409-000001',
    'P2G-7K5-2409-000002',
    'P2G-7K5-2409-000003',
  ]);
});

test('bulk battery rows reject duplicate battery serials', () => {
  const rows = [
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-001' },
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-002' },
  ];

  const result = validateBulkBatteryRows(rows);

  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicates, ['P2G-7K5-2409-000001']);
  assert.match(result.errors.join(' '), /Duplicate battery serial/i);
});

test('bulk module plan creates 2 modules with 12 cells each for a 7.5 kWh battery', () => {
  const originalProduct = {
    id: 'prod-1',
    name: 'P2G-HV7.5KWH',
    sku: 'P2G-HV7.5KWH',
    totalCells: 24,
    numModules: 2,
    cellsPerModule: 12,
  };

  const normalizedProduct = normalizeBatteryProductTemplate({ ...originalProduct, numModules: 3, cellsPerModule: 20, totalCells: 60 });
  assert.equal(normalizedProduct.numModules, 2);
  assert.equal(normalizedProduct.cellsPerModule, 12);
  assert.equal(normalizedProduct.totalCells, 24);

  const cells = Array.from({ length: 24 }, (_, index) => ({ id: `cell-${index + 1}`, internalSerial: `CELL-${index + 1}` }));

  const modules = buildModulePlan({
    batterySerial: 'P2G-7K5-2409-000001',
    cells,
    bmu: { id: 'bmu-1', serialNumber: 'P2G-BMU-001' },
  }, normalizedProduct, 'PO-1', 'BAT-1');

  assert.equal(modules.length, 2);
  assert.deepEqual(modules.map(module => module.moduleIndex), [0, 1]);
  assert.deepEqual(modules.map(module => module.cellIds.length), [12, 12]);
  assert.deepEqual(modules[0].cellIds.slice(0, 3), ['cell-1', 'cell-2', 'cell-3']);
  assert.equal(modules[1].cellIds.at(-1), 'cell-24');
});

test('completed battery release plan assigns passing welding and qc status and marks battery released', () => {
  const plan = buildCompletedBatteryReleasePlan({
    batteryId: 'bat-1',
    batterySerial: 'P2G-7K5-2409-000001',
    moduleCount: 2,
    bmuId: 'bmu-1',
    userId: 'user-1',
    createdAt: new Date('2026-08-31T00:00:00Z'),
  });

  assert.equal(plan.moduleTests.length, 4);
  assert.ok(plan.moduleTests.every(test => test.passed === true));
  assert.equal(plan.batteryTest.passed, true);
  assert.equal(plan.release.status, 'RELEASED');
  assert.equal(plan.release.progressPercent, 100);
});

test('exact battery row mapping keeps the uploaded BMU and cell group together', async () => {
  const rows = [
    {
      batterySerialNumber: 'P2G-7K5-2409-000001',
      bmuSerialNumber: 'P2G-BMU-010',
      cellQrCodes: Array.from({ length: 24 }, (_, index) => `QR-${index + 1}`),
    },
  ];
  const availableBmUs = [
    { id: 'bmu-1', serialNumber: 'P2G-BMU-001', status: 'AVAILABLE' },
    { id: 'bmu-2', serialNumber: 'P2G-BMU-002', status: 'AVAILABLE' },
    { id: 'bmu-3', serialNumber: 'P2G-BMU-003', status: 'AVAILABLE' },
    { id: 'bmu-10', serialNumber: 'P2G-BMU-010', status: 'AVAILABLE' },
  ];
  const availableCells = Array.from({ length: 24 }, (_, index) => ({
    id: `cell-${index + 1}`,
    internalSerial: `CELL-${index + 1}`,
    supplierBarcode: `QR-${index + 1}`,
    status: 'AVAILABLE',
    reservedForBatteryId: null,
    reservedForOrderId: null,
    assignedToModuleId: null,
  }));
  const product = {
    id: 'prod-1',
    name: 'P2G-HV7.5KWH',
    sku: 'P2G-HV7.5KWH',
    totalCells: 24,
    numModules: 2,
    cellsPerModule: 12,
  };

  const plan = await createBulkBatteryInitialization({
    rows,
    products: [product],
    availableBmUs,
    availableCells,
    userId: 'user-1',
  });

  assert.equal(plan.batteries[0].bmu.serialNumber, 'P2G-BMU-010');
  assert.deepEqual(
    plan.batteries[0].cells.map(cell => cell.supplierBarcode),
    Array.from({ length: 24 }, (_, index) => `QR-${index + 1}`)
  );
  assert.deepEqual(plan.batteries[0].modules.map(module => module.cells.length), [12, 12]);
});

test('module cell assignment deduplicates reused cell ids before insert', () => {
  const cellIds = ['cell-1', 'cell-2', 'cell-2', 'cell-3', '', 'cell-3'];
  const unique = dedupeModuleCellAssignments(cellIds);

  assert.deepEqual(unique, ['cell-1', 'cell-2', 'cell-3']);
});

test('module cell hydration deduplicates repeated assignment rows while preserving slot order', () => {
  const duplicateAssignments = [
    { cell_id: 'cell-1', cell_slot_index: 0 },
    { cell_id: 'cell-2', cell_slot_index: 1 },
    { cell_id: 'cell-2', cell_slot_index: 1 },
    { cell_id: 'cell-3', cell_slot_index: 2 },
    { id: 'cell-3', cell_slot_index: 2 },
  ];

  const unique = dedupeModuleCellAssignments(duplicateAssignments);

  assert.equal(unique.length, 3);
  assert.deepEqual(
    unique.map((cell: any) => cell.id ?? cell.cell_id),
    ['cell-1', 'cell-2', 'cell-3']
  );
});
