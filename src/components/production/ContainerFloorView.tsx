import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Layers,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { ScannerModal } from '../common/ScannerModal';

interface TransferLogEntry {
  id: string;
  mode: 'PALLET' | 'CELLS';
  reference: string;
  movedCount: number;
  skippedCount: number;
  timestamp: string;
}

export const ContainerFloorView: React.FC = () => {
  const { addNotification, setActiveView } = useApp();
  const [pallet, setPallet] = useState('');
  const [box, setBox] = useState('');
  const [barcodes, setBarcodes] = useState('');
  const [mode, setMode] = useState<'container' | 'cells'>('container');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessionLogs, setSessionLogs] = useState<TransferLogEntry[]>([]);

  const parsedBarcodes = useMemo(
    () =>
      barcodes
        .split(/[\n,;\t]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    [barcodes],
  );

  const appendLog = (entry: Omit<TransferLogEntry, 'id' | 'timestamp'>) => {
    setSessionLogs((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      },
      ...prev,
    ]);
  };

  const movePallet = async (palletCode: string) => {
    if (!palletCode.trim()) return;
    setSaving(true);
    try {
      const result = await api.movePalletToFloor(palletCode.trim());
      addNotification(
        'success',
        'Container moved to floor',
        `${result.palletNumber}: ${result.cellCount} cells are now in FLOOR_STOCK.`,
      );
      appendLog({
        mode: 'PALLET',
        reference: result.palletNumber || palletCode.trim(),
        movedCount: result.cellCount ?? 0,
        skippedCount: 0,
      });
      setPallet('');
    } catch (error: any) {
      addNotification('error', 'Container move failed', error.message);
    } finally {
      setSaving(false);
    }
  };

  const submitManualPallet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (box.trim()) {
      await submitCells(event);
      return;
    }
    await movePallet(pallet);
  };

  const submitCells = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.moveCellsToFloor({
        palletNumber: pallet,
        boxNumber: box,
        barcodes: parsedBarcodes,
      });
      addNotification(
        'success',
        'Cells moved to floor',
        `${result.movedCount} moved to FLOOR_STOCK (${result.skippedCount} skipped).`,
      );
      appendLog({
        mode: 'CELLS',
        reference: box.trim() || pallet.trim() || `${parsedBarcodes.length} Barcodes`,
        movedCount: result.movedCount ?? 0,
        skippedCount: result.skippedCount ?? 0,
      });
      setBarcodes('');
    } catch (error: any) {
      addNotification('error', 'Floor transfer failed', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700">
            <PackageCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Container to Floor Stock
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Transfer warehouse pallets or inspected boxes from IN_STOCK storage into active FLOOR_STOCK for module assembly.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView('inventory')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Layers className="w-4 h-4 text-emerald-600" />
            Cell Inventory
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('container');
              setScannerOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
          >
            <QrCode className="w-4 h-4" />
            Scan Pallet QR
          </button>
        </div>
      </div>

      {/* Mode Switcher Bar */}
      <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('container')}
          className={`flex-1 min-w-[200px] py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            mode === 'container'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              mode === 'container' ? 'bg-white text-emerald-700' : 'bg-slate-200 text-slate-600'
            }`}
          >
            1
          </span>
          Full Pallet / Container Release
        </button>
        <button
          type="button"
          onClick={() => setMode('cells')}
          className={`flex-1 min-w-[200px] py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            mode === 'cells'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              mode === 'cells' ? 'bg-white text-emerald-700' : 'bg-slate-200 text-slate-600'
            }`}
          >
            2
          </span>
          Box / Selective Cell Transfer
        </button>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-4">
          {mode === 'container' ? (
            <form
              onSubmit={submitManualPallet}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    Bulk Container Gate
                  </span>
                  <h2 className="text-base font-black text-slate-900 mt-0.5">
                    Release Complete Pallet to Floor Stock
                  </h2>
                </div>
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <Boxes className="w-5 h-5" />
                </div>
              </div>

              <div className="p-5 space-y-5">
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="w-full rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-5 text-left hover:bg-emerald-50 hover:border-emerald-500 transition-all group flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="p-3 rounded-xl bg-emerald-600 text-white shadow-xs group-hover:scale-105 transition-transform">
                      <ScanLine className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-900">
                        Scan Container / Pallet Label
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Instantly releases all verified IN_STOCK cells assigned to the scanned pallet.
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-emerald-600 shrink-0 group-hover:translate-x-1 transition-transform" />
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Or Enter Manually
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                      Pallet / Container Number
                    </label>
                    <input
                      value={pallet}
                      onChange={(e) => setPallet(e.target.value)}
                      placeholder="e.g. PLT-2026-001"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                      Optional Box Override
                    </label>
                    <input
                      value={box}
                      onChange={(e) => setBox(e.target.value)}
                      placeholder="Leave blank for entire pallet"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  Only <span className="font-bold text-slate-700">IN_STOCK</span> cells are transitioned to floor inventory.
                </p>
                <button
                  type="submit"
                  disabled={saving || (!pallet.trim() && !box.trim())}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Transferring...' : 'Move Pallet to Floor'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={submitCells}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    Granular Transfer
                  </span>
                  <h2 className="text-base font-black text-slate-900 mt-0.5">
                    Box Number or Selective Barcode Batch
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[11px] font-black text-emerald-700">
                  {parsedBarcodes.length} Barcodes Queued
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                      Pallet Reference (Optional)
                    </label>
                    <input
                      value={pallet}
                      onChange={(e) => setPallet(e.target.value)}
                      placeholder="e.g. PLT-2026-001"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                      Box Number
                    </label>
                    <input
                      value={box}
                      onChange={(e) => setBox(e.target.value)}
                      placeholder="e.g. BOX-014"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Cell Serials / Barcodes (One per line or comma separated)
                    </label>
                    {barcodes && (
                      <button
                        type="button"
                        onClick={() => setBarcodes('')}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={barcodes}
                    onChange={(e) => setBarcodes(e.target.value)}
                    placeholder="Paste scanned cell barcodes here (comma, newline, tab, or semicolon separated)..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  Provide a box number, pallet number, or pasted cell list.
                </p>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (!pallet.trim() && !box.trim() && parsedBarcodes.length === 0)
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Transferring...' : 'Move Selection to Floor'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Info & Session Log Column */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Production Gate Rules
              </h3>
            </div>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Cells must currently hold <strong className="text-slate-800">IN_STOCK</strong> warehouse status before they can be released to floor stock.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Cells already assigned to modules, damaged, issued, or on the floor are automatically skipped and counted safely.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Once in <strong className="text-slate-800">FLOOR_STOCK</strong>, cells immediately appear in Module Assembly for 8S/12S assignment.
                </span>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Session Transfer Log
                </h3>
              </div>
              <span className="text-[11px] font-bold text-slate-400">
                {sessionLogs.length} {sessionLogs.length === 1 ? 'transfer' : 'transfers'}
              </span>
            </div>

            {sessionLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No transfers executed in this session yet. Scan a pallet or submit cells to verify floor movement here.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
                {sessionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-100 text-emerald-800">
                          {log.mode}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-900 truncate">
                          {log.reference}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{log.timestamp}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                        +{log.movedCount} Floor
                      </span>
                      {log.skippedCount > 0 && (
                        <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          {log.skippedCount} skipped
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(value) => {
          setScannerOpen(false);
          setPallet(value);
          void movePallet(value);
        }}
        title="Scan Container / Pallet Barcode"
        subtitle="Moves every cell on the pallet to FLOOR_STOCK"
      />
    </div>
  );
};
