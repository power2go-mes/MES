import test from 'node:test';
import assert from 'node:assert/strict';

import { parseModuleImportGroups } from './moduleImportParser';

test('parseModuleImportGroups accepts a title row before the module headers', () => {
  const rows = [
    ['WallMount 5kWh - 5kWh x 2 modules x 8 cells'],
    ['Module No', 'QR Code'],
    ['M-01', 'QR-001'],
    ['M-01', 'QR-002'],
    ['M-01', 'QR-003'],
    ['M-01', 'QR-004'],
    ['M-01', 'QR-005'],
    ['M-01', 'QR-006'],
    ['M-01', 'QR-007'],
    ['M-01', 'QR-008'],
    ['M-02', 'QR-011'],
    ['M-02', 'QR-012'],
    ['M-02', 'QR-013'],
    ['M-02', 'QR-014'],
    ['M-02', 'QR-015'],
    ['M-02', 'QR-016'],
    ['M-02', 'QR-017'],
    ['M-02', 'QR-018'],
  ];

  const groups = parseModuleImportGroups(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].qrCodes, ['QR-001', 'QR-002', 'QR-003', 'QR-004', 'QR-005', 'QR-006', 'QR-007', 'QR-008']);
  assert.equal(groups[0].isValid, true);
  assert.equal(groups[1].moduleNumber, 'M-02');
  assert.equal(groups[1].isValid, true);
});

test('parseModuleImportGroups accepts different module and qr header names', () => {
  const rows = [
    ['Description'],
    ['Module ID', 'Cell QR Barcode'],
    ['A1', 'AA-01'],
    ['A1', 'AA-02'],
    ['A1', 'AA-03'],
    ['A1', 'AA-04'],
    ['A1', 'AA-05'],
    ['A1', 'AA-06'],
    ['A1', 'AA-07'],
    ['A1', 'AA-08'],
  ];

  const groups = parseModuleImportGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].moduleNumber, 'A1');
  assert.equal(groups[0].qrCodes.length, 8);
  assert.equal(groups[0].isValid, true);
});

test('parseModuleImportGroups validates 12S groups when configured for 12 cells', () => {
  const rows = [
    ['Module', 'QR Code'],
    ...Array.from({ length: 12 }, (_, index) => ['M-12', `QR-${String(index + 1).padStart(3, '0')}`]),
  ];

  const groups = parseModuleImportGroups(rows, 12);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].qrCodes.length, 12);
  assert.equal(groups[0].isValid, true);
});
