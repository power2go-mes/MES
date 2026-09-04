import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { ScanLine, Truck, QrCode } from 'lucide-react';
import { ScannerModal } from '../common/ScannerModal';

export const ContainerFloorView: React.FC = () => {
  const { addNotification } = useApp();
  const [pallet, setPallet] = useState('');
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
    await movePallet(pallet);
  };
  return <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8"><div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><Truck className="h-6 w-6 text-blue-600" /><div><h1 className="text-xl font-black text-slate-900">Container to Floor Stock</h1><p className="text-xs text-slate-500">Scan a pallet QR or pallet number to move its 225 imported cells to the manufacturing floor.</p></div></div></header>
    <form onSubmit={submitManualPallet} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600"><ScanLine className="h-4 w-4" /> Pallet scan</div><div className="grid gap-3 md:grid-cols-[1fr_auto_auto]"><input autoFocus required value={pallet} onChange={event => setPallet(event.target.value)} placeholder="Scan PALLET-... or pallet number" className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono" /><button type="button" onClick={() => setScannerOpen(true)} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"><QrCode className="h-4 w-4" />Scan QR</button><button type="submit" disabled={saving || !pallet.trim()} className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Moving...' : 'Move to floor'}</button></div><p className="mt-4 text-xs text-slate-500">The transaction rejects incomplete pallets and only moves cells currently marked IN STOCK.</p></form>
  </div><ScannerModal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={movePallet} title="Scan Pallet QR" subtitle="Identify a pallet to move its cells to floor stock" /></div>;
};
