import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeLocalHandoverMetadata } from './issuance';

test('issued items retain pending signature status when the server omits handover metadata', () => {
  const items = [{
    id: 'cell-123',
    entityType: 'CELL',
    issuedToPerson: 'Baqir',
    handoverStatus: null,
  }];
  const storage = {
    getItem: (key: string) => key === 'p2g_handover_CELL_cell-123'
      ? JSON.stringify({ handoverStatus: 'PENDING_SIGNATURE' })
      : null,
  };

  const result = mergeLocalHandoverMetadata(items, storage);

  assert.equal(result[0].handoverStatus, 'PENDING_SIGNATURE');
  assert.equal(items[0].handoverStatus, null);
});

test('completed handover metadata is merged after a signed slip is uploaded', () => {
  const items = [{ id: 'cell-123', entityType: 'CELL', handoverStatus: 'PENDING_SIGNATURE' as const }];
  const storage = {
    getItem: () => JSON.stringify({
      handoverStatus: 'COMPLETED',
      signedSlipUrl: 'data:application/pdf;base64,abc',
      signedSlipFileName: 'signed-slip.pdf',
      signedSlipUploadedAt: '2026-11-26T05:00:00.000Z',
    }),
  };

  const result = mergeLocalHandoverMetadata(items, storage);

  assert.equal(result[0].handoverStatus, 'COMPLETED');
  assert.equal(result[0].signedSlipFileName, 'signed-slip.pdf');
});
