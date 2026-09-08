import * as XLSX from 'xlsx';
import { BatteryUnit, CellItem, RackUnit } from '../types';

export const downloadCellReport = (cells: CellItem[]) => {
  const cellRows = cells.map((cell, index) => ({
    No: index + 1,
    'Supplier Barcode': cell.supplierBarcode || '',
    'Pallet Number': cell.palletNumber || '',
    'Box Number': cell.boxNumber || '',
    'Batch Number': cell.batchNumber || '',
    'Lifecycle Status': cell.lifecycleStatus || '',
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cellRows), 'Cells');
  XLSX.writeFile(workbook, `MES_Cell_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadBatteryReport = (batteries: BatteryUnit[]) => {
  const rows = batteries.map((battery, index) => ({
    No: index + 1,
    'Serial Number': battery.serialNumber,
    'Lifecycle Status': battery.lifecycleStatus || '',
    BMS: battery.bms?.serialNumber || '',
    BMU: battery.bmu?.serialNumber || '',
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Batteries');
  XLSX.writeFile(workbook, `MES_Battery_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const downloadRackReport = (racks: RackUnit[]) => {
  const rows = racks.map((rack, index) => ({
    No: index + 1,
    'Serial Number': rack.serialNumber,
    'Rack Type': rack.rackTemplateCode,
    Status: rack.status,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Racks');
  XLSX.writeFile(workbook, `MES_Rack_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};