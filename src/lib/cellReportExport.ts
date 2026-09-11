import * as XLSX from 'xlsx';
import { BatteryUnit, CellItem, RackUnit } from '../types';

const exportDate = (value?: string) => value ? new Date(value).toLocaleString() : '';
const exportDateOnly = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${date.getUTCFullYear()}`;
};
const exportRackType = (value?: string) => String(value || '').replace(/^RACK_/i, '').replace(/KWH$/i, 'kWh');

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

const appendOverviewSheet = (workbook: XLSX.WorkBook, classifications: string[]) => {
  const counts = classifications.reduce<Record<string, number>>((result, classification) => {
    result[classification] = (result[classification] || 0) + 1;
    return result;
  }, {});
  const overviewRows = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classification, quantity]) => ({ Classification: classification, Quantity: quantity }));
  overviewRows.push({ Classification: 'TOTAL', Quantity: classifications.length });
  const overviewSheet = XLSX.utils.json_to_sheet(overviewRows);
  autoFitColumns(overviewSheet, overviewRows);
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview');
};

type CellDashboardSummary = {
  rows: Array<{ label?: string; value?: number }>;
  total?: number;
};

type CellExportOptions = {
  warehouseStatuses?: Record<string, string>;
};

const cellClassificationStatuses = [
  'IN_STOCK', 'FLOOR_STOCK', 'IN_MODULE', 'IN_PACK', 'IN_RACK',
  'KARACHI_WAREHOUSE', 'LAHORE_WAREHOUSE', 'SOLD', 'SCRAP',
];
const classificationRank = new Map(cellClassificationStatuses.map((status, index) => [status, index]));
const sortByClassification = <T extends { Classification: string; 'Serial Number'?: string; 'Supplier Barcode'?: string }>(rows: T[]) => rows.sort((left, right) => {
  const rankDifference = (classificationRank.get(left.Classification) ?? 999) - (classificationRank.get(right.Classification) ?? 999);
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
    Classification: getCellClassification(cell, warehouseStatuses),
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
    summaryRows.push({ Status: 'TOTAL', Quantity: summaryQuantity });
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    autoFitColumns(summarySheet, summaryRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'CEO Dashboard Summary');
  }
  const sheet = XLSX.utils.json_to_sheet(cellRows);
  autoFitColumns(sheet, cellRows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cells');
  XLSX.writeFile(workbook, `MES_Cell_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadBatteryReport = (batteries: BatteryUnit[], options: CellExportOptions = {}) => {
  if (batteries.length === 0) throw new Error('No battery records are available to export.');
  const rows = batteries.map(battery => ({
    'Serial Number': battery.serialNumber || (battery as any).serial_number || '',
    BMU: battery.bmu?.serialNumber || (battery.bmu as any)?.serial_number || '',
    BMS: battery.bms?.serialNumber || (battery.bms as any)?.serial_number || '',
    Classification: getBatteryClassification(battery, options.warehouseStatuses),
    'Created At': exportDateOnly(battery.createdAt || (battery as any).created_at),
  }));
  sortByClassification(rows);
  const workbook = XLSX.utils.book_new();
  appendOverviewSheet(workbook, rows.map(row => row.Classification));
  const sheet = XLSX.utils.json_to_sheet(rows);
  autoFitColumns(sheet, rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Batteries');
  XLSX.writeFile(workbook, `MES_Battery_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadRackReport = (racks: RackUnit[], options: CellExportOptions = {}) => {
  if (racks.length === 0) throw new Error('No rack records are available to export.');
  const rows = racks.map(rack => ({
    'Serial Number': rack.serialNumber || (rack as any).serial_number || '',
    'Rack Type': exportRackType(rack.rackTemplateCode || (rack as any).rack_template_code),
    Classification: getRackClassification(rack, options.warehouseStatuses),
    'Created At': exportDateOnly(rack.createdAt || (rack as any).created_at),
  }));
  sortByClassification(rows);
  const workbook = XLSX.utils.book_new();
  appendOverviewSheet(workbook, rows.map(row => row.Classification));
  const sheet = XLSX.utils.json_to_sheet(rows);
  autoFitColumns(sheet, rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Rack-Cabinet');
  XLSX.writeFile(workbook, 'MES_Rack_Cabinet_Report.xlsx');
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