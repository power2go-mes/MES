import * as XLSX from 'xlsx-js-style';
import { BatteryUnit, CellItem, ModuleItem, RackUnit } from '../types';

const exportColors = {
  green: '10A36D',
  blue: '2979C7',
  amber: 'F4A62A',
  red: 'DC3545',
  slate: '64748B',
  silver: 'C0C0C0',
  navy: '101828',
  light: 'EAF7F2',
  border: 'E2E8F0',
  white: 'FFFFFF',
} as const;

const exportStatusColors: Record<string, string> = {
  'IN STOCK': exportColors.green,
  'FLOOR STOCK': exportColors.amber,
  'IN MODULE': exportColors.green,
  'IN PACK': exportColors.green,
  'IN RACK': exportColors.green,
  'KARACHI WAREHOUSE': exportColors.green,
  'LAHORE WAREHOUSE': exportColors.green,
  SOLD: exportColors.green,
  SCRAP: exportColors.red,
  RECYCLE: exportColors.green,
};

const exportDate = (value?: string) => value ? new Date(value).toLocaleString() : '';
const exportDateOnly = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${date.getUTCFullYear()}`;
};
const exportRackType = (value?: string) => String(value || '')
  .replace(/^RACK_/i, '')
  .replace(/70KWH$/i, '69.7kWh')
  .replace(/KWH$/i, 'kWh');
const normalizeClientName = (value: unknown) => {
  const name = String(value || '').trim();
  const midpoint = Math.floor(name.length / 2);
  const firstHalf = name.slice(0, midpoint).trim();
  const secondHalf = name.slice(midpoint).trim();
  return firstHalf && firstHalf === secondHalf ? firstHalf : name;
};
const exportBatterySerial = (battery: BatteryUnit) => {
  const serial = battery.serialNumber || (battery as any).serial_number || battery.id;
  const capacity = Number((battery as any).capacityKwh ?? (battery as any).capacity_kwh ?? (battery as any).product_templates?.capacity_kwh);
  const productName = String(battery.productName || (battery as any).product_name || (battery as any).product_templates?.name || '');
  const configuredCapacity = Number.isFinite(capacity) && capacity > 0
    ? capacity
    : Number(productName.match(/(\d+(?:\.\d+)?)\s*kwh/i)?.[1] || 0);
  const capacityLabel = configuredCapacity >= 7 && configuredCapacity <= 8
    ? '7.5'
    : Math.abs(configuredCapacity - 5) < 0.001
      ? '5'
      : '';
  return capacityLabel
    ? String(serial).replace(/^P2G-BP-[^-]+KWH(?=-)/i, `P2G-BP-${capacityLabel}KWH`)
    : String(serial);
};

const autoFitColumns = (sheet: XLSX.WorkSheet, rows: Record<string, unknown>[]) => {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  sheet['!cols'] = headers.map(header => {
    const longestValue = Math.max(
      header.length,
      ...rows.map(row => String(row[header] ?? '').length),
    );
    return { wch: Math.min(Math.max(longestValue + 2, 10), 45) };
  });
};

const centerAlignSheet = (sheet: XLSX.WorkSheet) => {
  const range = sheet['!ref'];
  if (!range) return;
  const decodedRange = XLSX.utils.decode_range(range);
  for (let row = decodedRange.s.r; row <= decodedRange.e.r; row += 1) {
    for (let column = decodedRange.s.c; column <= decodedRange.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      if (cell) {
        cell.s = {
          ...(cell.s || {}),
          alignment: {
            ...(cell.s?.alignment || {}),
            horizontal: 'center',
            vertical: 'center',
          },
        };
      }
    }
  }
};

const styleExportSheet = (sheet: XLSX.WorkSheet, colorStatusCells = true) => {
  const range = sheet['!ref'];
  if (!range) return;
  const decodedRange = XLSX.utils.decode_range(range);
  const headers = Array.from({ length: decodedRange.e.c - decodedRange.s.c + 1 }, (_, offset) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: decodedRange.s.r, c: decodedRange.s.c + offset })];
    return String(cell?.v || '').trim();
  });
  const statusColumns = headers
    .map((header, index) => ({ header: header.toUpperCase(), index }))
    .filter(({ header }) => ['CLASSIFICATION', 'STATUS', 'LOCATION'].includes(header));

  for (let column = decodedRange.s.c; column <= decodedRange.e.c; column += 1) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: decodedRange.s.r, c: column })];
    if (headerCell) {
      headerCell.s = {
        ...(headerCell.s || {}),
        font: { ...(headerCell.s?.font || {}), bold: true },
        border: { bottom: { style: 'thin', color: exportColors.border } },
      };
    }
  }

  if (!colorStatusCells) return;

  for (let row = decodedRange.s.r + 1; row <= decodedRange.e.r; row += 1) {
    statusColumns.forEach(({ index }) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index })];
      const status = String(cell?.v || '').trim().replace(/[_-]+/g, ' ').toUpperCase();
      const color = exportStatusColors[status];
      if (!cell || !color) return;
      cell.s = {
        ...(cell.s || {}),
        fill: { fgColor: { rgb: color } },
        font: { ...(cell.s?.font || {}), bold: true, color: color === exportColors.amber ? exportColors.navy : exportColors.white },
      };
    });
  }
};

const createExportSheet = (rows: object[], colorStatusCells = true) => {
  const numberedRows = rows.map((row, index) => ({ 'S.No.': index + 1, ...row }));
  const sheet = XLSX.utils.json_to_sheet(numberedRows);
  autoFitColumns(sheet, numberedRows);
  centerAlignSheet(sheet);
  styleExportSheet(sheet, colorStatusCells);
  return sheet;
};

const writeExportFile = (workbook: XLSX.WorkBook, filename: string) => {
  XLSX.writeFile(workbook, filename, { cellStyles: true });
};
const formatClassificationLabel = (value: unknown) => String(value || '')
  .trim()
  .replace(/[_-]+/g, ' ')
  .toLowerCase()
  .replace(/\b\w/g, character => character.toUpperCase());

const appendOverviewSheet = (workbook: XLSX.WorkBook, classifications: string[], colorStatusCells = true) => {
  const counts = classifications.reduce<Record<string, number>>((result, classification) => {
    result[classification] = (result[classification] || 0) + 1;
    return result;
  }, {});
  const overviewRows = Object.entries(counts)
    .sort(([left], [right]) => getClassificationRank(left) - getClassificationRank(right) || left.localeCompare(right))
    .map(([classification, quantity]) => ({ Classification: formatClassificationLabel(classification), Quantity: quantity }));
  overviewRows.push({ Classification: 'Total', Quantity: classifications.length });
  const overviewSheet = createExportSheet(overviewRows, colorStatusCells);
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview');
};

type CellDashboardSummary = {
  rows: Array<{ label?: string; value?: number }>;
  total?: number;
};

type CellExportOptions = {
  warehouseStatuses?: Record<string, string>;
};

type WarehouseExportRow = {
  Location: string;
  Entity: string;
  'Serial / QR': string;
  'Type / Model': string;
};

const cellClassificationStatuses = [
  'IN_STOCK', 'FLOOR_STOCK', 'IN_MODULE', 'IN_PACK', 'IN_RACK',
  'KARACHI_WAREHOUSE', 'LAHORE_WAREHOUSE', 'SOLD', 'SCRAP',
];
const classificationRank = new Map(cellClassificationStatuses.map((status, index) => [status, index]));
const getClassificationRank = (value: unknown) => classificationRank.get(
  String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_'),
) ?? 999;
const sortByClassification = <T extends { Classification: string; 'Serial Number'?: string; 'Supplier Barcode'?: string }>(rows: T[]) => rows.sort((left, right) => {
  const rankDifference = getClassificationRank(left.Classification) - getClassificationRank(right.Classification);
  if (rankDifference !== 0) return rankDifference;
  return String(left['Serial Number'] || left['Supplier Barcode'] || '').localeCompare(String(right['Serial Number'] || right['Supplier Barcode'] || ''));
});

const getCellId = (cell: CellItem) => String(cell.id || '');
const getCellLifecycleStatus = (cell: CellItem) => String(cell.lifecycleStatus || (cell as any).lifecycle_status || '').trim().toUpperCase();
const getCellClassification = (cell: CellItem, warehouseStatuses: Record<string, string>) => {
  const warehouseStatus = String(warehouseStatuses[getCellId(cell)] || '').trim().toUpperCase();
  if (warehouseStatus === 'KARACHI_WAREHOUSE' || warehouseStatus === 'LAHORE_WAREHOUSE') return warehouseStatus;
  const lifecycleStatus = getCellLifecycleStatus(cell);
  const cellStatus = String(cell.status || '').trim().toUpperCase();
  if (lifecycleStatus === 'SCRAP' || ['QUARANTINED', 'REJECTED'].includes(cellStatus)) return 'SCRAP';
  return cellClassificationStatuses.includes(lifecycleStatus) ? lifecycleStatus : lifecycleStatus || 'UNKNOWN';
};

export const downloadCellReport = (
  cells: CellItem[],
  dashboardSummary?: CellDashboardSummary,
  options: CellExportOptions = {},
) => {
  if (cells.length === 0) throw new Error('No cell records are available to export.');
  const warehouseStatuses = options.warehouseStatuses || {};
  const cellRows = sortByClassification(cells.map(cell => ({
    'Supplier Barcode': cell.supplierBarcode || (cell as any).supplier_barcode || '',
    'Pallet Number': cell.palletNumber || (cell as any).pallet_number || '',
    manufacturer_name: (cell as CellItem & { manufacturerName?: string; manufacturer_name?: string }).manufacturerName
      || (cell as CellItem & { manufacturerName?: string; manufacturer_name?: string }).manufacturer_name
      || (cell as CellItem & { supplier?: { name?: string } }).supplier?.name
      || '',
    Classification: formatClassificationLabel(getCellClassification(cell, warehouseStatuses)),
  })));
  const workbook = XLSX.utils.book_new();
  if (dashboardSummary) {
    const summaryRows = dashboardSummary.rows.length > 0
      ? dashboardSummary.rows.map(row => ({ Status: row.label || '', Quantity: Number(row.value) || 0 }))
      : Object.entries(cellRows.reduce<Record<string, number>>((counts, row) => {
        counts[row.Classification] = (counts[row.Classification] || 0) + 1;
        return counts;
      }, {})).map(([Status, Quantity]) => ({ Status, Quantity }));
    const summaryTotal = Number(dashboardSummary.total) || dashboardSummary.rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    const summaryQuantity = dashboardSummary.rows.length > 0 ? summaryTotal : cellRows.length;
    summaryRows.forEach(row => { row.Status = formatClassificationLabel(row.Status); });
    summaryRows.push({ Status: 'Total', Quantity: summaryQuantity });
    const summarySheet = createExportSheet(summaryRows, false);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'CEO Dashboard Summary');
  }
  const sheet = createExportSheet(cellRows, false);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cells');
  writeExportFile(workbook, `MES_Cell_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadBatteryReport = (batteries: BatteryUnit[], options: CellExportOptions = {}) => {
  if (batteries.length === 0) throw new Error('No battery records are available to export.');
  const rows = batteries.map(battery => ({
    'Serial Number': battery.serialNumber || (battery as any).serial_number || '',
    BMU: battery.bmu?.serialNumber || (battery.bmu as any)?.serial_number || '',
    BMS: battery.bms?.serialNumber || (battery.bms as any)?.serial_number || '',
    Classification: formatClassificationLabel(getBatteryClassification(battery, options.warehouseStatuses)),
    'Created At': exportDateOnly(battery.createdAt || (battery as any).created_at),
  }));
  sortByClassification(rows);
  const workbook = XLSX.utils.book_new();
  appendOverviewSheet(workbook, rows.map(row => row.Classification), false);
  const sheet = createExportSheet(rows, false);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Batteries');
  writeExportFile(workbook, `MES_Battery_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadModuleReport = (modules: ModuleItem[]) => {
  if (modules.length === 0) throw new Error('No module records are available to export.');
  const rows = modules.map(module => ({
    'Serial Number': module.serialNumber || '',
    'Module Type': module.moduleType || '',
    Status: formatClassificationLabel(module.lifecycleStatus || module.status),
    'Assigned Battery Serial': module.assignedBatterySerial || '',
    'Created At': exportDateOnly(module.createdAt),
  }));
  rows.sort((left, right) => left.Status.localeCompare(right.Status) || left['Serial Number'].localeCompare(right['Serial Number']));
  const workbook = XLSX.utils.book_new();
  appendOverviewSheet(workbook, rows.map(row => row.Status), false);
  (['12S', '8S'] as const).forEach(moduleType => {
    const typeRows = rows.filter(row => row['Module Type'] === moduleType);
    const sheet = createExportSheet(typeRows, false);
    XLSX.utils.book_append_sheet(workbook, sheet, `${moduleType} Module`);
  });
  writeExportFile(workbook, `MES_Module_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadRackReport = (racks: RackUnit[], options: CellExportOptions = {}) => {
  if (racks.length === 0) throw new Error('No rack records are available to export.');
  const rows = racks.map(rack => ({
    'Serial Number': rack.serialNumber || (rack as any).serial_number || '',
    'Rack Type': exportRackType(rack.rackTemplateCode || (rack as any).rack_template_code),
    Classification: formatClassificationLabel(getRackClassification(rack, options.warehouseStatuses)),
    'Created At': exportDateOnly(rack.createdAt || (rack as any).created_at),
  }));
  sortByClassification(rows);
  const workbook = XLSX.utils.book_new();
  appendOverviewSheet(workbook, rows.map(row => row.Classification), false);
  const sheet = createExportSheet(rows, false);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Rack-Cabinet');
  writeExportFile(workbook, 'MES_Rack_Cabinet_Report.xlsx');
};

export const downloadSoldReport = (batteries: BatteryUnit[], racks: RackUnit[], saleHistory: Array<{ entityType?: string; entity_type?: string; entityId?: string; entity_id?: string; clientName?: string; client_name?: string }> = []) => {
  const soldRacks = racks.filter(rack => String(rack.status || '').toUpperCase() === 'SOLD');
  const batteriesInsideSoldRacks = new Set(soldRacks.flatMap(rack => (rack.batteryIds || []).map(batteryId => String(batteryId))));
  const soldBatteries = batteries.filter(battery => !batteriesInsideSoldRacks.has(String(battery.id)) && (['SOLD', 'DISPATCHED'].includes(String(battery.status || '').toUpperCase()) || String(battery.lifecycleStatus || (battery as any).lifecycle_status || '').toUpperCase() === 'SOLD'));
  if (soldBatteries.length === 0 && soldRacks.length === 0) throw new Error('No sold battery packs or racks are available to export.');
  const clientByKey = new Map(saleHistory.map(sale => [
    `${String(sale.entityType || sale.entity_type || '').toUpperCase()}:${String(sale.entityId || sale.entity_id || '')}`,
    normalizeClientName(sale.clientName || sale.client_name || 'Not recorded'),
  ]));

  const batteryRows = soldBatteries.map(battery => ({
    'Serial Number': battery.serialNumber || (battery as any).serial_number || '',
    'Client Name': clientByKey.get(`BATTERY:${battery.id}`) || 'Not recorded',
    Status: 'SOLD',
  })).sort((left, right) => String(left['Client Name']).localeCompare(String(right['Client Name'])) || left['Serial Number'].localeCompare(right['Serial Number']));
  const rackRows = [...soldRacks]
    .sort((left, right) => String(clientByKey.get(`RACK:${left.id}`) || 'Not recorded').localeCompare(String(clientByKey.get(`RACK:${right.id}`) || 'Not recorded')))
    .flatMap(rack => {
      const packSerials = (rack.batteryIds || [])
        .map(batteryId => batteries.find(battery => String(battery.id) === String(batteryId)))
        .filter(Boolean)
        .map(battery => exportBatterySerial(battery as BatteryUnit));
      const rackSummary = {
        'Rack Serial Number': rack.serialNumber || (rack as any).serial_number || '',
        'Rack Type': exportRackType(rack.rackTemplateCode || (rack as any).rack_template_code),
        'Battery Pack Serial Number': '',
        'Client Name': clientByKey.get(`RACK:${rack.id}`) || 'Not recorded',
        Status: 'SOLD',
      };
      const packRows = packSerials.map(packSerial => ({
        'Rack Serial Number': '',
        'Rack Type': '',
        'Battery Pack Serial Number': packSerial,
        'Client Name': '',
        Status: '',
      }));
      return [rackSummary, ...packRows];
    });
  const workbook = XLSX.utils.book_new();
  const overviewRows = [
    { Entity: 'Battery Packs', Quantity: batteryRows.length },
    { Entity: 'Racks', Quantity: soldRacks.length },
    { Entity: 'TOTAL', Quantity: batteryRows.length + soldRacks.length },
  ];
  const overviewSheet = createExportSheet(overviewRows, false);
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Sold Overview');
  const appendSoldSheet = (name: string, rows: Record<string, unknown>[]) => {
    const outputRows = rows.length > 0 ? rows : [{ 'Serial Number': `No sold ${name.toLowerCase()} found` }];
    const sheet = createExportSheet(outputRows, false);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  appendSoldSheet('Battery Packs', batteryRows);
  appendSoldSheet('Racks', rackRows);
  writeExportFile(workbook, `MES_Sold_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadWarehouseReport = (
  batteries: BatteryUnit[],
  racks: RackUnit[],
  warehouseStatuses: Record<string, string>,
) => {
  const batteryById = new Map(batteries.map(battery => [String(battery.id), battery]));
  const rows: WarehouseExportRow[] = [];
  const normalizeWarehouseLocation = (value: unknown): 'Karachi' | 'Lahore' | '' => {
    const normalized = String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ');
    if (normalized === 'KARACHI' || normalized === 'KARACHI WAREHOUSE') return 'Karachi';
    if (normalized === 'LAHORE' || normalized === 'LAHORE WAREHOUSE') return 'Lahore';
    return '';
  };
  const entityLocation = (key: string, entity: any) => normalizeWarehouseLocation(
    warehouseStatuses[key] || entity?.location || entity?.warehouseLocation || entity?.warehouse_location,
  );
  const warehouseRackRows = racks
    .map(rack => {
      const rawLocation = String(rack.location || (rack as any).warehouseLocation || (rack as any).warehouse_location || '').trim();
      const rackTemplateCode = String(rack.rackTemplateCode || (rack as any).rack_template_code || '').toUpperCase();
      return {
        rack,
        location: entityLocation(`RACK:${rack.id}`, rack) || (rackTemplateCode === 'RACK_25KWH' ? rawLocation || 'Unassigned' : ''),
      };
    })
    .filter(({ location }) => Boolean(location))
    .sort((left, right) => left.location.localeCompare(right.location));

  warehouseRackRows.forEach(({ rack, location }) => {
    const rackBatteries = (rack.batteryIds || [])
      .map(batteryId => batteryById.get(String(batteryId)))
      .filter(Boolean) as BatteryUnit[];
    const rackTemplateCode = String(rack.rackTemplateCode || (rack as any).rack_template_code || '').toUpperCase();
    const rackCategory = rackTemplateCode === 'RACK_25KWH' ? 'Rack' : 'Cabinet';
    rows.push({
      Location: location,
      Entity: rackCategory,
      'Serial / QR': rack.serialNumber || (rack as any).serial_number || rack.id,
      'Type / Model': exportRackType(rack.rackTemplateCode || (rack as any).rack_template_code),
    });
    rackBatteries.forEach(battery => {
      rows.push({
        Location: location,
        Entity: `${rackCategory} Battery Pack`,
        'Serial / QR': exportBatterySerial(battery),
        'Type / Model': '',
      });
    });
  });

  batteries
    .map(battery => ({ battery, location: entityLocation(`BATTERY:${battery.id}`, battery) }))
    .filter(({ location }) => Boolean(location))
    .sort((left, right) => left.location.localeCompare(right.location))
    .forEach(({ battery, location }) => rows.push({
      Location: location,
      Entity: 'Standalone Battery Pack',
      'Serial / QR': exportBatterySerial(battery),
      'Type / Model': '',
    }));

  if (rows.length === 0) throw new Error('No Karachi or Lahore warehouse records are available to export.');
  const workbook = XLSX.utils.book_new();
  const overviewRows = [
    { Location: 'Karachi', Racks: rows.filter(row => row.Location === 'Karachi' && row.Entity === 'Rack').length, Cabinets: rows.filter(row => row.Location === 'Karachi' && row.Entity === 'Cabinet').length, 'Standalone Battery Packs': rows.filter(row => row.Location === 'Karachi' && row.Entity === 'Standalone Battery Pack').length },
    { Location: 'Lahore', Racks: rows.filter(row => row.Location === 'Lahore' && row.Entity === 'Rack').length, Cabinets: rows.filter(row => row.Location === 'Lahore' && row.Entity === 'Cabinet').length, 'Standalone Battery Packs': rows.filter(row => row.Location === 'Lahore' && row.Entity === 'Standalone Battery Pack').length },
    { Location: 'TOTAL', Racks: rows.filter(row => row.Entity === 'Rack').length, Cabinets: rows.filter(row => row.Entity === 'Cabinet').length, 'Standalone Battery Packs': rows.filter(row => row.Entity === 'Standalone Battery Pack').length },
  ];
  const overviewSheet = createExportSheet(overviewRows, false);
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Warehouse Overview');
  const batteryRows = rows.filter(row => row.Entity === 'Standalone Battery Pack');
  const rackRows = rows.filter(row => row.Entity === 'Rack' || row.Entity === 'Rack Battery Pack');
  const cabinetRows = rows.filter(row => row.Entity === 'Cabinet' || row.Entity === 'Cabinet Battery Pack');
  const appendWarehouseSheet = (sheetName: string, sheetRows: WarehouseExportRow[]) => {
    const outputRows = sheetName === 'Battery Packs'
      ? sheetRows.map(row => ({ Location: row.Location, 'Serial / QR': row['Serial / QR'] }))
      : sheetRows.map(row => ({ Location: row.Location, 'Serial / QR': row['Serial / QR'], 'Type / Model': row['Type / Model'] }));
    const emptyRow = sheetName === 'Battery Packs'
      ? { Location: '', 'Serial / QR': `No ${sheetName.toLowerCase()} found` }
      : { Location: '', 'Serial / QR': `No ${sheetName.toLowerCase()} found`, 'Type / Model': '' };
    const sheet = createExportSheet(outputRows.length > 0 ? outputRows : [emptyRow], false);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  };
  appendWarehouseSheet('Battery Packs', batteryRows);
  appendWarehouseSheet('Cabinets', cabinetRows);
  appendWarehouseSheet('Racks', rackRows);
  writeExportFile(workbook, `MES_Warehouse_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

const getBatteryClassification = (battery: BatteryUnit, warehouseStatuses: Record<string, string> = {}) => {
  const warehouseStatus = String(warehouseStatuses[`BATTERY:${battery.id}`] || '').toUpperCase();
  if (warehouseStatus === 'KARACHI_WAREHOUSE' || warehouseStatus === 'LAHORE_WAREHOUSE') return warehouseStatus;
  const lifecycleStatus = String(battery.lifecycleStatus || (battery as any).lifecycle_status || '').toUpperCase();
  if (cellClassificationStatuses.includes(lifecycleStatus)) return lifecycleStatus;
  const processStatus = String(battery.status || '').toUpperCase();
  if (processStatus === 'DISPATCHED') return 'SOLD';
  if (['RELEASED', 'FINISHED', 'WAREHOUSE'].includes(processStatus)) return 'IN_STOCK';
  return lifecycleStatus || processStatus || 'UNKNOWN';
};

const getRackClassification = (rack: RackUnit, warehouseStatuses: Record<string, string> = {}) => {
  const warehouseStatus = String(warehouseStatuses[`RACK:${rack.id}`] || '').toUpperCase();
  if (warehouseStatus === 'KARACHI_WAREHOUSE' || warehouseStatus === 'LAHORE_WAREHOUSE') return warehouseStatus;
  const status = String(rack.status || '').toUpperCase();
  return ['IN_STOCK', 'IN_RACK', 'SOLD', 'SCRAP'].includes(status) ? status : 'UNKNOWN';
};