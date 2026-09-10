import {
  ProductTemplate,
  Supplier,
  CellItem,
  BMSItem,
  BMUItem,
  ModuleItem,
  BatteryUnit,
  ProductionOrder,
  MachineStation,
  AuditLog,
  QuarantineRecord,
  SupplierImportSummary,
  User,
  Role,
  RackUnit,
  AuditLog as AuditLogType,
} from '../types';

import { buildCompletedBatteryReleasePlan, createBulkBatteryInitialization, dedupeModuleCellAssignments, type BulkBatteryRow } from './bulkBatteryInitializer';
import { supabase as rawSupabase } from '../lib/supabaseBrowser';

const columnAliases: Record<string, string> = {
  bmsConfig: 'bms_config_json',
  bmuConfig: 'bmu_config_json',
  gradingRules: 'grading_rules_json',
  qcStages: 'qc_stages',
  supplierIrMilliOhm: 'supplier_ir_mohm',
  productionIrMilliOhm: 'production_ir_mohm',
  testResult: 'test_result_json',
  stepResults: 'step_results_json',
  finalQcResult: 'final_qc_result_json',
  weldingResult: 'welding_result_json',
  qcResult: 'qc_result_json',
  assignedToBatteryId: 'reserved_for_battery_id',
  disposition: 'disposed_of_as',
  dispositionNotes: 'disposition_notes',
};

const reverseColumnAliases = Object.fromEntries(
  Object.entries(columnAliases).map(([appName, dbName]) => [dbName, appName]),
);

let dashboardStatsCache: { key: string; value: any; expiresAt: number } | null = null;
let dashboardStatsRequest: { key: string; promise: Promise<any> } | null = null;

function toDbColumn(value: string) {
  return columnAliases[value] || value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toAppColumn(value: string) {
  if (reverseColumnAliases[value]) return reverseColumnAliases[value];
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function applyDashboardDateRange(query: any, startDate?: string, endDate?: string) {
  let scopedQuery = query;
  if (startDate) scopedQuery = scopedQuery.gte('created_at', `${startDate}T00:00:00.000Z`);
  if (endDate) {
    const exclusiveEnd = new Date(`${endDate}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    scopedQuery = scopedQuery.lt('created_at', exclusiveEnd.toISOString());
  }
  return scopedQuery;
}

function toDbRow(row: any, table?: string) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const mapped = Object.fromEntries(Object.entries(row).map(([key, value]) => [toDbColumn(key), value]));
  if (table === 'audit_logs' || table === 'quarantine_records') {
    delete mapped.id;
    delete mapped.user_id;
    delete mapped.quarantined_by;
    delete mapped.resolved_by;
  }
  return mapped;
}

function toAppValue(value: any): any {
  if (Array.isArray(value)) return value.map(toAppValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [toAppColumn(key), toAppValue(child)]));
}

export function buildWarehouseReceiveResult(entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string, location: 'KARACHI' | 'LAHORE') {
  const normalizedType = String(entityType).toUpperCase() as 'MODULE' | 'BATTERY' | 'RACK';
  const normalizedLocation = String(location).toUpperCase() as 'KARACHI' | 'LAHORE';
  return {
    success: true,
    entityType: normalizedType,
    entityId,
    location: normalizedLocation,
    status: normalizedType === 'BATTERY' ? 'WAREHOUSE' : 'IN_STOCK',
  };
}

export function buildWarehouseLocationBuckets(
  cellBuckets: any[] = [],
  warehouseLocationMap: Map<string, string> = new Map(),
  lifecycleByCellId: Map<string, string> = new Map(),
) {
  const counts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const lifecycleBucket = (value: string) => {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'SOLD') return 'Sold';
    if (normalized === 'SCRAP' || normalized === 'QUARANTINED' || normalized === 'REJECTED') return 'Scrap';
    if (normalized === 'IN_RACK') return 'In Rack';
    if (normalized === 'IN_PACK') return 'In Pack';
    if (normalized === 'IN_MODULE') return 'In Module';
    if (normalized === 'FLOOR_STOCK') return 'Floor Stock';
    return 'In Stock';
  };
  for (const [cellId, location] of warehouseLocationMap.entries()) {
    if (!['KARACHI', 'LAHORE'].includes(String(location).toUpperCase())) continue;
    const bucketName = String(location).toUpperCase() === 'KARACHI' ? 'Karachi Warehouse' : 'Lahore Warehouse';
    counts.set(bucketName, (counts.get(bucketName) || 0) + 1);
    if (lifecycleByCellId.has(cellId)) {
      const bucket = lifecycleBucket(lifecycleByCellId.get(cellId) || '');
      sourceCounts.set(bucket, (sourceCounts.get(bucket) || 0) + 1);
    }
  }

  const warehouseCellCount = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  const rows = Array.isArray(cellBuckets) ? cellBuckets.map(row => ({ ...row, label: String(row?.label || '') })) : [];
  const sourceLabels = ['In Rack', 'In Pack', 'In Module', 'Floor Stock', 'In Stock', 'Sold', 'Scrap'];
  const exactSourceCounts = sourceCounts.size > 0 ? sourceCounts : new Map<string, number>();
  if (exactSourceCounts.size === 0 && warehouseCellCount > 0) {
    let remainingWarehouseCells = warehouseCellCount;
    for (const label of sourceLabels) {
      if (remainingWarehouseCells <= 0) break;
      exactSourceCounts.set(label, Math.min(
        Math.max(0, Number(rows.find(row => row.label.toLowerCase() === label.toLowerCase())?.value || 0)),
        remainingWarehouseCells,
      ));
      remainingWarehouseCells -= exactSourceCounts.get(label) || 0;
    }
  }
  for (const [label, count] of exactSourceCounts.entries()) {
    const index = rows.findIndex(row => row.label.toLowerCase() === label.toLowerCase());
    if (index < 0) continue;
    const currentValue = Math.max(0, Number(rows[index].value || 0));
    const removed = Math.min(currentValue, count);
    rows[index] = { ...rows[index], value: currentValue - removed };
  }
  for (const [label, value] of counts.entries()) {
    const index = rows.findIndex((row: any) => String(row.label).toLowerCase() === label.toLowerCase());
    if (index >= 0) {
      rows[index] = { ...rows[index], value: Number(rows[index]?.value || 0) + value };
    } else {
      rows.push({ label, value });
    }
  }

  return rows;
}

export function warehouseLocationStatus(location: string | undefined): string | undefined {
  const normalized = String(location || '').toUpperCase();
  if (normalized === 'KARACHI') return 'KARACHI_WAREHOUSE';
  if (normalized === 'LAHORE') return 'LAHORE_WAREHOUSE';
  return undefined;
}

export function normalizeBatteryRecord(battery: any): any {
  const serialNumber = String(battery?.serial_number ?? battery?.serialNumber ?? battery?.id ?? '').trim();
  const productName = String(
    battery?.product_templates?.name
    ?? battery?.productName
    ?? battery?.product_name
    ?? 'Unknown Pack',
  ).trim() || 'Unknown Pack';
  const currentStep = String(battery?.current_step ?? battery?.currentStep ?? 'UNKNOWN').trim() || 'UNKNOWN';
  return {
    ...battery,
    serialNumber,
    productName,
    currentStep,
    status: battery?.status || 'UNKNOWN',
  };
}

function reconcileDashboardCellBuckets(buckets: any[], totalCells: any): any[] {
  if (!Array.isArray(buckets)) return [];
  const rows = buckets.map(row => ({ ...row, label: String(row.label), value: Math.max(0, Number(row.value) || 0) }));
  const total = Math.max(0, Number(totalCells) || 0);
  const stockRows = rows.filter(row => row.label === 'In Stock' || row.label === 'Floor Stock');
  const nonStockTotal = rows
    .filter(row => row.label !== 'In Stock' && row.label !== 'Floor Stock')
    .reduce((sum, row) => sum + row.value, 0);
  const remainingStock = Math.max(0, total - nonStockTotal);
  const currentStock = stockRows.reduce((sum, row) => sum + row.value, 0);

  if (currentStock <= 0 || total <= 0 || remainingStock >= currentStock) return rows;

  // Preserve the stock bucket values when the source summary overlaps lifecycle states.
  // The authoritative database classification is the final source of truth for the dashboard totals.
  return rows;
}

function mergeReservedBatteryCells(modules: any[], reservedCells: any[], batteryId: string): any[] {
  return Array.isArray(modules) ? modules : [];
}

function hydrateModuleCells(assignments: any[] = []): any[] {
  const uniqueByCellId = new Map<string, any>();

  (assignments || []).forEach((assignment: any) => {
    if (!assignment) return;
    const cell = assignment.cell || assignment;
    const cellId = cell?.id || assignment.cell_id || assignment.cellId;
    if (!cellId) return;

    const slotIndex = Number.isFinite(Number(assignment.cell_slot_index ?? assignment.cellSlotIndex))
      ? Number(assignment.cell_slot_index ?? assignment.cellSlotIndex)
      : Number.isFinite(Number(cell.moduleSlotIndex))
        ? Number(cell.moduleSlotIndex)
        : undefined;

    const normalizedCell = { ...cell, ...(slotIndex !== undefined ? { moduleSlotIndex: slotIndex } : {}) };
    const current = uniqueByCellId.get(cellId);
    if (!current || (slotIndex !== undefined && (current.moduleSlotIndex === undefined || slotIndex < current.moduleSlotIndex))) {
      uniqueByCellId.set(cellId, normalizedCell);
    }
  });

  return Array.from(uniqueByCellId.values()).sort((a, b) => {
    const aSlot = Number.isFinite(Number(a.moduleSlotIndex)) ? Number(a.moduleSlotIndex) : Number.MAX_SAFE_INTEGER;
    const bSlot = Number.isFinite(Number(b.moduleSlotIndex)) ? Number(b.moduleSlotIndex) : Number.MAX_SAFE_INTEGER;
    return aSlot - bSlot;
  });
}

async function loadModuleCellAssignments(moduleIds: string[]): Promise<any[]> {
  const batchSize = 10;
  const batches = Array.from({ length: Math.ceil(moduleIds.length / batchSize) }, (_, index) =>
    moduleIds.slice(index * batchSize, (index + 1) * batchSize),
  );
  const results = await Promise.all(batches.map(ids => supabase
    .from('module_cells')
    .select('module_id, cell_id, cell_slot_index, cell:cells(*)')
    .in('module_id', ids)
    .order('cell_slot_index', { ascending: true })));
  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;
  return results.flatMap(result => result.data || []);
}

async function resolveWarehouseCellLocations() {
  if (!rawSupabase) return { locationByCell: new Map<string, string>(), latestByEntity: new Map<string, string>(), warehouseRackCounts: { KARACHI: 0, LAHORE: 0 }, warehouseRackTypeCounts: [], warehouseBatteryCounts: { KARACHI: 0, LAHORE: 0 }, warehouseBatteryTypeCounts: [] };

  const normalizeWarehouseLocation = (value: unknown): 'KARACHI' | 'LAHORE' | '' => {
    const normalized = String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ');
    if (normalized === 'KARACHI' || normalized === 'KARACHI WAREHOUSE') return 'KARACHI';
    if (normalized === 'LAHORE' || normalized === 'LAHORE WAREHOUSE') return 'LAHORE';
    return '';
  };

  const fetchAllRows = async (table: string, columns: string) => {
    const rows: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await rawSupabase.from(table).select(columns).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
    }
  };

  const [warehouseResult, moduleCells, modulesResult, batteriesResult, rackPacksResult, racksResult, cellsResult] = await Promise.all([
    rawSupabase.from('warehouse_movements')
      .select('entity_type, entity_id, to_location, moved_at')
      .order('moved_at', { ascending: false }),
    fetchAllRows('module_cells', 'cell_id, module_id'),
    rawSupabase.from('modules').select('id, serial_number, battery_id'),
    rawSupabase.from('batteries').select('id, serial_number, product_templates(name, capacity_kwh)'),
    rawSupabase.from('rack_packs').select('battery_id, rack_id'),
    rawSupabase.from('racks').select('id, serial_number, qr_code, rack_template_code, location'),
    fetchAllRows('cells', 'id, lifecycle_status, status'),
  ]);
  const warehouseMoves = warehouseResult.data || [];
  const modules = modulesResult.data || [];
  const batteries = batteriesResult.data || [];
  const rackPacks = rackPacksResult.data || [];
  const racks = racksResult.data || [];
  const lifecycleByCellId = new Map<string, string>((cellsResult || []).map((cell: any) => [
    String(cell.id),
    String(cell.lifecycle_status || cell.status || ''),
  ]));

  const canonicalIds = new Map<string, string>();
  const addCanonicalIds = (entityType: string, rows: any[]) => {
    rows.forEach(row => {
      const id = String(row?.id || '');
      if (!id) return;
      [row.id, row.serial_number, row.qr_code].filter(Boolean).forEach(value => {
        canonicalIds.set(`${entityType}:${String(value)}`, id);
      });
    });
  };
  addCanonicalIds('MODULE', modules || []);
  addCanonicalIds('BATTERY', batteries || []);
  addCanonicalIds('RACK', racks || []);

  const canonicalEntityId = (entityType: string, entityId: string) => canonicalIds.get(`${entityType}:${entityId}`) || entityId;

  const latestByEntity = new Map<string, string>();
  const orderedWarehouseMoves = [...(warehouseMoves || [])].sort((left: any, right: any) => {
    const leftTime = new Date(left?.moved_at || 0).getTime();
    const rightTime = new Date(right?.moved_at || 0).getTime();
    return rightTime - leftTime;
  });
  orderedWarehouseMoves.forEach((row: any) => {
    const type = String(row.entity_type || '').toUpperCase();
    const entityId = canonicalEntityId(type, String(row.entity_id || ''));
    const location = normalizeWarehouseLocation(row.to_location);
    if (!type || !entityId) return;
    const key = `${type}:${entityId}`;
    if (!latestByEntity.has(key)) latestByEntity.set(key, location);
  });

  // The rack row is the current source of truth after a warehouse edit.
  // It also covers older edits whose movement log was not written because of RLS.
  (racks || []).forEach((rack: any) => {
    const rackId = String(rack?.id || '');
    const location = normalizeWarehouseLocation(rack?.location);
    if (rackId && location) latestByEntity.set(`RACK:${rackId}`, location);
  });

  const moduleIdsByBattery = new Map<string, string[]>();
  for (const module of modules || []) {
    const batteryId = module?.battery_id ? String(module.battery_id) : '';
    if (!batteryId) continue;
    const current = moduleIdsByBattery.get(batteryId) || [];
    current.push(String(module.id));
    moduleIdsByBattery.set(batteryId, current);
  }

  const cellIdsByModule = new Map<string, string[]>();
  for (const entry of moduleCells || []) {
    const moduleId = String(entry?.module_id || '');
    const cellId = String(entry?.cell_id || '');
    if (!moduleId || !cellId) continue;
    const current = cellIdsByModule.get(moduleId) || [];
    current.push(cellId);
    cellIdsByModule.set(moduleId, current);
  }

  const rackIdsByBattery = new Map<string, string[]>();
  for (const row of rackPacks || []) {
    const batteryId = row?.battery_id ? String(row.battery_id) : '';
    const rackId = row?.rack_id ? String(row.rack_id) : '';
    if (!batteryId || !rackId) continue;
    const current = rackIdsByBattery.get(batteryId) || [];
    current.push(rackId);
    rackIdsByBattery.set(batteryId, current);
  }

  const locationByCell = new Map<string, string>();

  const assignCellLocation = (cellId: string, location: string) => {
    const normalizedLocation = normalizeWarehouseLocation(location);
    if (!cellId || !normalizedLocation) return;
    if (!locationByCell.has(cellId)) locationByCell.set(cellId, normalizedLocation);
  };

  const applyEntityToCellSet = (entityType: string, entityId: string, location: string) => {
    const normalizedLocation = normalizeWarehouseLocation(location);
    if (!entityId || !normalizedLocation) return;

    if (entityType === 'CELL') {
      assignCellLocation(entityId, normalizedLocation);
      return;
    }

    if (entityType === 'MODULE') {
      const cellIds = cellIdsByModule.get(entityId) || [];
      cellIds.forEach(cellId => assignCellLocation(cellId, normalizedLocation));
      return;
    }

    if (entityType === 'BATTERY') {
      const moduleIds = moduleIdsByBattery.get(entityId) || [];
      moduleIds.forEach(moduleId => {
        (cellIdsByModule.get(moduleId) || []).forEach(cellId => assignCellLocation(cellId, location));
      });
      return;
    }

    if (entityType === 'RACK') {
      const rackCells = new Set<string>();
      const batteryIds = new Set<string>();
      for (const row of rackPacks || []) {
        if (String(row?.rack_id || '') !== entityId) continue;
        if (row?.battery_id) batteryIds.add(String(row.battery_id));
      }
      batteryIds.forEach((batteryId: string) => {
        const moduleIds = moduleIdsByBattery.get(batteryId) || [];
        moduleIds.forEach((moduleId: string) => {
          (cellIdsByModule.get(moduleId) || []).forEach((cellId: string) => rackCells.add(cellId));
        });
      });
      rackCells.forEach((cellId: string) => locationByCell.set(cellId, normalizedLocation));
    }
  };

  latestByEntity.forEach((location, key) => {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex < 1) return;
    const entityType = key.slice(0, separatorIndex);
    const entityId = key.slice(separatorIndex + 1);
    if (entityType === 'RACK') return;
    applyEntityToCellSet(entityType, entityId, location);
  });

  latestByEntity.forEach((location, key) => {
    if (!key.startsWith('RACK:')) return;
    applyEntityToCellSet('RACK', key.slice('RACK:'.length), location);
  });

  const warehouseRackCounts = { KARACHI: 0, LAHORE: 0 };
  const warehouseRackTypeCounts = new Map<string, { KARACHI: number; LAHORE: number }>();
  const warehouseBatteryCounts = { KARACHI: 0, LAHORE: 0 };
  const warehouseBatteryTypeCounts = new Map<string, { KARACHI: number; LAHORE: number }>();
  latestByEntity.forEach((location, key) => {
    if (key.startsWith('BATTERY:')) {
      if (location === 'KARACHI') warehouseBatteryCounts.KARACHI += 1;
      if (location === 'LAHORE') warehouseBatteryCounts.LAHORE += 1;
      const batteryId = key.slice('BATTERY:'.length);
      const battery = batteries.find((item: any) => String(item?.id || '') === batteryId);
      const product = Array.isArray(battery?.product_templates) ? battery.product_templates[0] : battery?.product_templates;
      const productName = String(product?.name || (Number(product?.capacity_kwh) >= 7 ? '7.5 kWh Battery Pack' : '5 kWh Battery Pack')).trim();
      const counts = warehouseBatteryTypeCounts.get(productName) || { KARACHI: 0, LAHORE: 0 };
      if (location === 'KARACHI') counts.KARACHI += 1;
      if (location === 'LAHORE') counts.LAHORE += 1;
      warehouseBatteryTypeCounts.set(productName, counts);
      return;
    }
    if (!key.startsWith('RACK:')) return;
    if (location === 'KARACHI') warehouseRackCounts.KARACHI += 1;
    if (location === 'LAHORE') warehouseRackCounts.LAHORE += 1;
    const rackId = key.slice('RACK:'.length);
    const rack = racks.find((item: any) => String(item?.id || '') === rackId);
    const type = String(rack?.rack_template_code || 'UNKNOWN_RACK').toUpperCase();
    const counts = warehouseRackTypeCounts.get(type) || { KARACHI: 0, LAHORE: 0 };
    if (location === 'KARACHI') counts.KARACHI += 1;
    if (location === 'LAHORE') counts.LAHORE += 1;
    warehouseRackTypeCounts.set(type, counts);
  });

  return {
    locationByCell,
    latestByEntity,
    warehouseRackCounts,
    warehouseRackTypeCounts: Array.from(warehouseRackTypeCounts.entries()).map(([type, counts]) => ({ type, ...counts })),
    warehouseBatteryCounts,
    warehouseBatteryTypeCounts: Array.from(warehouseBatteryTypeCounts.entries()).map(([type, counts]) => ({ type, ...counts })),
    lifecycleByCellId,
  };
}

function mapQueryValue(method: string, value: any, index: number) {
  if (typeof value !== 'string') return value;
  if (method === 'eq' || method === 'neq' || method === 'in' || method === 'ilike') {
    return index === 0 ? toDbColumn(value) : value;
  }
  if (method === 'select' || method === 'order') {
    return index === 0 ? value.replace(/[A-Za-z][A-Za-z0-9]*(?=\.|,|\s|$)/g, token => toDbColumn(token)) : value;
  }
  if (method === 'or' || method === 'and') {
    return value.replace(/([A-Za-z][A-Za-z0-9_]*)\.(?=(?:eq|neq|gt|gte|lt|lte|like|ilike|is)\.)/g, (_, token) => `${toDbColumn(token)}.`);
  }
  return value;
}

function wrapSupabaseQuery(query: any, table: string): any {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') {
        return (resolve: any, reject: any) => target.then((result: any) => resolve({ ...result, data: toAppValue(result.data) }), reject);
      }
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== 'function') return original;
      return (...args: any[]) => {
        const method = String(property);
        const mappedArgs = args.map((arg, index) => {
          if (['insert', 'update', 'upsert'].includes(method) && index === 0) {
            return Array.isArray(arg) ? arg.map(value => toDbRow(value, table)) : toDbRow(arg, table);
          }
          return mapQueryValue(method, arg, index);
        });
        return wrapSupabaseQuery(original.apply(target, mappedArgs), table);
      };
    },
  });
}

const supabaseDb = {
  from(table: string) {
    return wrapSupabaseQuery((rawSupabase as any).from(table), table);
  },
};

const supabase = Object.assign(supabaseDb, { auth: (rawSupabase as any)?.auth });

const handleError = (res: Response) => {
  if (res.status === 401) {
    const text = res.statusText;
    const err: any = new Error('Authentication required. Session expired or invalid.');
    err.name = 'AuthRequiredError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  if (res.status === 403) {
    const text = res.statusText;
    const err: any = new Error('Permission denied.');
    err.name = 'PermissionDeniedError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  if (!res.ok) {
    const text = res.statusText;
    const err: any = new Error(text || 'Request failed');
    err.name = 'ApiError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  return res.json();
};

function mapSupabaseProfile(raw: any): User {
  return {
    id: raw.id,
    name: raw.full_name || raw.email?.split('@')[0] || 'Operator',
    username: raw.username || raw.email?.split('@')[0] || 'operator',
    email: raw.email || '',
    roleId: raw.role_id,
    role: raw.role?.name || 'operator',
    badgeId: raw.badge_id || '',
    status: raw.status || 'ACTIVE',
  };
}

export const api = {
  // Users & Roles

async getUsers(): Promise<User[]> {
    const { data, error } = await supabaseDb.from('profiles').select(`
      id, full_name, email, username, role_id, status, badge_id, created_at, updated_at,
      role:roles (id, name, description, status)
    `).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSupabaseProfile);
  },

  async createUser(user: Partial<User>, userId?: string): Promise<User> {
    const { data: sessionData } = await rawSupabase?.auth.getSession() || { data: { session: null } };
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
      },
      body: JSON.stringify({ ...user, userId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create user');
    return result;
  },

  async updateUser(id: string, user: Partial<User>, userId?: string): Promise<User> {
    const { data: sessionData } = await rawSupabase?.auth.getSession() || { data: { session: null } };
    const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
      },
      body: JSON.stringify({ ...user, userId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update user');
    return result;
  },

  async deleteUser(id: string, userId?: string): Promise<any> {
    const { data: sessionData } = await rawSupabase?.auth.getSession() || { data: { session: null } };
    const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
      },
      body: JSON.stringify({ userId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete user');
    return result;
  },

  async getRoles(): Promise<Role[]> {
    const [{ data: roles, error: rolesError }, { data: grants, error: grantsError }] = await Promise.all([
      supabase.from('roles').select('*').order('created_at', { ascending: false }),
      supabase.from('role_permissions').select('role_id, permission_id'),
    ]);
    if (rolesError) throw rolesError;
    if (grantsError) throw grantsError;
    const permissionsByRole = new Map<string, string[]>();
    (grants || []).forEach((grant: any) => {
      const permissions = permissionsByRole.get(grant.roleId) || [];
      permissions.push(grant.permissionId);
      permissionsByRole.set(grant.roleId, permissions);
    });
    return (roles || []).filter((role: any) => ['role-admin', 'role-operator'].includes(role.id)).map((role: any) => ({
      ...role,
      permissions: role.permissions?.includes('ALL')
        ? ['ALL']
        : permissionsByRole.get(role.id) || role.permissions || [],
    }));
  },

  async createRole(role: Partial<Role>, userId?: string): Promise<Role> {
    throw new Error('Only Administrator and Operator roles are supported.');
  },

  async updateRole(id: string, role: Partial<Role>, userId?: string): Promise<Role> {
    if (!['role-admin', 'role-operator'].includes(id)) {
      throw new Error('Only Administrator and Operator roles are supported.');
    }
    const { data, error } = await supabase.from('roles').update({
      name: role.name || undefined,
      description: role.description || undefined,
      status: role.status || undefined,
      updatedAt: new Date().toISOString(),
    }).eq('id', id).select();
    if (error) throw error;
    if (role.permissions) await this.replaceRolePermissions(id, role.permissions);
    return { ...(data?.[0] || {}), permissions: role.permissions || [] };
  },

  async replaceRolePermissions(roleId: string, permissions: string[]): Promise<void> {
    const { error: deleteError } = await supabase.from('role_permissions').delete().eq('roleId', roleId);
    if (deleteError) throw deleteError;
    if (permissions.length === 0 || permissions.includes('ALL')) {
      if (permissions.includes('ALL')) {
        const { error } = await supabase.from('role_permissions').insert({ roleId, permissionId: 'ALL' });
        if (error) throw error;
      }
      return;
    }
    const { error } = await supabase.from('role_permissions').insert(
      permissions.map(permissionId => ({ roleId, permissionId })),
    );
    if (error) throw error;
  },

  async deleteRole(id: string, userId?: string): Promise<any> {
    throw new Error('Administrator and Operator roles cannot be deleted.');
  },

  // Dashboard stats
  async getDashboardStats(startDate?: string, endDate?: string): Promise<any> {
    const cacheKey = `${startDate || ''}:${endDate || ''}`;
    const now = Date.now();
    if (dashboardStatsCache?.key === cacheKey && dashboardStatsCache.expiresAt > now) return dashboardStatsCache.value;
    if (dashboardStatsRequest?.key === cacheKey) return dashboardStatsRequest.promise;

    const promise = api.loadDashboardStats(startDate, endDate);
    dashboardStatsRequest = { key: cacheKey, promise };
    try {
      const value = await promise;
      dashboardStatsCache = { key: cacheKey, value, expiresAt: Date.now() + 10000 };
      return value;
    } finally {
      if (dashboardStatsRequest?.key === cacheKey) dashboardStatsRequest = null;
    }
  },

  async loadDashboardStats(startDate?: string, endDate?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    
    try {
      const applyDateRange = (query: any, field = 'created_at') => {
        let scopedQuery = query;
        if (startDate) scopedQuery = scopedQuery.gte(field, `${startDate}T00:00:00.000Z`);
        if (endDate) scopedQuery = scopedQuery.lte(field, `${endDate}T23:59:59.999Z`);
        return scopedQuery;
      };
      // Use RPC for dashboard summary (much faster than loading all cells)
      const { data, error } = await rawSupabase.rpc('get_dashboard_summary', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      });
      
      if (error) {
        console.warn('Dashboard RPC error:', error.message);
        throw new Error(`Dashboard summary unavailable: ${error.message}`);
      }

      const [{ data: liveModules }, { data: liveBatteries }, { data: liveRacks }, { data: liveRackPacks }] = await Promise.all([
        applyDateRange(rawSupabase.from('modules').select('module_type,created_at,battery:batteries(product_templates(capacity_kwh,num_modules))')),
        applyDateRange(rawSupabase.from('batteries').select('id,bms_id,bmu_id,progress_percent,status,created_at,product_id,product_templates(name,capacity_kwh)')),
        applyDateRange(rawSupabase.from('racks').select('id,status,rack_template_code,required_pack_count,required_pack_template_code,created_at')),
        rawSupabase.from('rack_packs').select('rack_id,battery:batteries(product_templates(capacity_kwh))'),
      ]);
      const moduleTypeCounts = new Map<string, number>();
      const moduleTypeCapacity = new Map<string, number>();
      (liveModules || []).forEach((module: any) => {
        const type = String(module.module_type || '8S').toUpperCase() === '12S' ? '12S' : '8S';
        moduleTypeCounts.set(type, (moduleTypeCounts.get(type) || 0) + 1);
        const packCapacity = Number(module.battery?.product_templates?.capacity_kwh);
        const moduleCount = Number(module.battery?.product_templates?.num_modules);
        const capacityKwh = Number.isFinite(packCapacity) && packCapacity > 0 && Number.isFinite(moduleCount) && moduleCount > 0
          ? packCapacity / moduleCount
          : type === '12S' ? 3.75 : 2.5;
        moduleTypeCapacity.set(type, (moduleTypeCapacity.get(type) || 0) + capacityKwh);
      });
      const liveModuleTypeBuckets = ['8S', '12S'].map(label => ({ label, value: moduleTypeCounts.get(label) || 0, capacityKwh: moduleTypeCapacity.get(label) || 0 }));
      const livePackCounts = new Map<string, number>();
      (liveBatteries || []).forEach((battery: any) => {
        const name = battery.product_templates?.name || 'Unnamed Pack';
        livePackCounts.set(name, (livePackCounts.get(name) || 0) + 1);
      });
      const livePackBuckets = Array.from(livePackCounts.entries()).map(([label, value]) => ({
        label,
        value,
        capacityKwh: (liveBatteries || [])
          .filter((battery: any) => (battery.product_templates?.name || 'Unnamed Pack') === label)
          .reduce((total: number, battery: any) => total + (Number(battery.product_templates?.capacity_kwh) || 0), 0),
      }));
      const capacityProducedKwh = (liveBatteries || [])
        .filter((battery: any) => ['FINISHED', 'RELEASED', 'DISPATCHED', 'WAREHOUSE'].includes(String(battery.status || '').toUpperCase()))
        .reduce((total: number, battery: any) => total + (Number(battery.product_templates?.capacity_kwh) || 0), 0);
      const rackCapacities = new Map<string, Set<number>>();
      (liveRackPacks || []).forEach((assignment: any) => {
        const rackId = String(assignment.rack_id || '');
        const capacity = Number(assignment.battery?.product_templates?.capacity_kwh);
        if (!rackId || !Number.isFinite(capacity)) return;
        const capacities = rackCapacities.get(rackId) || new Set<number>();
        capacities.add(capacity);
        rackCapacities.set(rackId, capacities);
      });
      const rackCategoryCounts = { cabinet: 0, rack: 0 };
      (liveRacks || []).forEach((rack: any) => {
        const capacities = rackCapacities.get(String(rack.id || ''));
        const fallbackCapacity = String(rack.required_pack_template_code || '').toUpperCase() === 'PACK_7_5KWH' ? 7.5 : 5;
        const usesCabinetBatteries = capacities?.has(7.5) || (!capacities?.size && fallbackCapacity === 7.5);
        const usesRackBatteries = capacities?.has(5) || (!capacities?.size && fallbackCapacity === 5);
        if (usesCabinetBatteries) rackCategoryCounts.cabinet += 1;
        else if (usesRackBatteries) rackCategoryCounts.rack += 1;
      });
      const producedCategoryBuckets = [
        {
          label: 'Cabinet',
          value: rackCategoryCounts.cabinet,
          capacityKwh: 7.5,
        },
        {
          label: 'Rack',
          value: rackCategoryCounts.rack,
          capacityKwh: 5,
        },
      ];
      const trendDays = Array.from({ length: 30 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - (29 - index));
        return date.toISOString().slice(0, 10);
      });
      const moduleTrendCounts = new Map<string, Map<string, number>>();
      const batteryTrendCounts = new Map<string, Map<string, number>>();
      (liveModules || []).forEach((module: any) => {
        const day = String(module.created_at || '').slice(0, 10);
        const type = String(module.module_type || '8S').toUpperCase() === '12S' ? '12S' : '8S';
        if (!trendDays.includes(day)) return;
        const values = moduleTrendCounts.get(day) || new Map<string, number>();
        values.set(type, (values.get(type) || 0) + 1);
        moduleTrendCounts.set(day, values);
      });
      (liveBatteries || []).forEach((battery: any) => {
        const day = String(battery.created_at || '').slice(0, 10);
        const status = String(battery.status || '').toUpperCase();
        const name = battery.product_templates?.name || 'Unnamed Pack';
        if (!trendDays.includes(day) || !['FINISHED', 'RELEASED', 'DISPATCHED', 'WAREHOUSE'].includes(status)) return;
        const values = batteryTrendCounts.get(day) || new Map<string, number>();
        values.set(name, (values.get(name) || 0) + 1);
        batteryTrendCounts.set(day, values);
      });
      const moduleTypeTrend = trendDays.map(label => ({
        label,
        series: ['8S', '12S'].map(name => ({ name, value: moduleTrendCounts.get(label)?.get(name) || 0 })),
      }));
      const liveBatteryPackTrend = trendDays.map(label => ({
        label,
        series: Array.from(livePackCounts.keys()).map(name => ({ name, value: batteryTrendCounts.get(label)?.get(name) || 0 })),
      }));
      const [{ data: liveBms }, { data: liveBmus }] = await Promise.all([
        rawSupabase.from('bms_units').select('id,status,reserved_for_battery_id'),
        rawSupabase.from('bmu_units').select('id,status,reserved_for_battery_id'),
      ]);
      const linkedBmsIds = new Set<string>((liveBatteries || []).map((battery: any) => String(battery.bms_id || battery.bmsId || '')).filter(Boolean));
      const linkedBmuIds = new Set<string>((liveBatteries || []).map((battery: any) => String(battery.bmu_id || battery.bmuId || '')).filter(Boolean));
      const isAvailableController = (controller: any, linkedIds: Set<string>, id: string) => (
        String(controller.status || '').toUpperCase() === 'AVAILABLE'
        && !controller.reserved_for_battery_id
        && !linkedIds.has(id)
      );
      const isAssignedController = (controller: any, linkedIds: Set<string>, id: string) => (
        String(controller.status || '').toUpperCase() === 'ASSIGNED'
        || Boolean(controller.reserved_for_battery_id)
        || linkedIds.has(id)
      );
      const controllerInventory = {
        availableBms: (liveBms || []).filter((controller: any) => isAvailableController(controller, linkedBmsIds, controller.id)).length,
        availableBmu: (liveBmus || []).filter((controller: any) => isAvailableController(controller, linkedBmuIds, controller.id)).length,
        totalBms: (liveBms || []).length,
        totalBmu: (liveBmus || []).length,
        assignedBms: (liveBms || []).filter((controller: any) => isAssignedController(controller, linkedBmsIds, controller.id)).length,
        assignedBmu: (liveBmus || []).filter((controller: any) => isAssignedController(controller, linkedBmuIds, controller.id)).length,
      };
      const { locationByCell: warehouseCellLocations, lifecycleByCellId, warehouseRackCounts, warehouseRackTypeCounts, warehouseBatteryCounts, warehouseBatteryTypeCounts } = await resolveWarehouseCellLocations();
      const normalizedCellBuckets = reconcileDashboardCellBuckets(data?.cellBuckets, data?.inventory?.totalCells);
      const warehouseAwareCellBuckets = buildWarehouseLocationBuckets(normalizedCellBuckets, warehouseCellLocations, lifecycleByCellId);
      const karachiWarehouseCells = Array.from(warehouseCellLocations.values()).filter(location => location === 'KARACHI').length;
      const lahoreWarehouseCells = Array.from(warehouseCellLocations.values()).filter(location => location === 'LAHORE').length;
      // Use data from RPC - it's already optimized at database level
      return {
        inventory: {
          ...(data?.inventory || {
            totalCells: 0, availableCells: 0, usedCells: 0, reservedCells: 0,
            inProcessCells: 0, assembledCells: 0, quarantinedCells: 0,
            finishedBatteries: 0, inProcessBatteries: 0,
          }),
          karachiWarehouseCells,
          lahoreWarehouseCells,
          karachiWarehouseRacks: warehouseRackCounts.KARACHI,
          lahoreWarehouseRacks: warehouseRackCounts.LAHORE,
          warehouseRackTypeCounts,
          karachiWarehouseBatteries: warehouseBatteryCounts.KARACHI,
          lahoreWarehouseBatteries: warehouseBatteryCounts.LAHORE,
          warehouseBatteryTypeCounts,
        },
        quality: data?.quality || { firstPassYieldPercent: 0, quarantinedCount: 0 },
        orders: data?.orders || { total: 0, inProcess: 0, completed: 0, planned: 0 },
        production: { ...(data?.production || {}), capacityProducedKwh },
        kpis: data?.kpis || {
          totalCellsInInventory: data?.inventory?.totalCells || 0,
          availableCells: data?.inventory?.availableCells || 0,
          usedCells: data?.inventory?.usedCells || 0,
          reservedCells: data?.inventory?.reservedCells || 0,
          inProcessCells: 0,
          assembledCells: 0,
          quarantinedCells: data?.inventory?.quarantinedCells || 0,
          totalBatteriesCompleted: data?.inventory?.finishedBatteries || 0,
          batteriesInProduction: data?.inventory?.inProcessBatteries || 0,
          activeOrders: 0,
          firstPassYield: 100,
          onlineMachines: 0,
          totalMachines: 0
        },
        recentBatteries: Array.isArray(data?.recentBatteries) ? toAppValue(data.recentBatteries) : [],
        recentOrders: Array.isArray(data?.recentOrders) ? data.recentOrders : [],
        recentAuditLogs: Array.isArray(data?.recentAuditLogs) ? data.recentAuditLogs : [],
        machines: Array.isArray(data?.machines) ? data.machines : [],
        finishedPackTrend: Array.isArray(data?.finishedPackTrend) ? data.finishedPackTrend : [],
        activeBatchTrend: Array.isArray(data?.activeBatchTrend) ? data.activeBatchTrend : [],
        batteryBuildTrend: Array.isArray(data?.batteryBuildTrend) ? data.batteryBuildTrend : [],
        bmsTelemetry: data?.bmsTelemetry || { total: 0, tested: 0 },
        controllerInventory: (liveBms || liveBmus) ? controllerInventory : {
          availableBms: Number(data?.inventory?.availableBms || 0),
          availableBmu: Number(data?.inventory?.availableBmu || 0),
          totalBms: Number(data?.inventory?.totalBms || 0),
          totalBmu: Number(data?.inventory?.totalBmu || 0),
        },
        // Lifecycle buckets are authoritative. Warehouse location is reported separately
        // and must not reclassify or duplicate cells in the inventory distribution.
        cellBuckets: warehouseAwareCellBuckets,
        cellTotal: Number(data?.inventory?.totalCells || warehouseAwareCellBuckets.reduce((sum: number, bucket: any) => sum + (Number(bucket.value) || 0), 0)),
        moduleTotal: liveModules?.length || 0,
        moduleStatusBuckets: liveModuleTypeBuckets,
        moduleTypeBuckets: liveModuleTypeBuckets,
        batteryStatusBuckets: Array.isArray(data?.batteryStatusBuckets) ? data.batteryStatusBuckets : [],
        batteryPackTotal: liveBatteries?.length || 0,
        completedBatteriesTotal: (liveBatteries || []).filter((battery: any) => ['FINISHED', 'RELEASED', 'DISPATCHED', 'WAREHOUSE'].includes(String(battery.status || '').toUpperCase())).length,
        producedCategoryBuckets,
        batteryPackBuckets: livePackBuckets,
        batteryPackTrend: liveBatteryPackTrend.some((point: any) => point.series.some((item: any) => item.value > 0))
          ? liveBatteryPackTrend
          : (Array.isArray(data?.batteryPackTrend) ? data.batteryPackTrend : []),
        moduleTypeTrend,
        rackTotal: liveRacks?.length || 0,
        rackStatusBuckets: Array.from((liveRacks || []).reduce((counts: Map<string, { value: number; capacityKwh: number; rackTypes: Map<string, { value: number; capacityKwh: number }> }>, rack: any) => {
          const status = String(rack.status || 'UNKNOWN').replace(/_/g, ' ');
          const rackType = String(rack.rack_template_code || 'UNKNOWN_RACK');
          const capacityKwh = Number(String(rack.rack_template_code || '').match(/RACK_(\d+(?:\.\d+)?)KWH/i)?.[1] || 0);
          const current = counts.get(status) || { value: 0, capacityKwh: 0, rackTypes: new Map<string, { value: number; capacityKwh: number }>() };
          const typeTotals = current.rackTypes.get(rackType) || { value: 0, capacityKwh: 0 };
          current.rackTypes.set(rackType, { value: typeTotals.value + 1, capacityKwh: typeTotals.capacityKwh + capacityKwh });
          counts.set(status, { value: current.value + 1, capacityKwh: current.capacityKwh + capacityKwh, rackTypes: current.rackTypes });
          return counts;
        }, new Map<string, { value: number; capacityKwh: number; rackTypes: Map<string, { value: number; capacityKwh: number }> }>())).map(([label, values]) => ({
          label,
          value: values.value,
          capacityKwh: values.capacityKwh,
          rackTypes: Array.from(values.rackTypes.entries()).map(([rackType, totals]) => ({ rackType, ...totals })),
        })),
        quarantineOpenCount: data?.inventory?.quarantinedCells || 0,
      };
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      throw error;
    }
  },

  // Reports & Quality Analytics
  async getReportsAnalytics(): Promise<any> {
    const reportCellFields = 'id,internal_serial,supplier_barcode,supplier_ocv_v,production_ocv_v,status,reserved_for_order_id,reserved_for_battery_id,tested_at';
    const { count: cellCount, error: cellCountError } = await supabase
      .from('cells')
      .select('id', { count: 'exact', head: true });
    if (cellCountError) throw cellCountError;

    const reportPageSize = 1000;
    const reportPageCount = Math.ceil((cellCount || 0) / reportPageSize);
    const reportCellPages = await Promise.all(Array.from({ length: reportPageCount }, (_, page) =>
      supabase
        .from('cells')
        .select(reportCellFields)
        .order('created_at', { ascending: false })
        .range(page * reportPageSize, (page + 1) * reportPageSize - 1),
    ));
    const failedCellPage = reportCellPages.find(result => result.error);
    if (failedCellPage?.error) throw failedCellPage.error;
    const cells = reportCellPages.flatMap(result => result.data || []).map((cell: any) => ({
      ...cell,
      supplierOcvV: cell.supplierOcvV ?? cell.supplier_ocv_v,
      productionOcvV: cell.productionOcvV ?? cell.production_ocv_v,
      reservedForOrderId: cell.reservedForOrderId ?? cell.reserved_for_order_id,
      reservedForBatteryId: cell.reservedForBatteryId ?? cell.reserved_for_battery_id,
      testedAt: cell.testedAt ?? cell.tested_at,
    })) as CellItem[];

    const [batteriesResult, modulesResult, bmsResult, cellTestsResult, batteryTestsResult, quarantineResult] = await Promise.all([
      supabase.from('batteries').select('id,status,step_results_json,created_at'),
      supabase.from('modules').select('id,status,welding_result_json'),
      supabase.from('bms_units').select('id,status,test_result_json'),
      supabase.from('cell_tests').select('id,cell_id,battery_id,passed,tested_at'),
      supabase.from('battery_tests').select('id,battery_id,passed,tested_at'),
      supabase.from('quarantine_records').select('id,entity_type,entity_id,reason,status'),
    ]);
    const results = [batteriesResult, modulesResult, bmsResult, cellTestsResult, batteryTestsResult, quarantineResult];
    const failedResult = results.find(result => result.error);
    if (failedResult?.error) throw failedResult.error;

    const batteries = (batteriesResult.data || []).map((battery: any) => ({
      ...battery,
      stepResults: battery.stepResults ?? battery.step_results_json,
    }));
    const modules = (modulesResult.data || []).map((module: any) => ({
      ...module,
      weldingResult: module.weldingResult ?? module.welding_result_json,
    }));
    const bmsUnits = (bmsResult.data || []).map((controller: any) => ({
      ...controller,
      testResult: controller.testResult ?? controller.test_result_json,
    }));
    const cellTests = (cellTestsResult.data || []).map((test: any) => ({ ...test, cellId: test.cellId ?? test.cell_id }));
    const batteryTests = (batteryTestsResult.data || []).map((test: any) => ({ ...test, batteryId: test.batteryId ?? test.battery_id }));
    const quarantine = (quarantineResult.data || []) as any[];
    const testedCellIds = new Set(cellTests.map(test => test.cellId).filter(Boolean));
    const testedCells = testedCellIds.size || cells.filter(cell => cell.testedAt).length;
    const testedBatteries = batteryTests.length || batteries.filter(battery => battery.stepResults?.FINAL_TESTING?.status).length;
    const totalTestCycles = cellTests.length + batteryTests.length;
    const totalQuarantined = quarantine.length;
    const reservedCells = cells.filter(cell => cell.reservedForOrderId || cell.reservedForBatteryId).length;
    const availableCells = cells.filter(cell => !cell.reservedForOrderId && !cell.reservedForBatteryId && cell.status !== 'QUARANTINED').length;
    const passedTestCycles = cellTests.filter(test => test.passed === true).length
      + batteryTests.filter(test => test.passed === true).length;
    const fpy = totalTestCycles > 0
      ? Number(((passedTestCycles / totalTestCycles) * 100).toFixed(1))
      : 0;
    const weldedModules = modules.filter(module => module.weldingResult?.status);
    const passedWelds = weldedModules.filter(module => module.weldingResult.status === 'PASSED').length;
    const testedBms = bmsUnits.filter(controller => controller.testResult?.status);
    const passedBms = testedBms.filter(controller => controller.testResult.status === 'PASSED').length;
    const buckets: Record<string, number> = { '< 3.297V': 0, '3.298V': 0, '3.300V': 0, '3.302V': 0, '> 3.303V': 0 };
    cells.forEach(cell => {
      const voltage = Number(cell.productionOcvV ?? cell.supplierOcvV ?? 3.300);
      if (voltage < 3.298) buckets['< 3.297V'] += 1;
      else if (voltage < 3.2995) buckets['3.298V'] += 1;
      else if (voltage < 3.3015) buckets['3.300V'] += 1;
      else if (voltage < 3.303) buckets['3.302V'] += 1;
      else buckets['> 3.303V'] += 1;
    });
    const maxCount = Math.max(1, ...Object.values(buckets));
    const ocvDistribution = Object.entries(buckets).map(([label, count]) => ({
      label,
      count,
      height: `${Math.max(8, Math.round((count / maxCount) * 100))}%`,
    }));
    const defectCounts: Record<string, number> = {};
    quarantine.forEach(record => {
      const reason = record.reason || 'General Quality Deviation';
      defectCounts[reason] = (defectCounts[reason] || 0) + 1;
    });
    const totalDefects = Math.max(1, quarantine.length);
    const paretoColors = ['bg-amber-500', 'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
    const pareto = Object.entries(defectCounts)
      .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
      .map(([mode, count], index) => ({ mode, count, pct: Math.round((count / totalDefects) * 100), color: paretoColors[index % paretoColors.length] }));

    return {
      hasData: cells.length > 0 || batteries.length > 0 || modules.length > 0 || bmsUnits.length > 0 || quarantine.length > 0,
      fpy,
      totalCycles: totalTestCycles,
      laserWeldQuality: weldedModules.length ? Number(((passedWelds / weldedModules.length) * 100).toFixed(1)) : 0,
      bmsTelemetryRate: testedBms.length ? Number(((passedBms / testedBms.length) * 100).toFixed(1)) : 0,
      ocvDistribution,
      pareto,
      totalCells: cells.length,
      reservedCells,
      availableCells,
      totalModules: modules.length,
      totalBatteries: batteries.length,
      weldedModules: weldedModules.length,
      testedCells,
      testedBatteries,
      testedBms: testedBms.length,
      totalBms: bmsUnits.length,
      quarantineOpen: quarantine.filter(record => record.status === 'OPEN').length,
      quarantineResolved: quarantine.filter(record => record.status === 'RESOLVED').length,
    };
  },

  async getRecentTraceItems(): Promise<Array<{ label: string; serial: string }>> {
    const [batteriesResult, cellsResult] = await Promise.all([
      supabase.from('batteries').select('serial_number').order('created_at', { ascending: false }).limit(3),
      supabase.from('cells').select('internal_serial').order('created_at', { ascending: false }).limit(3),
    ]);
    if (batteriesResult.error) throw batteriesResult.error;
    if (cellsResult.error) throw cellsResult.error;
    return [
      ...(batteriesResult.data || []).map((battery: any) => {
        const serial = battery.serialNumber || battery.serial_number || '';
        return { label: `${serial} (Battery)`, serial };
      }),
      ...(cellsResult.data || []).map((cell: any) => {
        const serial = cell.internalSerial || cell.internal_serial || '';
        return { label: `${serial} (Cell)`, serial };
      }),
    ].filter(item => Boolean(item.serial));
  },

  async getWarehouseEntityStatuses(): Promise<Record<string, 'KARACHI_WAREHOUSE' | 'LAHORE_WAREHOUSE'>> {
    const resolved = await resolveWarehouseCellLocations();
    const statuses: Record<string, 'KARACHI_WAREHOUSE' | 'LAHORE_WAREHOUSE'> = {};
    const addStatus = (key: string, location: string) => {
      const status = warehouseLocationStatus(location);
      if (status) statuses[key] = status as 'KARACHI_WAREHOUSE' | 'LAHORE_WAREHOUSE';
    };
    Array.from(resolved.locationByCell.entries()).forEach(([cellId, location]) => addStatus(`CELL:${cellId}`, location));
    resolved.latestByEntity?.forEach((location: string, key: string) => addStatus(key, location));
    return statuses;
  },

  async getWarehouseCellStatuses(): Promise<Record<string, 'KARACHI_WAREHOUSE' | 'LAHORE_WAREHOUSE'>> {
    const statuses = await api.getWarehouseEntityStatuses();
    return Object.fromEntries(Object.entries(statuses).filter(([key]) => key.startsWith('CELL:')).map(([key, status]) => [key.slice(5), status])) as Record<string, 'KARACHI_WAREHOUSE' | 'LAHORE_WAREHOUSE'>;
  },

  // Products
  async getProducts(): Promise<ProductTemplate[]> {
    const { data, error } = await supabase
      .from('product_templates')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((product: any) => ({
      ...product,
      productModel: product.productModel || product.product_model || product.sku,
      batteryName: product.batteryName || product.battery_name || product.name,
      voltageType: product.voltageType || product.voltage_type || 'LV',
      bmsProtocol: product.bmsProtocol === 'CAN_2.0B' ? 'CAN_2.0B' : (product.bmsProtocol || 'CAN_2_0B'),
      moduleConfigurations: product.moduleConfigurations || product.module_configurations_json || [],
    }));
  },

  async createProduct(product: Partial<ProductTemplate>): Promise<ProductTemplate> {
    const normalizedProtocol = product.bmsProtocol === 'CAN_2.0B' ? 'CAN_2_0B' : product.bmsProtocol;
    const generatedSku = `${product.productModel || product.name || 'PRODUCT'}-${product.batteryName || 'BATTERY'}-${Date.now()}`
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-');
    const { data, error } = await supabase
      .from('product_templates')
      .insert({
        id: `prod-${Date.now()}`,
        sku: product.sku || generatedSku,
        name: product.name || '',
        product_model: product.productModel || product.sku || '',
        battery_name: product.batteryName || product.name || '',
        voltage_type: product.voltageType || 'LV',
        nominalVoltageV: product.nominalVoltageV || 0,
        capacityKwh: product.capacityKwh || 0,
        totalCapacityAh: product.totalCapacityAh || 0,
        numModules: product.numModules || 0,
        cellsPerModule: product.cellsPerModule || 0,
        totalCells: product.totalCells || 0,
        module_configurations_json: product.moduleConfigurations || [],
        bmsModel: product.bmsModel || 'PACE 51.2V',
        bmsProtocol: normalizedProtocol || 'CAN_2_0B',
        bmsConfig: {
          required: product.bmsConfig?.required || true,
          model: product.bmsConfig?.model || 'PACE 51.2V',
          protocol: product.bmsConfig?.protocol === 'CAN_2.0B' ? 'CAN_2_0B' : (product.bmsConfig?.protocol || 'CAN_2_0B'),
          manufacturer: product.bmsConfig?.manufacturer,
        },
        bmuConfig: product.bmuConfig || { required: false },
        gradingRules: product.gradingRules || {
          minCapacityAh: 90,
          maxCapacityAh: 120,
          minOcvV: 3.2,
          maxOcvV: 3.4,
          maxIrMilliOhm: 1,
          maxDeltaCapacityPercent: 5,
          maxDeltaOcvMv: 5,
          maxDeltaIrMilliOhm: 0.5,
        },
        qcStages: product.qcStages || ['OCV_IR'],
        serialPrefix: product.serialPrefix || 'P2G-BP',
        active: product.active !== undefined ? product.active : true,
      })
      .select();
    if (error) throw error;
    return data?.[0] || {};
  },

  async deleteProduct(id: string): Promise<any> {
    const { error } = await supabase
      .from('product_templates')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // Suppliers
  async getSuppliers(): Promise<Supplier[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id,name,contact_email,status,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Imports
  async importSupplierCells(data: {
    filename: string;
    rows: any[];
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<{ summary: SupplierImportSummary; importedCount: number }> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const supplierName = data.rows.find(row => row.manufacturer_name)?.manufacturer_name || 'Unknown Supplier';
    const rpcRows = data.rows.map((row: any) => ({
      internal_serial: row.internal_serial || row.barcode || row.supplier_barcode,
      supplier_barcode: row.supplier_barcode || row.barcode || row.internal_serial,
      ocv: row.ocv ?? row.ocv_v,
      ir: row.ir ?? row.ri ?? row.ir_mohm,
      batch_number: row.batch_number || row.group || null,
      pallet_number: row.pallet_number || row.pallet || null,
      box_number: row.box_number || row.box || null,
    }));
    const chunkSize = 250;
    const results: any[] = [];
    for (let start = 0; start < rpcRows.length; start += chunkSize) {
      const { data: result, error } = await rawSupabase.rpc('import_supplier_cells_bulk', {
        p_filename: data.filename,
        p_supplier_name: supplierName,
        p_rows: rpcRows.slice(start, start + chunkSize),
      });
      if (error) throw error;
      results.push(toAppValue(result || {}) as any);
    }
    const mapped = results.reduce((summary, result) => ({
      total: summary.total + Number(result.total || 0),
      imported: summary.imported + Number(result.imported || result.importedCount || 0),
      duplicates: summary.duplicates + Number(result.duplicates || 0),
    }), { total: 0, imported: 0, duplicates: 0 });
    return {
      summary: {
        id: results[0]?.importId || `imp-${Date.now()}`,
        filename: data.filename,
        supplierId: '',
        supplierName,
        totalRows: mapped.total || data.rows.length,
        validRows: mapped.imported,
        duplicateRows: mapped.duplicates,
        invalidRows: 0,
        importedAt: new Date().toISOString(),
        importedBy: data.userId || '',
      },
      importedCount: mapped.imported,
    };
  },

  async getSupplierImports(): Promise<SupplierImportSummary[]> {
    const { data, error } = await supabase
      .from('supplier_imports')
      .select('*')
      .order('imported_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Inventory
  async bulkInitializeBatteryBatch(params: {
    rows: BulkBatteryRow[];
    productId?: string;
    controllerType?: 'BMS' | 'BMU';
    userId?: string;
  }): Promise<any> {
    const products = await this.getProducts();
    const product = params.productId
      ? products.find(candidate => candidate.id === params.productId)
      : products.find(candidate => Number(candidate.capacityKwh ?? 0) >= 7 && Number(candidate.capacityKwh ?? 0) <= 8)
        || products[0];

    if (!product) {
      throw new Error('No valid 7.5 kWh product template was found for bulk battery initialization.');
    }

    // Fetch all unallocated cells (no status restriction at DB level)
    const [allCells, availableBms, availableBmUs, batteriesResult] = await Promise.all([
      this.getCells({ limit: 10000 }),
      this.getBmsUnits(),
      this.getBmuUnits(),
      supabase.from('batteries').select('id'),
    ]);
    if (batteriesResult.error) throw batteriesResult.error;
    const activeBatteryIds = new Set((batteriesResult.data || []).map((battery: any) => battery.id));

    // Filter at application level: accept all cells except those that are definitely unavailable
    const filteredCells = allCells.filter(item => {
      const status = String(item.status ?? '').toUpperCase();
      const unavailableStatuses = ['QUARANTINED', 'REJECTED', 'MODULE_ASSIGNED'];
      const reservedForBatteryId = item.reservedForBatteryId ?? (item as any).reserved_for_battery_id;
      const reservedForOrderId = item.reservedForOrderId ?? (item as any).reserved_for_order_id;
      const assignedToModuleId = item.assignedToModuleId ?? (item as any).assigned_to_module_id;
      return !unavailableStatuses.includes(status)
        && !reservedForBatteryId
        && !reservedForOrderId
        && !assignedToModuleId;
    });

    const filteredBmUs = availableBmUs.filter(item => {
      const status = String(item.status ?? '').toUpperCase();
      const unavailableStatuses = ['QUARANTINED', 'FAILED', 'ARCHIVED'];
      const assignedToBatteryId = item.assignedToBatteryId ?? (item as any).reserved_for_battery_id;
      return !unavailableStatuses.includes(status)
        && (!assignedToBatteryId || !activeBatteryIds.has(assignedToBatteryId));
    });
    const filteredBms = availableBms.filter(item => {
      const status = String(item.status ?? '').toUpperCase();
      const unavailableStatuses = ['QUARANTINED', 'FAILED', 'ARCHIVED'];
      const assignedToBatteryId = (item as any).reservedForBatteryId ?? (item as any).reserved_for_battery_id;
      return !unavailableStatuses.includes(status)
        && (!assignedToBatteryId || !activeBatteryIds.has(assignedToBatteryId));
    });
    const hasExplicitCellMaps = params.rows.some(row => Array.isArray(row.cellQrCodes) && row.cellQrCodes.length > 0);
    const cellsForInitialization = hasExplicitCellMaps
      ? filteredCells
      : filteredCells.slice(0, product.totalCells * params.rows.length);

    return createBulkBatteryInitialization({
      rows: params.rows,
      products,
      productId: params.productId,
      controllerType: params.controllerType,
      availableBms: filteredBms.map(item => ({
        id: item.id,
        serialNumber: item.serialNumber,
        status: item.status,
        reservedForBatteryId: (item as any).reservedForBatteryId ?? (item as any).reserved_for_battery_id ?? null,
      })),
      availableBmUs: filteredBmUs.map(item => ({
        id: item.id,
        serialNumber: item.serialNumber,
        status: item.status,
        reservedForBatteryId: null,
      })),
      availableCells: cellsForInitialization.map(cell => ({
        id: cell.id,
        internalSerial: cell.internalSerial ?? (cell as any).internal_serial,
        supplierBarcode: cell.supplierBarcode ?? (cell as any).supplier_barcode,
        // BUG-11 fix: map qrCode so QR-code-based cell lookup works in resolveExplicitBatteryAssignments
        qrCode: (cell as any).qrCode ?? (cell as any).qr_code ?? cell.supplierBarcode ?? (cell as any).supplier_barcode,
        status: cell.status,
        reservedForBatteryId: cell.reservedForBatteryId ?? (cell as any).reserved_for_battery_id ?? null,
        reservedForOrderId: cell.reservedForOrderId ?? (cell as any).reserved_for_order_id ?? null,
        assignedToModuleId: cell.assignedToModuleId ?? (cell as any).assigned_to_module_id ?? null,
      })),
      userId: params.userId,
    });
  },

  async createBulkBatteryBatch(params: {
    batchPlan: any;
    userId?: string;
  }): Promise<{ productionOrderId: string; batteryCount: number; cellsAllocated: number; status: string }> {
    if (!params.batchPlan || !params.batchPlan.batteries || params.batchPlan.batteries.length === 0) {
      throw new Error('Invalid batch plan: no batteries to create.');
    }

    // Keep production order identifiers unique for concurrent imports.
    const productionOrderId = `PO-BULK-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const timestampSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date();
    const dayMonth = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const insertInBatches = async (table: string, rows: any[], batchSize = 500) => {
      for (let start = 0; start < rows.length; start += batchSize) {
        const { error } = await supabase.from(table).insert(rows.slice(start, start + batchSize));
        if (error) throw error;
      }
    };
    let createdBatteryIds: string[] = [];

    try {
      const productTemplate = params.batchPlan.template;
      const cellsPerModule = Math.max(1, Number(productTemplate?.cellsPerModule || productTemplate?.totalCells / Math.max(1, productTemplate?.numModules || 1)));
      const batteryPower = Number(productTemplate?.capacityKwh || 5).toString().replace(/\.0+$/, '');
      const serialPrefix = `P2G-BP-${batteryPower}KWH-${dayMonth}`;
      const existingSerialRows: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: serialPage, error: serialLookupError } = await supabase
          .from('batteries')
          .select('serial_number')
          .like('serial_number', `${serialPrefix}-%`)
          .range(offset, offset + 999);
        if (serialLookupError) throw new Error(`Failed to verify battery serials: ${serialLookupError.message}`);
        existingSerialRows.push(...(serialPage || []));
        if (!serialPage || serialPage.length < 1000) break;
      }
      const usedSerials = new Set(existingSerialRows.map((row: any) => String(row.serial_number).toUpperCase()));
      const batchSerials = new Set<string>();
      const plannedSerials = params.batchPlan.batteries.map((plan: any) => String(plan.batterySerial || '').trim().toUpperCase()).filter(Boolean);
      const duplicatePlannedSerials = plannedSerials.filter((serial: string, index: number) => plannedSerials.indexOf(serial) !== index);
      if (duplicatePlannedSerials.length > 0) {
        throw new Error(`Duplicate battery serials in batch plan: ${Array.from(new Set(duplicatePlannedSerials)).join(', ')}`);
      }
      let nextSerialNumber = Math.max(0, ...Array.from(usedSerials)
        .map(serial => Number(String(serial).match(/-(\d{4})$/)?.[1] || 0))) + 1;
      const uniqueBatchSerial = () => {
        let serial = `${serialPrefix}-${String(nextSerialNumber).padStart(4, '0')}`;
        while (usedSerials.has(serial) || batchSerials.has(serial)) {
          nextSerialNumber += 1;
          serial = `${serialPrefix}-${String(nextSerialNumber).padStart(4, '0')}`;
        }
        nextSerialNumber += 1;
        batchSerials.add(serial);
        usedSerials.add(serial);
        return serial;
      };
      const requestedBatchSerial = (value: unknown) => {
        const requestedNumber = String(value || '').match(/-(\d+)$/)?.[1];
        if (!requestedNumber) return uniqueBatchSerial();
        const serial = `${serialPrefix}-${String(Number(requestedNumber)).padStart(4, '0')}`;
        if (usedSerials.has(serial) || batchSerials.has(serial)) {
          throw new Error(`Battery serial ${serial} is already used. Change the Battery number in the uploaded file.`);
        }
        nextSerialNumber += 1;
        batchSerials.add(serial);
        usedSerials.add(serial);
        return serial;
      };

      const { data: orderData, error: orderError } = await supabase
        .from('production_orders')
        .insert({
          id: productionOrderId,
          order_number: productionOrderId,
          product_id: productTemplate?.id,
          target_quantity: params.batchPlan.batchSize,
          quantity_in_process: params.batchPlan.batchSize,
          status: 'IN_PROCESS',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .select()
        .single();

      if (orderError) {
        console.error('Production order creation failed:', orderError);
        throw new Error(`Failed to create production order: ${orderError.message}`);
      }

      const batteryInserts = params.batchPlan.batteries.map((plan: any, idx: number) => {
        const uniqueId = `bat-${timestampSuffix}-${String(idx + 1).padStart(6, '0')}`;
        // BUG-05 fix: use the serial from the batch plan (came from the Excel file), not a newly generated one
        const serial = requestedBatchSerial(plan.batterySerial);
        return {
          id: uniqueId,
          serial_number: serial,
          production_order_id: productionOrderId,
          product_id: productTemplate?.id,
          bms_id: plan.bms?.id || null,
          bmu_id: plan.bmu?.id || null,
          current_step: 'RELEASED',
          status: 'RELEASED',
          progress_percent: 100,
          step_results_json: JSON.stringify({
            bmuSerial: plan.bmu?.serialNumber,
            bmsSerial: plan.bms?.serialNumber,
            cellsAllocated: plan.cells.length,
            originalSerial: plan.batterySerial,
            uploadMode: 'AUTO_COMPLETED',
            finalQc: 'PASSED',
            releaseAt: now.toISOString(),
          }),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };
      });

      const batteriesData: any[] = [];
      for (let start = 0; start < batteryInserts.length; start += 500) {
        const { data, error } = await supabase
          .from('batteries')
          .insert(batteryInserts.slice(start, start + 500))
          .select();
        if (error) {
          console.error('Batteries creation failed:', error);
          throw new Error(`Failed to create batteries: ${error.message}`);
        }
        const insertedBatteries = data || [];
        batteriesData.push(...insertedBatteries);
        createdBatteryIds.push(...insertedBatteries.map((battery: any) => battery.id).filter(Boolean));
      }


      const moduleInserts: any[] = [];
      const moduleCellInserts: any[] = [];
      const moduleTestsInserts: any[] = [];
      let moduleSequence = 1;

      params.batchPlan.batteries.forEach((plan: any, batteryIndex: number) => {
        const battery = batteriesData?.[batteryIndex];
        if (!battery) return;

        console.log(
          `Battery ${batteryIndex + 1} (${battery.serial_number}): Total cells in plan = ${plan.cells.length}, ` +
          `Expected = ${productTemplate?.totalCells || 0}, Modules = ${productTemplate?.numModules || 0}, ` +
          `CellsPerModule = ${cellsPerModule}`
        );

        for (let moduleIndex = 0; moduleIndex < (productTemplate?.numModules || 0); moduleIndex += 1) {
          const start = moduleIndex * cellsPerModule;
          const end = start + cellsPerModule;
          const cellsSlice = plan.cells.slice(start, end);
          const moduleCellIds = cellsSlice.map((cell: any) => cell.id);

          // Check for problematic cells in the slice
          const nullCellIndices: number[] = [];
          const cellDetails: string[] = [];
          for (let i = 0; i < cellsSlice.length; i++) {
            const cell = cellsSlice[i];
            if (!cell || !cell.id) {
              nullCellIndices.push(i);
              cellDetails.push(`[${i}]: NULL/UNDEFINED`);
            } else {
              cellDetails.push(`[${i}]: id=${cell.id} qr=${cell.supplierBarcode || cell.internalSerial || 'unknown'}`);
            }
          }

          if (nullCellIndices.length > 0) {
            console.error(
              `⚠️  Battery ${battery.serial_number}, Module ${moduleIndex}: ` +
              `Found ${nullCellIndices.length} null/undefined cells at indices ${nullCellIndices.join(', ')}. ` +
              `Cells: ${cellDetails.join(' | ')}`
            );
          }

          // BUG-01 fix: declare moduleId BEFORE the console.log that uses it (was TDZ crash)
          const moduleId = `mod-${battery.id}-${moduleIndex}`;
          console.log(
            `Module ${moduleIndex} (${moduleId}): Slice[${start}:${end}] from ${plan.cells.length} = ${cellsSlice.length} cells. ` +
            `IDs before dedup: [${moduleCellIds.join(', ')}]`
          );
          const moduleSerial = `P2G-MOD-${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}-${timestampSuffix}-${String(moduleSequence).padStart(5, '0')}`;
          moduleSequence += 1;

          moduleInserts.push({
            id: moduleId,
            battery_id: battery.id,
            production_order_id: productionOrderId,
            module_index: moduleIndex,
            serial_number: moduleSerial,
            status: 'PASSED',
            lifecycle_status: 'IN_PACK',
            welding_result_json: {
              status: 'PASSED',
              weldedAt: now.toISOString(),
              operatorId: params.userId || 'SYSTEM',
              laserPowerWatts: 2800,
              weldTimeMs: 4200,
              pullForceKg: 18.5,
            },
            qc_result_json: {
              status: 'PASSED',
              physicalVisualOk: true,
              voltageQcOk: true,
              inspectedAt: now.toISOString(),
              inspectorId: params.userId || 'SYSTEM',
              notes: 'Auto-approved for uploaded batch',
            },
            matching_score: 100,
            matching_metrics: {
              avgCapacityAh: 0,
              deltaCapacityAh: 0,
              avgOcvV: 0,
              deltaOcvV: 0,
              avgIrMilliOhm: 0,
              deltaIrMilliOhm: 0,
            },
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          });

          const uniqueModuleCellIds = dedupeModuleCellAssignments<string>(moduleCellIds);
          if (uniqueModuleCellIds.length !== cellsPerModule) {
            throw new Error(
              `Module ${moduleId} (Battery ${battery.serial_number}, Module ${moduleIndex}) ` +
              `requires ${cellsPerModule} unique cells but received ${uniqueModuleCellIds.length}.`
            );
          } else {
            console.log(
              `✓ Module ${moduleId} (Battery ${battery.serial_number}, Module ${moduleIndex}): ${cellsPerModule} cells OK`
            );
          }
          uniqueModuleCellIds.forEach((cellId: string, slotIndex: number) => {
            moduleCellInserts.push({
              module_id: moduleId,
              cell_id: cellId,
              cell_slot_index: slotIndex,
              assigned_at: now.toISOString(),
            });
          });

          moduleTestsInserts.push(
            {
              id: `mtest-${moduleId}-weld`,
              module_id: moduleId,
              test_type: 'WELDING_INSPECTION',
              passed: true,
              result_json: { status: 'PASSED', mode: 'AUTO', checkedAt: now.toISOString(), checkedBy: params.userId || 'SYSTEM' },
              remarks: 'Auto-approved for uploaded batch',
              tested_by: params.userId || 'SYSTEM',
              tested_at: now.toISOString(),
            },
            {
              id: `mtest-${moduleId}-qc`,
              module_id: moduleId,
              test_type: 'QC',
              passed: true,
              result_json: { status: 'PASSED', mode: 'AUTO', checkedAt: now.toISOString(), checkedBy: params.userId || 'SYSTEM' },
              remarks: 'Auto-approved for uploaded batch',
              tested_by: params.userId || 'SYSTEM',
              tested_at: now.toISOString(),
            }
          );
        }
      });

      if (moduleInserts.length > 0) {
        try {
          await insertInBatches('modules', moduleInserts);
        } catch (error: any) {
          console.error('Modules creation failed:', error);
          throw new Error(`Failed to create modules: ${error.message}`);
        }
      }

      if (moduleCellInserts.length > 0) {
        console.log(
          `📦 Inserting ${moduleCellInserts.length} module-cell assignments across ${moduleInserts.length} modules. ` +
          `Expected: ${moduleInserts.length} modules × ${cellsPerModule} cells = ${moduleInserts.length * cellsPerModule}`
        );
        try {
          await insertInBatches('module_cells', moduleCellInserts);
        } catch (error: any) {
          console.error('❌ Module cell assignment failed:', error);
          console.error('First 5 inserts attempted:', moduleCellInserts.slice(0, 5));
          throw new Error(`Failed to assign cells to modules: ${error.message}`);
        }
        console.log(
          `✅ Successfully inserted ${moduleCellInserts.length} module-cell assignments`
        );
      }

      if (moduleTestsInserts.length > 0) {
        try {
          await insertInBatches('module_tests', moduleTestsInserts);
        } catch (error: any) {
          console.error('Module testing failed:', error);
          throw new Error(`Failed to record module tests: ${error.message}`);
        }
      }

      // Keep each request small enough for PostgREST URLs when importing large batches.
      const reservationBatchSize = 200;
      for (let batteryIndex = 0; batteryIndex < params.batchPlan.batteries.length; batteryIndex += 1) {
        const battery = batteriesData[batteryIndex];
        const reservationIds = Array.from(new Set(params.batchPlan.batteries[batteryIndex].cells.map((cell: any) => cell.id).filter(Boolean)));
        for (let start = 0; start < reservationIds.length; start += reservationBatchSize) {
          const batchIds = reservationIds.slice(start, start + reservationBatchSize);
          const { data: reservedRows, error: cellError } = await supabase
            .from('cells')
            .update({
              reserved_for_order_id: productionOrderId,
              reserved_for_battery_id: battery.id,
              lifecycle_status: 'IN_PACK',
              status: 'RESERVED',
              updated_at: now.toISOString(),
            })
            .in('id', batchIds)
            .is('reserved_for_order_id', null)
            .is('reserved_for_battery_id', null)
            .select('id');

          if (cellError) {
            throw new Error(`Failed to reserve cells for production order ${productionOrderId}: ${cellError.message}`);
          }
          if ((reservedRows || []).length !== batchIds.length) {
            throw new Error(`Cell allocation conflict: ${batchIds.length - (reservedRows || []).length} cell(s) were allocated by another operation.`);
          }
        }
      }

      if (batteriesData && batteriesData.length > 0) {
        const batteryTests = [];
        const bmsAssignments: Array<{ id: string; reserved_for_battery_id: string; status: string; updated_at: string }> = [];
        const bmuAssignments: Array<{ id: string; reserved_for_battery_id: string; status: string; updated_at: string }> = [];
        for (let i = 0; i < Math.min(batteriesData.length, params.batchPlan.batteries.length); i++) {
          const battery = batteriesData[i];
          const plan = params.batchPlan.batteries[i];

          if (plan.bms?.id) {
            bmsAssignments.push({ id: plan.bms.id, reserved_for_battery_id: battery.id, status: 'ASSIGNED', updated_at: now.toISOString() });
          }
          if (plan.bmu?.id) {
            bmuAssignments.push({ id: plan.bmu.id, reserved_for_battery_id: battery.id, status: 'ASSIGNED', updated_at: now.toISOString() });
          }

          batteryTests.push({
            id: `btest-${battery.id}`,
            battery_id: battery.id,
            test_type: 'EOL',
            passed: true,
            result_json: {
              status: 'PASSED',
              mode: 'AUTO',
              qcTesting: 'PASSED',
              batterySerial: plan.batterySerial,
              checkedAt: now.toISOString(),
              checkedBy: params.userId || 'SYSTEM',
            },
            tested_by: params.userId || 'SYSTEM',
            tested_at: now.toISOString(),
          });
        }
        for (const assignment of [...bmsAssignments, ...bmuAssignments]) {
          const { id, ...values } = assignment;
          const table = bmsAssignments.some(item => item.id === id) ? 'bms_units' : 'bmu_units';
          const { data: assignedRows, error } = await supabase.from(table)
            .update(values)
            .eq('id', id)
            .eq('status', 'AVAILABLE')
            .is('reserved_for_battery_id', null)
            .select('id');
          if (error) throw new Error(`Failed to assign controller '${id}': ${error.message}`);
          if (!assignedRows?.length) throw new Error(`Controller '${id}' is no longer available.`);
        }
        if (batteryTests.length > 0) await insertInBatches('battery_tests', batteryTests);
      }

      const { error: orderCompletionError } = await supabase
        .from('production_orders')
        .update({
          quantity_completed: params.batchPlan.batteries.length,
          quantity_in_process: 0,
          status: 'COMPLETED',
          updated_at: now.toISOString(),
        })
        .eq('id', productionOrderId);
      if (orderCompletionError) {
        throw new Error(`Failed to complete production order: ${orderCompletionError.message}`);
      }

      return {
        productionOrderId,
        batteryCount: params.batchPlan.batchSize,
        cellsAllocated: moduleCellInserts.length,
        status: 'RELEASED',
      };
    } catch (err: any) {
      console.error('Batch creation error:', err);
      try {
        if (createdBatteryIds.length > 0) {
          await supabase.from('bms_units')
            .update({ reserved_for_battery_id: null, status: 'AVAILABLE', updated_at: new Date().toISOString() })
            .in('reserved_for_battery_id', createdBatteryIds);
          await supabase.from('bmu_units')
            .update({ reserved_for_battery_id: null, status: 'AVAILABLE', updated_at: new Date().toISOString() })
            .in('reserved_for_battery_id', createdBatteryIds);
        }
        await supabase.from('cells')
          .update({ reserved_for_order_id: null, reserved_for_battery_id: null, status: 'AVAILABLE', lifecycle_status: 'FLOOR_STOCK', updated_at: new Date().toISOString() })
          .eq('reserved_for_order_id', productionOrderId);
        if (createdBatteryIds.length > 0) {
          await supabase.from('batteries').delete().in('id', createdBatteryIds);
        }
        await supabase.from('production_orders').delete().eq('id', productionOrderId);
      } catch (rollbackError) {
        console.error('Bulk creation rollback failed:', rollbackError);
      }
      throw err;
    }
  },

  async getCellCounts(): Promise<{ total: number; used: number; available: number; quarantined: number }> {
    const [totalResult, usedResult, availableResult, quarantinedResult] = await Promise.all([
      supabase.from('cells').select('id', { count: 'exact', head: true }),
      supabase.from('cells').select('id', { count: 'exact', head: true }).or('reserved_for_battery_id.not.is.null,reserved_for_order_id.not.is.null'),
      supabase.from('cells').select('id', { count: 'exact', head: true }).in('status', ['AVAILABLE', 'OCV_TESTED', 'GRADED', 'IMPORTED', 'ACKNOWLEDGED']).is('reserved_for_order_id', null).is('reserved_for_battery_id', null),
      supabase.from('cells').select('id', { count: 'exact', head: true }).eq('status', 'QUARANTINED'),
    ]);
    const failedResult = [totalResult, usedResult, availableResult, quarantinedResult].find(result => result.error);
    if (failedResult?.error) throw failedResult.error;
    return {
      total: totalResult.count || 0,
      used: usedResult.count || 0,
      available: availableResult.count || 0,
      quarantined: quarantinedResult.count || 0,
    };
  },

  async getCells(params?: { status?: string; lifecycleStatus?: string; search?: string; limit?: number; usedOnly?: boolean; fields?: string }): Promise<CellItem[]> {
    const pageSize = 1000;
    const requestedLimit = params?.limit && params.limit > 0 ? params.limit : undefined;
    const cells: CellItem[] = [];
    const seen = new Set<string>();
    let standaloneModuleCellIds: string[] | null = null;

    if (params?.lifecycleStatus === 'IN_MODULE' && rawSupabase) {
      const { data: assignments, error: assignmentsError } = await rawSupabase
        .from('module_cells')
        .select('cell_id,module:modules(battery_id)');
      if (assignmentsError) throw assignmentsError;
      standaloneModuleCellIds = (assignments || [])
        .filter((assignment: any) => !assignment.module?.battery_id)
        .map((assignment: any) => assignment.cell_id)
        .filter(Boolean);
    }

    for (let offset = 0; requestedLimit === undefined || cells.length < requestedLimit; offset += pageSize) {
      let query = params?.fields
        ? supabase.from('cells').select(params.fields)
        : supabase.from('cells').select('*, supplier:suppliers(name)');

      if (params?.status) {
        if (params.status === 'AVAILABLE') {
          query = query.in('status', ['AVAILABLE', 'IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED']);
        } else {
          query = query.eq('status', params.status);
        }
      }
      if (params?.lifecycleStatus && standaloneModuleCellIds === null) {
        query = query.eq('lifecycle_status', params.lifecycleStatus);
      }
      if (standaloneModuleCellIds !== null) {
        if (standaloneModuleCellIds.length === 0) break;
        query = query.in('id', standaloneModuleCellIds);
      }
      if (params?.usedOnly === true) {
        query = query.or('reserved_for_battery_id.not.is.null,reserved_for_order_id.not.is.null');
      }
      if (params?.search && typeof params.search === 'string') {
        const q = params.search.toLowerCase();
        query = query.or(`internal_serial.ilike.%${q}%,supplier_barcode.ilike.%${q}%,pallet_number.ilike.%${q}%,box_number.ilike.%${q}%`);
      }

      const end = requestedLimit === undefined
        ? offset + pageSize - 1
        : Math.min(offset + pageSize - 1, requestedLimit - 1);
      const { data, error } = await query.order('created_at', { ascending: false }).range(offset, end);
      if (error) throw error;
      const page = (data || []).map((cell: any) => ({
        ...cell,
        manufacturerName: cell.manufacturerName ?? cell.manufacturer_name ?? cell.supplier?.name ?? '',
        internalSerial: cell.internalSerial ?? cell.internal_serial,
        supplierBarcode: cell.supplierBarcode ?? cell.supplier_barcode,
        reservedForOrderId: cell.reservedForOrderId ?? cell.reserved_for_order_id,
        reservedForBatteryId: cell.reservedForBatteryId ?? cell.reserved_for_battery_id,
        assignedToModuleId: cell.assignedToModuleId ?? cell.assigned_to_module_id,
        lifecycleStatus: cell.lifecycleStatus ?? cell.lifecycle_status,
      })) as CellItem[];
      if (standaloneModuleCellIds !== null) {
        page.forEach(cell => { cell.lifecycleStatus = 'IN_MODULE'; });
      }
      for (const cell of page) {
        const key = String(cell.id || cell.internalSerial || cell.supplierBarcode || `${cell.palletNumber}-${cell.boxNumber}`);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        cells.push(cell);
      }
      if (page.length < pageSize) break;
    }

    const resultCells = requestedLimit === undefined ? cells : cells.slice(0, requestedLimit);
    if (params?.usedOnly === true && resultCells.length > 0 && rawSupabase) {
      const cellIds = resultCells.map(cell => cell.id).filter(Boolean);
      const { data: assignments } = await rawSupabase
        .from('module_cells')
        .select('cell_id,module_id,module:modules(battery_id)')
        .in('cell_id', cellIds);
      const batteryIds = Array.from(new Set([
        ...resultCells.map(cell => cell.reservedForBatteryId).filter(Boolean),
        ...(assignments || []).map((assignment: any) => assignment.module?.battery_id).filter(Boolean),
      ]));
      const { data: linkedBatteries } = batteryIds.length > 0
        ? await rawSupabase.from('batteries').select('id,status').in('id', batteryIds)
        : { data: [] as any[] };
      const batteryStatusById = new Map((linkedBatteries || []).map((battery: any) => [battery.id, battery.status]));
      const locationByCellId = new Map((assignments || []).map((assignment: any) => {
        const batteryId = assignment.module?.battery_id || null;
        return [assignment.cell_id, {
          moduleId: assignment.module_id,
          batteryId,
          batteryStatus: batteryId ? batteryStatusById.get(batteryId) : undefined,
        }];
      }));
      return resultCells.map(cell => {
        const location = locationByCellId.get(cell.id) || (cell.reservedForBatteryId ? {
          moduleId: undefined,
          batteryId: cell.reservedForBatteryId,
          batteryStatus: batteryStatusById.get(cell.reservedForBatteryId),
        } : undefined);
        return location
          ? { ...cell, assignedToModuleId: location.moduleId, reservedForBatteryId: cell.reservedForBatteryId || location.batteryId, assignedBatteryStatus: location.batteryStatus }
          : cell;
      });
    }
    return resultCells;
  },

  async createStandaloneModule(moduleType: '8S' | '12S', cellBarcodes: string[]): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const normalizedBarcodes = Array.from(new Set(cellBarcodes.map(value => value.trim()).filter(Boolean)));
    const { data, error } = await rawSupabase.rpc('create_standalone_module_transaction', {
      p_module_type: moduleType,
      p_cell_barcodes: normalizedBarcodes,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async replaceModuleCells(moduleId: string, cellBarcodes: string[]): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const normalizedBarcodes = Array.from(new Set(cellBarcodes.map(value => value.trim()).filter(Boolean)));
    const { data, error } = await rawSupabase.rpc('replace_module_cell_assignment_transaction', {
      p_module_id: moduleId,
      p_cell_barcodes: normalizedBarcodes,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async completeStandaloneModule(moduleId: string, acknowledged: boolean, cells: Array<{ cellId: string; ocvV: number; irMilliOhm: number; grade: string; damageCondition: 'GOOD' | 'DAMAGED'; damageRemarks?: string }>): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('complete_standalone_module_transaction', {
      p_module_id: moduleId,
      p_acknowledged: acknowledged,
      p_cells: cells.map(cell => ({
        cell_id: cell.cellId,
        ocv_v: cell.ocvV,
        ir_mohm: cell.irMilliOhm,
        grade: cell.grade,
        damage_condition: cell.damageCondition,
        damage_remarks: cell.damageRemarks || '',
      })),
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async getCellInventoryBuckets(): Promise<Array<{ cellId: string; bucket: 'AVAILABLE' | 'RESERVED' | 'IN_PROCESS' | 'DAMAGE'; batteryId?: string; moduleId?: string; reason?: string }>> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const [{ data: cells, error: cellsError }, { data: assignments, error: assignmentsError }, { data: quarantines, error: quarantineError }] = await Promise.all([
      rawSupabase.from('cells').select('id,status,lifecycle_status,reserved_for_order_id,reserved_for_battery_id'),
      rawSupabase.from('module_cells').select('cell_id,module_id,module:modules(battery_id)'),
      rawSupabase.from('quarantine_records').select('entity_id,reason').eq('entity_type', 'CELL').eq('status', 'OPEN'),
    ]);
    if (cellsError) throw cellsError;
    if (assignmentsError) throw assignmentsError;
    if (quarantineError) throw quarantineError;

    const assignmentByCell = new Map<string, { moduleId?: string; batteryId?: string }>();
    (assignments || []).forEach((assignment: any) => {
      assignmentByCell.set(assignment.cell_id, { moduleId: assignment.module_id, batteryId: assignment.module?.battery_id });
    });
    const quarantineByCell = new Map((quarantines || []).map((record: any) => [record.entity_id, record.reason]));
    return (cells || []).map((cell: any) => {
      const assignment = assignmentByCell.get(cell.id);
      const batteryId = cell.reserved_for_battery_id || assignment?.batteryId;
      const isDamage = quarantineByCell.has(cell.id) || ['SCRAP', 'QUARANTINED', 'REJECTED'].includes(String(cell.lifecycle_status || cell.status || '').toUpperCase());
      const isInProcess = Boolean(assignment?.moduleId) || ['IN_MODULE', 'IN_PACK', 'IN_RACK'].includes(String(cell.lifecycle_status || '').toUpperCase()) || ['IN_PROCESS', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED', 'ASSEMBLED'].includes(String(cell.status || '').toUpperCase());
      return {
        cellId: cell.id,
        bucket: isDamage ? 'DAMAGE' : cell.reserved_for_order_id || batteryId ? 'RESERVED' : isInProcess ? 'IN_PROCESS' : 'AVAILABLE',
        batteryId,
        moduleId: assignment?.moduleId,
        reason: quarantineByCell.get(cell.id),
      };
    });
  },

  async getBmsUnits(): Promise<BMSItem[]> {
    const [{ data, error }, { data: batteries, error: batteriesError }] = await Promise.all([
      supabase.from('bms_units').select('*').order('created_at', { ascending: false }),
      supabase.from('batteries').select('id, bmsId'),
    ]);
    if (error) throw error;
    if (batteriesError) throw batteriesError;
    const assignedBatteryByController = new Map<string, string>(
      (batteries || [])
        .filter((battery: any) => battery.bmsId)
        .map((battery: any) => [battery.bmsId, battery.id]),
    );
    return (data || []).map((bms: any) => {
      const assignedToBatteryId = bms.assignedToBatteryId
        || bms.reservedForBatteryId
        || bms.reserved_for_battery_id
        || assignedBatteryByController.get(bms.id);
      return assignedToBatteryId
        ? { ...bms, status: 'ASSIGNED', assignedToBatteryId }
        : bms;
    });
  },

  async createBmsBatch(params?: { count?: number; model?: string; supplier?: string; manufacturer?: string; batchNumber?: string; barcodePrefix?: string; serialNumbers?: string[] }): Promise<{ count: number; items: BMSItem[] }> {
    const count = (params?.count ?? 10);
    const model = params?.model || 'PACE-51.2V-100A-CAN';
    const supplier = params?.supplier || params?.manufacturer || 'Power2Go Verified';
    const protocol = 'CAN_2_0B';
    const created: BMSItem[] = [];
    const uniqueSerials = (params?.serialNumbers || [])
      .map(value => String(value).trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.findIndex(item => item.toUpperCase() === value.toUpperCase()) === index);
    const effectiveCount = uniqueSerials.length > 0 ? uniqueSerials.length : count;

    for (let i = 1; i <= effectiveCount; i++) {
      const nextNum = i;
      const serial = uniqueSerials[i - 1] || (params?.barcodePrefix ? `${params.barcodePrefix}-${String(nextNum).padStart(5, '0')}` : `P2G-BMS-${Date.now()}-${String(nextNum).padStart(4, '0')}`);
      const id = `bms-${crypto.randomUUID()}`;

      const { data, error } = await supabase.from('bms_units').insert({
        id,
        serialNumber: serial,
        model,
        supplier,
        manufacturer: params?.manufacturer || supplier,
        batchNumber: params?.batchNumber || 'UNSPECIFIED',
        firmwareVersion: 'v4.2.1-prod',
        hardwareVersion: 'HW-Rev3',
        protocol: protocol as any,
        status: 'AVAILABLE' as any,
        createdAt: new Date().toISOString(),
      }).select();
      if (error) throw error;
      created.push(data?.[0] || {});
    }

    return { count: effectiveCount, items: created };
  },

  async getBmuUnits(): Promise<BMUItem[]> {
    const [{ data, error }, { data: batteries, error: batteriesError }] = await Promise.all([
      supabase.from('bmu_units').select('*').order('created_at', { ascending: false }),
      supabase.from('batteries').select('id, bmuId'),
    ]);
    if (error) throw error;
    if (batteriesError) throw batteriesError;
    const assignedBatteryByController = new Map<string, string>(
      (batteries || [])
        .filter((battery: any) => battery.bmuId)
        .map((battery: any) => [battery.bmuId, battery.id]),
    );
    return (data || []).map((bmu: any) => {
      const assignedToBatteryId = bmu.assignedToBatteryId
        || bmu.reservedForBatteryId
        || bmu.reserved_for_battery_id
        || assignedBatteryByController.get(bmu.id);
      return assignedToBatteryId
        ? { ...bmu, status: 'ASSIGNED', assignedToBatteryId }
        : bmu;
    });
  },

  async createBmuBatch(params?: { count?: number; model?: string; manufacturer?: string; batchNumber?: string; barcodePrefix?: string; serialNumbers?: string[] }): Promise<{ count: number; items: BMUItem[] }> {
    const count = params?.count ?? 10;
    const model = params?.model || 'Power2Go BMU-X1';
    const manufacturer = params?.manufacturer || 'Power2Go';
    const created: BMUItem[] = [];
    const uniqueSerials = (params?.serialNumbers || [])
      .map(value => String(value).trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.findIndex(item => item.toUpperCase() === value.toUpperCase()) === index);
    const effectiveCount = uniqueSerials.length > 0 ? uniqueSerials.length : count;

    for (let i = 1; i <= effectiveCount; i++) {
      const serial = uniqueSerials[i - 1] || (params?.barcodePrefix ? `${params.barcodePrefix}-${String(i).padStart(5, '0')}` : `P2G-BMU-${Date.now()}-${String(i).padStart(4, '0')}`);
      const id = `bmu-${crypto.randomUUID()}`;
      const { data, error } = await supabase.from('bmu_units').insert({
        id,
        serialNumber: serial,
        model,
        manufacturer,
        batchNumber: params?.batchNumber || 'UNSPECIFIED',
        protocol: 'CAN',
        status: 'AVAILABLE' as any,
        createdAt: new Date().toISOString(),
      }).select();
      if (error) throw error;
      created.push(data?.[0] || {} as BMUItem);
    }

    return { count: effectiveCount, items: created };
  },

  async updateBms(id: string, update: { status?: string; model?: string; firmwareVersion?: string; hardwareVersion?: string; protocol?: string }): Promise<BMSItem> {
    const { data, error } = await supabase.from('bms_units').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteCell(id: string): Promise<void> {
    const { error } = await supabase.from('cells').delete().eq('id', id);
    if (error) throw error;
  },

  async deleteBms(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_controller_transaction', { p_controller_type: 'BMS', p_controller_id: id });
    if (error) throw error;
  },

  async updateBmu(id: string, update: { status?: string; model?: string; manufacturer?: string; protocol?: string }): Promise<BMUItem> {
    const { data, error } = await supabase.from('bmu_units').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBmu(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_controller_transaction', { p_controller_type: 'BMU', p_controller_id: id });
    if (error) throw error;
  },

  async getModules(): Promise<ModuleItem[]> {
    const { data, error } = await supabase.from('modules').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const modules = (data || []) as any[];
    console.log(`getModules: Loaded ${modules.length} modules`);
    const moduleIds = modules.map(module => module.id).filter(Boolean);
    if (moduleIds.length === 0) return modules;

    // Explicitly select with snake_case and map to camelCase
    const assignments = await loadModuleCellAssignments(moduleIds);

    console.log(`getModules: Loaded ${assignments?.length || 0} total cell assignments for ${moduleIds.length} modules`);

    const cellsByModule = new Map<string, any[]>();
    (assignments || []).forEach((assignment: any) => {
      if (!assignment) return;

      const moduleId = assignment.module_id || assignment.moduleId;
      if (!moduleId) {
        console.warn(`Assignment has no moduleId: ${JSON.stringify(assignment)}`);
        return;
      }

      const existing = cellsByModule.get(moduleId) || [];
      const deduped = hydrateModuleCells([...existing, assignment]);
      cellsByModule.set(moduleId, deduped);
    });

    const cellCounts = Array.from(cellsByModule.values()).map(cells => cells.length);
    const distribution = new Map<number, number>();
    cellCounts.forEach(count => {
      distribution.set(count, (distribution.get(count) || 0) + 1);
    });
    console.log(
      `getModules: Cell distribution per module: ${Array.from(distribution.entries())
        .map(([count, freq]) => `${freq} modules with ${count} cells`)
        .join(', ')}`
    );

    return modules.map(module => toAppValue({
      ...module,
      qr_code: module.qr_code || `${module.serial_number}|MODULE:${module.id}`,
      cells: cellsByModule.get(module.id) || [],
    })) as ModuleItem[];
  },

  async updateModule(id: string, update: { status?: string; matchingScore?: number }): Promise<ModuleItem> {
    const { data, error } = await supabase.from('modules').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async updateModuleWeldingStatus(id: string, status: 'PASSED' | 'FAILED'): Promise<ModuleItem> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase
      .from('modules')
      .update({ welding_result_json: { status, welded_at: new Date().toISOString() } })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as ModuleItem;
  },

  async deleteModule(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_module_transaction', { p_module_id: id });
    if (error) throw error;
  },

  async getBatteries(): Promise<BatteryUnit[]> {
    const batteries: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('batteries')
        .select('*')
        .range(offset, offset + pageSize - 1)
        .order('created_at', { ascending: false });
      if (error) throw error;
      batteries.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    const batteryIds = batteries.map(battery => battery.id).filter(Boolean);
    if (batteryIds.length === 0) return [];
    const [bmsResult, bmuResult] = await Promise.all([
      supabase.from('bms_units').select('*'),
      supabase.from('bmu_units').select('*'),
    ]);
    if (bmsResult.error) throw bmsResult.error;
    if (bmuResult.error) throw bmuResult.error;
    const bmsById = new Map((bmsResult.data || []).map((controller: any) => [controller.id, controller]));
    const bmuById = new Map((bmuResult.data || []).map((controller: any) => [controller.id, controller]));
    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .in('battery_id', batteryIds)
      .order('module_index', { ascending: true });
    if (modulesError) throw modulesError;
    const moduleIds = (modules || []).map((module: any) => module.id).filter(Boolean);
    const assignments = moduleIds.length ? await loadModuleCellAssignments(moduleIds) : [];

    const cellsByModule = new Map<string, any[]>();
    (assignments || []).forEach((assignment: any) => {
      if (!assignment) return;

      const moduleId = assignment.module_id || assignment.moduleId;
      if (!moduleId) return;

      const existing = cellsByModule.get(moduleId) || [];
      const deduped = hydrateModuleCells([...existing, assignment]);
      cellsByModule.set(moduleId, deduped);
    });
    const modulesByBattery = new Map<string, any[]>();
    (modules || []).forEach((module: any) => {
      const batteryId = module.battery_id || module.batteryId;
      const moduleId = module.id;
      const batteryModules = modulesByBattery.get(batteryId) || [];
      batteryModules.push({
        ...module,
        batteryId,
        moduleIndex: module.module_index ?? module.moduleIndex,
        serialNumber: module.serial_number ?? module.serialNumber,
        moduleType: module.module_type ?? module.moduleType,
        qrCode: module.qr_code || module.qrCode || `${module.serial_number || module.serialNumber}|MODULE:${moduleId}`,
        cells: cellsByModule.get(moduleId) || [],
      });
      modulesByBattery.set(batteryId, batteryModules);
    });
    return batteries.map(battery => {
      const normalized = normalizeBatteryRecord({
        ...battery,
        qrCode: battery.qrCode || battery.qr_code || `${battery.serial_number || battery.serialNumber || battery.id}|BATTERY:${battery.id}`,
        bms: bmsById.get(battery.bms_id || battery.bmsId),
        bmu: bmuById.get(battery.bmu_id || battery.bmuId),
        modules: modulesByBattery.get(battery.id) || [],
      });
      return {
        ...normalized,
        qrCode: normalized.qrCode || `${normalized.serialNumber}|BATTERY:${normalized.id}`,
        bms: normalized.bms,
        bmu: normalized.bmu,
        modules: normalized.modules || [],
      } as BatteryUnit;
    });
  },

  async getBatterySummaries(): Promise<Array<Pick<BatteryUnit, 'id' | 'serialNumber' | 'productName' | 'productionOrderId' | 'currentStep' | 'progressPercent' | 'status' | 'lifecycleStatus'> & { bmsId?: string; bmuId?: string; capacityKwh?: number }>> {
    const { data, error } = await supabase
      .from('batteries')
      .select('id,serial_number,production_order_id,current_step,progress_percent,status,lifecycle_status,bms_id,bmu_id,product_templates(name,capacity_kwh)')
      .range(0, 9999)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((battery: any) => ({
      id: battery.id,
      serialNumber: battery.serialNumber || battery.serial_number || battery.id,
      productName: battery.productTemplates?.name || battery.product_templates?.name || '',
      capacityKwh: Number(battery.productTemplates?.capacityKwh ?? battery.product_templates?.capacity_kwh ?? 0) || undefined,
      productionOrderId: battery.productionOrderId || battery.production_order_id,
      currentStep: battery.currentStep || battery.current_step,
      progressPercent: battery.progressPercent ?? battery.progress_percent,
      status: battery.status,
      lifecycleStatus: battery.lifecycleStatus || battery.lifecycle_status,
      bmsId: battery.bmsId || battery.bms_id,
      bmuId: battery.bmuId || battery.bmu_id,
    }));
  },

  async updateBattery(id: string, update: { status?: string; currentStep?: string; progressPercent?: number }): Promise<BatteryUnit> {
    const { data, error } = await supabase.from('batteries').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBattery(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');

    const { error: releaseError } = await supabase
      .from('bmu_units')
      .update({
        reserved_for_battery_id: null,
        status: 'AVAILABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('reserved_for_battery_id', id);

    if (releaseError) throw releaseError;

    const { error: releaseBmsError } = await supabase
      .from('bms_units')
      .update({
        reserved_for_battery_id: null,
        status: 'AVAILABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('reserved_for_battery_id', id);

    if (releaseBmsError) throw releaseBmsError;

    const { error: batteryResetError } = await supabase
      .from('batteries')
      .update({
        bmu_id: null,
        bms_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (batteryResetError) throw batteryResetError;

    const { error: deletionError } = await rawSupabase.rpc('delete_battery_cascade', { p_battery_id: id });
    if (deletionError) throw deletionError;
    return;
  },

  // Orders
  async getProductionOrders(): Promise<ProductionOrder[]> {
    const { data, error } = await supabase
      .from('production_orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createProductionOrder(data: {
    productId: string;
    quantity: number;
    orderNumber?: string;
    batterySerialBase?: string;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<{ order: ProductionOrder; batteryIds: string[] }> {
    if (!Number.isInteger(data.quantity) || data.quantity < 1) {
      throw new Error('Quantity must be a positive whole number');
    }
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data: transactionResult, error: transactionError } = await rawSupabase.rpc('create_production_order_transaction', {
      p_product_id: data.productId,
      p_quantity: data.quantity,
      p_order_number: data.orderNumber || null,
      p_battery_serial_prefix: data.batterySerialBase || null,
    });
    if (transactionError) throw transactionError;
    const mappedTransaction = toAppValue(transactionResult || {});
    return {
      order: mappedTransaction.order,
      batteryIds: mappedTransaction.batteryIds || [],
    };

    /*
    const product = await supabase.from('product_templates').select('*').eq('id', data.productId).maybeSingle();
    if (!product?.data) throw new Error('Product template not found');

    const prod = product.data;
    const requiredCells = prod.totalCells * data.quantity;
    const orderId = data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`;

    // Reserve cells from available inventory
    const { data: availableCells, error: cellsError } = await supabase
      .from('cells')
      .select('*')
      .eq('status', 'AVAILABLE')
      .limit(requiredCells);
    if (cellsError) throw cellsError;

    if ((availableCells?.length || 0) < requiredCells) {
      throw new Error('Insufficient cell inventory to start production order');
    }

    const batteryIds: string[] = [];

    const { error: initialOrderError } = await supabase.from('production_orders').insert({
      id: orderId,
      orderNumber: data.orderNumber || orderId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      quantityPlanned: data.quantity,
      quantityCompleted: 0,
      quantityInProcess: data.quantity,
      quantityFailed: 0,
      status: 'IN_PROCESS',
      requiredCells,
      availableCells: availableCells.length,
      reservedCells: 0,
      shortageCells: 0,
      requiredBms: 0,
      availableBms: 0,
      reservedBms: 0,
      shortageBms: 0,
      batteryIds: [],
      createdBy: data.userId || undefined,
    });
    if (initialOrderError) throw initialOrderError;

    for (let q = 0; q < data.quantity; q++) {
      const batId = `bat-${Date.now()}-${q}`;
      const batSerial = `${prod.serialPrefix}-${String(Date.now() + q + 1).padStart(6, '0')}`;
      batteryIds.push(batId);

      // Create modules based on product configuration
      const modules: any[] = [];
      for (let m = 0; m < prod.numModules; m++) {
        const modId = `mod-${Date.now()}-${q}-${m}`;
        const moduleSerial = `${prod.serialPrefix}-MOD-${Date.now()}-${q}-${m + 1}`;
        modules.push({
          id: modId,
          serialNumber: moduleSerial,
          qrCode: `${moduleSerial}|${prod.sku}|BATTERY:${batSerial}`,
          productId: prod.id,
          productionOrderId: orderId,
          batteryId: batId,
          moduleIndex: m,
          cells: [],
          matchingScore: 0,
          matchingMetrics: {
            avgCapacityAh: 0,
            deltaCapacityAh: 0,
            avgOcvV: 0,
            deltaOcvV: 0,
            avgIrMilliOhm: 0,
            deltaIrMilliOhm: 0,
          },
          status: 'IN_PROCESS',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Create battery record
      const { error: batteryError } = await supabase.from('batteries').insert({
        id: batId,
        serialNumber: batSerial,
        qrCode: `${batSerial}|${prod.sku}|IN_PROCESS`,
        productionOrderId: orderId,
        productId: prod.id,
        productName: prod.name,
        currentStep: 'CELL_IDENTIFICATION',
        progressPercent: 5,
        status: 'IN_PROCESS',
        modules,
        stepResults: {
          CELL_IDENTIFICATION: { stepName: 'Cell Identification & Verification', status: 'READY', mode: 'AUTO' },
          CELL_TESTING: { stepName: 'OCV & IR Testing', status: 'PENDING', mode: 'AUTO' },
          GRADING: { stepName: 'Automatic Cell Grading', status: 'PENDING', mode: 'AUTO' },
          CELL_MATCHING: { stepName: 'Module Cell Matching', status: 'PENDING', mode: 'AUTO' },
          MODULE_ASSEMBLY: { stepName: 'Module Assembly', status: 'PENDING', mode: 'MANUAL' },
          LASER_WELDING: { stepName: 'Laser Busbar Welding', status: 'PENDING', mode: 'AUTO' },
          MODULE_QC: { stepName: 'Module QC Inspection', status: 'PENDING', mode: 'MANUAL' },
          BATTERY_ASSEMBLY: { stepName: 'Battery Enclosure Assembly', status: 'PENDING', mode: 'MANUAL' },
          BMS_INTEGRATION: { stepName: 'BMS Harness & Comms Testing', status: 'PENDING', mode: 'AUTO' },
          FINAL_TESTING: { stepName: 'Pack High-Pot & Dyn Load Test', status: 'PENDING', mode: 'AUTO' },
          FINAL_QC: { stepName: 'Final Quality Release & Label', status: 'PENDING', mode: 'MANUAL' },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (batteryError) throw batteryError;

      const { error: moduleError } = await supabase.from('modules').insert(modules);
      if (moduleError) throw moduleError;

      // Reserve cells after the referenced battery exists.
      const reservedIds = (availableCells || [])
        .slice(q * prod.totalCells, (q + 1) * prod.totalCells)
        .map((c: any) => c.id);
      if (reservedIds.length > 0) {
        const { error: reservationError } = await supabase.from('cells').update({
          status: 'RESERVED',
          reservedForOrderId: orderId,
          reservedForBatteryId: batId,
          updatedAt: new Date().toISOString(),
        }).in('id', reservedIds);
        if (reservationError) throw reservationError;
      }
    }

    const { error: orderError } = await supabase.from('production_orders').update({
      reservedCells: requiredCells,
      batteryIds,
      updatedAt: new Date().toISOString(),
    }).eq('id', orderId);
    if (orderError) throw orderError;

    // Record audit
    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      userId: data.userId || 'usr-admin-01',
      userName: 'Administrator',
      userRole: 'admin',
      action: `Created Production Order ${data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`} for ${data.quantity}x ${prod.name} (Reserved ${requiredCells} cells)`,
      entityType: 'ORDER',
      entityId: orderId,
    });

    return {
      order: {
        id: orderId,
        orderNumber: data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`,
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        quantityPlanned: data.quantity,
        quantityCompleted: 0,
        quantityInProcess: data.quantity,
        quantityFailed: 0,
        status: 'IN_PROCESS',
        requiredCells,
        availableCells: availableCells?.length || 0,
        reservedCells: requiredCells,
        shortageCells: 0,
        requiredBms: 0,
        availableBms: 0,
        reservedBms: 0,
        shortageBms: 0,
        batteryIds,
        createdBy: data.userId || 'usr-admin-01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      batteryIds,
    };
    */
  },

  async createPackBatteryShell(productId: string, orderNumber: string): Promise<{ order: ProductionOrder; batteryIds: string[] }> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('create_pack_battery_shell_transaction', {
      p_product_id: productId,
      p_order_number: orderNumber,
    });
    if (error) throw error;
    const mapped = toAppValue(data || {});
    return { order: mapped.order, batteryIds: mapped.batteryIds || [] };
  },

  async cancelProductionOrder(id: string, reason?: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('cancel_production_order_transaction', {
      p_order_id: id,
      p_reason: reason || 'Cancelled by operator',
      p_user_id: userId || null,
    });
    if (error) {
      if (!error.message?.includes('cell_status') || !error.message?.includes('type text')) throw error;
      const { error: releaseError } = await supabase
        .from('cells')
        .update({ status: 'IMPORTED', lifecycleStatus: 'IN_STOCK', reservedForOrderId: null, updatedAt: new Date().toISOString() })
        .eq('reservedForOrderId', id)
        .is('reservedForBatteryId', null);
      if (releaseError) throw error;
      const { error: orderError } = await supabase
        .from('production_orders')
        .update({ status: 'CANCELLED', updatedAt: new Date().toISOString() })
        .eq('id', id);
      if (orderError) throw orderError;
    }
    return { success: true };
  },

  // Battery & Visual Builder
  async getBattery(id: string): Promise<{ battery: BatteryUnit; product: ProductTemplate; order: ProductionOrder }> {
    const { data: batteryRows, error: batteryError } = await supabase
      .from('batteries')
      .select('*')
      .eq('id', id)
      .limit(1);
    if (batteryError) throw batteryError;
    const battery = batteryRows?.[0] as any;
    if (!battery) throw new Error(`Battery '${id}' was not found in Supabase.`);

    const [{ data: product, error: productError }, { data: order, error: orderError }] = await Promise.all([
      supabase.from('product_templates').select('*').eq('id', battery.productId).limit(1),
      supabase.from('production_orders').select('*').eq('id', battery.productionOrderId).limit(1),
    ]);
    if (productError) throw productError;
    if (orderError) throw orderError;
    if (!product?.[0]) throw new Error('Product data is missing for this battery in Supabase.');
    let bms;
    let bmu;
    if (battery.bmsId) {
      const result = await supabase.from('bms_units').select('*').eq('id', battery.bmsId).maybeSingle();
      if (result.error) throw result.error;
      bms = result.data;
    }
    if (battery.bmuId) {
      const result = await supabase.from('bmu_units').select('*').eq('id', battery.bmuId).maybeSingle();
      if (result.error) throw result.error;
      bmu = result.data;
    }
    const { data: relationalModules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', id)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    battery.modules = relationalModules || [];
    const moduleIds = battery.modules.map((module: any) => module.id);
    if (moduleIds.length > 0) {
      const { data: assignments, error: assignmentError } = await supabase
        .from('module_cells')
        .select('moduleId, cellId, cellSlotIndex, cell:cells(*)')
        .in('moduleId', moduleIds)
        .order('cellSlotIndex', { ascending: true });
      if (assignmentError) throw assignmentError;
      const assignmentsByModule = new Map<string, any[]>();
      (assignments || []).forEach((assignment: any) => {
        const moduleId = assignment.moduleId || assignment.module_id;
        if (!moduleId) return;
        const cells = assignmentsByModule.get(moduleId) || [];
        assignmentsByModule.set(moduleId, hydrateModuleCells([...cells, assignment]));
      });
      battery.modules = battery.modules.map((module: any) => ({
        ...module,
        cells: assignmentsByModule.get(module.id) || hydrateModuleCells(module.cells || []),
      }));
    }

    return {
      battery: {
        ...battery,
        modules: Array.isArray(battery.modules) ? battery.modules : [],
        bms,
        bmu,
      },
      product: product[0],
      order: order?.[0],
    } as any;
  },

  async assignModuleToBattery(batteryId: string, moduleBarcode: string, moduleIndex: number): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('assign_module_to_battery_transaction', {
      p_battery_id: batteryId,
      p_module_barcode: moduleBarcode.trim(),
      p_module_index: moduleIndex,
    });
    if (!error) return toAppValue(data);

    const missingRpc = /schema cache|does not exist|could not find the function/i.test(error.message || '');
    if (!missingRpc) throw error;

    const barcode = moduleBarcode.trim();
    const lookups = [
      rawSupabase.from('modules').select('*').eq('id', barcode).maybeSingle(),
      rawSupabase.from('modules').select('*').ilike('serial_number', barcode).maybeSingle(),
    ];
    const lookupResults = await Promise.all(lookups);
    const lookupError = lookupResults.find(result => result.error)?.error;
    if (lookupError) throw lookupError;
    let module = lookupResults.map(result => result.data).find(Boolean) as any;
    if (!module) {
      const { data: qr, error: qrError } = await rawSupabase
        .from('qr_registry')
        .select('entity_id')
        .eq('entity_type', 'MODULE')
        .ilike('qr_code', barcode)
        .maybeSingle();
      if (qrError) throw qrError;
      if (qr?.entity_id) {
        const { data: qrModule, error: qrModuleError } = await rawSupabase.from('modules').select('*').eq('id', qr.entity_id).single();
        if (qrModuleError) throw qrModuleError;
        module = qrModule;
      }
    }
    if (!module) throw new Error(`Module '${moduleBarcode}' not found.`);
    if (module.battery_id && module.battery_id !== batteryId) throw new Error(`Module '${module.serial_number}' is already assigned to another battery.`);
    if (module.status !== 'PASSED') throw new Error(`Module '${module.serial_number}' is not complete. Complete module QC before pack assignment.`);
    if (module.battery_id === batteryId) return toAppValue({ success: true, module });

    const { data: placeholder, error: placeholderError } = await rawSupabase
      .from('modules')
      .select('id')
      .eq('battery_id', batteryId)
      .eq('module_index', moduleIndex)
      .neq('id', module.id)
      .maybeSingle();
    if (placeholderError) throw placeholderError;
    if (placeholder) {
      const { data: placeholderCells, error: placeholderCellsError } = await rawSupabase.from('module_cells').select('cell_id').eq('module_id', placeholder.id);
      if (placeholderCellsError) throw placeholderCellsError;
      if ((placeholderCells || []).length > 0) throw new Error(`Battery module slot ${moduleIndex} is already occupied.`);
      const { error: deletePlaceholderError } = await rawSupabase.from('modules').delete().eq('id', placeholder.id);
      if (deletePlaceholderError) throw deletePlaceholderError;
    }

    const { data: battery, error: batteryError } = await rawSupabase.from('batteries').select('production_order_id').eq('id', batteryId).single();
    if (batteryError) throw batteryError;
    const { error: moduleUpdateError } = await rawSupabase.from('modules').update({
      battery_id: batteryId,
      production_order_id: battery.production_order_id,
      module_index: moduleIndex,
      lifecycle_status: 'IN_PACK',
      updated_at: new Date().toISOString(),
    }).eq('id', module.id);
    if (moduleUpdateError) throw moduleUpdateError;
    const { data: moduleCells, error: moduleCellsError } = await rawSupabase.from('module_cells').select('cell_id').eq('module_id', module.id);
    if (moduleCellsError) throw moduleCellsError;
    const cellIds = (moduleCells || []).map((cell: any) => cell.cell_id).filter(Boolean);
    if (cellIds.length > 0) {
      const { error: cellUpdateError } = await rawSupabase.from('cells').update({
        reserved_for_battery_id: batteryId,
        lifecycle_status: 'IN_PACK',
        updated_at: new Date().toISOString(),
      }).in('id', cellIds);
      if (cellUpdateError) throw cellUpdateError;
    }
    return toAppValue({ success: true, module: { ...module, battery_id: batteryId, production_order_id: battery.production_order_id, module_index: moduleIndex, lifecycle_status: 'IN_PACK' } });
  },

  async scanComponent(batteryId: string, data: {
    barcode: string;
    slotType: 'CELL' | 'BMS' | 'BMU';
    moduleIndex?: number;
    cellSlotIndex?: number;
    userId?: string; cellId?: string; grade?: string; remarks?: string; manufacturer?: string; batchNumber?: string;
  }): Promise<any> {
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;
    const prod = battery.product;

    if (data.slotType === 'BMS') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const lookupValue = data.barcode.trim();
      const { data: bmsById, error: bmsIdLookupError } = await supabase
        .from('bms_units')
        .select('id, serialNumber, status, reservedForBatteryId')
        .eq('id', lookupValue)
        .maybeSingle();
      if (bmsIdLookupError) throw bmsIdLookupError;
      let bmsRecord = bmsById;
      if (!bmsRecord) {
        const { data: bmsBySerial, error: bmsSerialLookupError } = await supabase
          .from('bms_units')
          .select('id, serialNumber, status, reservedForBatteryId')
          .ilike('serialNumber', lookupValue)
          .maybeSingle();
        if (bmsSerialLookupError) throw bmsSerialLookupError;
        bmsRecord = bmsBySerial;
      }
      if (!bmsRecord) {
        throw new Error(`BMS '${lookupValue}' was not found in the current BMS inventory.`);
      }
      if (bmsRecord.status === 'QUARANTINED' || bmsRecord.status === 'FAILED' || bmsRecord.status === 'ARCHIVED') {
        throw new Error(`BMS '${bmsRecord.serialNumber}' is not available for assignment (${bmsRecord.status}).`);
      }
      const bmsAssignedBatteryId = bmsRecord.assignedToBatteryId || bmsRecord.reservedForBatteryId;
      if (bmsAssignedBatteryId && bmsAssignedBatteryId !== batteryId) {
        throw new Error(`BMS '${bmsRecord.serialNumber}' is already assigned to another battery.`);
      }
      const { data: result, error } = await rawSupabase.rpc('assign_controller_transaction', {
        p_battery_id: batteryId,
        p_controller_type: 'BMS',
        p_controller_id: bmsRecord.id,
        p_metadata: { manufacturer: data.manufacturer, batchNumber: data.batchNumber },
      });
      if (error) throw error;
      return toAppValue(result);

      /*
      const { data: existingBms, error: bmsError } = await supabase
        .from('bms_units')
        .select('*')
        .or(`serialNumber.eq.${data.barcode},id.eq.${data.barcode}`)
        .maybeSingle();

      if (bmsError) throw bmsError;

      if (existingBms) {
        const bms = existingBms;
        if (bms.assignedToBatteryId && bms.assignedToBatteryId !== batteryId) {
          throw new Error(`BMS ${bms.serialNumber} is already assembled in Battery ${bms.assignedToBatteryId}`);
        }
        if (bms.status === 'QUARANTINED') {
          throw new Error(`BMS ${bms.serialNumber} is in QUARANTINE: ${bms.quarantineReason || 'Failed test'}`);
        }
        const { error: linkError } = await supabase.from('bms_units').update({
          assignedToBatteryId: batteryId,
          status: 'IN_PROCESS',
          manufacturer: data.manufacturer,
          batchNumber: data.batchNumber,
          updatedAt: new Date().toISOString(),
        }).eq('id', bms.id);
        if (linkError) throw linkError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmsId: bms.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMS', item: bms };
      } else {
        const { data: newBms, error: newBmsError } = await supabase.from('bms_units').insert({
          id: `bms-${Date.now()}`,
          serialNumber: data.barcode,
          model: prod?.bmsConfig?.model || 'PACE 51.2V',
          supplier: prod?.bmsConfig?.manufacturer || 'Power2Go Verified',
          firmwareVersion: 'v1.2.0',
          hardwareVersion: 'v2.0',
          protocol: prod?.bmsConfig?.protocol || 'CAN_2_0B',
          status: 'IN_PROCESS',
          assignedToBatteryId: batteryId,
          manufacturer: data.manufacturer || prod?.bmsConfig?.manufacturer || 'Power2Go Verified',
          batchNumber: data.batchNumber,
          createdAt: new Date().toISOString(),
        }).select();
        if (newBmsError) throw newBmsError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmsId: newBms?.[0]?.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMS', item: newBms?.[0] };
      }
      */
    }

    if (data.slotType === 'BMU') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const lookupValue = data.barcode.trim();
      const { data: bmuById, error: bmuIdLookupError } = await supabase
        .from('bmu_units')
        .select('id, serialNumber, status, reservedForBatteryId')
        .eq('id', lookupValue)
        .maybeSingle();
      if (bmuIdLookupError) throw bmuIdLookupError;
      let bmuRecord = bmuById;
      if (!bmuRecord) {
        const { data: bmuBySerial, error: bmuSerialLookupError } = await supabase
          .from('bmu_units')
          .select('id, serialNumber, status, reservedForBatteryId')
          .ilike('serialNumber', lookupValue)
          .maybeSingle();
        if (bmuSerialLookupError) throw bmuSerialLookupError;
        bmuRecord = bmuBySerial;
      }
      if (!bmuRecord) {
        throw new Error(`BMU '${lookupValue}' was not found in the current BMU inventory.`);
      }
      if (bmuRecord.status === 'QUARANTINED' || bmuRecord.status === 'FAILED' || bmuRecord.status === 'ARCHIVED') {
        throw new Error(`BMU '${bmuRecord.serialNumber}' is not available for assignment (${bmuRecord.status}).`);
      }
      const bmuAssignedBatteryId = bmuRecord.assignedToBatteryId || bmuRecord.reservedForBatteryId;
      if (bmuAssignedBatteryId && bmuAssignedBatteryId !== batteryId) {
        throw new Error(`BMU '${bmuRecord.serialNumber}' is already assigned to another battery.`);
      }
      const { data: result, error } = await rawSupabase.rpc('assign_controller_transaction', {
        p_battery_id: batteryId,
        p_controller_type: 'BMU',
        p_controller_id: bmuRecord.id,
        p_metadata: { manufacturer: data.manufacturer, batchNumber: data.batchNumber },
      });
      if (error) throw error;
      return toAppValue(result);

      /*
      const { data: existingBmu, error: bmuError } = await supabase
        .from('bmu_units')
        .select('*')
        .or(`serialNumber.eq.${data.barcode},id.eq.${data.barcode}`)
        .maybeSingle();

      if (bmuError) throw bmuError;

      if (existingBmu) {
        const bmu = existingBmu;
        if (bmu.assignedToBatteryId && bmu.assignedToBatteryId !== batteryId) {
          throw new Error(`BMU ${bmu.serialNumber} is already assembled in Battery ${bmu.assignedToBatteryId}`);
        }
        if (bmu.status === 'QUARANTINED') {
          throw new Error(`BMU ${bmu.serialNumber} is in QUARANTINE: ${bmu.quarantineReason || 'Failed test'}`);
        }
        const { error: bmuLinkError } = await supabase.from('bmu_units').update({
          assignedToBatteryId: batteryId,
          status: 'IN_PROCESS',
          manufacturer: data.manufacturer,
          batchNumber: data.batchNumber,
          updatedAt: new Date().toISOString(),
        }).eq('id', bmu.id);
        if (bmuLinkError) throw bmuLinkError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmuId: bmu.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMU', item: bmu };
      } else {
        const { data: newBmu, error: newBmuError } = await supabase.from('bmu_units').insert({
          id: `bmu-${Date.now()}`,
          serialNumber: data.barcode,
          model: prod?.bmuConfig?.model || 'Power2Go BMU-X1',
          manufacturer: data.manufacturer || prod?.bmuConfig?.manufacturer || 'Power2Go',
          protocol: prod?.bmuConfig?.protocol || 'CAN',
          status: 'IN_PROCESS',
          assignedToBatteryId: batteryId,
          batchNumber: data.batchNumber,
          createdAt: new Date().toISOString(),
        }).select();
        if (newBmuError) throw newBmuError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmuId: newBmu?.[0]?.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMU', item: newBmu?.[0] };
      }
      */
    }

    // CELL Scanning
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('battery_id', batteryId)
      .order('module_index', { ascending: true });
    if (modulesError) throw modulesError;
    const targetModuleIndex = data.moduleIndex || 0;
    const targetModule = (modules || []).find((module: any) => module.moduleIndex === targetModuleIndex);
    if (!targetModule) {
      throw new Error(`Module index ${targetModuleIndex} out of range`);
    }
    const { data: result, error } = await rawSupabase.rpc('assign_cell_transaction', {
      p_battery_id: batteryId,
      p_cell_barcode: data.barcode,
      p_module_index: targetModuleIndex,
      p_cell_slot_index: data.cellSlotIndex,
      p_user_id: data.userId || null,
    });
    if (error) throw error;
    
    // Return updated battery
    return { success: true, itemType: 'CELL', battery: toAppValue(result) };
  },

  async replaceController(batteryId: string, controllerType: 'BMS' | 'BMU', controllerId: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('replace_controller_transaction', {
      p_battery_id: batteryId,
      p_controller_type: controllerType,
      p_controller_id: controllerId,
      p_user_id: userId || null,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async moveCell(batteryId: string, sourceModuleIndex: number, sourceCellSlotIndex: number, targetModuleIndex: number, targetCellSlotIndex: number, explicitCellId?: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');

    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', batteryId)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;

    const moduleIds = (modules || []).map((module: any) => module.id);
    const { data: assignments, error: assignmentError } = moduleIds.length > 0
      ? await supabase
          .from('module_cells')
          .select('module_id, cell_id, cell_slot_index')
          .in('module_id', moduleIds)
          .order('cell_slot_index', { ascending: true })
      : { data: [], error: null };
    if (assignmentError) throw assignmentError;

    const sourceModule = (modules || []).find((module: any) => module.module_index === sourceModuleIndex);
    const targetModule = (modules || []).find((module: any) => module.module_index === targetModuleIndex);

    const sourceAssignment = explicitCellId
      ? (assignments || []).find((assignment: any) => assignment.cell_id === explicitCellId)
      : (assignments || []).find((assignment: any) => assignment.module_id === sourceModule?.id && assignment.cell_slot_index === sourceCellSlotIndex);

    if (!sourceModule || !targetModule || !sourceAssignment) {
      throw new Error('The selected cell or target module does not exist.');
    }

    const { error: moveError } = await rawSupabase.rpc('move_cell_transaction', {
      p_battery_id: batteryId,
      p_cell_id: sourceAssignment.cell_id,
      p_target_module_id: targetModule.id,
      p_target_slot: targetCellSlotIndex,
    });
    if (moveError) throw moveError;
    return;

    /*
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('modules')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;

    const modules = Array.isArray(battery.modules) ? battery.modules.map((module: any) => ({
      ...module,
      cells: Array.isArray(module.cells) ? [...module.cells] : [],
    })) : [];
    const sourceModule = modules.find((module: any) => module.moduleIndex === sourceModuleIndex);
    const targetModule = modules.find((module: any) => module.moduleIndex === targetModuleIndex);
    if (!sourceModule || !targetModule) throw new Error('The selected module does not exist.');
    if (sourceModuleIndex === targetModuleIndex && sourceCellSlotIndex === targetCellSlotIndex) {
      throw new Error('Choose a different destination slot.');
    }
    if (targetModule.cells.some((cell: any) => cell.moduleSlotIndex === targetCellSlotIndex)) {
      throw new Error('The destination slot is already occupied.');
    }

    const sourceCellIndex = sourceModule.cells.findIndex((cell: any) => cell.moduleSlotIndex === sourceCellSlotIndex);
    if (sourceCellIndex < 0) throw new Error('The source slot is empty.');
    const [cell] = sourceModule.cells.splice(sourceCellIndex, 1);
    const movedCell = { ...cell, assignedToModuleId: targetModule.id, moduleSlotIndex: targetCellSlotIndex };
    targetModule.cells.push(movedCell);

    const { error: cellError } = await supabase.from('cells').update({
      assignedToModuleId: targetModule.id,
      moduleSlotIndex: targetCellSlotIndex,
      updatedAt: new Date().toISOString(),
    }).eq('id', cell.id);
    if (cellError) throw cellError;

    const { error: normalizedMoveError } = await supabase.from('module_cells').delete()
      .eq('cell_id', cell.id);
    if (normalizedMoveError) throw normalizedMoveError;
    const { error: normalizedMoveInsertError } = await supabase.from('module_cells').insert({
      moduleId: targetModule.id,
      cellId: cell.id,
      cellSlotIndex: targetCellSlotIndex,
    });
    if (normalizedMoveInsertError) throw normalizedMoveInsertError;

    for (const module of [sourceModule, targetModule]) {
      const { error } = await supabase.from('modules').update({ cells: module.cells, updatedAt: new Date().toISOString() }).eq('id', module.id);
      if (error) throw error;
    }

    const { error: batteryUpdateError } = await supabase.from('batteries').update({
      modules,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (batteryUpdateError) throw batteryUpdateError;
    */
  },

  async autoMatchCells(batteryId: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('auto_match_cells_transaction', {
      p_battery_id: batteryId,
      p_user_id: userId || null,
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /* LEGACY IMPLEMENTATION — REPLACED BY RPC
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;
    const prod = battery.product;

    // Gather candidate cells assigned to this battery
    const { data: candidateCells, error: candidatesError } = await supabase
      .from('cells')
      .select('*')
      .eq('reservedForBatteryId', batteryId)
      .or('status.eq.AVAILABLE,status.eq.RESERVED,status.eq.VALIDATING,status.eq.PASSED')
      .order('supplierCapacityAh', { ascending: false });
    if (candidatesError) throw candidatesError;

    for (let m = 0; m < battery.modules.length; m++) {
      const mod = battery.modules[m];
      const requiredCount = prod?.cellsPerModule || 8;

      // Simple cell matching - sort by capacity and take first N
      const validCells = (candidateCells || []).filter((c: any) =>
        ['AVAILABLE', 'RESERVED', 'VALIDATING', 'PASSED'].includes(c.status)
      );
      const sortedCells = validCells.sort((a: any, b: any) => (b.supplierCapacityAh || 108) - (a.supplierCapacityAh || 108));

      const matched = sortedCells.slice(0, requiredCount);
      if (matched.length < requiredCount) {
        throw new Error(`Could not match ${requiredCount} cells for Module ${m + 1}. Need ${requiredCount} cells.`);
      }

      // Update module cells
      const moduleCellUpdates = matched.map((c: any, idx: number) => ({
        id: c.id,
        moduleSlotIndex: idx,
      }));

      const { error: moduleError } = await supabase.from('modules').update({
        cells: matched.map((c: any) => ({
          ...c,
          moduleSlotIndex: matched.indexOf(c),
          status: 'ASSEMBLED',
          assignedToModuleId: mod.id,
        })),
        matchingScore: 85,
        matchingMetrics: {
          avgCapacityAh: Number((matched.map((c: any) => c.supplierCapacityAh || 108).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaCapacityAh: Number((Math.max(...matched.map((c: any) => c.supplierCapacityAh || 108)) - Math.min(...matched.map((c: any) => c.supplierCapacityAh || 108))).toFixed(1)),
          avgOcvV: Number((matched.map((c: any) => c.supplierOcvV || 3.30).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaOcvV: Number((Math.max(...matched.map((c: any) => c.supplierOcvV || 3.30)) - Math.min(...matched.map((c: any) => c.supplierOcvV || 3.30))).toFixed(4)),
          avgIrMilliOhm: Number((matched.map((c: any) => c.supplierIrMilliOhm || 0.25).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaIrMilliOhm: Number((Math.max(...matched.map((c: any) => c.supplierIrMilliOhm || 0.25)) - Math.min(...matched.map((c: any) => c.supplierIrMilliOhm || 0.25))).toFixed(1)),
        },
        status: 'IN_PROCESS',
        updatedAt: new Date().toISOString(),
      }).eq('id', mod.id);
      if (moduleError) throw moduleError;

      // Update cell assignments
      const { error: cellError } = await supabase.from('cells').update({
        status: 'ASSEMBLED',
        assignedToModuleId: mod.id,
      }).in('id', matched.map((c: any) => c.id));
      if (cellError) throw cellError;

      const { error: assignmentError } = await supabase.from('module_cells').upsert(
        matched.map((c: any, index: number) => ({
          moduleId: mod.id,
          cellId: c.id,
          cellSlotIndex: index,
          assignedBy: userId,
        })),
        { onConflict: 'module_id,cell_slot_index' },
      );
      if (assignmentError) throw assignmentError;
    }

    // Update battery step results
    const avgScore = battery.modules.reduce((s: number, m: any) => s + (m.matchingScore || 0), 0) / battery.modules.length;
    await supabase.from('batteries').update({
      stepResults: {
        CELL_MATCHING: {
          stepName: 'Module Cell Matching',
          status: 'PASSED',
          mode: 'AUTO',
          completedAt: new Date().toISOString(),
          completedBy: userId,
          details: `All ${battery.modules.length} modules matched with average score ${avgScore.toFixed(1)}%`,
        },
        MODULE_ASSEMBLY: {
          stepName: 'Module Assembly',
          status: 'READY',
          mode: 'MANUAL',
        },
      },
      currentStep: 'MODULE_ASSEMBLY',
      progressPercent: 40,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);

    return {
      success: true,
      battery,
      modules: battery.modules,
    };
    */
  },

  async executeStep(batteryId: string, stepKey: string, payload: {
    mode: 'AUTO' | 'MANUAL' | 'BYPASS';
    reuseSupplierData?: boolean;
    manualValues?: any;
    bypassReason?: string;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<any> {
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;

    const { error: batteryUpdateError } = await supabase.from('batteries').update({
      stepResults: {
        ...(battery.stepResults || {}),
        [stepKey]: {
          stepName: stepKey.replace(/_/g, ' '),
          status: payload.mode === 'AUTO' ? 'PASSED' : payload.mode === 'BYPASS' ? 'BYPASSED' : 'PENDING',
          mode: payload.mode,
          completedAt: new Date().toISOString(),
          completedBy: payload.userId,
          details: payload.remarks || `Step ${stepKey} executed`,
        },
      },
      currentStep: stepKey,
      progressPercent: payload.mode === 'AUTO' ? 50 : 30,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (batteryUpdateError) throw batteryUpdateError;

    return { success: true, battery };
  },

  async bulkSaveCellOcvIr(batteryId: string, measurements: { cellId: string; productionOcvV: number; productionIrMilliOhm: number }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: measurements.map(measurement => ({
        cell_id: measurement.cellId,
        production_ocv_v: measurement.productionOcvV,
        production_ir_mohm: measurement.productionIrMilliOhm,
        id: `ctest-${crypto.randomUUID()}`,
      })),
      p_test_type: 'OCV_IR',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveCellGrading(batteryId: string, grades: { cellId: string; grade: string; remarks?: string }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: grades.map(test => ({
        id: `ctest-${crypto.randomUUID()}`,
        cell_id: test.cellId,
        grade: test.grade,
        remarks: test.remarks,
      })),
      p_test_type: 'GRADING',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveDamageHistory(batteryId: string, items: { cellId: string; condition: string; remarks?: string; imageUri?: string }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: items.map(item => ({
        cell_id: item.cellId,
        condition: item.condition,
        remarks: item.remarks,
        image_uri: item.imageUri,
      })),
      p_test_type: 'DAMAGE',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveModuleWorkflow(batteryId: string, modules: any[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: modules.map(module => ({
        module_id: module.moduleId || module.id,
        status: module.status,
        welding_status: module.weldingStatus,
        physical_visual_ok: module.physicalVisualOk,
        voltage_qc_ok: module.voltageQcOk,
        notes: module.notes,
      })),
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    for (const mod of modules) {
      const { error } = await supabase.from('modules').update({
        status: mod.status || 'IN_PROCESS',
        weldingResult: mod.weldingResult || null,
        qcResult: mod.qcResult || null,
        updatedAt: new Date().toISOString(),
      }).eq('id', mod.id).eq('batteryId', batteryId);
      if (error) throw error;
    }
    return { success: true };
    */
  },

  async weldModule(batteryId: string, moduleId: string, payload: {
    mode?: 'AUTO' | 'MANUAL' | 'BYPASS';
    machineId?: string;
    manualParams?: any;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await (rawSupabase as any).rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: [{ moduleId, weldingStatus: payload.mode === 'BYPASS' ? 'BYPASSED' : 'PASSED', physicalVisualOk: true, voltageQcOk: true, ...payload.manualParams, notes: payload.remarks }],
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data), weldResult: toAppValue(data) };

    /*
    const weldResult = {
      status: payload.mode || 'PASSED',
      machineId: payload.machineId || 'MANUAL_OVERRIDE',
      laserPowerWatts: payload.manualParams?.laserPowerWatts || 2800,
      weldTimeMs: payload.manualParams?.weldTimeMs || 4200,
      pullForceKg: payload.manualParams?.pullForceKg || 18.2,
      weldedAt: new Date().toISOString(),
      operatorId: payload.userId,
    };

    const { error } = await supabase.from('modules').update({
      weldingResult: weldResult,
      updatedAt: new Date().toISOString(),
    }).eq('id', moduleId);
    if (error) throw error;

    return { success: true, weldResult };
    */
  },

  async qcModule(batteryId: string, moduleId: string, payload: any): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await (rawSupabase as any).rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: [{ moduleId, weldingStatus: 'PASSED', physicalVisualOk: payload.physicalVisualOk ?? true, voltageQcOk: payload.voltageQcOk ?? payload.status === 'PASSED', notes: payload.notes }],
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { error } = await supabase.from('modules').update({
      qcResult: payload,
      updatedAt: new Date().toISOString(),
    }).eq('id', moduleId);
    if (error) throw error;
    return { success: true };
    */
  },

  async testBms(batteryId: string, payload: { mode?: 'AUTO' | 'MANUAL'; machineId?: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_controller_test_transaction', {
      p_battery_id: batteryId,
      p_controller_type: 'BMS',
      p_result: { status: 'PASSED', mode: payload.mode || 'MANUAL', machineId: payload.machineId },
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { error } = await supabase.from('batteries').update({
      stepResults: {
        ...(payload.mode === 'AUTO' ? { BMS_INTEGRATION: { stepName: 'BMS Harness & Comms Testing', status: 'PASSED', mode: 'AUTO' } } : {}),
      },
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (error) throw error;
    return { success: true };
    */
  },

  async finalTest(batteryId: string, payload: { mode?: 'AUTO' | 'MANUAL'; machineId?: string; userId?: string; cellId?: string; grade?: string; remarks?: string; manualValues?: any }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_battery_test_transaction', {
      p_battery_id: batteryId,
      p_result: {
        ...(payload.manualValues || {}),
        mode: payload.mode || 'MANUAL',
        machineId: payload.machineId,
        remarks: payload.remarks,
      },
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { data: current, error: loadError } = await supabase.from('batteries').select('*').eq('id', batteryId).single();
    if (loadError) throw loadError;
    const qcStatus = payload.manualValues?.qcTesting === 'FAILED' ? 'FAILED' : 'PASSED';
    const update: any = {
      stepResults: {
        ...(current.stepResults || {}),
        FINAL_TESTING: {
          stepName: 'Pack High-Pot & Dyn Load Test',
          status: qcStatus,
          mode: payload.mode || 'MANUAL',
          completedAt: new Date().toISOString(),
          completedBy: payload.userId,
          details: payload.remarks || 'Final pack test executed',
          values: payload.manualValues || {},
        },
        FINAL_QC: {
          ...(current.stepResults?.FINAL_QC || {}),
          stepName: 'Final Quality Release & Label',
          status: 'READY',
          mode: 'MANUAL',
        },
      },
      currentStep: 'FINAL_QC',
      progressPercent: 95,
      finalQcResult: {
        ...(current.finalQcResult || {}),
        status: qcStatus,
        packVoltageV: Number(payload.manualValues?.packVoltageV ?? current.finalQcResult?.packVoltageV ?? 51.2),
        internalResistanceMilliOhm: Number(payload.manualValues?.batteryIrMohm ?? current.finalQcResult?.internalResistanceMilliOhm ?? 0),
        hiPotInsulationMOhm: Number(payload.manualValues?.hiPotInsulationMOhm ?? current.finalQcResult?.hiPotInsulationMOhm ?? 0),
        bmsTelemetryOk: payload.manualValues?.bmsTelemetryOk ?? true,
        enclosureVisualOk: payload.manualValues?.enclosureVisualOk ?? true,
        testedBy: payload.userId,
        testedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    if (payload.cellId) {
      update.stepResults.FINAL_TESTING.manualValues = { cellId: payload.cellId, ...payload.manualValues };
    }

    const { data, error } = await supabase.from('batteries').update(update).eq('id', batteryId).select().single();
    if (error) throw error;
    return { success: true, battery: data };
    */
  },

  async finalQc(batteryId: string, payload: { status: 'PASSED' | 'FAILED'; userId?: string }): Promise<any> {
    if (payload.status === 'FAILED') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data, error } = await rawSupabase.rpc('quarantine_item_transaction', {
        p_entity_type: 'BATTERY',
        p_entity_id: batteryId,
        p_reason: 'Failed Final QC sign-off',
      });
      if (error) throw error;
      return { success: true, record: toAppValue(data) };
    }
    const { data: current, error: loadError } = await supabase.from('batteries').select('*, product:product_templates(*), productionOrder:production_orders(*)').eq('id', batteryId).single();
    if (loadError) throw loadError;
    const { data: batteryModules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', batteryId)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    const moduleIds = (batteryModules || []).map((module: any) => module.id).filter(Boolean);
    const { data: moduleCells, error: moduleCellsError } = moduleIds.length
      ? await supabase.from('module_cells').select('module_id, cell_id, cell_slot_index').in('module_id', moduleIds)
      : { data: [], error: null };
    if (moduleCellsError) throw moduleCellsError;
    const cellsByModule = new Map<string, any[]>();
    (moduleCells || []).forEach((assignment: any) => {
      const moduleId = assignment.module_id || assignment.moduleId;
      if (!moduleId) return;

      const cells = cellsByModule.get(moduleId) || [];
      cellsByModule.set(moduleId, hydrateModuleCells([...cells, assignment]));
    });
    current.modules = (batteryModules || []).map((module: any) => ({
      ...module,
      cells: cellsByModule.get(module.id) || hydrateModuleCells(module.cells || []),
    }));
    const passed = payload.status === 'PASSED';
    if (passed && current.status === 'FINISHED') throw new Error('Battery has already been released.');
    if (passed) {
      const modules = Array.isArray(current.modules) ? current.modules : [];
      const requiredCells = Number(current.product?.totalCells || 0);
      const assignedCells = modules.reduce((total: number, module: any) => total + (Array.isArray(module.cells) ? module.cells.length : 0), 0);
      const cellsComplete = modules.length > 0 && assignedCells > 0 && (!requiredCells || assignedCells >= requiredCells);
      if (!cellsComplete) throw new Error('Cannot release battery: all module cell slots must be assigned.');
      const bmsRequired = current.product?.bmsConfig?.required ?? current.product?.bms_config_json?.required ?? true;
      const bmuRequired = current.product?.bmuConfig?.required ?? current.product?.bmu_config_json?.required ?? false;
      if (bmsRequired && !current.bmsId) throw new Error('Cannot release battery: assign a BMS first.');
      if (bmuRequired && !current.bmuId) throw new Error('Cannot release battery: assign a BMU first.');
      if (current.stepResults?.FINAL_TESTING?.status !== 'PASSED') throw new Error('Cannot release battery: pack testing must pass first.');
      const { data: openQuarantine, error: quarantineError } = await supabase
        .from('quarantine_records')
        .select('id, entityId')
        .eq('status', 'OPEN');
      if (quarantineError) throw quarantineError;
      const quarantinedEntityIds = new Set([batteryId, ...modules.map((module: any) => module.id)]);
      if ((openQuarantine || []).some((record: any) => quarantinedEntityIds.has(record.entityId))) {
        throw new Error('Cannot release battery: an open quarantine record exists.');
      }
    }
    if (passed) {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data, error } = await rawSupabase.rpc('release_battery_transaction', { p_battery_id: batteryId });
      if (error) throw error;
      return { success: true, battery: toAppValue(data) };
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('batteries').update({
      status: passed ? 'FINISHED' : 'QUARANTINED',
      currentStep: passed ? 'COMPLETED' : 'FINAL_QC',
      progressPercent: passed ? 100 : 95,
      qrCode: passed ? `${current.serialNumber}|${current.productName}|PASSED|${now.slice(0, 10)}` : current.qrCode,
      stepResults: {
        ...(current.stepResults || {}),
        FINAL_QC: {
          stepName: 'Final Quality Release & Label',
          status: passed ? 'PASSED' : 'FAILED',
          mode: 'MANUAL',
          completedAt: now,
          completedBy: payload.userId,
          details: passed ? 'Certified for customer dispatch and finished goods inventory' : 'Failed final QC sign-off',
        },
      },
      finalQcResult: {
        ...(current.finalQcResult || {}),
        status: passed ? 'PASSED' : 'FAILED',
        testedBy: payload.userId,
        testedAt: now,
      },
      updatedAt: now,
    }).eq('id', batteryId);
    if (error) throw error;

    if (passed && current.productionOrderId && current.productionOrder) {
      const order = current.productionOrder;
      const completed = Number(order.quantityCompleted || 0) + 1;
      const { error: orderError } = await supabase.from('production_orders').update({
        quantityCompleted: completed,
        quantityInProcess: Math.max(0, Number(order.quantityInProcess || 0) - 1),
        status: completed >= Number(order.quantityPlanned || 0) ? 'COMPLETED' : 'IN_PROCESS',
        updatedAt: now,
      }).eq('id', current.productionOrderId);
      if (orderError) throw orderError;
    }
    return { success: true, battery: data };
  },

  // Universal Traceability Engine
  async universalTrace(query: string): Promise<any> {
    const cleanQuery = query.trim().toLowerCase();
    const find = async (table: string, columns: string[]) => {
      for (const column of columns) {
        const result = await supabase.from(table).select('*').ilike(column, cleanQuery).limit(1);
        if (result.error) throw result.error;
        if (Array.isArray(result.data) && result.data.length > 0) return result.data[0];
      }
      return null;
    };

    const loadModuleCells = async (moduleId: string) => {
      const { data, error } = await supabase
        .from('module_cells')
        .select('module_id, cell_id, cell_slot_index, cell:cells(*)')
        .eq('module_id', moduleId)
        .order('cell_slot_index', { ascending: true });
      if (error) throw error;
      return hydrateModuleCells(data || []);
    };

    const loadBatteryModules = async (batteryId: string) => {
      const { data: modules, error: modulesError } = await supabase
        .from('modules')
        .select('*')
        .eq('batteryId', batteryId)
        .order('moduleIndex', { ascending: true });
      if (modulesError) throw modulesError;
      return Promise.all((modules || []).map(async (module: any) => ({
        ...module,
        cells: await loadModuleCells(module.id),
      })));
    };

    const loadBatteryContext = async (battery: any, context: any) => {
      context.battery = battery;
      context.modules = await loadBatteryModules(battery.id);
      context.cells = context.modules.flatMap((module: any) => module.cells || []);
      if (battery.bmsId) context.bms = (await supabase.from('bms_units').select('*').eq('id', battery.bmsId).maybeSingle()).data;
      if (battery.bmuId) context.bmu = (await supabase.from('bmu_units').select('*').eq('id', battery.bmuId).maybeSingle()).data;
      const { data: rackPack, error: rackPackError } = await supabase
        .from('rack_packs')
        .select('rack_id,pack_slot_index')
        .eq('battery_id', battery.id)
        .maybeSingle();
      if (rackPackError) throw rackPackError;
      if (rackPack?.rackId || rackPack?.rack_id) {
        const rackId = rackPack.rackId || rackPack.rack_id;
        const { data: rack, error: rackError } = await supabase.from('racks').select('*').eq('id', rackId).maybeSingle();
        if (rackError) throw rackError;
        if (rack) context.rack = { ...rack, packSlotIndex: rackPack.packSlotIndex ?? rackPack.pack_slot_index };
      }
    };

    const loadRackContext = async (rack: any, context: any) => {
      const { data: rackPacks, error: rackPacksError } = await supabase
        .from('rack_packs')
        .select('rack_id, battery_id, pack_slot_index')
        .eq('rack_id', rack.id)
        .order('pack_slot_index', { ascending: true });
      if (rackPacksError) throw rackPacksError;

      context.batteries = await Promise.all((rackPacks || []).map(async (pack: any) => {
        const batteryId = pack.battery_id || pack.batteryId;
        const battery = await supabase.from('batteries').select('*').eq('id', batteryId).maybeSingle();
        if (!battery.data) return null;
        const batteryContext: any = {};
        await loadBatteryContext(battery.data, batteryContext);
        return {
          ...batteryContext.battery,
          modules: batteryContext.modules,
          cells: batteryContext.cells,
          bms: batteryContext.bms,
          bmu: batteryContext.bmu,
          rackSlotIndex: pack.pack_slot_index ?? pack.packSlotIndex,
        };
      })).then(items => items.filter(Boolean));
      context.rackPacks = rackPacks || [];
      context.batteryIds = context.batteries.map((battery: any) => battery.id);
    };

    const buildContext = async (entityType: string, entity: any) => {
      const normalizedEntity = entityType === 'CELL'
        ? { ...entity, lifecycleStatus: entity.lifecycleStatus ?? entity.lifecycle_status }
        : entity;
      const lifecycleStatus = normalizedEntity.lifecycleStatus || normalizedEntity.lifecycle_status;
      const warehouseResolution = await resolveWarehouseCellLocations();
      const warehouseLocation = entityType === 'CELL'
        ? warehouseResolution.locationByCell.get(String(normalizedEntity.id))
        : warehouseResolution.latestByEntity.get(`${entityType}:${String(normalizedEntity.id)}`);
      const context: any = {
        entityType,
        entity: warehouseLocationStatus(warehouseLocation)
          ? { ...normalizedEntity, status: warehouseLocationStatus(warehouseLocation) }
          : normalizedEntity,
        identifier: query.trim(),
        status: warehouseLocationStatus(warehouseLocation) || lifecycleStatus || normalizedEntity.status,
      };
      const formatGenealogyReason = (event: any): string | undefined => {
        const data = event.eventData || {};
        switch (event.eventType) {
          case 'ASSIGNED_TO_BATTERY':
            return `Assigned to battery ${data.batteryId || data.battery_id || 'recorded battery'}`;
          case 'ASSIGNED_TO_MODULE':
            return `Assigned to module ${data.moduleId || data.module_id || 'recorded module'}${data.cellSlotIndex !== undefined ? `, slot ${data.cellSlotIndex}` : ''}`;
          case 'IMPORTED':
            return 'Imported into inventory';
          case 'OCV_TESTED':
            return `OCV/IR test recorded${data.ocvV !== undefined ? `: ${data.ocvV} V` : ''}`;
          case 'GRADED':
            return `Cell graded${data.grade ? `: ${data.grade}` : ''}`;
          default:
            return Object.keys(data).length > 0 ? Object.entries(data).map(([key, value]) => `${key}: ${value}`).join(', ') : undefined;
        }
      };
      const { data: genealogy, error: genealogyError } = await supabase
        .from('genealogy_records')
        .select('*')
        .or(`entityId.eq.${entity.id},parentEntityId.eq.${entity.id}`)
        .limit(500);
      if (!genealogyError) {
        context.genealogy = genealogy || [];
        context.auditTrail = (genealogy || []).map((event: any) => ({
          id: event.id,
          action: event.eventType,
          reason: formatGenealogyReason(event),
          userName: event.recordedBy || 'System',
          userRole: event.recordedBy ? 'Authenticated operator' : 'System event',
          timestamp: event.recordedAt,
        }));
      }
      if (entityType === 'CELL') {
        const supplier = normalizedEntity.supplierId ? await supabase.from('suppliers').select('*').eq('id', normalizedEntity.supplierId).maybeSingle() : null;
        if (supplier?.data) context.supplier = supplier.data;
        const { data: assignment, error: assignmentError } = await supabase
          .from('module_cells')
          .select('moduleId')
          .eq('cellId', normalizedEntity.id)
          .maybeSingle();
        if (assignmentError) throw assignmentError;
        if (assignment?.moduleId) {
          const module = await supabase.from('modules').select('*').eq('id', assignment.moduleId).maybeSingle();
          if (module?.data) context.module = { ...module.data, cells: await loadModuleCells(module.data.id) };
        }
      }
      if (entityType === 'CELL' || entityType === 'MODULE') {
        const batteryId = entityType === 'CELL' ? context.module?.batteryId : normalizedEntity.batteryId;
        if (entityType === 'MODULE') {
          context.cells = await loadModuleCells(entity.id);
          context.entity = { ...context.entity, cells: context.cells };
        }
        if (batteryId) {
          const battery = await supabase.from('batteries').select('*').eq('id', batteryId).maybeSingle();
          if (battery?.data) {
            await loadBatteryContext(battery.data, context);
            if (entityType === 'MODULE') {
              context.cells = await loadModuleCells(entity.id);
              context.entity = { ...context.entity, cells: context.cells };
            }
          }
        }
      }
      if (entityType === 'BATTERY') {
        await loadBatteryContext(entity, context);
      }
      if (entityType === 'RACK') {
        await loadRackContext(entity, context);
      }
      if (entityType === 'BMS' || entityType === 'BMU') {
        const batteryColumn = entityType === 'BMS' ? 'bmsId' : 'bmuId';
        const battery = await supabase.from('batteries').select('*').eq(batteryColumn, entity.id).maybeSingle();
        if (battery?.data) {
          await loadBatteryContext(battery.data, context);
          const assignedEntity = { ...entity, status: 'ASSIGNED', assignedToBatteryId: battery.data.id };
          context.entity = assignedEntity;
          context.status = 'ASSIGNED';
          context.bms = entityType === 'BMS' ? assignedEntity : (await supabase.from('bms_units').select('*').eq('id', battery.data.bmsId).maybeSingle()).data;
          context.bmu = entityType === 'BMU' ? assignedEntity : (await supabase.from('bmu_units').select('*').eq('id', battery.data.bmuId).maybeSingle()).data;
          if (!context.auditTrail?.some((event: any) => event.action === 'ASSIGNED_TO_BATTERY')) {
            context.auditTrail = [
              ...(context.auditTrail || []),
              {
                id: `derived-assignment-${entity.id}-${battery.data.id}`,
                action: 'ASSIGNED_TO_BATTERY',
                reason: `Assigned to battery ${battery.data.id}`,
                userName: 'System',
                userRole: 'Derived relationship',
                timestamp: entity.updatedAt || battery.data.updatedAt,
              },
            ];
          }
        }
      }
      return context;
    };

    const qrMatch = await find('qr_registry', ['qrCode']);
    if (qrMatch) {
      const tableByType: Record<string, string> = {
        CELL: 'cells',
        MODULE: 'modules',
        BATTERY: 'batteries',
        BMS: 'bms_units',
        BMU: 'bmu_units',
      };
      const table = tableByType[qrMatch.entityType];
      if (table) {
        const registeredEntity = await supabase.from(table).select('*').eq('id', qrMatch.entityId).maybeSingle();
        if (registeredEntity.data) return buildContext(qrMatch.entityType, registeredEntity.data);
      }
    }

    const cell = await find('cells', ['supplierBarcode', 'internalSerial', 'id']);
    if (cell) return buildContext('CELL', cell);
    const module = await find('modules', ['serialNumber', 'id']);
    if (module) return buildContext('MODULE', module);
    const battery = await find('batteries', ['serialNumber', 'id']);
    if (battery) return buildContext('BATTERY', battery);
    const bms = await find('bms_units', ['serialNumber', 'id']);
    if (bms) return buildContext('BMS', bms);
    const bmu = await find('bmu_units', ['serialNumber', 'id']);
    if (bmu) return buildContext('BMU', bmu);
    const rack = await find('racks', ['serialNumber', 'qrCode', 'id']);
    if (rack) return buildContext('RACK', rack);
    const supplier = await find('suppliers', ['name', 'id']);
    if (supplier) return buildContext('SUPPLIER', supplier);
    const { data: batchCells, error: batchError } = await supabase
      .from('cells')
      .select('*')
      .or(`batchNumber.eq.${query.trim()},palletNumber.eq.${query.trim()},boxNumber.eq.${query.trim()}`)
      .limit(1000);
    if (!batchError && batchCells?.length) {
      const supplierResult = await supabase.from('suppliers').select('*').eq('id', batchCells[0].supplierId).maybeSingle();
      return {
        entityType: 'SUPPLIER_BATCH',
        identifier: query.trim(),
        entity: { batchIdentifier: query.trim(), cellCount: batchCells.length, supplierName: batchCells[0].supplierName },
        supplier: supplierResult.data,
        cells: batchCells,
      };
    }
    throw new Error('Traceability record not found');
  },

  // Quarantine
  async getQuarantines(): Promise<QuarantineRecord[]> {
    const { data, error } = await supabase
      .from('quarantine_records')
      .select('*')
      .order('quarantined_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getQuarantineRecords(): Promise<QuarantineRecord[]> {
    const { data, error } = await supabase
      .from('quarantine_records')
      .select('*')
      .order('quarantined_at', { ascending: false });
    const records: any[] = error ? [] : (toAppValue(data || []) as any[]).map((record: any) => ({
      ...record,
      disposition: record.disposition || record.disposedOfAs || record.disposed_of_as,
      dispositionNotes: record.dispositionNotes || record.disposition_notes,
      entitySerial: record.entitySerial || record.entityId,
    }));

    // Include rejected cells even when quarantine RLS/schema changes have not
    // reached the live API yet.
    if (rawSupabase) {
      const quarantineCellIds = records
        .filter(record => (record.entityType || record.entity_type) === 'CELL')
        .map(record => record.entityId || record.entity_id)
        .filter(Boolean);
      if (quarantineCellIds.length > 0) {
        const { data: quarantineCells } = await rawSupabase
          .from('cells')
          .select('id,internal_serial,supplier_barcode')
          .in('id', quarantineCellIds);
        const cellById = new Map((quarantineCells || []).map((cell: any) => [cell.id, cell]));
        records.forEach(record => {
          const entityId = record.entityId || record.entity_id;
          const cell = cellById.get(entityId);
          if (cell) record.entitySerial = cell.internal_serial || cell.supplier_barcode || entityId;
        });
      }
      const { data: rejectedCells } = await rawSupabase
        .from('cells')
        .select('id,internal_serial,supplier_barcode,status,lifecycle_status,updated_at')
        .or('status.eq.REJECTED,lifecycle_status.eq.SCRAP');
      const knownCellIds = new Set(records
        .filter(record => (record.entity_type || record.entityType) === 'CELL')
        .map(record => record.entity_id || record.entityId)
        .filter(Boolean));
      (rejectedCells || []).forEach((cell: any) => {
        if (knownCellIds.has(cell.id)) return;
        records.push({
          id: `derived-scrap-${cell.id}`,
          entityType: 'CELL',
          entityId: cell.id,
          entitySerial: cell.internal_serial || cell.supplier_barcode || cell.id,
          reason: 'Cell marked as rejected/scrap',
          stage: 'SCRAP',
          status: 'OPEN',
          quarantinedAt: cell.updated_at,
        });
      });
    }
    if (error && records.length === 0) throw error;
    const uniqueRecords = new Map<string, any>();
    records.forEach(record => {
      const entityType = record.entityType || record.entity_type || 'UNKNOWN';
      const entityId = record.entityId || record.entity_id || record.id;
      const key = `${entityType}:${entityId}`;
      if (!uniqueRecords.has(key) || !String(record.id || '').startsWith('derived-scrap-')) {
        uniqueRecords.set(key, record);
      }
    });
    return Array.from(uniqueRecords.values());
  },

  async quarantineItem(payload: { itemType: string; itemId: string; reason: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('quarantine_item_transaction', {
      p_entity_type: payload.itemType,
      p_entity_id: payload.itemId,
      p_reason: payload.reason,
    });
    if (error) throw error;
    return { success: true, record: toAppValue(data) };

    /*
    const entityTable = payload.itemType === 'CELL' ? 'cells'
      : payload.itemType === 'MODULE' ? 'modules'
        : payload.itemType === 'BATTERY' ? 'batteries'
          : payload.itemType === 'BMS' ? 'bms_units' : 'bmu_units';
    const { data: entity, error: entityError } = await supabase
      .from(entityTable)
      .select('id,serialNumber')
      .eq('id', payload.itemId)
      .maybeSingle();
    if (entityError) throw entityError;
    if (!entity) throw new Error(`${payload.itemType} not found.`);

    const { data: quarantineRecord, error } = await supabase.from('quarantine_records').insert({
      id: `quar-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      entityType: payload.itemType,
      entityId: payload.itemId,
      entitySerial: entity.serialNumber || payload.itemId,
      reason: payload.reason,
      stage: 'OPEN',
      disposition: 'RELEASE_APPROVED',
      dispositionNotes: 'Resolved by quality',
      quarantinedBy: payload.userId || 'usr-admin-01',
      quarantinedAt: new Date().toISOString(),
      status: 'OPEN',
    }).select('id');
    if (error) throw error;

    // Update item status
    const { error: statusError } = await supabase.from(entityTable).update({ status: 'QUARANTINED' }).eq('id', payload.itemId);
    if (statusError) {
      if (quarantineRecord?.[0]?.id) {
        await supabase.from('quarantine_records').delete().eq('id', quarantineRecord[0].id);
      }
      throw statusError;
    }

    return { success: true };
    */
  },

  async scrapCellsByBarcodes(barcodes: string[], reason: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('scrap_cells_by_barcodes', {
      p_barcodes: barcodes,
      p_reason: reason,
    });
    if (!error) return toAppValue(data);

    // Allow operations to continue while PostgREST is waiting for the new RPC
    // to appear in its schema cache after a SQL deployment.
    if (error.code !== 'PGRST202') throw error;
    const scrapped: any[] = [];
    const missing: string[] = [];
    for (const barcode of barcodes.map(value => value.trim()).filter(Boolean)) {
      const { data: cell, error: cellError } = await rawSupabase
        .from('cells')
        .select('id,internal_serial,supplier_barcode')
        .or(`id.eq.${barcode},internal_serial.eq.${barcode},supplier_barcode.eq.${barcode}`)
        .maybeSingle();
      if (cellError) throw cellError;
      if (!cell) {
        missing.push(barcode);
        continue;
      }
      const { error: quarantineError } = await rawSupabase.rpc('quarantine_item_transaction', {
        p_entity_type: 'CELL',
        p_entity_id: cell.id,
        p_reason: reason,
      });
      if (quarantineError) throw quarantineError;
      const { error: unlinkError } = await rawSupabase.from('module_cells').delete().eq('cell_id', cell.id);
      if (unlinkError) throw unlinkError;
      const { error: updateError } = await rawSupabase.from('cells').update({
        status: 'REJECTED',
        lifecycle_status: 'SCRAP',
        reserved_for_order_id: null,
        reserved_for_battery_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', cell.id);
      if (updateError) throw updateError;
      scrapped.push({ barcode, cellId: cell.id, internalSerial: cell.internal_serial });
    }
    return { scrapped, missing, scrappedCount: scrapped.length, missingCount: missing.length };
  },

  async deleteScrapCell(cellId: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('delete_scrap_cell_transaction', { p_cell_id: cellId });
    if (error) throw error;
    return toAppValue(data);
  },

  async resolveQuarantine(id: string, payload: { action?: string; disposition?: string; notes?: string; dispositionNotes?: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('resolve_quarantine_transaction', {
      p_quarantine_id: id,
      p_disposition: payload.disposition || payload.action || 'RELEASE_APPROVED',
      p_notes: payload.dispositionNotes || payload.notes || 'Resolved by quality',
    });
    if (error) throw error;
    return { success: true, record: toAppValue(data) };

    /*
    const disposition = payload.disposition || payload.action || 'RELEASE_APPROVED';
    const dispositionNotes = payload.dispositionNotes || payload.notes || 'Resolved by quality';

    const { data: record, error: loadError } = await supabase.from('quarantine_records').select('entityType, entityId').eq('id', id).maybeSingle();
    if (loadError) throw loadError;
    if (!record) throw new Error('Quarantine record not found.');

    const { error } = await supabase.from('quarantine_records').update({
      stage: 'RESOLVED',
      disposition,
      dispositionNotes,
      resolvedBy: payload.userId,
      resolvedAt: new Date().toISOString(),
      status: 'RESOLVED',
    }).eq('id', id);
    if (error) throw error;

    // Update item status back to active
    if (record.entityType === 'CELL') {
      const { error: updateError } = await supabase.from('cells').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'MODULE') {
      const { error: updateError } = await supabase.from('modules').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BATTERY') {
      const { error: updateError } = await supabase.from('batteries').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'IN_PROCESS' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BMS') {
      const { error: updateError } = await supabase.from('bms_units').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BMU') {
      const { error: updateError } = await supabase.from('bmu_units').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'ONLINE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    }

    return { success: true };
    */
  },

  async getWarehouseMovements(entityId?: string): Promise<any[]> {
    let query = supabase.from('warehouse_movements').select('*').order('moved_at', { ascending: false });
    if (entityId) query = query.eq('entity_id', entityId);
    const { data, error } = await query;
    if (error) throw error;

    const movements = data || [];
    const entityRefs = new Map<string, Promise<{ serialNumber?: string; qrCode?: string } | null>>();
    const addLookup = (entityType: string, entityIdValue: string) => {
      if (!entityType || !entityIdValue) return Promise.resolve(null);
      const key = `${entityType}:${entityIdValue}`;
      if (entityRefs.has(key)) return entityRefs.get(key)!;

      const promise = (async () => {
        if (entityType === 'RACK') {
          const { data: rack, error: rackError } = await supabase.from('racks').select('serial_number, qr_code').eq('id', entityIdValue).maybeSingle();
          if (rackError || !rack) return null;
          return { serialNumber: rack.serial_number || rack.serialNumber || rack.qr_code || entityIdValue, qrCode: rack.qr_code || rack.qrCode || rack.serial_number || entityIdValue };
        }
        if (entityType === 'BATTERY') {
          const { data: battery, error: batteryError } = await supabase.from('batteries').select('serial_number, qr_code').eq('id', entityIdValue).maybeSingle();
          if (batteryError || !battery) return null;
          return { serialNumber: battery.serial_number || battery.serialNumber || battery.qr_code || entityIdValue, qrCode: battery.qr_code || battery.qrCode || battery.serial_number || entityIdValue };
        }
        if (entityType === 'MODULE') {
          const { data: moduleRow, error: moduleError } = await supabase.from('modules').select('serial_number, qr_code').eq('id', entityIdValue).maybeSingle();
          if (moduleError || !moduleRow) return null;
          return { serialNumber: moduleRow.serial_number || moduleRow.serialNumber || moduleRow.qr_code || entityIdValue, qrCode: moduleRow.qr_code || moduleRow.qrCode || moduleRow.serial_number || entityIdValue };
        }
        if (entityType === 'CELL') {
          const { data: cell, error: cellError } = await supabase.from('cells').select('internal_serial, qr_code').eq('id', entityIdValue).maybeSingle();
          if (cellError || !cell) return null;
          return { serialNumber: cell.internal_serial || cell.serialNumber || cell.qr_code || entityIdValue, qrCode: cell.qr_code || cell.qrCode || cell.internal_serial || entityIdValue };
        }
        return null;
      })();

      entityRefs.set(key, promise);
      return promise;
    };

    const enriched = await Promise.all(movements.map(async (movement: any) => {
      const entityType = String(movement.entity_type || movement.entityType || '').toUpperCase();
      const entityIdValue = String(movement.entity_id || movement.entityId || '');
      const metadata = entityIdValue ? await addLookup(entityType, entityIdValue) : null;
      const serialNumber = metadata?.serialNumber || entityIdValue || movement.serial_number || movement.serialNumber || movement.id;
      return {
        ...movement,
        entityType,
        entityId: entityIdValue,
        entitySerial: serialNumber,
      };
    }));

    return enriched;
  },

  async dispatchBattery(batteryId: string, dispatchReference: string, destination: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('dispatch_battery_transaction', {
      p_battery_id: batteryId,
      p_reference: dispatchReference,
      p_destination: destination,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async sellBattery(batteryId: string, client: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('sell_battery_transaction', {
      p_battery_id: batteryId,
      p_client: client,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async getSaleHistory(): Promise<any[]> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.from('sale_history').select('*').order('sold_at', { ascending: false });
    // Older sales were marked SOLD before sale_history existed. Include those
    // records from the current entity status so the history is never blank.
    const historyRows = error ? [] : (data || []);
    const [{ data: batteries }, { data: racks }, { data: dispatches }, { data: rackEvents }, { data: warehouseDispatches }] = await Promise.all([
      rawSupabase.from('batteries').select('id,serial_number,status,lifecycle_status,created_at,updated_at').eq('lifecycle_status', 'SOLD'),
      rawSupabase.from('racks').select('id,serial_number,status,created_at,updated_at').eq('status', 'SOLD'),
      rawSupabase.from('dispatches').select('battery_id,destination,dispatched_at').order('dispatched_at', { ascending: false }),
      rawSupabase.from('lifecycle_events').select('entity_id,reason,recorded_at').eq('entity_type', 'RACK').eq('to_status', 'SOLD').order('recorded_at', { ascending: false }),
      rawSupabase.from('warehouse_movements').select('entity_id,to_location,moved_at').eq('entity_type', 'BATTERY').eq('movement_type', 'DISPATCH').order('moved_at', { ascending: false }),
    ]);
    const soldRackIds = (racks || []).map(row => row.id);
    const { data: soldRackPacks } = soldRackIds.length
      ? await rawSupabase.from('rack_packs').select('rack_id,battery_id').in('rack_id', soldRackIds)
      : { data: [] as any[] };
    const batteriesInsideSoldRacks = new Set((soldRackPacks || []).map(row => row.battery_id));
    const historyByKey = new Map(
      historyRows
        .filter(row => !(row.entity_type === 'BATTERY' && batteriesInsideSoldRacks.has(row.entity_id)))
        .map(row => [`${row.entity_type}:${row.entity_id}`, row]),
    );
    const legacyClientByKey = new Map<string, string>([
      ...(dispatches || []).map(row => [`BATTERY:${row.battery_id}`, row.destination] as [string, string]),
      ...(warehouseDispatches || []).map(row => [`BATTERY:${row.entity_id}`, row.to_location] as [string, string]),
      ...(rackEvents || []).map(row => [`RACK:${row.entity_id}`, row.reason] as [string, string]),
    ]);
    const currentSold = [
      ...(batteries || []).filter(row => !batteriesInsideSoldRacks.has(row.id)).map(row => ({ ...row, entity_type: 'BATTERY' })),
      ...(racks || []).map(row => ({ ...row, entity_type: 'RACK' })),
    ];
    return currentSold
      .map(row => {
        const key = `${row.entity_type}:${row.id}`;
        const saved = historyByKey.get(key);
        return {
          id: saved?.id || `legacy-${key}`,
          entityType: row.entity_type,
          entityId: row.id,
          serialNumber: row.serial_number || row.id,
          clientName: saved?.client_name || legacyClientByKey.get(key) || 'Not recorded',
          soldAt: saved?.sold_at || row.updated_at || row.created_at,
          persisted: Boolean(saved),
        };
      })
      .sort((left, right) => new Date(right.soldAt).getTime() - new Date(left.soldAt).getTime());
  },

  async updateSaleHistory(id: string, clientName: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.from('sale_history').update({ client_name: clientName, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteSaleHistory(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.from('sale_history').delete().eq('id', id);
    if (error) throw error;
  },

  async receiveBattery(batteryId: string, location: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('receive_battery_transaction', {
      p_battery_id: batteryId,
      p_location: location,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async receiveWarehouseEntity(entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string, location: 'KARACHI' | 'LAHORE'): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('receive_warehouse_entity_transaction', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_location: location,
    });
    if (!error) return toAppValue(data);

    const missingRpc = /schema cache|does not exist|could not find the function/i.test(error.message || '');
    if (!missingRpc) throw error;

    const trimmedId = String(entityId ?? '').trim();
    if (!trimmedId) throw new Error('Entity identifier is required.');

    const normalizedLocation = String(location).toUpperCase() as 'KARACHI' | 'LAHORE';

    if (entityType === 'BATTERY') {
      const { data: battery, error: batteryError } = await rawSupabase
        .from('batteries')
        .select('id, serial_number')
        .or(`id.eq.${trimmedId},serial_number.eq.${trimmedId}`)
        .maybeSingle();
      if (batteryError) throw batteryError;
      if (!battery) throw new Error(`Battery ${entityId} not found.`);

      const { error: updateError } = await rawSupabase.from('batteries').update({
        status: 'WAREHOUSE',
        current_step: 'WAREHOUSE',
        lifecycle_status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', battery.id);
      if (updateError) throw updateError;

      try {
        const { error: movementError } = await rawSupabase.from('warehouse_movements').insert({
          id: `mov-${crypto.randomUUID()}`,
          entity_type: 'BATTERY',
          entity_id: battery.id,
          movement_type: 'RECEIVE',
          from_location: 'PRODUCTION',
          to_location: normalizedLocation,
          reference: 'Warehouse Receipt',
          moved_by: null,
          moved_at: new Date().toISOString(),
        });
        if (movementError) {
          throw movementError;
        }
      } catch (movementFailure) {
        throw movementFailure;
      }

      return buildWarehouseReceiveResult('BATTERY', battery.id, normalizedLocation);
    }

    if (entityType === 'MODULE') {
      const { data: moduleRecord, error: moduleError } = await rawSupabase
        .from('modules')
        .select('id, serial_number')
        .or(`id.eq.${trimmedId},serial_number.eq.${trimmedId}`)
        .maybeSingle();
      if (moduleError) throw moduleError;
      if (!moduleRecord) throw new Error(`Module ${entityId} not found.`);

      const { error: updateError } = await rawSupabase.from('modules').update({
        lifecycle_status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', moduleRecord.id);
      if (updateError) throw updateError;

      try {
        const { error: movementError } = await rawSupabase.from('warehouse_movements').insert({
          id: `mov-${crypto.randomUUID()}`,
          entity_type: 'MODULE',
          entity_id: moduleRecord.id,
          movement_type: 'RECEIVE',
          from_location: 'PRODUCTION',
          to_location: normalizedLocation,
          reference: 'Warehouse Receipt',
          moved_by: null,
          moved_at: new Date().toISOString(),
        });
        if (movementError) {
          throw movementError;
        }
      } catch (movementFailure) {
        throw movementFailure;
      }

      return buildWarehouseReceiveResult('MODULE', moduleRecord.id, normalizedLocation);
    }

    const { data: rackRecord, error: rackError } = await rawSupabase
      .from('racks')
      .select('id, serial_number, qr_code')
      .or(`id.eq.${trimmedId},serial_number.eq.${trimmedId},qr_code.eq.${trimmedId}`)
      .maybeSingle();
    if (rackError) throw rackError;
    if (!rackRecord) throw new Error(`Rack ${entityId} not found.`);

    const { error: updateError } = await rawSupabase.from('racks').update({
      location: normalizedLocation,
      status: 'IN_STOCK',
      updated_at: new Date().toISOString(),
    }).eq('id', rackRecord.id);
    if (updateError) throw updateError;

    try {
      const { error: movementError } = await rawSupabase.from('warehouse_movements').insert({
        id: `mov-${crypto.randomUUID()}`,
        entity_type: 'RACK',
        entity_id: rackRecord.id,
        movement_type: 'RECEIVE',
        from_location: 'PRODUCTION',
        to_location: normalizedLocation,
        reference: 'Warehouse Receipt',
        moved_by: null,
        moved_at: new Date().toISOString(),
      });
      if (movementError) {
        throw movementError;
      }
    } catch (movementFailure) {
      throw movementFailure;
    }

    return buildWarehouseReceiveResult('RACK', rackRecord.id, normalizedLocation);
  },

  async updateWarehouseEntityLocation(entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string, location: 'KARACHI' | 'LAHORE'): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');

    const trimmedId = String(entityId ?? '').trim();
    if (!trimmedId) throw new Error('Entity identifier is required.');

    const normalizedLocation = String(location).toUpperCase() as 'KARACHI' | 'LAHORE';
    const previousLocationQuery = await rawSupabase
      .from('warehouse_movements')
      .select('to_location')
      .eq('entity_type', entityType)
      .eq('entity_id', trimmedId)
      .order('moved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const previousLocation = String(previousLocationQuery.data?.to_location || '').toUpperCase();

    if (entityType === 'RACK') {
      const { error: updateError } = await rawSupabase.from('racks').update({
        location: normalizedLocation,
        status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (updateError) throw updateError;
    } else if (entityType === 'BATTERY') {
      const { error: updateError } = await rawSupabase.from('batteries').update({
        status: 'WAREHOUSE',
        current_step: 'WAREHOUSE',
        lifecycle_status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (updateError) throw updateError;
    } else {
      const { error: updateError } = await rawSupabase.from('modules').update({
        lifecycle_status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (updateError) throw updateError;
    }

    try {
      const { error: movementError } = await rawSupabase.from('warehouse_movements').insert({
        id: `mov-${crypto.randomUUID()}`,
        entity_type: entityType,
        entity_id: trimmedId,
        movement_type: 'MOVE',
        from_location: previousLocation || 'UNKNOWN',
        to_location: normalizedLocation,
        reference: 'Warehouse Location Edit',
        moved_by: null,
        moved_at: new Date().toISOString(),
      });
      if (movementError) {
        throw movementError;
      }
    } catch (movementFailure) {
      throw movementFailure;
    }

    return {
      success: true,
      entityType,
      entityId: trimmedId,
      location: normalizedLocation,
    };
  },

  async removeWarehouseEntity(entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');

    const trimmedId = String(entityId ?? '').trim();
    if (!trimmedId) throw new Error('Entity identifier is required.');

    const previousLocationQuery = await rawSupabase
      .from('warehouse_movements')
      .select('to_location')
      .eq('entity_type', entityType)
      .eq('entity_id', trimmedId)
      .order('moved_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousLocation = String(previousLocationQuery.data?.to_location || '').toUpperCase();

    if (entityType === 'RACK') {
      const { error } = await rawSupabase.from('racks').update({
        location: null,
        status: 'IN_STOCK',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (error) throw error;
    } else if (entityType === 'BATTERY') {
      const { error } = await rawSupabase.from('batteries').update({
        status: 'IN_PROCESS',
        current_step: 'PRODUCTION',
        lifecycle_status: 'IN_PACK',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (error) throw error;
    } else {
      const { error } = await rawSupabase.from('modules').update({
        lifecycle_status: 'IN_MODULE',
        updated_at: new Date().toISOString(),
      }).eq('id', trimmedId);
      if (error) throw error;
    }

    const { error: movementError } = await rawSupabase.from('warehouse_movements').insert({
      id: `mov-${crypto.randomUUID()}`,
      entity_type: entityType,
      entity_id: trimmedId,
      movement_type: 'MOVE',
      from_location: previousLocation || 'WAREHOUSE',
      to_location: 'PRODUCTION',
      reference: 'Removed from Warehouse',
      moved_by: null,
      moved_at: new Date().toISOString(),
    });
    if (movementError) throw movementError;

    return { success: true, entityType, entityId: trimmedId };
  },

  async movePalletToFloor(palletQr: string, location?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('move_pallet_to_floor_transaction', {
      p_pallet_qr: palletQr,
      p_location: location || 'PRODUCTION_FLOOR',
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async moveCellsToFloor(params: { palletNumber?: string; boxNumber?: string; barcodes?: string[]; location?: string }): Promise<{ movedCount: number; skippedCount: number; requestedCount: number }> {
    const palletNumber = String(params.palletNumber || '').trim();
    const boxNumber = String(params.boxNumber || '').trim();
    const barcodes = Array.from(new Set((params.barcodes || []).map(value => String(value).trim()).filter(Boolean)));
    if (!palletNumber && !boxNumber && barcodes.length === 0) throw new Error('Enter a pallet, box, or at least one cell barcode.');
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('move_cells_to_floor_transaction', {
      p_pallet_number: palletNumber || null,
      p_box_number: boxNumber || null,
      p_barcodes: barcodes,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async getRacks(): Promise<RackUnit[]> {
    const rows: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('racks')
        .select('*, rack_packs(battery_id, pack_slot_index)')
        .range(offset, offset + pageSize - 1)
        .order('created_at', { ascending: false });
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows.map((rack: any) => ({
      ...rack,
      id: rack.id,
      serialNumber: rack.serialNumber || rack.serial_number,
      qrCode: rack.qrCode || rack.qr_code,
      rackTemplateCode: rack.rackTemplateCode || rack.rack_template_code,
      requiredPackCount: rack.requiredPackCount || rack.required_pack_count,
      requiredPackTemplateCode: rack.requiredPackTemplateCode || rack.required_pack_template_code,
      batteryIds: (rack.rackPacks || rack.rack_packs || [])
        .sort((a: any, b: any) => (a.packSlotIndex ?? a.pack_slot_index) - (b.packSlotIndex ?? b.pack_slot_index))
        .map((item: any) => item.batteryId || item.battery_id),
    })) as RackUnit[];
  },

  async assembleRack(templateCode: 'RACK_25KWH' | 'RACK_45KWH' | 'RACK_60KWH' | 'RACK_70KWH' | 'RACK_75KWH', batteryIds: string[], location?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('assemble_rack_transaction', {
      p_template_code: templateCode,
      p_battery_ids: batteryIds,
      p_location: location || 'RACK_ASSEMBLY',
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async sellRack(rackId: string, destination: string, reference: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('sell_rack_transaction', {
      p_rack_id: rackId,
      p_destination: destination,
      p_reference: reference,
    });
    if (error) throw error;
    const { error: historyError } = await rawSupabase.from('sale_history').upsert({
      entity_type: 'RACK',
      entity_id: rackId,
      client_name: destination,
      sold_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'entity_type,entity_id' });
    if (historyError) throw historyError;
    return toAppValue(data);
  },

  async deleteRack(rackId: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_rack_transaction', { p_rack_id: rackId });
    if (error) throw error;
  },

  async scrapEntity(entityType: 'CELL' | 'MODULE' | 'BATTERY' | 'RACK', entityId: string, reason: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('scrap_entity_transaction', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_reason: reason,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  // Machines
  async getMachines(): Promise<MachineStation[]> {
    const { data, error } = await supabase.from('machine_configurations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async updateMachine(id: string, payload: { status?: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'BUSY' }): Promise<MachineStation> {
    const { data, error } = await supabase.from('machine_configurations').update(payload).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || {};
  },

  async toggleMachineStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE'): Promise<MachineStation> {
    const { data, error } = await supabase.from('machine_configurations').update({ status }).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || {};
  },

  // Audit
  async getAuditLogs(params?: { entityType?: string; search?: string; limit?: number }): Promise<AuditLog[]> {
    const pageSize = 1000;
    const requestedLimit = params?.limit && params.limit > 0 ? params.limit : undefined;
    const logs: any[] = [];
    for (let offset = 0; requestedLimit === undefined || logs.length < requestedLimit; offset += pageSize) {
      let query = supabase.from('audit_logs').select('*');
      if (params?.entityType) query = query.eq('entity_type', params.entityType);
      if (params?.search && typeof params.search === 'string') {
        const q = params.search.replace(/[%(),]/g, ' ').trim();
        if (q) query = query.or(`actor.ilike.%${q}%,action.ilike.%${q}%,entity_id.ilike.%${q}%`);
      }
      const end = requestedLimit === undefined
        ? offset + pageSize - 1
        : Math.min(offset + pageSize - 1, requestedLimit - 1);
      const { data, error } = await query.order('timestamp', { ascending: false }).range(offset, end);
      if (error) throw error;
      logs.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return logs.slice(0, requestedLimit).map((log: any) => ({
      id: log.id,
      userId: log.actor || 'SYSTEM',
      userName: log.actor || 'SYSTEM',
      userRole: log.actor === 'SYSTEM' ? 'system' : 'operator',
      action: log.action || 'UNKNOWN',
      entityType: log.entity_type || 'SYSTEM',
      entityId: log.entity_id || '',
      oldValue: log.before_state ? JSON.stringify(log.before_state) : undefined,
      newValue: log.after_state ? JSON.stringify(log.after_state) : undefined,
      reason: log.details || undefined,
      timestamp: log.timestamp,
    }));
  },

  // Authentication - these now delegate to Supabase Auth
  async login(identifier: string, password: string): Promise<{
    message?: string;
    error?: string;
    pendingToken?: string;
    sessionId?: string;
    user?: any;
  }> {
    // Auth is now handled by Supabase Auth in AuthContext
    // This function is kept for backwards compatibility
    return { message: 'Use login form - authentication via Supabase' };
  },

  async verifyOtp(token: string, otp: string): Promise<{
    message?: string;
    error?: string;
    sessionId?: string;
    user?: any;
  }> {
    // OTP verification is now handled by Supabase Auth in AuthContext
    return { message: 'Use OTP verification via Supabase' };
  },

  async resendOtp(token: string): Promise<{ message?: string; error?: string; resendInSec?: number }> {
    // OTP resend is now handled by Supabase Auth in AuthContext
    return { message: 'Use OTP resend via Supabase dashboard' };
  },

  async getMe(): Promise<any> {
    // Get current user from Supabase auth
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return session.user;
  },

  async logout(): Promise<{ message: string }> {
    // Auth is now handled by Supabase Auth in AuthContext
    await supabase.auth.signOut();
    return { message: 'Logged out successfully' };
  },
};