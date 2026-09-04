import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit } from '../../types';
import { PackageCheck, Truck, RefreshCw } from 'lucide-react';

export const WarehouseView: React.FC = () => {
  const { refreshKey, addNotification, triggerRefresh } = useApp();
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [location, setLocation] = useState('FINISHED_GOODS');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [selectedBattery, setSelectedBattery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [allBatteries, history] = await Promise.all([api.getBatteries(), api.getWarehouseMovements()]);
      setBatteries(allBatteries.filter(b => ['FINISHED', 'RELEASED'].includes(b.status)));
      setMovements(history);
    } catch (error: any) {
      addNotification('error', 'Warehouse Load Failed', error.message || 'Could not load warehouse data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);

  const receive = async () => {
    if (!selectedBattery || !location.trim()) return;
    setSaving(true);
    try {
      await api.receiveBattery(selectedBattery, location.trim());
      addNotification('success', 'Battery Received', 'Released battery added to warehouse stock.');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Receipt Failed', error.message || 'Could not receive battery.');
    } finally {
      setSaving(false);
    }
  };

  const dispatch = async () => {
    if (!selectedBattery || !reference.trim() || !destination.trim()) return;
    setSaving(true);
    try {
      await api.dispatchBattery(selectedBattery, reference.trim(), destination.trim());
      addNotification('success', 'Battery Dispatched', 'Dispatch was recorded successfully.');
      setDestination('');
      setReference('');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Dispatch Failed', error.message || 'Could not dispatch battery.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3"><PackageCheck className="w-6 h-6 text-emerald-600" /><div><h1 className="text-xl font-black text-slate-900">Warehouse & Dispatch</h1><p className="text-xs text-slate-500">Released battery stock, locations, movement history, and dispatch.</p></div></div>
        <button type="button" onClick={() => void load()} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Refresh warehouse"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3">
        <select value={selectedBattery} onChange={e => setSelectedBattery(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs md:col-span-2"><option value="">Select released battery</option>{batteries.map(b => <option key={b.id} value={b.id}>{b.serialNumber} ({b.status})</option>)}</select>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Warehouse location" className="px-3 py-2 border border-slate-200 rounded-lg text-xs" />
        <button type="button" onClick={() => void receive()} disabled={saving || !selectedBattery} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:bg-slate-300">Receive</button>
        <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Dispatch reference" className="px-3 py-2 border border-slate-200 rounded-lg text-xs" />
        <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Customer / destination" className="px-3 py-2 border border-slate-200 rounded-lg text-xs md:col-span-2" />
        <button type="button" onClick={() => void dispatch()} disabled={saving || !selectedBattery} className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"><Truck className="w-4 h-4" />Dispatch</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"><div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Released Batteries</div>{loading ? <div className="p-8 text-center text-xs text-slate-500">Loading warehouse...</div> : <table className="w-full text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-3">Battery</th><th className="p-3">Status</th><th className="p-3">QR</th><th className="p-3">BMS / BMU</th></tr></thead><tbody className="divide-y divide-slate-100">{batteries.map(b => <tr key={b.id}><td className="p-3 font-mono font-bold">{b.serialNumber}</td><td className="p-3">{b.status}</td><td className="p-3 font-mono">{b.qrCode || 'Not generated'}</td><td className="p-3">{b.bms?.serialNumber || '-'} / {b.bmu?.serialNumber || '-'}</td></tr>)}</tbody></table>}</div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"><div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Movement History</div><table className="w-full text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-3">Entity</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Time</th></tr></thead><tbody className="divide-y divide-slate-100">{movements.map(m => <tr key={m.id}><td className="p-3 font-mono">{m.entityId}</td><td className="p-3">{m.fromLocation || '-'}</td><td className="p-3">{m.toLocation}</td><td className="p-3">{new Date(m.movedAt).toLocaleString()}</td></tr>)}</tbody></table></div>
    </div>
  );
};
