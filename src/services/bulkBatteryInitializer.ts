export type BulkBatteryRow = {
  batterySerialNumber?: string;
  bmuSerialNumber?: string;
  cellQrCodes?: string[];
  cellIds?: string[];
  [key: string]: any;
};

export type BulkBatteryValidationResult = {
  valid: boolean;
  serials: string[];
  duplicates: string[];
  errors: string[];
};

export type ProductTemplateLike = {
  id: string;
  name: string;
  productModel?: string;
  batteryName?: string;
  sku?: string;
  capacityKwh?: number;
  totalCells: number;
  numModules: number;
  cellsPerModule: number;
};

export type AvailableBmuLike = {
  id: string;
  serialNumber: string;
  status?: string;
  reservedForBatteryId?: string | null;
};

export type AvailableCellLike = {
  id: string;
  internalSerial: string;
  supplierBarcode?: string;
  /** QR code scanned from cell — may be same as supplierBarcode in many workflows */
  qrCode?: string;
  status?: string;
  reservedForBatteryId?: string | null;
  reservedForOrderId?: string | null;
  assignedToModuleId?: string | null;
};

export function normalizeBatterySerial(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeBatteryIdentifier(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function resolveExplicitBatteryAssignments(
  rows: BulkBatteryRow[],
  availableBmUs: AvailableBmuLike[],
  availableCells: AvailableCellLike[],
  productTemplate: ProductTemplateLike,
): Array<{ batterySerial: string; bmu?: AvailableBmuLike; cells: AvailableCellLike[]; modules: Array<{ moduleIndex: number; cells: AvailableCellLike[] }> }> {
  const bmuBySerial = new Map<string, AvailableBmuLike>();
  for (const item of availableBmUs) {
    const serial = normalizeBatteryIdentifier(item.serialNumber);
    if (!serial) continue;
    if (!bmuBySerial.has(serial)) bmuBySerial.set(serial, item);
  }

  const usedBmuIds = new Set<string>();
  const usedCellIds = new Set<string>();

  return rows.map((row) => {
    const batterySerial = normalizeBatterySerial(row.batterySerialNumber ?? '');

    // Resolve requested cell references — prefer cellQrCodes then cellIds
    const requestedCellRefs: string[] = (
      Array.isArray(row.cellQrCodes) && row.cellQrCodes.length > 0
        ? row.cellQrCodes
        : Array.isArray(row.cellIds) && row.cellIds.length > 0
          ? row.cellIds
          : []
    ).map((v: string) => normalizeBatteryIdentifier(v)).filter(Boolean);

    // Detect duplicate cell references within this battery — hard error, not warning
    const seenRefs = new Set<string>();
    const duplicateRefs: string[] = [];
    for (const ref of requestedCellRefs) {
      if (seenRefs.has(ref)) duplicateRefs.push(ref);
      seenRefs.add(ref);
    }
    if (duplicateRefs.length > 0) {
      throw new Error(
        `Battery ${batterySerial} has ${duplicateRefs.length} duplicate cell QR code(s): ` +
        `${duplicateRefs.slice(0, 5).join(', ')}${duplicateRefs.length > 5 ? '...' : ''}. ` +
        `Each cell must appear exactly once per battery.`,
      );
    }

    // Match each QR code reference against available cell pool
    const matchedCells = requestedCellRefs.map(ref => {
      const match = availableCells.find(cell => {
        const candidates = [
          cell.id,
          cell.internalSerial,
          cell.supplierBarcode,
          cell.qrCode,
        ].map(v => normalizeBatteryIdentifier(String(v ?? '')));
        return candidates.includes(ref);
      });
      if (!match) {
        throw new Error(
          `Battery ${batterySerial} references cell '${ref}' that was not found in available inventory. ` +
          `Ensure the cell is imported via the Supplier Manifest before importing batteries.`,
        );
      }
      return match;
    });

    // Validate all matched cells have IDs
    const invalidCells = matchedCells.filter(cell => !cell.id);
    if (invalidCells.length > 0) {
      throw new Error(
        `Battery ${batterySerial} has ${invalidCells.length} matched cells with missing IDs — data integrity issue.`,
      );
    }

    // Verify exact cell count matches product template
    if (matchedCells.length !== productTemplate.totalCells) {
      throw new Error(
        `Battery ${batterySerial} must use exactly ${productTemplate.totalCells} cells ` +
        `(${productTemplate.numModules} modules × ${productTemplate.cellsPerModule} cells), ` +
        `but ${matchedCells.length} were provided via ${requestedCellRefs.length} QR codes.`,
      );
    }

    // Cross-battery duplicate check — same cell cannot be in two batteries in this batch
    for (const cell of matchedCells) {
      if (usedCellIds.has(cell.id)) {
        throw new Error(
          `Cell '${cell.internalSerial || cell.supplierBarcode || cell.id}' is assigned to more than one battery in this batch.`,
        );
      }
      usedCellIds.add(cell.id);
    }

    // Resolve BMU
    let assignedBmu: AvailableBmuLike | undefined;
    if (row.bmuSerialNumber) {
      const explicitBmuRef = normalizeBatteryIdentifier(row.bmuSerialNumber);
      const match = bmuBySerial.get(explicitBmuRef);
      if (!match) {
        throw new Error(
          `BMU serial '${row.bmuSerialNumber}' was not found in available BMU inventory. ` +
          `Ensure the BMU is imported before importing batteries.`,
        );
      }
      if (usedBmuIds.has(match.id)) {
        throw new Error(`BMU '${match.serialNumber}' is assigned to more than one battery in this batch.`);
      }
      assignedBmu = match;
      usedBmuIds.add(match.id);
    }

    // Distribute cells across modules
    const moduleAssignments = Array.from({ length: productTemplate.numModules }, (_, moduleIndex) => ({
      moduleIndex,
      cells: matchedCells.slice(
        moduleIndex * productTemplate.cellsPerModule,
        (moduleIndex + 1) * productTemplate.cellsPerModule,
      ),
    }));

    return {
      batterySerial,
      bmu: assignedBmu,
      cells: matchedCells,
      modules: moduleAssignments,
    };
  });
}

export function validateBulkBatteryRows(rows: BulkBatteryRow[]): BulkBatteryValidationResult {
  const serials: string[] = [];
  const duplicates = new Set<string>();
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const value = normalizeBatterySerial(row?.batterySerialNumber ?? '');
    if (!value) {
      errors.push(`Row ${index + 2}: missing battery serial number`);
      continue;
    }

    if (serials.includes(value)) {
      if (!duplicates.has(value)) {
        // Emit exactly one error per unique duplicate serial
        errors.push(`Row ${index + 2}: duplicate battery serial '${value}' — already used in this file`);
        duplicates.add(value);
      }
      continue;
    }

    serials.push(value);
  }

  return {
    valid: errors.length === 0,
    serials,
    duplicates: Array.from(duplicates),
    errors,
  };
}

export function normalizeBatteryProductTemplate(product: ProductTemplateLike): ProductTemplateLike {
  const haystack = [product.name, product.productModel, product.batteryName, product.sku]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const is7_5Product =
    haystack.includes('7.5')
    || haystack.includes('7k5')
    || haystack.includes('7_5')
    || Number(product.capacityKwh ?? 0) === 7.5
    || (Number(product.capacityKwh ?? 0) >= 7 && Number(product.capacityKwh ?? 0) <= 8);

  if (!is7_5Product) {
    return product;
  }

  return {
    ...product,
    numModules: 2,
    cellsPerModule: 12,
    totalCells: 24,
    capacityKwh: 7.5,
  };
}

export function resolveBatteryTemplate(products: ProductTemplateLike[], preferredName = '7.5'): ProductTemplateLike {
  const normalized = preferredName.toLowerCase();

  if (products.length === 0) {
    throw new Error('No product templates were provided for the bulk battery initialization.');
  }

  const exactMatch = products.find(product => {
    const haystack = [product.name, product.productModel, product.batteryName, product.sku]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const normalizedProduct = normalizeBatteryProductTemplate(product);

    return (
      normalizedProduct.numModules === 2
      && normalizedProduct.cellsPerModule === 12
      && normalizedProduct.totalCells === 24
      && (
        haystack.includes(normalized)
        || haystack.includes('7k5')
        || haystack.includes('7_5')
        || Number(product.capacityKwh ?? 0) === 7.5
      )
    );
  });

  if (exactMatch) return normalizeBatteryProductTemplate(exactMatch);

  const directMatch = products.find(product => {
    const haystack = [product.name, product.productModel, product.batteryName, product.sku]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalized)
      || haystack.includes('7k5')
      || haystack.includes('7_5')
      || product.capacityKwh === 7.5;
  });

  if (directMatch) return normalizeBatteryProductTemplate(directMatch);

  const approx = products.find(product => Number(product.capacityKwh ?? 0) >= 7 && Number(product.capacityKwh ?? 0) <= 8);
  if (approx) return normalizeBatteryProductTemplate(approx);

  // Last resort: any product that resolves to 2×12 structure
  const byStructure = products.find(product => {
    const n = normalizeBatteryProductTemplate(product);
    return n.numModules === 2 && n.cellsPerModule === 12 && n.totalCells === 24;
  });
  if (byStructure) return normalizeBatteryProductTemplate(byStructure);

  throw new Error(
    `No matching product template found for the bulk battery import (expected 2 modules × 12 cells = 24 total). ` +
    `Ensure a 7.5 kWh battery product template is configured in the Product Catalog.`,
  );
}

export function selectAvailableBmUs(items: AvailableBmuLike[], count: number): AvailableBmuLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    const unavailableStatuses = ['QUARANTINED', 'FAILED', 'ARCHIVED'];
    return !unavailableStatuses.includes(status) && !item.reservedForBatteryId;
  });

  if (pool.length < count) {
    throw new Error(`Insufficient available BMUs: required ${count}, available ${pool.length}.`);
  }

  return pool.slice(0, count);
}

export function selectRequiredCells(items: AvailableCellLike[], requiredCount: number): AvailableCellLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    const unavailableStatuses = ['QUARANTINED', 'REJECTED', 'RESERVED', 'MODULE_ASSIGNED'];
    return !unavailableStatuses.includes(status) && !item.reservedForBatteryId && !item.reservedForOrderId && !item.assignedToModuleId;
  });

  if (pool.length < requiredCount) {
    throw new Error(`Insufficient unallocated cells: required ${requiredCount}, available ${pool.length}.`);
  }

  return pool.slice(0, requiredCount);
}

export function buildModulePlan(
  battery: {
    batterySerial: string;
    cells: { id: string }[];
    bmu?: { id?: string; serialNumber?: string };
  },
  product: ProductTemplateLike,
  productionOrderId: string,
  batteryId: string,
) {
  const cellsPerModule = Math.max(1, product.cellsPerModule || Math.ceil(product.totalCells / Math.max(1, product.numModules)));
  const modules: Array<{
    id: string;
    serialNumber: string;
    qrCode: string;
    productionOrderId: string;
    batteryId: string;
    moduleIndex: number;
    status: string;
    matchingScore: number;
    matchingMetrics: Record<string, number>;
    cellIds: string[];
  }> = [];
  const now = new Date();
  const dateStamp = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (let moduleIndex = 0; moduleIndex < product.numModules; moduleIndex += 1) {
    const start = moduleIndex * cellsPerModule;
    const end = start + cellsPerModule;
    const cellIds = battery.cells.slice(start, end).map(cell => cell.id);
    const moduleNumber = moduleIndex + 1;
    const uniqueSerial = `P2G-MOD-${dateStamp}-${Date.now()}-${String(moduleNumber).padStart(5, '0')}`;

    modules.push({
      id: `mod-${batteryId}-${moduleIndex}`,
      serialNumber: uniqueSerial,
      qrCode: `${uniqueSerial}|${product.sku || product.name || 'BATTERY'}|BATTERY:${battery.batterySerial}`,
      productionOrderId,
      batteryId,
      moduleIndex,
      status: 'CREATED',
      matchingScore: 0,
      matchingMetrics: {
        avgCapacityAh: 0,
        deltaCapacityAh: 0,
        avgOcvV: 0,
        deltaOcvV: 0,
        avgIrMilliOhm: 0,
        deltaIrMilliOhm: 0,
      },
      cellIds,
    });
  }

  return modules;
}

export function buildCompletedBatteryReleasePlan({
  batteryId,
  batterySerial,
  moduleCount,
  bmuId,
  userId,
  createdAt,
}: {
  batteryId: string;
  batterySerial: string;
  moduleCount: number;
  bmuId?: string;
  userId?: string;
  createdAt?: Date;
}) {
  const testTimestamp = createdAt || new Date();
  const moduleTests = Array.from({ length: Math.max(0, moduleCount) * 2 }, (_, index) => ({
    id: `mtest-${batteryId}-${index}`,
    moduleId: `mod-${batteryId}-${Math.floor(index / 2)}`,
    testType: index % 2 === 0 ? 'WELDING_INSPECTION' : 'QC',
    passed: true,
    resultJson: { status: 'PASSED', checkedAt: testTimestamp.toISOString(), checkedBy: userId || 'SYSTEM' },
    remarks: 'Auto-approved for uploaded production batch',
    testedBy: userId || 'SYSTEM',
    testedAt: testTimestamp.toISOString(),
  }));

  const batteryTest = {
    id: `btest-${batteryId}`,
    batteryId,
    testType: 'EOL',
    passed: true,
    resultJson: {
      status: 'PASSED',
      mode: 'AUTO',
      qcTesting: 'PASSED',
      batterySerial,
      checkedAt: testTimestamp.toISOString(),
      checkedBy: userId || 'SYSTEM',
    },
    testedBy: userId || 'SYSTEM',
    testedAt: testTimestamp.toISOString(),
  };

  const release = {
    batteryId,
    status: 'RELEASED',
    currentStep: 'RELEASED',
    progressPercent: 100,
    updatedAt: testTimestamp.toISOString(),
    bmuId,
    releaseNotes: 'Auto-approved for uploaded batch final release',
  };

  return {
    moduleTests,
    batteryTest,
    release,
  };
}

export function dedupeModuleCellAssignments<T extends string | { id?: string; cell_id?: string }>(cellIds: T[]): Array<T> {
  const seen = new Set<string>();
  const duplicatesRemoved: string[] = [];

  const result = cellIds.filter(cellId => {
    const value = typeof cellId === 'string'
      ? String(cellId ?? '')
      : String(cellId?.id ?? cellId?.cell_id ?? '');

    if (!value) {
      console.warn(`⚠️  Empty/undefined cell ID encountered during deduplication`);
      return false;
    }
    if (seen.has(value)) {
      duplicatesRemoved.push(value);
      return false;
    }
    seen.add(value);
    return true;
  });

  if (duplicatesRemoved.length > 0) {
    console.error(
      `❌ Deduplication removed ${duplicatesRemoved.length} duplicate cell IDs: ` +
      `[${duplicatesRemoved.slice(0, 5).join(', ')}${duplicatesRemoved.length > 5 ? '...' : ''}].`,
    );
  }

  return result;
}

export async function createBulkBatteryInitialization({
  rows,
  products,
  availableBmUs,
  availableCells,
  userId,
}: {
  rows: BulkBatteryRow[];
  products: ProductTemplateLike[];
  availableBmUs: AvailableBmuLike[];
  availableCells: AvailableCellLike[];
  userId?: string;
}) {
  const validation = validateBulkBatteryRows(rows);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  if (rows.length === 0) {
    throw new Error('No battery rows were provided for initialization.');
  }

  const productTemplate = resolveBatteryTemplate(products, '7.5');
  const requiredBmuCount = rows.length;
  const totalRequiredCells = productTemplate.totalCells * rows.length;

  // A row has explicit cell mapping if it provides QR codes OR cell IDs
  const hasExplicitCellMaps = rows.some(
    row =>
      (Array.isArray(row.cellQrCodes) && row.cellQrCodes.length > 0) ||
      (Array.isArray(row.cellIds) && row.cellIds.length > 0),
  );

  // If any row uses explicit cells, ALL rows must have them — no mixing allowed
  if (hasExplicitCellMaps) {
    const rowsMissingCells = rows.filter(
      row =>
        (!Array.isArray(row.cellQrCodes) || row.cellQrCodes.length === 0) &&
        (!Array.isArray(row.cellIds) || row.cellIds.length === 0),
    );
    if (rowsMissingCells.length > 0) {
      const serials = rowsMissingCells
        .map(r => normalizeBatterySerial(r.batterySerialNumber ?? ''))
        .slice(0, 5)
        .join(', ');
      throw new Error(
        `${rowsMissingCells.length} battery row(s) are missing cell QR codes while other rows have explicit cells: ${serials}. ` +
        `Either all batteries must have cell assignments or none.`,
      );
    }
  }

  const bmuPool = hasExplicitCellMaps
    ? availableBmUs.filter(item => {
        const status = String(item.status ?? '').toUpperCase();
        const unavailableStatuses = ['QUARANTINED', 'FAILED', 'ARCHIVED'];
        return !unavailableStatuses.includes(status) && !item.reservedForBatteryId;
      })
    : selectAvailableBmUs(availableBmUs, requiredBmuCount);

  const selectedCells = hasExplicitCellMaps
    ? availableCells.filter(item => {
        const status = String(item.status ?? '').toUpperCase();
        const unavailableStatuses = ['QUARANTINED', 'REJECTED', 'RESERVED', 'MODULE_ASSIGNED'];
        return !unavailableStatuses.includes(status)
          && !item.reservedForBatteryId
          && !item.reservedForOrderId
          && !item.assignedToModuleId;
      })
    : selectRequiredCells(availableCells, totalRequiredCells);

  const batteryPlan = hasExplicitCellMaps
    ? resolveExplicitBatteryAssignments(rows, bmuPool, selectedCells, productTemplate).map((battery, index) => ({
        rowIndex: index + 2,
        batterySerial: battery.batterySerial,
        bmu: battery.bmu,
        cells: battery.cells,
        modules: battery.modules,
        genealogy: {
          batterySerial: battery.batterySerial,
          bmuId: battery.bmu?.id,
          bmuSerial: battery.bmu?.serialNumber,
          cellIds: battery.cells.map(cell => cell.id),
        },
      }))
    : rows.map((row, index) => {
        const batterySerial = normalizeBatterySerial(row.batterySerialNumber ?? '');
        const assignedBmu = bmuPool[index];
        const cellStart = index * productTemplate.totalCells;
        const cellSlice = selectedCells.slice(cellStart, cellStart + productTemplate.totalCells);
        if (cellSlice.length !== productTemplate.totalCells) {
          throw new Error(`Battery ${batterySerial} could not allocate the required ${productTemplate.totalCells} cells.`);
        }

        const moduleAssignments = Array.from({ length: productTemplate.numModules }, (_, moduleIndex) => ({
          moduleIndex,
          cells: cellSlice.slice(moduleIndex * productTemplate.cellsPerModule, (moduleIndex + 1) * productTemplate.cellsPerModule),
        }));

        return {
          rowIndex: index + 2,
          batterySerial,
          bmu: assignedBmu,
          cells: cellSlice,
          modules: moduleAssignments,
          genealogy: {
            batterySerial,
            bmuId: assignedBmu?.id,
            bmuSerial: assignedBmu?.serialNumber,
            cellIds: cellSlice.map(cell => cell.id),
          },
        };
      });

  return {
    valid: true,
    batchSize: rows.length,
    template: productTemplate,
    order: {
      type: 'BULK_BATTERY_INITIALIZATION',
      productId: productTemplate.id,
      quantity: rows.length,
      productName: productTemplate.name,
      requiredCells: totalRequiredCells,
      requiredBmUs: requiredBmuCount,
    },
    batteries: batteryPlan,
    validation,
  };
}
