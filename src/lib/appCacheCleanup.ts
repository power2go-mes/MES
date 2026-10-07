export const DASHBOARD_STATS_CACHE_KEY = 'p2g_dashboard_stats_cache';
export const APP_CACHE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function cleanupDashboardStatsCache(storage: StorageLike, now = Date.now()): boolean {
  const raw = storage.getItem(DASHBOARD_STATS_CACHE_KEY);
  if (!raw) return false;

  try {
    const cached = JSON.parse(raw);
    const savedAt = Number(cached?.savedAt);
    if (!Number.isFinite(savedAt) || savedAt > now || now - savedAt >= APP_CACHE_RETENTION_MS || !('value' in cached)) {
      storage.removeItem(DASHBOARD_STATS_CACHE_KEY);
      return true;
    }
    return false;
  } catch {
    storage.removeItem(DASHBOARD_STATS_CACHE_KEY);
    return true;
  }
}

export function readDashboardStatsCache(storage: StorageLike, now = Date.now()): any | null {
  cleanupDashboardStatsCache(storage, now);
  const raw = storage.getItem(DASHBOARD_STATS_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw).value ?? null;
  } catch {
    storage.removeItem(DASHBOARD_STATS_CACHE_KEY);
    return null;
  }
}

export function writeDashboardStatsCache(storage: StorageLike, value: any, now = Date.now()): void {
  storage.setItem(DASHBOARD_STATS_CACHE_KEY, JSON.stringify({ savedAt: now, value }));
}