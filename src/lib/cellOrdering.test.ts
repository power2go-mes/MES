import test from 'node:test';
import assert from 'node:assert/strict';

import { sortCellsForWorkflow } from './cellOrdering';

test('sortCellsForWorkflow keeps builder slot order across modules', () => {
  const modules = [
    { id: 'mod-1', moduleIndex: 0 },
    { id: 'mod-2', moduleIndex: 1 },
  ];

  const cells = [
    { id: 'cell-2', assignedToModuleId: 'mod-2', moduleSlotIndex: 0 },
    { id: 'cell-1', assignedToModuleId: 'mod-1', moduleSlotIndex: 1 },
    { id: 'cell-3', assignedToModuleId: 'mod-1', moduleSlotIndex: 0 },
    { id: 'cell-4', assignedToModuleId: 'mod-2', moduleSlotIndex: 1 },
  ];

  const ordered = sortCellsForWorkflow(cells, modules);
  assert.deepEqual(ordered.map(cell => cell.id), ['cell-3', 'cell-1', 'cell-2', 'cell-4']);
});
