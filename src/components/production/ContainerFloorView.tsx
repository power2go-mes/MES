import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { ScanLine, Truck, QrCode, ClipboardPaste, PackageOpen } from 'lucide-react';
import { ScannerModal } from '../common/ScannerModal';

export const ContainerFloorView: React.FC = () => {
  const { addNotification } = useApp();
  const [pallet, setPallet] = useState('');
  const [box, setBox] = useState('');
  const [barcodes, setBarcodes] = useState('');
  const [mode, setMode] = useState<'container' | 'cells'>('container');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const movePallet = async (palletCode: string) => {
    if (!palletCode.trim()) return;
    setSaving(true);
    try {
      const result = await api.movePalletToFloor(palletCode.trim());
      addNotification('success', 'Pallet Moved to Floor', `${result.palletNumber}: ${result.cellCount} cells are now FLOOR STOCK.`);
      setPallet('');
      setScannerOpen(false);
    } catch (error: any) {
      addNotification('error', 'Pallet Scan Failed', error.message || 'Could not move pallet to floor stock.');
      throw error;
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
        barcodes: barcodes.split(/[\n,;\t]+/).map(value => value.trim()).filter(Boolean),
      });
      addNotification('success', 'Cells Moved to Floor', `${result.movedCount} cells are now FLOOR STOCK.`);
      setPallet(''); setBox(''); setBarcodes('');
    } catch (error: any) {
      addNotification('error', 'Cell Move Failed', error.message || 'Could not move cells to floor stock.');
    } finally { setSaving(false); }
  };
  return <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8"><div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><Truck className="h-6 w-6 text-blue-600" /><div><h1 className="text-xl font-black text-slate-900">Container to Floor Stock</h1><p className="text-xs text-slate-500">Move imported cells from a pallet, box, or manual barcode list into FLOOR STOCK.</p></div></div></header>
    <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><button type="button" onClick={() => setMode('container')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === 'container' ? 'bg-blue-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><PackageOpen className="mr-2 inline h-4 w-4" />Pallet / Box</button><button type="button" onClick={() => setMode('cells')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === 'cells' ? 'bg-blue-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><ClipboardPaste className="mr-2 inline h-4 w-4" />Manual / Paste Cells</button></div>
    {mode === 'container' ? <form onSubmit={submitManualPallet} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600"><ScanLine className="h-4 w-4" /> Container identification</div><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]"><input autoFocus required value={pallet} onChange={event => setPallet(event.target.value)} placeholder="Pallet QR / pallet number" className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono" /><input value={box} onChange={event => setBox(event.target.value)} placeholder="Optional box number" className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono" /><button type="button" onClick={() => setScannerOpen(true)} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"><QrCode className="h-4 w-4" />Scan</button><button type="submit" disabled={saving || !pallet.trim()} className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Moving...' : 'Move to floor'}</button></div><p className="mt-4 text-xs text-slate-500">Pallet QR uses the transactional pallet workflow; pallet + box moves only the matching eligible cells.</p></form> : <form onSubmit={submitCells} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600"><ClipboardPaste className="h-4 w-4" /> Cell barcode list</div><textarea required value={barcodes} onChange={event => setBarcodes(event.target.value)} placeholder="Paste one cell barcode per line, or separate values with commas" className="min-h-36 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono" /><div className="mt-3 flex justify-end"><button type="submit" disabled={saving || !barcodes.trim()} className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Moving...' : 'Move cells to floor'}</button></div></form>}
  </div><ScannerModal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={movePallet} title="Scan Pallet QR" subtitle="Identify a pallet to move its cells to floor stock" /></div>;
};
