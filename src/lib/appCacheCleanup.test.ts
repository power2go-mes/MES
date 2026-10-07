import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_CACHE_RETENTION_MS,
  cleanupDashboardStatsCache,
  readDashboardStatsCache,
  writeDashboardStatsCache,
} from './appCacheCleanup';

class TestStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('dashboard cache is returned while younger than three days', () => {
  const storage = new TestStorage();
  const now = 10_000_000;
  writeDashboardStatsCache(storage, { totalCells: 12 }, now - APP_CACHE_RETENTION_MS + 1);

  assert.deepEqual(readDashboardStatsCache(storage, now), { totalCells: 12 });
  assert.equal(cleanupDashboardStatsCache(storage, now), false);
});

test('dashboard cache expires after three days and legacy entries are removed', () => {
  const storage = new TestStorage();
  const now = 10_000_000;
  writeDashboardStatsCache(storage, { totalCells: 12 }, now - APP_CACHE_RETENTION_MS);
  assert.equal(cleanupDashboardStatsCache(storage, now), true);
  assert.equal(readDashboardStatsCache(storage, now), null);

  storage.setItem('p2g_dashboard_stats_cache', JSON.stringify({ oldUnversionedValue: true }));
  assert.equal(cleanupDashboardStatsCache(storage, now), true);
  assert.equal(storage.getItem('p2g_dashboard_stats_cache'), null);
});