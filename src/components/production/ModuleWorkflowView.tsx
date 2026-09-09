import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { CellItem } from '../../types';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';
import { ClipboardPaste, GripVertical, Layers, ScanLine, Trash2 } from 'lucide-react';

interface ModuleTestRow {
  cellId: string;
  ocvV: string;
  irMilliOhm: string;
  grade: string;
  damageCondition: 'GOOD' | 'DAMAGED';
  damageRemarks: string;
}

export const ModuleWorkflowView: React.FC = () => {
  const { activeModuleId, addNotification, refreshKey, triggerRefresh } = useApp();
  const [moduleType, setModuleType] = useState<'8S' | '12S'>('8S');
  const [floorCells, setFloorCells] = useState<CellItem[]>([]);
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

  const loadFloorCells = async (additionalCells: CellItem[] = []) => {
    setLoading(true);
    try {
      const stockCells = await api.getCells({ lifecycleStatus: 'FLOOR_STOCK', limit: 5000 });
      setFloorCells(current => {
        const cellsById = new Map<string, CellItem>();
        [...stockCells, ...additionalCells, ...current].forEach(cell => {
          if (cell?.id) cellsById.set(cell.id, cell);
        });
        return Array.from(cellsById.values());
      });
    } catch (error: any) {
      addNotification('error', 'Floor Stock Unavailable', error.message || 'Could not load floor-stock cells.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeModuleId) void loadFloorCells();
  }, [activeModuleId, refreshKey]);
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

  const addCellByBarcode = (barcode: string) => {
    const normalized = barcode.trim().toLowerCase();
    if (!normalized) return;
    const cell = floorCells.find(item => [item.id, item.internalSerial, item.supplierBarcode].some(value => String(value || '').toLowerCase() === normalized));
    if (!cell) {
      addNotification('error', 'Cell Not Available', `${barcode} is not in FLOOR_STOCK.`);
      return;
    }
    if (selectedCellIds.includes(cell.id)) {
      addNotification('warning', 'Duplicate Cell', `${barcode} has already been selected.`);
      return;
    }
    if (selectedCellIds.length >= requiredCells) {
      addNotification('warning', 'Module Full', `An ${moduleType} module accepts exactly ${requiredCells} cells.`);
      return;
    }

    if (editingCellIndex !== null) {
      replaceCellAtIndex(editingCellIndex, cell.id);
      setEditingCellIndex(null);
      addNotification('success', 'Cell Replaced', `${cell.internalSerial || cell.id} has been assigned to this module slot.`);
      return;
    }

    setSelectedCellIds(current => [...current, cell.id]);
  };

  const submitManualCells = (event: React.FormEvent) => {
    event.preventDefault();
    manualBarcodes.split(/[\n,;\t]+/).filter(Boolean).forEach(addCellByBarcode);
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
      setQrModule({ ...draftModule, ...result.module, serial_number: result.module.serial_number || draftModule.serial_number, qr_code: draftModule.qr_code || `${draftModule.serial_number}|MODULE:${draftModule.id}` });
      setDraftModule(null);
      setSelectedCellIds([]);
      setTestRows([]);
      triggerRefresh();
      await loadFloorCells();
      addNotification('success', 'Module Complete', `${moduleType} module completed with laser welding ${weldingStatus === 'PASSED' ? 'passed' : 'failed'}.`);
    } catch (error: any) {
      addNotification('error', 'Module Completion Failed', error.message || 'Complete every required module test.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><Layers className="h-7 w-7 text-emerald-600" /><div><h1 className="text-xl font-black text-slate-900">Standalone Module Assembly</h1><p className="text-xs text-slate-500">Build a module directly from FLOOR_STOCK cells. Battery and rack selection happens in later production stages.</p></div></div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end">
            <label className="text-xs font-bold text-slate-600">Module type<select value={moduleType} disabled={Boolean(draftModule)} onChange={event => setModuleType(event.target.value as '8S' | '12S')} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-bold"><option value="8S">8S · 8 cells</option><option value="12S">12S · 12 cells</option></select></label>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900"><strong>Floor stock only:</strong> scan cells received from Supplier Import and moved through Container to Floor.</div>
            <button type="button" onClick={() => setScannerOpen(true)} disabled={Boolean(draftModule) || selectedCellIds.length >= requiredCells} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300"><ScanLine className="h-4 w-4" />Scan cell</button>
          </div>
          {!draftModule && <form onSubmit={submitManualCells} className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea value={manualBarcodes} onChange={event => setManualBarcodes(event.target.value)} placeholder="Paste cell barcodes, one per line or comma separated" className="min-h-12 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono" /><button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><ClipboardPaste className="h-4 w-4" />Add pasted cells</button></form>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">2D Module Builder</p><h2 className="text-base font-black text-slate-900">Cells assigned to {moduleType}</h2></div><span className="font-mono text-sm font-black text-emerald-700">{selectedCells.length} / {requiredCells}</span></div>
          {loading ? <p className="p-8 text-center text-xs text-slate-500">Loading floor-stock cells...</p> : <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">{selectedCells.map((cell, index) => <div key={cell.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-black text-emerald-700">SLOT {index + 1}</span><div className="flex items-center gap-2"><button type="button" onClick={() => { setEditingCellIndex(index); setScannerOpen(true); }} className="inline-flex items-center gap-1 rounded border border-emerald-600 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50" title="Edit this cell">Edit</button><button type="button" onClick={() => setSelectedCellIds(current => current.filter(id => id !== cell.id))} className="text-slate-400 hover:text-red-600" title="Remove cell"><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-2 truncate font-mono text-xs font-bold text-slate-900">{cell.internalSerial}</p><p className="mt-1 text-[10px] text-slate-500">{cell.supplierBarcode || 'No supplier barcode'} · FLOOR_STOCK</p></div>)}{selectedCells.length === 0 && <p className="col-span-full py-8 text-center text-xs text-slate-500">No cells selected. Scan or paste cells from floor stock.</p>}</div>}
          {!draftModule && <div className="flex items-center justify-between border-t border-slate-100 p-5"><p className="text-xs text-slate-500">The first step creates a module draft. Tests are required before completion.</p><button type="button" onClick={() => void createModule()} disabled={saving || selectedCells.length !== requiredCells} className="rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Creating draft...' : `Start ${moduleType} module`}</button></div>}
        </section>

        {draftModule && <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50 p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Module quality workflow</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-black text-slate-900">Complete {draftModule.serial_number}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-600">Laser Welding<select value={weldingStatus} onChange={event => setWeldingStatus(event.target.value as 'PASSED' | 'FAILED')} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold normal-case tracking-normal"><option value="PASSED">PASS</option><option value="FAILED">FAIL</option></select></label>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${weldingStatus === 'PASSED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  Welding Status: {weldingStatus === 'PASSED' ? 'WELDED' : 'FAILED'}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600">Acknowledgement, OCV/IR, grading, damage history, and welding status are shown before completion.</p>
          </div>
          <label className="m-5 flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-700"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I acknowledge the module cells are correctly assigned.</label>
          <div className="space-y-3 px-5 pb-5">{testRows.map((row, index) => { const cell = selectedCells.find(item => item.id === row.cellId); return <div key={row.cellId} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr_0.8fr_1fr_1.2fr]"><div><span className="block text-[10px] font-black text-slate-500">CELL {index + 1}</span><span className="font-mono text-xs font-bold">{cell?.internalSerial || row.cellId}</span></div><input type="number" step="0.001" placeholder="OCV V" value={row.ocvV} onChange={event => updateTestRow(row.cellId, { ocvV: event.target.value })} className="rounded border border-slate-200 px-2 py-2 text-xs" /><input type="number" step="0.001" placeholder="IR mΩ" value={row.irMilliOhm} onChange={event => updateTestRow(row.cellId, { irMilliOhm: event.target.value })} className="rounded border border-slate-200 px-2 py-2 text-xs" /><select value={row.grade} onChange={event => updateTestRow(row.cellId, { grade: event.target.value })} className="rounded border border-slate-200 px-2 py-2 text-xs"><option value="A+">A+</option><option value="A">A</option><option value="REJECT">Reject</option></select><select value={row.damageCondition} onChange={event => updateTestRow(row.cellId, { damageCondition: event.target.value as 'GOOD' | 'DAMAGED' })} className="rounded border border-slate-200 px-2 py-2 text-xs"><option value="GOOD">Damage: Good</option><option value="DAMAGED">Damage: Damaged</option></select><input value={row.damageRemarks} onChange={event => updateTestRow(row.cellId, { damageRemarks: event.target.value })} placeholder="Damage history / remarks" className="rounded border border-slate-200 px-2 py-2 text-xs" /></div>; })}</div>
          <div className="flex justify-end border-t border-amber-100 p-5"><button type="button" onClick={() => void completeModule()} disabled={saving || !acknowledged || testRows.some(row => !row.ocvV || !row.irMilliOhm || !row.grade || row.damageCondition !== 'GOOD')} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Completing workflow...' : 'Complete module and issue QR'}</button></div>
        </section>}
      </div>
      {draftModule && <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500"><GripVertical className="h-4 w-4" />Drag cells to reorder module slots</div><div className="flex flex-wrap gap-2">{testRows.map((row, index) => { const cell = selectedCells.find(item => item.id === row.cellId); return <div key={row.cellId} draggable onDragStart={() => setDraggedCellId(row.cellId)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedCellId) moveCellBefore(draggedCellId, row.cellId); setDraggedCellId(null); }} className="cursor-grab rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 active:cursor-grabbing"><span className="mr-1 text-emerald-600">{index + 1}.</span>{cell?.internalSerial || row.cellId}</div>; })}</div></div>}
      <ScannerModal isOpen={scannerOpen} onClose={() => { setScannerOpen(false); setEditingCellIndex(null); }} onScan={barcode => { setScannerOpen(false); addCellByBarcode(barcode); }} title={editingCellIndex !== null ? 'Replace cell in this module slot' : 'Scan floor-stock cell'} subtitle={editingCellIndex !== null ? 'Scan a different FLOOR_STOCK cell to replace the selected slot.' : 'Only cells currently in FLOOR_STOCK can be assigned to this module'} />
      <QRCodeModal isOpen={Boolean(qrModule)} onClose={() => setQrModule(null)} title="Module Traceability QR" qrPayload={qrModule?.qr_code || qrModule?.qrCode || `${qrModule?.serial_number}|MODULE:${qrModule?.id}` || ''} serialNumber={qrModule?.serial_number || 'MODULE'} itemType="MODULE" metadata={{ type: qrModule?.module_type || moduleType, status: qrModule?.status || 'CELLS_ASSIGNED' }} />
    </div>
  );
};