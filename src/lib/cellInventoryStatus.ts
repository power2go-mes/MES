export type CellInventoryStatus =
  | 'IN_STOCK'
  | 'FLOOR_STOCK'
  | 'IN_MODULE'
  | 'IN_PACK'
  | 'IN_RACK'
  | 'KARACHI_WAREHOUSE'
  | 'LAHORE_WAREHOUSE'
  | 'SOLD'
  | 'DAMAGE'
  | 'REUSABLE';

type CellStatusContext = {
  warehouseLocation?: string;
  isReusable?: boolean;
  hasModuleAssignment?: boolean;
  moduleBatteryId?: string;
  batteryStatus?: string;
  isInRack?: boolean;
};

const statusLabels: Record<CellInventoryStatus, string> = {
  IN_STOCK: 'In Stock',
  FLOOR_STOCK: 'Floor Stock',
  IN_MODULE: 'In Module',
  IN_PACK: 'In Pack',
  IN_RACK: 'In Rack',
  KARACHI_WAREHOUSE: 'Karachi Warehouse',
  LAHORE_WAREHOUSE: 'Lahore Warehouse',
  SOLD: 'Sold',
  DAMAGE: 'Damage',
  REUSABLE: 'Reusable',
};

export const cellInventoryStatuses = Object.keys(statusLabels) as CellInventoryStatus[];

export function cellInventoryStatusLabel(status: CellInventoryStatus): string {
  return statusLabels[status];
}

export function getCellInventoryStatus(cell: any, context: CellStatusContext = {}): CellInventoryStatus {
  const lifecycleStatus = String(cell?.lifecycleStatus ?? cell?.lifecycle_status ?? '').toUpperCase();
  const recordStatus = String(cell?.status || '').toUpperCase();
  const grade = String(cell?.grade ?? cell?.productionGrade ?? cell?.production_grade ?? '').toUpperCase();
  const warehouseLocation = String(context.warehouseLocation || '').toUpperCase();
  const batteryStatus = String(context.batteryStatus || '').toUpperCase();
  const disposedOfAs = String(cell?.disposedOfAs ?? cell?.disposed_of_as ?? '').toUpperCase();

  if (warehouseLocation === 'KARACHI' || warehouseLocation === 'KARACHI_WAREHOUSE') return 'KARACHI_WAREHOUSE';
  if (warehouseLocation === 'LAHORE' || warehouseLocation === 'LAHORE_WAREHOUSE') return 'LAHORE_WAREHOUSE';
  if (context.isReusable || ['REUSABLE', 'REWORK', 'RELEASE_APPROVED', 'RECYCLE'].includes(lifecycleStatus)
    || ['REUSABLE', 'REWORK', 'RELEASE_APPROVED', 'RECYCLE'].includes(disposedOfAs)) return 'REUSABLE';
  if (['DAMAGE', 'DAMAGED', 'SCRAP', 'QUARANTINED', 'REJECTED', 'FAILED'].includes(lifecycleStatus)
    || ['DAMAGE', 'DAMAGED', 'SCRAP', 'QUARANTINED', 'REJECTED', 'FAILED'].includes(recordStatus)
    || ['DAMAGE', 'DAMAGED', 'SCRAP', 'QUARANTINED', 'REJECTED', 'FAILED'].includes(grade)) return 'DAMAGE';
  if (['SOLD', 'DISPATCHED'].includes(lifecycleStatus)) return 'SOLD';
  if (context.isInRack || lifecycleStatus === 'IN_RACK') return 'IN_RACK';
  if (lifecycleStatus === 'IN_PACK'
    || Boolean(context.moduleBatteryId)
    || ['RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED'].includes(batteryStatus)) return 'IN_PACK';
  if (lifecycleStatus === 'IN_MODULE' || context.hasModuleAssignment || cell?.reservedForBatteryId || cell?.reserved_for_battery_id) return 'IN_MODULE';
  if (lifecycleStatus === 'FLOOR_STOCK') return 'FLOOR_STOCK';
  return 'IN_STOCK';
}

export function buildCellInventoryBuckets(
  cells: any[],
  getContext: (cell: any) => CellStatusContext = () => ({}),
): Array<{ label: string; value: number }> {
  const counts = new Map<CellInventoryStatus, number>(cellInventoryStatuses.map(status => [status, 0]));
  for (const cell of cells) {
    const status = getCellInventoryStatus(cell, getContext(cell));
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return cellInventoryStatuses.map(status => ({ label: cellInventoryStatusLabel(status), value: counts.get(status) || 0 }));
}