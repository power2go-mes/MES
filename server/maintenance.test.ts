import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_LOG_RETENTION_MS, retainRecentOtpLogLines } from './maintenance';

test('OTP log retention drops entries older than three days and malformed lines', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const fresh = new Date(now - APP_LOG_RETENTION_MS + 1).toISOString();
  const expired = new Date(now - APP_LOG_RETENTION_MS).toISOString();
  const future = new Date(now + 1000).toISOString();
  const retained = retainRecentOtpLogLines([
    `${fresh} OTP 123456 for user <user@example.com>`,
    `${expired} OTP 654321 for user <user@example.com>`,
    `${future} OTP 111111 for user <user@example.com>`,
    'not a timestamp',
  ].join('\n'), now);

  assert.deepEqual(retained, [`${fresh} OTP 123456 for user <user@example.com>`]);
});