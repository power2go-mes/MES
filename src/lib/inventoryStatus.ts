export type ControllerInventoryBucket = 'AVAILABLE' | 'USED' | 'DAMAGE' | 'REUSABLE';

export function getControllerInventoryBucket(status: unknown): ControllerInventoryBucket | string {
  const normalized = String(status || '').toUpperCase();
  if (['AVAILABLE', 'IN_STOCK', 'FLOOR_STOCK'].includes(normalized)) return 'AVAILABLE';
  if (['ASSIGNED', 'IN_PROCESS', 'IN_MODULE', 'IN_PACK', 'IN_RACK'].includes(normalized)) return 'USED';
  if (['FAILED', 'DAMAGED', 'SCRAP', 'REJECTED', 'QUARANTINED'].includes(normalized)) return 'DAMAGE';
  if (['PASSED', 'REUSABLE', 'RELEASE_APPROVED'].includes(normalized)) return 'REUSABLE';
  return normalized || 'UNKNOWN';
}

export function getInventoryStatusPageIds(ids: readonly string[], page: number, pageSize = 25): string[] {
  if (!Number.isInteger(page) || page < 0 || pageSize < 1) return [];
  const start = page * pageSize;
  return ids.slice(start, start + pageSize);
}