import fs from 'fs';
import path from 'path';
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
} from '../src/types';
import { hashPassword, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME } from './auth.ts';
import { getServiceClient, isSupabaseConfigured } from './supabase.ts';

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || isVercelRuntime();
}

function localFileAllowed() {
  return false;
}

function dbFilePath() {
  return path.join(process.cwd(), 'memory', 'mes-database.json');
}

type Snapshot = {
  users: User[];
  roles: Role[];
  products: ProductTemplate[];
  suppliers: Supplier[];
  cells: [string, CellItem][];
  bmsUnits: [string, BMSItem][];
  bmuUnits: [string, BMUItem][];
  modules: [string, ModuleItem][];
  batteries: [string, BatteryUnit][];
  orders: [string, ProductionOrder][];
  machines: [string, MachineStation][];
  auditLogs: AuditLog[];
  quarantineRecords: QuarantineRecord[];
  imports: SupplierImportSummary[];
};

class Database {
  users: User[] = [];
  roles: Role[] = [];
  products: ProductTemplate[] = [];
  suppliers: Supplier[] = [];
  cells: Map<string, CellItem> = new Map();
  bmsUnits: Map<string, BMSItem> = new Map();
  bmuUnits: Map<string, BMUItem> = new Map();
  modules: Map<string, ModuleItem> = new Map();
  batteries: Map<string, BatteryUnit> = new Map();
  orders: Map<string, ProductionOrder> = new Map();
  machines: Map<string, MachineStation> = new Map();
  auditLogs: AuditLog[] = [];
  quarantineRecords: QuarantineRecord[] = [];
  imports: SupplierImportSummary[] = [];

  private version = 1;
  private readyPromise: Promise<void>;
  private persistPromise: Promise<void> = Promise.resolve();

  constructor() {
    this.readyPromise = this.hydrate();
  }

  async ready() {
    await this.readyPromise;
  }

  private snapshot(includeSecrets: boolean): Snapshot {
    const users = includeSecrets
      ? this.users
      : this.users.map(({ passwordHash, otpHash, ...safe }) => safe as User);
    return {
      users,
      roles: this.roles,
      products: this.products,
      suppliers: this.suppliers,
      cells: Array.from(this.cells.entries()),
      bmsUnits: Array.from(this.bmsUnits.entries()),
      bmuUnits: Array.from(this.bmuUnits.entries()),
      modules: Array.from(this.modules.entries()),
      batteries: Array.from(this.batteries.entries()),
      orders: Array.from(this.orders.entries()),
      machines: Array.from(this.machines.entries()),
      auditLogs: this.auditLogs,
      quarantineRecords: this.quarantineRecords,
      imports: this.imports,
    };
  }

  private applySnapshot(state: Partial<Snapshot>) {
    this.users = state.users || [];
    this.roles = state.roles || [];
    this.products = state.products || [];
    this.suppliers = state.suppliers || [];
    this.cells = new Map(state.cells || []);
    this.bmsUnits = new Map(state.bmsUnits || []);
    this.bmuUnits = new Map(state.bmuUnits || []);
    this.modules = new Map(state.modules || []);
    this.batteries = new Map(state.batteries || []);
    this.orders = new Map(state.orders || []);
    this.machines = new Map(state.machines || []);
    this.auditLogs = state.auditLogs || [];
    this.quarantineRecords = state.quarantineRecords || [];
    this.imports = state.imports || [];
  }

  private snapshotHasFactoryData(state: Partial<Snapshot> | null | undefined) {
    if (!state) return false;
    return Boolean(
      (state.roles && state.roles.length) ||
        (state.users && state.users.length) ||
        (state.cells && state.cells.length) ||
        (state.products && state.products.length)
    );
  }

  private async hydrate() {
    // Normalized Supabase tables are the only durable source of MES data.
    // This cache exists only for legacy server routes that are being retired.
    this.seedConfigurationOnly();
  }

  public commit() {
    this.persistPromise = this.persistNow();
  }

  public async flush() {
    await this.persistPromise;
  }

  private async persistNow() {
    // Deliberately no-op: durable writes belong to normalized Supabase tables.
  }

  private seedConfigurationOnly() {
    const now = new Date().toISOString();
    this.roles = [
      {
        id: 'role-admin',
        name: 'Administrator',
        description: 'Full system access and security administration',
        status: 'ACTIVE',
        permissions: ['ALL'],
        createdAt: now,
        updatedAt: now,
      },
      ...[
        ['role-operator', 'Operator'],
      ].map(([id, name]) => ({
        id,
        name,
        description: `${name} access`,
        status: 'ACTIVE' as const,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      })),
    ];

    const bootstrap =
      process.env.ADMIN_BOOTSTRAP_PASSWORD || (isProduction() ? '' : DEFAULT_ADMIN_PASSWORD);
    this.users = bootstrap
      ? [
          {
            id: 'usr-admin-01',
            name: 'Administrator',
            username: DEFAULT_ADMIN_USERNAME,
            email: DEFAULT_ADMIN_EMAIL,
            roleId: 'role-admin',
            role: 'admin',
            badgeId: 'P2G-ADMIN-001',
            status: 'ACTIVE',
            passwordHash: hashPassword(bootstrap),
            mustChangePassword: false,
            loginAttempts: 0,
            otpAttempts: 0,
          },
        ]
      : [];

    this.products = [];
    this.suppliers = [
      { id: 'sup-eve', code: 'EVE', name: 'EVE Energy Co., Ltd.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 108.0, ratingScore: 98 },
      { id: 'sup-catl', code: 'CATL', name: 'Contemporary Amperex Technology (CATL)', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 110.0, ratingScore: 99 },
      { id: 'sup-gotion', code: 'GOTION', name: 'Gotion High-Tech Inc.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 105.0, ratingScore: 95 },
    ];
    this.cells = new Map();
    this.bmsUnits = new Map();
    this.bmuUnits = new Map();
    this.modules = new Map();
    this.batteries = new Map();
    this.orders = new Map();
    this.auditLogs = [];
    this.quarantineRecords = [];
    this.imports = [];
    this.seedMachines();
  }

  private seedDemoMonitoringData() {
    if (this.cells.size > 0 || this.batteries.size > 0 || this.orders.size > 0) return;

    const now = Date.now();
    const iso = (offsetDays: number, hour = 12) => {
      const d = new Date(now - offsetDays * 86400000 + hour * 3600000);
      return d.toISOString();
    };

    const cellStatuses = [
      { status: 'AVAILABLE', lifecycleStatus: 'IN_STOCK', count: 12450 },
      { status: 'RESERVED', lifecycleStatus: 'IN_STOCK', count: 980 },
      { status: 'IN_PROCESS', lifecycleStatus: 'IN_PACK', count: 2850 },
      { status: 'ASSEMBLED', lifecycleStatus: 'IN_MODULE', count: 3100 },
      { status: 'QUARANTINED', lifecycleStatus: 'SCRAP', count: 100 },
      { status: 'AVAILABLE', lifecycleStatus: 'FLOOR_STOCK', count: 5200 },
      { status: 'PASSED', lifecycleStatus: 'IN_RACK', count: 900 },
      { status: 'FAILED', lifecycleStatus: 'SCRAP', count: 400 },
    ] as const;

    let index = 0;
    for (const entry of cellStatuses) {
      for (let i = 0; i < entry.count; i += 1) {
        const cellId = `cell-demo-${index + 1}`;
        const cell: CellItem = {
          id: cellId,
          internalSerial: `P2G-C-${String(index + 1).padStart(6, '0')}`,
          supplierBarcode: `SUP-${String(index + 1).padStart(6, '0')}`,
          supplierId: 'sup-eve',
          supplierName: 'EVE Energy Co., Ltd.',
          batchNumber: `BATCH-${String(Math.floor(index / 100) + 1).padStart(3, '0')}`,
          palletNumber: `PAL-${String(Math.floor(index / 50) + 1).padStart(3, '0')}`,
          boxNumber: `BOX-${String(Math.floor(index / 10) + 1).padStart(3, '0')}`,
          manufacturingDate: iso(25 + (index % 7), 9),
          supplierCapacityAh: 108.4,
          supplierOcvV: 3.304,
          supplierIrMilliOhm: 0.18,
          supplierIrMohm: 180,
          supplierGrade: 'A',
          productionOcvV: 3.302 + ((index % 15) * 0.0007),
          productionIrMilliOhm: 0.16 + ((index % 11) * 0.008),
          productionIrMohm: 160 + (index % 25),
          productionCapacityAh: 108.1,
          productionGrade: 'A',
          measurementMethod: 'MACHINE_AUTO',
          testedAt: iso(Math.floor(index / 1250) + 1, 10),
          testedBy: 'AUTO-OCV-01',
          testMachineId: 'MC-OCV-01',
          status: entry.status,
          lifecycleStatus: entry.lifecycleStatus,
          createdAt: iso(45 + (index % 18), 8),
          updatedAt: iso(1 + (index % 7), 15),
        };
        this.cells.set(cellId, cell);
        index += 1;
      }
    }

    const demoProducts = [
      { id: 'product-5kwh', name: '5 kWh Battery Pack' },
      { id: 'product-7kwh', name: '7.5 kWh Battery Pack' },
    ];

    const orderTemplate = [
      { orderNumber: 'PO-2026-1001', productId: 'product-5kwh', productName: '5 kWh Battery Pack', quantityPlanned: 18, quantityCompleted: 18, quantityInProcess: 4, status: 'IN_PROCESS' as const },
      { orderNumber: 'PO-2026-1002', productId: 'product-7kwh', productName: '7.5 kWh Battery Pack', quantityPlanned: 22, quantityCompleted: 16, quantityInProcess: 5, status: 'IN_PROCESS' as const },
      { orderNumber: 'PO-2026-1003', productId: 'product-5kwh', productName: '5 kWh Battery Pack', quantityPlanned: 12, quantityCompleted: 12, quantityInProcess: 0, status: 'COMPLETED' as const },
      { orderNumber: 'PO-2026-1004', productId: 'product-7kwh', productName: '7.5 kWh Battery Pack', quantityPlanned: 10, quantityCompleted: 10, quantityInProcess: 0, status: 'COMPLETED' as const },
    ];

    orderTemplate.forEach((order, idx) => {
      const id = `order-demo-${idx + 1}`;
      this.orders.set(id, {
        id,
        orderNumber: order.orderNumber,
        productId: order.productId,
        productSku: order.productId,
        productName: order.productName,
        quantityPlanned: order.quantityPlanned,
        quantityCompleted: order.quantityCompleted,
        quantityInProcess: order.quantityInProcess,
        quantityFailed: 0,
        status: order.status,
        requiredCells: 12,
        availableCells: 16,
        reservedCells: 8,
        shortageCells: 0,
        requiredBms: 1,
        availableBms: 2,
        reservedBms: 1,
        shortageBms: 0,
        batteryIds: [],
        createdBy: 'usr-admin-01',
        createdAt: iso(8 + idx, 9),
        updatedAt: iso(1 + idx, 15),
      });
    });

    for (let i = 0; i < 59; i += 1) {
      const batteryId = `battery-demo-${i + 1}`;
      const isLatest = i > 48;
      const battery: BatteryUnit = {
        id: batteryId,
        serialNumber: `P2G-BATT-${String(i + 1).padStart(5, '0')}`,
        qrCode: `QR-${String(i + 1).padStart(5, '0')}`,
        productionOrderId: this.orders.keys().next().value || 'order-demo-1',
        productId: demoProducts[i % demoProducts.length].id,
        productName: demoProducts[i % demoProducts.length].name,
        currentStep: isLatest ? 'FINAL_QC' : 'RELEASED',
        progressPercent: 100,
        status: 'FINISHED',
        packTemplateCode: i % 2 === 0 ? 'PACK_5KWH' : 'PACK_7_5KWH',
        lifecycleStatus: 'SOLD',
        modules: [],
        stepResults: { FINAL_TESTING: { stepName: 'FINAL_TESTING', status: 'PASSED', mode: 'AUTO', completedAt: iso(1 + (i % 5), 12), completedBy: 'AUTO-TESTER' } },
        finalQcResult: {
          status: 'PASSED',
          packVoltageV: 52.4 + ((i % 3) * 0.2),
          internalResistanceMilliOhm: 0.15 + ((i % 5) * 0.01),
          hiPotInsulationMOhm: 120 + (i % 20),
          bmsTelemetryOk: true,
          thermalSensorDeltaC: 0.2,
          enclosureVisualOk: true,
          testedBy: 'QC-01',
          testedAt: iso(1 + (i % 6), 16),
        },
        createdAt: iso(18 + (i % 12), 8),
        updatedAt: iso(1 + (i % 7), 14),
      };
      this.batteries.set(batteryId, battery);
    }

    for (let i = 0; i < 12; i += 1) {
      const batteryId = `battery-demo-wip-${i + 1}`;
      const battery: BatteryUnit = {
        id: batteryId,
        serialNumber: `P2G-WIP-${String(i + 1).padStart(5, '0')}`,
        qrCode: `QR-WIP-${String(i + 1).padStart(5, '0')}`,
        productionOrderId: 'order-demo-1',
        productId: demoProducts[i % demoProducts.length].id,
        productName: demoProducts[i % demoProducts.length].name,
        currentStep: ['CELL_TESTING', 'MODULE_MATE', 'PACK_ASSEMBLY', 'FINAL_QC'][i % 4],
        progressPercent: [35, 55, 72, 88][i % 4],
        status: 'IN_PROCESS',
        packTemplateCode: i % 2 === 0 ? 'PACK_5KWH' : 'PACK_7_5KWH',
        lifecycleStatus: 'IN_PACK',
        modules: [],
        stepResults: {
          CELL_TESTING: { stepName: 'CELL_TESTING', status: 'PASSED', mode: 'AUTO', completedAt: iso(2 + i, 10), completedBy: 'AUTO-OCV-01' },
          MODULE_MATE: { stepName: 'MODULE_MATE', status: i % 2 === 0 ? 'PASSED' : 'EXECUTING', mode: 'AUTO', completedAt: iso(1 + i, 11), completedBy: 'AUTOMATION' },
        },
        createdAt: iso(3 + i, 8),
        updatedAt: iso(1 + (i % 5), 14),
      };
      this.batteries.set(batteryId, battery);
    }

    this.auditLogs = [
      { id: 'audit-demo-1', userId: 'usr-admin-01', userName: 'Administrator', userRole: 'admin', action: 'Production output updated', entityType: 'SYSTEM', entityId: 'CEO-DASHBOARD', timestamp: iso(0, 9) },
      { id: 'audit-demo-2', userId: 'usr-admin-01', userName: 'Administrator', userRole: 'admin', action: 'Inventory sync completed', entityType: 'IMPORT', entityId: 'SUPPLIER-EVE', timestamp: iso(1, 8) },
    ];
  }

  private seedMachines() {
    const ping = new Date().toISOString();
    this.machines.set('MC-OCV-01', {
      id: 'MC-OCV-01',
      name: 'Hioki BT3562 Auto OCV/IR Station',
      type: 'OCV_IR_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.45',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'HIOKI-BT3562-PRO',
    });
    this.machines.set('MC-WELD-01', {
      id: 'MC-WELD-01',
      name: 'Trumpf TruDisk 3kW Laser Welder #1',
      type: 'LASER_WELDER',
      status: 'ONLINE',
      ipAddress: '192.168.10.50',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'TRUMPF-TRUDISK-3000',
    });
    this.machines.set('MC-BMS-01', {
      id: 'MC-BMS-01',
      name: 'Kvaser CAN-Tester & Calibration Rig',
      type: 'BMS_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.62',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'KVASER-LEAF-CAN-CAL',
    });
    this.machines.set('MC-DYN-01', {
      id: 'MC-DYN-01',
      name: 'Chroma 17020 Final Pack Dyn Load 100A',
      type: 'FINAL_DYN_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.80',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'CHROMA-17020E-500V',
    });
  }

  private ensureConfigSeeded(): boolean {
    let dirty = false;
    const roleDefaults = [['role-operator', 'Operator']];
    if (this.roles.length === 0) {
      this.seedConfigurationOnly();
      return true;
    }
    for (const [id, name] of roleDefaults) {
      if (!this.roles.some(role => role.id === id)) {
        this.roles.push({ id, name, description: `${name} access`, status: 'ACTIVE', permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        dirty = true;
      }
    }
    if (this.machines.size === 0) {
      this.seedMachines();
      dirty = true;
    }
    if (this.suppliers.length === 0) {
      this.suppliers = [
        { id: 'sup-eve', code: 'EVE', name: 'EVE Energy Co., Ltd.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 108.0, ratingScore: 98 },
        { id: 'sup-catl', code: 'CATL', name: 'Contemporary Amperex Technology (CATL)', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 110.0, ratingScore: 99 },
        { id: 'sup-gotion', code: 'GOTION', name: 'Gotion High-Tech Inc.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 105.0, ratingScore: 95 },
      ];
      dirty = true;
    }
    if (!isProduction()) {
      const admin = this.users.find(u => u.id === 'usr-admin-01' || u.username === 'admin');
      const bootstrap = process.env.ADMIN_BOOTSTRAP_PASSWORD || DEFAULT_ADMIN_PASSWORD;
      if (admin) {
        admin.email = DEFAULT_ADMIN_EMAIL;
        admin.username = DEFAULT_ADMIN_USERNAME;
        admin.status = 'ACTIVE';
        admin.roleId = 'role-admin';
        admin.role = 'admin';
        admin.passwordHash = hashPassword(bootstrap);
        admin.loginAttempts = 0;
        admin.lockedUntil = null;
        dirty = true;
      }
    }
    return dirty;
  }

  addAuditLog(
    userId: string,
    action: string,
    entityType: 'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'ORDER' | 'QC' | 'IMPORT' | 'SYSTEM' | 'AUTH',
    entityId: string,
    oldValue?: string,
    newValue?: string,
    reason?: string
  ) {
    const user = this.users.find(u => u.id === userId) || { name: 'System Auto', role: 'admin' as const };
    const log: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      userId,
      userName: user.name,
      userRole: user.role,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 5000) this.auditLogs.pop();
  }

  matchCellsForModule(availableCells: CellItem[], requiredCount: number, rules: any): { matched: CellItem[]; score: number; metrics: any } | null {
    if (availableCells.length < requiredCount) return null;
    const validCells = availableCells.filter(c =>
      c.status === 'AVAILABLE' || c.status === 'RESERVED' || c.status === 'VALIDATING' || c.status === 'PASSED'
    );
    if (validCells.length < requiredCount) return null;
    validCells.sort((a, b) => (a.supplierCapacityAh || 108) - (b.supplierCapacityAh || 108));
    let bestWindow: CellItem[] = [];
    let bestSpread = Infinity;
    for (let i = 0; i <= validCells.length - requiredCount; i++) {
      const window = validCells.slice(i, i + requiredCount);
      const caps = window.map(c => c.productionCapacityAh || c.supplierCapacityAh || 108);
      const ocvs = window.map(c => c.productionOcvV || c.supplierOcvV || 3.30);
      const irs = window.map(c => c.productionIrMilliOhm || c.supplierIrMilliOhm || 0.25);
      const cost = (Math.max(...caps) - Math.min(...caps)) * 10 + (Math.max(...ocvs) - Math.min(...ocvs)) * 1000 + (Math.max(...irs) - Math.min(...irs)) * 20;
      if (cost < bestSpread) {
        bestSpread = cost;
        bestWindow = window;
      }
    }
    if (bestWindow.length < requiredCount) return null;
    const caps = bestWindow.map(c => c.productionCapacityAh || c.supplierCapacityAh || 108);
    const ocvs = bestWindow.map(c => c.productionOcvV || c.supplierOcvV || 3.30);
    const irs = bestWindow.map(c => c.productionIrMilliOhm || c.supplierIrMilliOhm || 0.25);
    return {
      matched: bestWindow,
      score: Math.max(70, Math.min(99.8, Number((100 - (Math.max(...caps) - Math.min(...caps)) * 8 - (Math.max(...ocvs) - Math.min(...ocvs)) * 400 - (Math.max(...irs) - Math.min(...irs)) * 10).toFixed(1)))),
      metrics: {
        avgCapacityAh: Number((caps.reduce((a, b) => a + b, 0) / caps.length).toFixed(4)),
        deltaCapacityAh: Number((Math.max(...caps) - Math.min(...caps)).toFixed(4)),
        avgOcvV: Number((ocvs.reduce((a, b) => a + b, 0) / ocvs.length).toFixed(4)),
        deltaOcvV: Number((Math.max(...ocvs) - Math.min(...ocvs)).toFixed(4)),
        avgIrMilliOhm: Number((irs.reduce((a, b) => a + b, 0) / irs.length).toFixed(4)),
        deltaIrMilliOhm: Number((Math.max(...irs) - Math.min(...irs)).toFixed(4)),
      },
    };
  }
}

export const db = new Database();
