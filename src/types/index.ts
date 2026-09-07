export type UserRole =
  | 'admin'
  | 'production_manager'
  | 'engineering'
  | 'operator'
  | 'qc_inspector'
  | 'supervisor'
  | 'warehouse'
  | 'maintenance'
  | string;

export interface Role {
  id: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  permissions: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  roleId: string;
  role: UserRole;
  permissions?: string[];
  badgeId: string;
  status: 'ACTIVE' | 'INACTIVE';
  avatar?: string;
  // Authentication / security fields (never return passwordHash or OTP material to the client)
  passwordHash?: string | null;
  otpHash?: string | null;
  otpExpiresAt?: string | null;
  otpAttempts?: number;
  otpLastSentAt?: string | null;
  loginAttempts?: number;
  lockedUntil?: string | null;
  passwordChangedAt?: string | null;
  mustChangePassword?: boolean;
}

export type ComponentStatus =
  | 'EMPTY'
  | 'RECEIVED'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'IN_PROCESS'
  | 'SCANNED'
  | 'VALIDATING'
  | 'TESTING'
  | 'PASSED'
  | 'FAILED'
  | 'QUARANTINED'
  | 'REWORK'
  | 'ASSEMBLED'
  | 'FINISHED'
  | 'DISPATCHED';

export type LifecycleStatus = 'IN_STOCK' | 'FLOOR_STOCK' | 'IN_MODULE' | 'IN_PACK' | 'IN_RACK' | 'SOLD' | 'SCRAP';

export interface RackUnit {
  id: string;
  serialNumber: string;
  qrCode: string;
  rackTemplateCode: 'RACK_25KWH' | 'RACK_75KWH';
  status: 'IN_STOCK' | 'IN_RACK' | 'SOLD' | 'SCRAP';
  requiredPackCount: number;
  requiredPackTemplateCode: 'PACK_5KWH' | 'PACK_7_5KWH';
  location?: string;
  batteryIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type StepExecutionMode = 'AUTO' | 'MANUAL' | 'BYPASS';

export type StepStatus = 'PENDING' | 'READY' | 'EXECUTING' | 'PASSED' | 'FAILED' | 'BYPASSED';

export interface GradingRules {
  minCapacityAh: number;
  maxCapacityAh: number;
  minOcvV: number;
  maxOcvV: number;
  maxIrMilliOhm: number;
  maxDeltaCapacityPercent: number;
  maxDeltaOcvMv: number;
  maxDeltaIrMilliOhm: number;
}

export interface BMSConfig {
  required: boolean;
  model: string;
  manufacturer?: string;
  type?: string;
  protocol: 'CAN_2.0B' | 'RS485' | 'MODBUS' | string;
  voltage?: number;
  partNumber?: string;
}

export interface BMUConfig {
  required: boolean;
  model?: string;
  manufacturer?: string;
  type?: string;
  protocol?: string;
  partNumber?: string;
}

export interface ProductTemplate {
  id: string;
  sku: string;
  name: string;
  productModel: string;
  batteryName: string;
  voltageType: 'LV' | 'HV';
  nominalVoltageV: number;
  capacityKwh: number;
  totalCapacityAh: number;
  numModules: number;
  cellsPerModule: number;
  totalCells: number;
  moduleConfigurations?: Array<{ type: string; quantity: number; cellsPerModule: number }>;
  bmsModel: string;
  bmsProtocol: 'CAN_2.0B' | 'RS485' | 'MODBUS';
  bmsConfig: BMSConfig;
  bmuConfig: BMUConfig;
  gradingRules: GradingRules;
  qcStages: string[];
  serialPrefix: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  country: string;
  cellChemistry: 'LFP' | 'NMC' | 'LTO';
  nominalCapacityAh: number;
  ratingScore: number;
}

export interface CellItem {
  id: string;
  internalSerial: string;
  supplierBarcode: string;
  supplierId: string;
  supplierName: string;
  batchNumber: string;
  palletNumber: string;
  boxNumber: string;
  manufacturingDate: string;
  
  // Supplier Measurements
  supplierCapacityAh: number;
  supplierOcvV: number;
  supplierIrMilliOhm: number;
  supplierIrMohm: number;
  supplierGrade: string;

  // Production Measurements
  productionOcvV?: number;
  productionIrMilliOhm?: number;
  productionIrMohm?: number;
  productionCapacityAh?: number;
  productionGrade?: string;
  measurementMethod?: 'SUPPLIER_REUSE' | 'MACHINE_AUTO' | 'MANUAL' | 'BYPASS';
  testedAt?: string;
  testedBy?: string;
  testMachineId?: string;

  // Status and allocation
  status: ComponentStatus;
  lifecycleStatus?: LifecycleStatus;
  reservedForOrderId?: string;
  reservedForBatteryId?: string;
  assignedToModuleId?: string;
  moduleSlotIndex?: number;
  quarantineReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BMSItem {
  id: string;
  serialNumber: string;
  model: string;
  supplier: string;
  manufacturer?: string;
  batchNumber?: string;
  firmwareVersion: string;
  hardwareVersion: string;
  protocol: string;
  status: ComponentStatus;
  reservedForOrderId?: string;
  assignedToBatteryId?: string;
  testResult?: {
    status: 'PASSED' | 'FAILED';
    canCommsOk: boolean;
    tempSensorsOk: boolean;
    voltageDeltaMv: number;
    testedAt: string;
    testedBy: string;
  };
  quarantineReason?: string;
  createdAt: string;
}

export interface BMUItem {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer?: string;
  batchNumber?: string;
  protocol?: string;
  status: ComponentStatus;
  reservedForOrderId?: string;
  assignedToBatteryId?: string;
  testResult?: {
    status: 'PASSED' | 'FAILED';
    testedAt: string;
    testedBy: string;
  };
  quarantineReason?: string;
  createdAt: string;
}

export interface ModuleItem {
  id: string;
  serialNumber: string;
  qrCode: string;
  productId: string;
  productionOrderId: string;
  batteryId?: string;
  moduleIndex: number; // 0, 1, ...
  cells: CellItem[];
  matchingScore: number; // 0-100%
  matchingMetrics: {
    avgCapacityAh: number;
    deltaCapacityAh: number;
    avgOcvV: number;
    deltaOcvV: number;
    avgIrMilliOhm: number;
    deltaIrMilliOhm: number;
  };
  weldingResult?: {
    status: 'PASSED' | 'FAILED' | 'BYPASSED';
    machineId: string;
    laserPowerWatts: number;
    weldTimeMs: number;
    pullForceKg: number;
    weldedAt: string;
    operatorId: string;
  };
  qcResult?: {
    status: 'PASSED' | 'FAILED' | 'REWORK';
    physicalVisualOk: boolean;
    busbarResistanceMilliOhm: number;
    packVoltageV: number;
    insulationResistanceMOhm: number;
    inspectedAt: string;
    inspectorId: string;
    notes?: string;
  };
  status: ComponentStatus;
  moduleType?: '8S' | '12S';
  lifecycleStatus?: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BatteryUnit {
  id: string;
  serialNumber: string;
  qrCode: string;
  productionOrderId: string;
  productId: string;
  productName: string;
  currentStep: string;
  progressPercent: number;
  status: ComponentStatus;
  packTemplateCode?: 'PACK_5KWH' | 'PACK_7_5KWH';
  lifecycleStatus?: LifecycleStatus;
  modules: ModuleItem[];
  bms?: BMSItem;
  bmu?: BMUItem;
  
  // Step results
  stepResults: Record<string, {
    stepName: string;
    status: StepStatus;
    mode: StepExecutionMode;
    completedAt?: string;
    completedBy?: string;
    details?: string;
    values?: Record<string, any>;
  }>;

  finalQcResult?: {
    status: 'PASSED' | 'FAILED';
    packVoltageV: number;
    internalResistanceMilliOhm: number;
    hiPotInsulationMOhm: number;
    bmsTelemetryOk: boolean;
    thermalSensorDeltaC: number;
    enclosureVisualOk: boolean;
    testedBy: string;
    testedAt: string;
  };

  customerOrderRef?: string;
  dispatchedTo?: string;
  dispatchedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  productId: string;
  productSku: string;
  productName: string;
  quantityPlanned: number;
  quantityCompleted: number;
  quantityInProcess: number;
  quantityFailed: number;
  status: 'PLANNED' | 'IN_PROCESS' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';
  
  // Material requirements
  requiredCells: number;
  availableCells: number;
  reservedCells: number;
  shortageCells: number;
  
  requiredBms: number;
  availableBms: number;
  reservedBms: number;
  shortageBms: number;

  batteryIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineStation {
  id: string;
  name: string;
  type: 'OCV_IR_TESTER' | 'LASER_WELDER' | 'BMS_TESTER' | 'FINAL_DYN_TESTER';
  status: 'ONLINE' | 'BUSY' | 'OFFLINE' | 'MAINTENANCE';
  ipAddress: string;
  lastPing: string;
  totalRuns: number;
  successRate: number;
  model: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  entityType: 'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'ORDER' | 'QC' | 'IMPORT' | 'SYSTEM' | 'AUTH';
  entityId: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  timestamp: string;
}

export interface QuarantineRecord {
  id: string;
  entityType: 'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'BMU';
  entityId: string;
  entitySerial: string;
  reason: string;
  stage: string;
  quarantinedBy: string;
  quarantinedAt: string;
  disposition?: 'SCRAP' | 'REWORK' | 'RELEASE_APPROVED';
  dispositionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  status: 'OPEN' | 'RESOLVED';
}

export interface SupplierImportSummary {
  id: string;
  filename: string;
  supplierId: string;
  supplierName: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  importedAt: string;
  importedBy: string;
}
