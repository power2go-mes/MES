import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { CellItem } from '../../types';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  Cpu,
  GripVertical,
  Layers,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

interface ModuleTestRow {
  cellId: string;
  ocvV: string;
  irMilliOhm: string;
  grade: string;
  damageCondition: 'GOOD' | 'DAMAGED';
  damageRemarks: string;
}

export const ModuleWorkflowView: React.FC = () => {
  const { activeModuleId, setActiveModuleId, setActiveView, addNotification, refreshKey, triggerRefresh } = useApp();
  const [moduleType, setModuleType] = useState<'8S' | '12S'>('8S');
  const [floorCells, setFloorCells] = useState<CellItem[]>([]);
  const [floorSearch, setFloorSearch] = useState('');
  const [floorPage, setFloorPage] = useState(0);
  const [hasMoreFloorCells, setHasMoreFloorCells] = useState(false);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [manualBarcodes, setManualBarcodes] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrModule, setQrModule] = useState<any | null>(null);
  const [draftModule, setDraftModule] = useState<any | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [weldingStatus, setWeldingStatus] = useState<'PASSED' | 'FAILED'>('PASSED');
  const [testRows, setTestRows] = useState<ModuleTestRow[]>([]);
  const [draggedCellId, setDraggedCellId] = useState<string | null>(null);
  const [editingCellIndex, setEditingCellIndex] = useState<number | null>(null);
  const requiredCells = moduleType === '8S' ? 8 : 12;

  const replaceCellAtIndex = (index: number, replacementCellId: string) => {
    setSelectedCellIds(current => {
      if (index < 0 || index >= current.length) return current;
      const next = [...current];
      const existingId = next[index];
      if (!existingId || existingId === replacementCellId) return current;
      next[index] = replacementCellId;
      return next;
    });

    setTestRows(current => {
      const next = [...current];
      const rowIndex = current.findIndex(row => row.cellId === selectedCellIds[index]);
      if (rowIndex < 0) return current;
      next[rowIndex] = { ...next[rowIndex], cellId: replacementCellId };
      return next;
    });
  };

  const loadFloorCells = async (additionalCells: CellItem[] = [], page = 0) => {
    setLoading(true);
    try {
      const pageSize = 50;
      const stockCells = await api.getCells({ lifecycleStatus: 'FLOOR_STOCK', search: floorSearch || undefined, limit: pageSize, offset: page * pageSize });
      setFloorCells(current => {
        const cellsById = new Map<string, CellItem>();
        [...(page > 0 ? current : []), ...stockCells, ...additionalCells].forEach(cell => {
          if (cell?.id) cellsById.set(cell.id, cell);
        });
        return Array.from(cellsById.values());
      });
      setFloorPage(page);
      setHasMoreFloorCells(stockCells.length === pageSize);
    } catch (error: any) {
      addNotification('error', 'Floor Stock Unavailable', error.message || 'Could not load floor-stock cells.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeModuleId) void loadFloorCells([], 0);
  }, [activeModuleId, refreshKey, floorSearch]);
  useEffect(() => { setSelectedCellIds([]); setManualBarcodes(''); }, [moduleType]);

  useEffect(() => {
    if (!activeModuleId) return;
    let cancelled = false;
    const loadModuleForEdit = async () => {
      try {
        const module = (await api.getModules()).find(item => item.id === activeModuleId);
        if (!module || cancelled) return;
        const moduleCells = module.cells || [];
        const inferredModuleType = module.moduleType === '12S' || moduleCells.length === 12 ? '12S' : '8S';
        setModuleType(inferredModuleType);
        await loadFloorCells(moduleCells);
        setSelectedCellIds(moduleCells.map(cell => cell.id));
        setDraftModule(module);
        setWeldingStatus(module.weldingResult?.status === 'FAILED' ? 'FAILED' : 'PASSED');
        setAcknowledged(true);
        setTestRows(moduleCells.map(cell => ({
          cellId: cell.id,
          ocvV: cell.productionOcvV != null ? String(cell.productionOcvV) : cell.supplierOcvV != null ? String(cell.supplierOcvV) : '',
          irMilliOhm: cell.productionIrMilliOhm != null ? String(cell.productionIrMilliOhm) : cell.supplierIrMilliOhm != null ? String(cell.supplierIrMilliOhm) : '',
          grade: cell.productionGrade || cell.supplierGrade || 'A+',
          damageCondition: 'GOOD',
          damageRemarks: '',
        })));
      } catch (error: any) {
        if (!cancelled) addNotification('error', 'Module Load Failed', error.message || 'Could not load the module for editing.');
      }
    };
    void loadModuleForEdit();
    return () => { cancelled = true; };
  }, [activeModuleId, addNotification]);

  const selectedCells = useMemo(() => selectedCellIds
    .map(id => floorCells.find(cell => cell.id === id))
    .filter(Boolean) as CellItem[], [floorCells, selectedCellIds]);

  const loadMoreFloorCells = () => {
    if (!loading && hasMoreFloorCells) void loadFloorCells([], floorPage + 1);
  };

  const addCellByBarcode = async (barcode: string) => {
    const normalized = barcode.trim().toLowerCase();
    if (!normalized) return;
    
    let cell = floorCells.find(item => [item.id, item.internalSerial, item.supplierBarcode].some(value => String(value || '').toLowerCase() === normalized));
    
    if (!cell) {
      try {
        const foundCells = await api.getCells({ lifecycleStatus: 'FLOOR_STOCK', search: barcode, limit: 1 });
        if (foundCells && foundCells.length > 0) {
          cell = foundCells[0];
          setFloorCells(current => {
            if (current.some(c => c.id === cell!.id)) return current;
            return [cell!, ...current];
          });
        }
      } catch (error) {
        console.error('Error fetching cell:', error);
      }
    }

    if (!cell) {
      addNotification('error', 'Cell Not Available', `${barcode} is not in FLOOR_STOCK.`);
      return;
    }
    if (selectedCellIds.includes(cell.id)) {
      addNotification('warning', 'Duplicate Cell', `${barcode} has already been selected.`);
      return;
    }

    if (editingCellIndex !== null) {
      replaceCellAtIndex(editingCellIndex, cell.id);
      setEditingCellIndex(null);
      addNotification('success', 'Cell Replaced', `${cell.internalSerial || cell.id} has been assigned to this module slot.`);
      return;
    }

    if (selectedCellIds.length >= requiredCells) {
      addNotification('warning', 'Module Full', `An ${moduleType} module accepts exactly ${requiredCells} cells.`);
      return;
    }

    setSelectedCellIds(current => [...current, cell.id]);
  };

  const submitManualCells = async (event: React.FormEvent) => {
    event.preventDefault();
    const barcodes = manualBarcodes.split(/[\n,;\t]+/).filter(Boolean);
    for (const barcode of barcodes) {
      await addCellByBarcode(barcode);
    }
    setManualBarcodes('');
  };

  const createModule = async () => {
    if (selectedCells.length !== requiredCells) return;
    setSaving(true);
    try {
      const result = await api.createStandaloneModule(moduleType, selectedCells.map(cell => cell.internalSerial || cell.id));
      setDraftModule(result.module);
      setWeldingStatus('PASSED');
      setAcknowledged(false);
      setTestRows(selectedCells.map(cell => ({
        cellId: cell.id,
        ocvV: cell.supplierOcvV != null ? String(cell.supplierOcvV) : '',
        irMilliOhm: cell.supplierIrMilliOhm != null ? String(cell.supplierIrMilliOhm) : '',
        grade: cell.supplierGrade || 'A+',
        damageCondition: 'GOOD',
        damageRemarks: '',
      })));
      addNotification('success', 'Module Draft Created', 'Complete acknowledgement, OCV/IR, grading, and damage history before final completion.');
    } catch (error: any) {
      addNotification('error', 'Module Creation Failed', error.message || 'Could not create the module.');
    } finally {
      setSaving(false);
    }
  };

  const updateTestRow = (cellId: string, changes: Partial<ModuleTestRow>) => {
    setTestRows(current => current.map(row => row.cellId === cellId ? { ...row, ...changes } : row));
  };

  const moveCellBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setTestRows(current => {
      const sourceIndex = current.findIndex(row => row.cellId === sourceId);
      const targetIndex = current.findIndex(row => row.cellId === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setSelectedCellIds(current => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const completeModule = async () => {
    if (!draftModule || !acknowledged || testRows.some(row => Number(row.ocvV) <= 0 || Number(row.irMilliOhm) < 0 || !row.grade || row.damageCondition !== 'GOOD')) return;
    setSaving(true);
    try {
      if (draftModule?.id) {
        await api.replaceModuleCells(draftModule.id, selectedCells.map(cell => cell.internalSerial || cell.id));
      }
      const result = await api.completeStandaloneModule(draftModule.id, acknowledged, testRows.map(row => ({
        cellId: row.cellId,
        ocvV: Number(row.ocvV),
        irMilliOhm: Number(row.irMilliOhm),
        grade: row.grade,
        damageCondition: row.damageCondition,
        damageRemarks: row.damageRemarks,
      })));
      await api.updateModuleWeldingStatus(draftModule.id, weldingStatus);
      setQrModule(null);
      setDraftModule(null);
      setSelectedCellIds([]);
      setTestRows([]);
      setActiveModuleId(null);
      triggerRefresh();
      await loadFloorCells();
      addNotification('success', 'Module Complete', `${moduleType} module completed with laser welding ${weldingStatus === 'PASSED' ? 'passed' : 'failed'}.`);
      setActiveView('production-flow');
    } catch (error: any) {
      addNotification('error', 'Module Completion Failed', error.message || 'Complete every required module test.');
    } finally {
      setSaving(false);
    }
  };

  const availableFloorPool = useMemo(
    () => floorCells.filter((cell) => !selectedCellIds.includes(cell.id)),
    [floorCells, selectedCellIds],
  );

  const slotsArray = useMemo(
    () => Array.from({ length: requiredCells }, (_, idx) => selectedCells[idx] ?? null),
    [requiredCells, selectedCells],
  );

  const stageStep = draftModule ? 3 : selectedCells.length > 0 ? 2 : 1;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Studio Header */}
        <header className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                Standalone Module Assembly
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Populate an 8S or 12S cell matrix from FLOOR_STOCK, complete OCV/IR & laser welding checks, and issue a module QR passport.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draftModule ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-black text-amber-800">
                <Cpu className="w-3.5 h-3.5" />
                Draft: {draftModule.serial_number}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingCellIndex(null);
                  setScannerOpen(true);
                }}
                disabled={selectedCellIds.length >= requiredCells}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:bg-slate-300 transition-colors"
              >
                <ScanLine className="h-4 w-4" />
                Scan Cell ({selectedCells.length}/{requiredCells})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveView('inventory')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Module Inventory
            </button>
          </div>
        </header>

        {/* 3-Step Studio Progress Bar */}
        <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap gap-2">
          <div
            className={`flex-1 min-w-[180px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              stageStep === 1
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                stageStep === 1 ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'
              }`}
            >
              1
            </span>
            Config ({moduleType})
          </div>
          <div
            className={`flex-1 min-w-[200px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              stageStep === 2
                ? 'bg-emerald-600 text-white shadow-xs'
                : draftModule
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-slate-500 bg-slate-50'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                stageStep === 2
                  ? 'bg-white text-emerald-700'
                  : draftModule
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              2
            </span>
            2D Cell Matrix ({selectedCells.length}/{requiredCells})
          </div>
          <div
            className={`flex-1 min-w-[190px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              stageStep === 3
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-500 bg-slate-50'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                stageStep === 3 ? 'bg-white text-emerald-700' : 'bg-slate-200 text-slate-600'
              }`}
            >
              3
            </span>
            OCV / IR & Welding QC
          </div>
        </div>

        {/* Module Type Selector Cards + Paste Batch Input (when building) */}
        {!draftModule && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  1 · Module Architecture
                </span>
                <span className="text-[11px] font-bold text-slate-400">
                  FLOOR_STOCK Only
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['8S', '12S'] as const).map((typeOption) => {
                  const isActive = moduleType === typeOption;
                  const cellCount = typeOption === '8S' ? 8 : 12;
                  return (
                    <button
                      key={typeOption}
                      type="button"
                      disabled={Boolean(draftModule)}
                      onClick={() => setModuleType(typeOption)}
                      className={`p-4 rounded-2xl border-2 text-left transition-all ${
                        isActive
                          ? 'border-emerald-500 bg-emerald-50/70 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-lg font-black ${
                            isActive ? 'text-emerald-800' : 'text-slate-900'
                          }`}
                        >
                          {typeOption}
                        </span>
                        {isActive && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        )}
                      </div>
                      <p className="text-xs font-semibold text-slate-600 mt-1">
                        {cellCount} Series Cells
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 mt-2">
                        {typeOption === '8S' ? 'Standard LV Module' : 'Extended Series Module'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={submitManualCells}
              className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    Batch Barcode Intake
                  </span>
                  <h2 className="text-sm font-black text-slate-900">
                    Paste or Scan Multiple Floor-Stock Barcodes
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCellIndex(null);
                    setScannerOpen(true);
                  }}
                  disabled={selectedCellIds.length >= requiredCells}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  Scanner
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <textarea
                  value={manualBarcodes}
                  onChange={(event) => setManualBarcodes(event.target.value)}
                  placeholder="Paste cell barcodes (one per line or comma separated)..."
                  rows={2}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!manualBarcodes.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-emerald-400 disabled:opacity-50 shrink-0"
                >
                  <ClipboardPaste className="h-4 w-4 text-emerald-600" />
                  Add Pasted
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 2: Physical 2D Module Slot Matrix + Floor Stock Pool */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                2D Module Matrix
              </p>
              <h2 className="text-base font-black text-slate-900 mt-0.5">
                Physical Cell Arrangement · {moduleType} ({requiredCells} Slots)
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Slots Assigned
                </span>
                <span className="font-mono text-sm font-black text-emerald-700">
                  {selectedCells.length} / {requiredCells}
                </span>
              </div>
              {selectedCells.length > 0 && !draftModule && (
                <button
                  type="button"
                  onClick={() => setSelectedCellIds([])}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500">
              Loading floor-stock cell inventory...
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Visual 2D Matrix */}
              <div className={`${!draftModule ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {slotsArray.map((cell, index) =>
                    cell ? (
                      <div
                        key={cell.id}
                        className="rounded-2xl border-2 border-emerald-500 bg-white p-3.5 shadow-xs flex flex-col justify-between min-h-[112px]"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black tracking-wide">
                            SLOT {index + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCellIndex(index);
                                setScannerOpen(true);
                              }}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                              title="Replace cell in this slot"
                            >
                              Replace
                            </button>
                            {!draftModule && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCellIds((current) =>
                                    current.filter((id) => id !== cell.id),
                                  )
                                }
                                className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                                title="Remove cell"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2">
                          <p className="truncate font-mono text-xs font-black text-slate-900">
                            {cell.internalSerial}
                          </p>
                          <p className="truncate text-[10px] text-slate-500 mt-0.5">
                            {cell.supplierBarcode || 'FLOOR_STOCK'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <button
                        key={`empty-slot-${index}`}
                        type="button"
                        disabled={Boolean(draftModule)}
                        onClick={() => {
                          setEditingCellIndex(index);
                          setScannerOpen(true);
                        }}
                        className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 p-3.5 text-left min-h-[112px] flex flex-col justify-between hover:border-emerald-400 hover:bg-emerald-50/40 transition-all group disabled:cursor-default disabled:hover:border-slate-300"
                      >
                        <span className="px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-600 text-[10px] font-black w-fit">
                          SLOT {index + 1}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 group-hover:text-emerald-700">
                          <Plus className="w-3.5 h-3.5" />
                          <span>Scan Cell</span>
                        </div>
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Right Quick-Pick Floor Stock Drawer */}
              {!draftModule && (
                <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-3 max-h-[420px]">
                  <div className="space-y-3 flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                        Available Floor Stock
                      </h3>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        {availableFloorPool.length} shown
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        value={floorSearch}
                        onChange={(event) => setFloorSearch(event.target.value)}
                        placeholder="Search serial or barcode..."
                        className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                      {availableFloorPool.length === 0 ? (
                        <div className="py-8 text-center text-[11px] text-slate-400">
                          No matching unassigned cells loaded. Use search or Load More below.
                        </div>
                      ) : (
                        availableFloorPool.slice(0, 30).map((cell) => (
                          <button
                            key={cell.id}
                            type="button"
                            disabled={selectedCellIds.length >= requiredCells}
                            onClick={() => void addCellByBarcode(cell.internalSerial || cell.id)}
                            className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-emerald-400 hover:bg-emerald-50/40 disabled:opacity-40 transition-all"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-mono text-[11px] font-bold text-slate-900">
                                {cell.internalSerial}
                              </p>
                              <p className="truncate text-[10px] text-slate-400">
                                {cell.supplierBarcode || 'FLOOR_STOCK'}
                              </p>
                            </div>
                            <span className="shrink-0 text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                              + Add
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  {hasMoreFloorCells && (
                    <button
                      type="button"
                      onClick={loadMoreFloorCells}
                      className="w-full rounded-xl border border-emerald-200 bg-white py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition-colors shrink-0"
                    >
                      Load more floor cells
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {!draftModule && (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-xs text-slate-500">
                Assign all <strong className="text-slate-700">{requiredCells} cells</strong> to create the serialized module draft and unlock electrical testing.
              </p>
              <button
                type="button"
                onClick={() => void createModule()}
                disabled={saving || selectedCells.length !== requiredCells}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Creating draft...' : `Start ${moduleType} Module`}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>

        {/* Step 3: Quality, OCV/IR & Welding Workflow */}
        {draftModule && (
          <section className="rounded-2xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-emerald-100 bg-emerald-50/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    Step 3 · Electrical Testing & Laser Welding
                  </p>
                  <h2 className="text-base font-black text-slate-900 mt-0.5">
                    Complete {draftModule.serial_number}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-600">
                    Laser Welding
                    <select
                      value={weldingStatus}
                      onChange={(event) =>
                        setWeldingStatus(event.target.value as 'PASSED' | 'FAILED')
                      }
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 normal-case tracking-normal"
                    >
                      <option value="PASSED">PASS</option>
                      <option value="FAILED">FAIL</option>
                    </select>
                  </label>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${
                      weldingStatus === 'PASSED'
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                        : 'border-rose-300 bg-rose-100 text-rose-800'
                    }`}
                  >
                    Welding Status: {weldingStatus === 'PASSED' ? 'WELDED' : 'FAILED'}
                  </span>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-slate-600">
                Verify OCV, Internal Resistance (IR), grade, physical damage state, and laser welding sign-off before issuing the module QR code.
              </p>
            </div>

            <div className="p-5 space-y-4">
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs font-bold text-slate-700 cursor-pointer hover:border-emerald-300">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>I acknowledge the module cells are correctly assigned and seated per polarity spec.</span>
              </label>

              <div className="space-y-2.5">
                {testRows.map((row, index) => {
                  const cell = selectedCells.find((item) => item.id === row.cellId);
                  return (
                    <div
                      key={row.cellId}
                      className="grid gap-2.5 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr_0.8fr_1fr_1.2fr] items-center hover:border-slate-300 transition-colors"
                    >
                      <div>
                        <span className="block text-[10px] font-black text-emerald-700">
                          CELL {index + 1}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {cell?.internalSerial || row.cellId}
                        </span>
                      </div>
                      <input
                        type="number"
                        step="0.001"
                        placeholder="OCV V"
                        value={row.ocvV}
                        onChange={(event) =>
                          updateTestRow(row.cellId, { ocvV: event.target.value })
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-mono focus:border-emerald-500 focus:bg-white focus:outline-none"
                      />
                      <input
                        type="number"
                        step="0.001"
                        placeholder="IR mΩ"
                        value={row.irMilliOhm}
                        onChange={(event) =>
                          updateTestRow(row.cellId, { irMilliOhm: event.target.value })
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-mono focus:border-emerald-500 focus:bg-white focus:outline-none"
                      />
                      <select
                        value={row.grade}
                        onChange={(event) =>
                          updateTestRow(row.cellId, { grade: event.target.value })
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold focus:border-emerald-500 focus:bg-white focus:outline-none"
                      >
                        <option value="A+">Grade A+</option>
                        <option value="A">Grade A</option>
                        <option value="REJECT">Reject</option>
                      </select>
                      <select
                        value={row.damageCondition}
                        onChange={(event) =>
                          updateTestRow(row.cellId, {
                            damageCondition: event.target.value as 'GOOD' | 'DAMAGED',
                          })
                        }
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold focus:border-emerald-500 focus:bg-white focus:outline-none"
                      >
                        <option value="GOOD">Condition: Good</option>
                        <option value="DAMAGED">Condition: Damaged</option>
                      </select>
                      <input
                        value={row.damageRemarks}
                        onChange={(event) =>
                          updateTestRow(row.cellId, { damageRemarks: event.target.value })
                        }
                        placeholder="Inspection / damage remarks"
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs focus:border-emerald-500 focus:bg-white focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <GripVertical className="h-4 w-4" />
                  Drag cells to reorder module slots
                </div>
                <div className="flex flex-wrap gap-2">
                  {testRows.map((row, index) => {
                    const cell = selectedCells.find((item) => item.id === row.cellId);
                    return (
                      <div
                        key={row.cellId}
                        draggable
                        onDragStart={() => setDraggedCellId(row.cellId)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedCellId) moveCellBefore(draggedCellId, row.cellId);
                          setDraggedCellId(null);
                        }}
                        className="cursor-grab rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 hover:border-emerald-400 active:cursor-grabbing shadow-2xs"
                      >
                        <span className="mr-1.5 text-emerald-700 font-black">{index + 1}.</span>
                        <span className="font-mono">{cell?.internalSerial || row.cellId}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={() => void completeModule()}
                disabled={
                  saving ||
                  !acknowledged ||
                  testRows.some(
                    (row) =>
                      !row.ocvV ||
                      !row.irMilliOhm ||
                      !row.grade ||
                      row.damageCondition !== 'GOOD',
                  )
                }
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Completing workflow...' : 'Complete Module & Issue QR'}
                <CheckCircle2 className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}
      </div>
      <ScannerModal isOpen={scannerOpen} onClose={() => { setScannerOpen(false); setEditingCellIndex(null); }} onScan={barcode => { setScannerOpen(false); void addCellByBarcode(barcode); }} title={editingCellIndex !== null ? 'Replace cell in this module slot' : 'Scan floor-stock cell'} subtitle={editingCellIndex !== null ? 'Scan a different FLOOR_STOCK cell to replace the selected slot.' : 'Only cells currently in FLOOR_STOCK can be assigned to this module'} />
      <QRCodeModal isOpen={Boolean(qrModule)} onClose={() => setQrModule(null)} title="Module Traceability QR" qrPayload={qrModule?.qr_code || qrModule?.qrCode || `${qrModule?.serial_number}|MODULE:${qrModule?.id}` || ''} serialNumber={qrModule?.serial_number || 'MODULE'} itemType="MODULE" metadata={{ type: qrModule?.module_type || moduleType, status: qrModule?.status || 'CELLS_ASSIGNED' }} />
    </div>
  );
};