import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Supplier, SupplierImportSummary } from '../../types';
import {
  Truck,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Download,
  Sparkles,
  RefreshCw,
  Boxes,
  Layers,
  XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ParsedRow {
  index: number;
  barcode?: string;
  capacity?: number;
  ocv?: number;
  ri?: number;
  gear?: string;
  box_number?: string;
  pallet?: string;
  group?: string;
  manufacturer_name?: string;
  manufacture_date?: string;
  isValid: boolean;
  errors: string[];
}

export const SupplierImportView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ summary: SupplierImportSummary; importedCount: number } | null>(null);

  // New Validation State
  const [parsedFileName, setParsedFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headersFound, setHeadersFound] = useState<Record<string, boolean>>({});
  const [previewMode, setPreviewMode] = useState(false);

  // Battery Batch Import State
  const [batteryImportFileName, setBatteryImportFileName] = useState('');
  const [batteryParsedRows, setBatteryParsedRows] = useState<Array<{ index: number; batterySerialNumber: string; bmuSerialNumber?: string; isValid: boolean; errors: string[] }>>([]);
  const [batteryPreviewMode, setBatteryPreviewMode] = useState(false);
  const [batteryImportResult, setBatteryImportResult] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const loadData = async () => {
    try {
      const sups = await api.getSuppliers();
      setSuppliers(sups);
    } catch (err) {
      console.error('Failed to load supplier data', err);
    }
  };

  const normalizeHeader = (h: string) => h.toLowerCase().trim().replace(/[\s-]+/g, '_');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setPreviewMode(false);
    setParsedFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        
        let targetSheet = workbook.SheetNames.find(s => s.toLowerCase().includes('celltemplate')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[targetSheet];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        if (rawData.length < 2) {
          throw new Error('File is empty or missing data rows');
        }

        const headers = rawData[0].map(h => normalizeHeader(String(h || '')));
        
        // Canonical headers
        const headerAliases: Record<string, string[]> = {
          barcode: ['barcode', 'supplier_barcode', 'supplier_serial', 'cell_barcode', 'serial_number', 'serial'],
          capacity: ['capacity', 'capacity_ah', 'nominal_capacity', 'nominal_capacity_ah'],
          ocv: ['ocv', 'ocv_v', 'open_circuit_voltage', 'open_circuit_voltage_v'],
          ri: ['ri', 'ir', 'ir_mohm', 'resistance', 'internal_resistance'],
          gear: ['gear', 'grade', 'grading', 'cell_grade'],
          box_number: ['box_number', 'box', 'box_no'],
          pallet: ['pallet', 'pallet_number', 'pallet_no'],
          group: ['group', 'batch', 'batch_number', 'lot', 'lot_number'],
          manufacturer_name: ['manufacturer_name', 'manufacturer', 'supplier', 'supplier_name'],
          manufacture_date: ['manufacture_date', 'manufacturing_date', 'production_date', 'date'],
        };
        const canonical = Object.keys(headerAliases);
        
        const hFound: Record<string, boolean> = {};
        const hIndex: Record<string, number> = {};
        
        canonical.forEach(ch => {
          const idx = headers.findIndex(h => headerAliases[ch].includes(h));
          hFound[ch] = idx !== -1;
          hIndex[ch] = idx;
        });
        
        setHeadersFound(hFound);

        const rows: ParsedRow[] = [];
        for (let i = 1; i < rawData.length; i++) {
          const rowData = rawData[i];
          if (!rowData || rowData.length === 0) continue;
          
          let hasAnyData = false;
          for(let d of rowData) if(d !== undefined && d !== null && String(d).trim() !== '') hasAnyData = true;
          if(!hasAnyData) continue;

          const row: ParsedRow = { index: i, isValid: true, errors: [] };

          const getVal = (colName: string) => {
            const idx = hIndex[colName];
            return idx !== -1 ? rowData[idx] : undefined;
          };

          row.barcode = getVal('barcode') ? String(getVal('barcode')).trim() : undefined;
          if (!row.barcode) { row.isValid = false; row.errors.push('Missing barcode'); }

          const capacityValue = getVal('capacity');
          const cap = parseFloat(capacityValue);
          if (capacityValue !== undefined && capacityValue !== null && String(capacityValue).trim() !== '') {
            if (isNaN(cap)) { row.isValid = false; row.errors.push('Invalid capacity'); } else row.capacity = cap;
          }

          const ocvValue = getVal('ocv');
          const ocv = parseFloat(ocvValue);
          if (ocvValue !== undefined && ocvValue !== null && String(ocvValue).trim() !== '') {
            if (isNaN(ocv)) { row.isValid = false; row.errors.push('Invalid ocv'); } else row.ocv = ocv;
          }

          const riValue = getVal('ri');
          const ri = parseFloat(riValue);
          if (riValue !== undefined && riValue !== null && String(riValue).trim() !== '') {
            if (isNaN(ri)) { row.isValid = false; row.errors.push('Invalid ri'); } else row.ri = ri;
          }

          row.gear = getVal('gear') ? String(getVal('gear')) : undefined;

          row.box_number = getVal('box_number') ? String(getVal('box_number')) : undefined;
          row.pallet = getVal('pallet') ? String(getVal('pallet')) : undefined;
          row.group = getVal('group') ? String(getVal('group')) : undefined;
          row.manufacturer_name = getVal('manufacturer_name') ? String(getVal('manufacturer_name')) : undefined;

          let dateVal = getVal('manufacture_date');
          if (dateVal instanceof Date) {
            row.manufacture_date = dateVal.toISOString().slice(0, 10);
          } else if (dateVal) {
            row.manufacture_date = String(dateVal);
          }

          rows.push(row);
        }

        setParsedRows(rows);
        setPreviewMode(true);
      } catch (err: any) {
        addNotification('error', 'File Parse Error', err.message);
      } finally {
        setLoading(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const confirmImport = async () => {
    setLoading(true);
    try {
      // Map Canonical payload
      const payloadRows = parsedRows.filter(r => r.isValid).map(r => ({
        barcode: r.barcode,
        capacity: r.capacity,
        ocv: r.ocv,
        ri: r.ri,
        gear: r.gear,
        box_number: r.box_number,
        pallet: r.pallet,
        group: r.group,
        manufacturer_name: r.manufacturer_name,
        manufacture_date: r.manufacture_date
      }));

      const res = await api.importSupplierCells({
        filename: parsedFileName,
        rows: payloadRows,
        userId: currentUser.id,
      });

      setImportResult(res);
      addNotification('success', 'File Imported', `Imported ${res.importedCount} cells`);
      triggerRefresh();
      setPreviewMode(false);
    } catch (err: any) {
      addNotification('error', 'Import Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBatteryFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // BUG-16 fix: show loading state so UI is not clickable during parse
    setLoading(true);
    setBatteryPreviewMode(false);
    setBatteryImportResult(null);
    setBatteryParsedRows([]);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = reader.result;
        if (!data) throw new Error('No spreadsheet content was loaded.');

        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw:false converts numbers to strings, defval:'' fills empty cells from merged regions
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, any>[];

        if (rawRows.length === 0) {
          throw new Error('The spreadsheet is empty or has no data rows.');
        }

        /**
         * Flexible column-value finder.
         * Excel merged cells only store their value in the TOP-LEFT cell of the merge;
         * all other cells in the merge are empty. We therefore track state across rows.
         *
         * Column aliases supported (case-insensitive, partial match):
         *   QR code : 'qr code', 'qr', 'qrcode', 'barcode', 'cell qr', 'cell_qr'
         *   Battery  : 'battery', 'battery serial', 'battery_serial', 'battery_no', 'battery number'
         *   BMU      : 'bmu', 'bmu serial', 'bmu_serial', 'controller'
         *   Modul    : 'modul', 'module', 'module no', 'module_no'
         */
        const findColValue = (row: Record<string, any>, ...keys: string[]): string => {
          // Exact header match first
          for (const key of keys) {
            const k = key.toLowerCase().trim();
            for (const [col, val] of Object.entries(row)) {
              if (col.toLowerCase().trim() === k) {
                const v = String(val ?? '').trim();
                if (v) return v;
              }
            }
          }
          // Partial match (header contains the keyword)
          for (const key of keys) {
            const k = key.toLowerCase().trim();
            for (const [col, val] of Object.entries(row)) {
              if (col.toLowerCase().trim().includes(k)) {
                const v = String(val ?? '').trim();
                if (v) return v;
              }
            }
          }
          return '';
        };

        /**
         * Parse battery groups from the Excel.
         *
         * Format (from the uploaded screenshot):
         *   Col A (S)       : Slot number 1-12 per module
         *   Col B (QR code) : Cell QR / barcode (one per row)
         *   Col C (Modul)   : Module number 1 or 2 (merged — appears once per 12 rows)
         *   Col D (Battery) : Battery sequence number (merged — appears once per 24 rows)
         *   Col E (BMU)     : BMU serial (merged — appears once per 24 rows)
         *
         * Because xlsx stores merged-cell values only in the FIRST row of the merge,
         * we detect a new battery when Battery column has a non-empty value.
         */
        const batteryGroups: Map<string, {
          rawSerial: string;
          bmuSerial: string;
          qrCodes: string[];
          seqNumber: number;
        }> = new Map();

        let currentKey = '';
        let batteryCounter = 0;
        const now = new Date();
        const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;

        for (const row of rawRows) {
          const qrCode   = findColValue(row, 'QR code', 'qr', 'qrcode', 'barcode', 'cell qr', 'cell_qr');
          const batteryVal = findColValue(row, 'Battery', 'battery serial', 'battery_serial', 'battery_no', 'battery number', 'battery');
          const bmuVal   = findColValue(row, 'BMU', 'bmu serial', 'bmu_serial', 'controller');

          // A non-empty Battery column value signals the start of a new battery group
          if (batteryVal) {
            batteryCounter++;
            currentKey = `bat_${batteryCounter}`;

            // If the Excel value is a plain number (e.g. "1", "2"), format it as a proper serial
            const isNumeric = /^\d+$/.test(batteryVal);
            const rawSerial = isNumeric
              ? `P2G-7K5-${yymm}-${String(parseInt(batteryVal)).padStart(6, '0')}`
              : batteryVal.toUpperCase();

            batteryGroups.set(currentKey, {
              rawSerial,
              bmuSerial: bmuVal,   // BMU is on the same first row of the merged region
              qrCodes: [],
              seqNumber: batteryCounter,
            });
          }

          // BUG-15 fix: capture BMU from ANY row in the group (not just the battery-header row)
          if (bmuVal && currentKey) {
            const g = batteryGroups.get(currentKey);
            if (g && !g.bmuSerial) g.bmuSerial = bmuVal;
          }

          // Accumulate cell QR codes into the current battery group
          if (qrCode && currentKey) {
            batteryGroups.get(currentKey)?.qrCodes.push(qrCode.trim());
          }
        }

        if (batteryGroups.size === 0) {
          throw new Error(
            'No battery groups were found in the spreadsheet. ' +
            'Make sure the file has a "Battery" column with a number or serial for each battery, ' +
            'and a "QR code" column with one cell barcode per row (24 rows per battery: 2 modules × 12 cells).'
          );
        }

        // Build per-battery validation
        const globalQrSeen = new Map<string, number>();
        const normalizedRows = Array.from(batteryGroups.values()).map((group, idx) => {
          const errors: string[] = [];

          // Must have exactly 24 cells (2 modules × 12)
          if (group.qrCodes.length !== 24) {
            errors.push(
              `Expected 24 cells (2 modules × 12), found ${group.qrCodes.length}`
            );
          }

          // Check for duplicates within this battery
          const localSeen = new Set<string>();
          const localDups: string[] = [];
          for (const qr of group.qrCodes) {
            const norm = qr.toLowerCase();
            if (norm && localSeen.has(norm)) localDups.push(qr);
            if (norm) localSeen.add(norm);
            // Track globally for cross-battery warnings
            if (norm) globalQrSeen.set(norm, (globalQrSeen.get(norm) || 0) + 1);
          }
          if (localDups.length > 0) {
            errors.push(
              `${localDups.length} duplicate QR code(s) within battery: ${localDups.slice(0, 3).join(', ')}`
            );
          }

          return {
            index: idx + 2,
            batterySerialNumber: group.rawSerial,
            bmuSerialNumber: group.bmuSerial || '',
            cellQrCodes: group.qrCodes,
            cellCount: group.qrCodes.length,
            isValid: errors.length === 0,
            errors,
          };
        });

        // Cross-battery duplicate summary
        let crossBatteryDups = 0;
        for (const count of globalQrSeen.values()) {
          if (count > 1) crossBatteryDups++;
        }

        setBatteryParsedRows(normalizedRows);
        setBatteryImportFileName(file.name);
        setBatteryPreviewMode(true);

        const invalidCount = normalizedRows.filter(r => !r.isValid).length;
        const validCount = normalizedRows.filter(r => r.isValid).length;
        const totalCells = normalizedRows.reduce((s, r) => s + r.cellCount, 0);

        if (invalidCount > 0 || crossBatteryDups > 0) {
          addNotification(
            'warning',
            'Battery Excel Parsed with Issues',
            `Loaded ${normalizedRows.length} batteries (${validCount} valid, ${invalidCount} with errors). ` +
            `${totalCells} total cells. ` +
            (crossBatteryDups > 0 ? `${crossBatteryDups} QR code(s) appear in multiple batteries.` : '')
          );
        } else {
          addNotification(
            'success',
            'Battery Excel Parsed Successfully',
            `Loaded ${normalizedRows.length} batteries · ${totalCells} cells · Ready to validate.`
          );
        }
      } catch (err: any) {
        addNotification('error', 'Battery File Parse Failed', err.message);
      } finally {
        setLoading(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const confirmBatteryImport = async () => {
    // BUG-17 fix: don't block the entire import on a few invalid rows.
    // Import valid rows only and warn the user about skipped ones.
    const validRows = batteryParsedRows.filter(row => row.isValid);
    const invalidRows = batteryParsedRows.filter(row => !row.isValid);

    if (validRows.length === 0) {
      addNotification(
        'error',
        'No Valid Batteries',
        'All batteries in the file have errors. Fix your spreadsheet and re-upload.'
      );
      return;
    }

    if (invalidRows.length > 0) {
      addNotification(
        'warning',
        `Skipping ${invalidRows.length} Invalid ${invalidRows.length === 1 ? 'Battery' : 'Batteries'}`,
        `Processing ${validRows.length} valid ${validRows.length === 1 ? 'battery' : 'batteries'}. ` +
        `${invalidRows.length} with errors will be skipped.`
      );
    }

    const payloadRows = validRows.map(row => ({
      batterySerialNumber: row.batterySerialNumber,
      bmuSerialNumber: row.bmuSerialNumber || undefined,
      cellQrCodes: Array.isArray(row.cellQrCodes) ? row.cellQrCodes : [],
    }));

    setLoading(true);
    try {
      const result = await api.bulkInitializeBatteryBatch({
        rows: payloadRows,
        userId: currentUser.id,
      });

      setBatteryImportResult(result);
      addNotification(
        'success',
        'Battery Batch Validated',
        `Validated ${result.batchSize} batteries for ${result.template.name}. ` +
        `Required ${result.order.requiredCells} cells and ${result.order.requiredBmUs} BMUs.`
      );
      setBatteryPreviewMode(false);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Battery Batch Validation Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const createBatteryBatch = async () => {
    if (!batteryImportResult) {
      addNotification('error', 'No batch to create', 'Please validate a battery batch first.');
      return;
    }

    setLoading(true);
    try {
      const result = await api.createBulkBatteryBatch({
        batchPlan: batteryImportResult,
        userId: currentUser.id,
      });

      addNotification(
        'success',
        'Production Batch Created',
        `Created ${result.batteryCount} batteries with ${result.cellsAllocated} cells. Production Order: ${result.productionOrderId}`
      );
      setBatteryImportResult(null);
      setBatteryPreviewMode(false);
      setBatteryParsedRows([]);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Batch Creation Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const allHeadersFound = Object.values(headersFound).every(Boolean);

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex items-center space-x-3">
        <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
          <Truck className="w-5 h-5" />
        </span>
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            Supplier Manifest & Receiving
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict column mapping and validation for Excel/CSV manifests.
          </p>
        </div>
      </div>

      {!previewMode && !importResult && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900">Upload Manifest</h2>

          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-7 text-center relative hover:border-emerald-500">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <FileSpreadsheet className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-bold text-slate-800">Drag & Drop Excel / CSV Manifest</p>
            <p className="text-[11px] text-slate-400 mt-1">Extracts canonical 10 columns strictly.</p>
          </div>
        </div>
      )}

      {!batteryPreviewMode && !batteryImportResult && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Battery Batch Upload</h2>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Existing stock allocation</span>
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-7 text-center relative hover:border-emerald-500">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleBatteryFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <Boxes className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-bold text-slate-800">Upload Battery Excel / CSV</p>
            <p className="text-[11px] text-slate-400 mt-1">Primary identifier is the Battery serial column; BMU is optional. Uses imported BMUs/cells already in stock.</p>
          </div>
        </div>
      )}

      {batteryPreviewMode && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Battery Batch Validation</h2>
            <button
              type="button"
              onClick={() => setBatteryPreviewMode(false)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4 text-center border-y border-slate-100 py-3">
            <div><span className="block text-xl font-black text-slate-900">{batteryParsedRows.length}</span><span className="text-xs text-slate-500">Total Batteries</span></div>
            <div><span className="block text-xl font-black text-emerald-600">{batteryParsedRows.filter(r => r.isValid).length}</span><span className="text-xs text-slate-500">Valid</span></div>
            <div><span className="block text-xl font-black text-slate-900">{batteryParsedRows.reduce((sum, r) => sum + (r.cellCount || 0), 0)}</span><span className="text-xs text-slate-500">Total Cells</span></div>
            <div><span className="block text-xl font-black text-sky-600">{batteryParsedRows.length > 0 ? Math.round(batteryParsedRows.reduce((sum, r) => sum + (r.cellCount || 0), 0) / batteryParsedRows.length) : 0}</span><span className="text-xs text-slate-500">Cells/Battery</span></div>
          </div>

          <div className="max-h-[250px] overflow-auto border border-slate-200 rounded">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2">Battery #</th>
                  <th className="px-3 py-2">Generated Serial</th>
                  <th className="px-3 py-2">Cells</th>
                  <th className="px-3 py-2">BMU Serial</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {batteryParsedRows.map((row, idx) => (
                  <tr key={`${row.index}-${row.batterySerialNumber}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-center font-bold text-slate-900">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.batterySerialNumber}</td>
                    <td className="px-3 py-2 text-center">{row.cellCount}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.bmuSerialNumber || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${row.isValid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-800 text-white'}`}>
                        {row.isValid ? 'VALID' : 'INVALID'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={confirmBatteryImport}
              disabled={loading || batteryParsedRows.filter(row => row.isValid).length === 0}
              className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50"
            >
              {loading ? 'Validating...' : 'Validate & Prepare Batch'}
            </button>
          </div>
        </div>
      )}

      {batteryImportResult && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Battery Batch Result</h2>
            <button
              type="button"
              onClick={() => setBatteryImportResult(null)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-slate-500">Total batteries</div>
              <div className="mt-1 text-lg font-black text-slate-900">{batteryImportResult.batchSize}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-slate-500">Template</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{batteryImportResult.template?.name || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-slate-500">Cells required</div>
              <div className="mt-1 text-lg font-black text-slate-900">{batteryImportResult.order?.requiredCells || 0}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-slate-500">BMUs required</div>
              <div className="mt-1 text-lg font-black text-slate-900">{batteryImportResult.order?.requiredBmUs || 0}</div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setBatteryImportResult(null)}
              className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createBatteryBatch}
              disabled={loading}
              className="px-4 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 hover:bg-emerald-700"
            >
              {loading ? 'Creating Batch...' : 'Create Production Batch'}
            </button>
          </div>
        </div>
      )}

      {previewMode && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900">Import Validation & Preview</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(headersFound).map(([header, found]) => (
              <div key={header} className={`p-2 text-xs rounded border ${found ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-900 border-slate-800 text-white'}`}>
                {found ? <CheckCircle2 className="inline w-3 h-3 mr-1" /> : <AlertTriangle className="inline w-3 h-3 mr-1 text-yellow-400" />}
                {header}
              </div>
            ))}
          </div>

          {!allHeadersFound && (
            <div className="p-3 bg-slate-900 text-white text-xs rounded">
              Warning: Some canonical headers were not detected.
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-center border-y border-slate-100 py-3">
             <div><span className="block text-xl font-black text-slate-900">{parsedRows.length}</span><span className="text-xs text-slate-500">Total Rows</span></div>
             <div><span className="block text-xl font-black text-emerald-600">{parsedRows.filter(r => r.isValid).length}</span><span className="text-xs text-slate-500">Valid</span></div>
             <div><span className="block text-xl font-black text-slate-900">{parsedRows.filter(r => !r.isValid).length}</span><span className="text-xs text-slate-500">Invalid</span></div>
          </div>

          <div className="max-h-[300px] overflow-auto border border-slate-200 rounded">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 sticky top-0">
                <tr>
                  <th className="p-2">Row</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Barcode</th>
                  <th className="p-2">Capacity</th>
                  <th className="p-2">OCV</th>
                  <th className="p-2">RI</th>
                  <th className="p-2">Errors</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2">{r.isValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-slate-900" />}</td>
                    <td className="p-2 font-mono">{r.barcode || '-'}</td>
                    <td className="p-2">{r.capacity || '-'}</td>
                    <td className="p-2">{r.ocv || '-'}</td>
                    <td className="p-2">{r.ri || '-'}</td>
                    <td className="p-2 text-slate-900">{r.errors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 50 && <p className="text-center text-xs p-2 text-slate-500">Showing first 50 rows...</p>}
          </div>

          <div className="flex space-x-3">
             <button onClick={confirmImport} disabled={loading} className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-500">
               {loading ? 'Importing...' : `IMPORT ${parsedRows.filter(r => r.isValid).length} VALID RECORDS`}
             </button>
             <button onClick={() => setPreviewMode(false)} className="px-5 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200">
               Cancel
             </button>
          </div>
        </div>
      )}

      {importResult && (
         <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 text-center space-y-4">
           <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
             <CheckCircle2 className="w-8 h-8" />
           </div>
           <h2 className="text-xl font-black text-slate-900">IMPORT COMPLETE</h2>
           <div className="max-w-md mx-auto grid grid-cols-2 gap-4 text-left">
             <div className="p-3 bg-slate-50 rounded border border-slate-100">
               <span className="block text-xs text-slate-500">Total Rows</span>
               <span className="block text-lg font-bold">{importResult.summary.totalRows}</span>
             </div>
             <div className="p-3 bg-emerald-50 rounded border border-emerald-100">
               <span className="block text-xs text-emerald-700">Imported</span>
               <span className="block text-lg font-bold text-emerald-700">{importResult.summary.validRows}</span>
             </div>
             <div className="p-3 bg-slate-100 rounded border border-slate-200">
               <span className="block text-xs text-slate-600">Duplicates Skipped</span>
               <span className="block text-lg font-bold text-slate-800">{importResult.summary.duplicateRows}</span>
             </div>
             <div className="p-3 bg-slate-900 rounded border border-slate-800">
               <span className="block text-xs text-slate-300">Invalid / Rejected</span>
               <span className="block text-lg font-bold text-white">{importResult.summary.invalidRows}</span>
             </div>
           </div>
           <button onClick={() => setImportResult(null)} className="px-5 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded mt-4">
             Import Another File
           </button>
         </div>
      )}
    </div>
  );
};
