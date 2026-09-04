import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit } from '../../types';
import { PackageCheck, QrCode, RefreshCw, Truck } from 'lucide-react';

export const RackAssemblyView: React.FC = () => {
  const { addNotification, refreshKey, triggerRefresh } = useApp();
  const [template, setTemplate] = useState<'RACK_25KWH' | 'RACK_75KWH'>('RACK_25KWH');
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [location, setLocation] = useState('RACK_ASSEMBLY');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const requiredCount = template === 'RACK_25KWH' ? 5 : 10;
  const packLabel = template === 'RACK_25KWH' ? '5 kWh' : '7.5 kWh';

  const load = async () => {
    setLoading(true);
    try {
      const [allBatteries, allRacks] = await Promise.all([api.getBatteries(), api.getRacks()]);
      setBatteries(allBatteries.filter(item => ['RELEASED', 'FINISHED', 'WAREHOUSE'].includes(item.status)));
      setRacks(allRacks);
    } catch (error: any) {
      addNotification('error', 'Rack Load Failed', error.message || 'Could not load rack data. Apply the lifecycle migration first.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);
  useEffect(() => { setSelected([]); }, [template]);

  const toggleBattery = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : current.length < requiredCount ? [...current, id] : current);

  const assemble = async () => {
    if (selected.length !== requiredCount) return;
    setSaving(true);
    try {
      const result = await api.assembleRack(template, selected, location);
      addNotification('success', 'Rack Assembled', `${result.serialNumber} created with ${requiredCount} compatible packs.`);
      setSelected([]);
      triggerRefresh();
    } catch (error: any) { addNotification('error', 'Rack Assembly Failed', error.message); } finally { setSaving(false); }
  };

  const sell = async (rack: any) => {
    if (!destination.trim() || !reference.trim()) return;
    setSaving(true);
    try {
      await api.sellRack(rack.id, destination.trim(), reference.trim());
      addNotification('success', 'Rack Sold', `${rack.serialNumber} was marked SOLD.`);
      setDestination(''); setReference(''); triggerRefresh();
    } catch (error: any) { addNotification('error', 'Rack Sale Failed', error.message); } finally { setSaving(false); }
  };

  return <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center"><div className="flex items-center gap-3"><PackageCheck className="h-6 w-6 text-cyan-600" /><div><h1 className="text-xl font-black text-slate-900">Rack Assembly</h1><p className="text-xs text-slate-500">Assemble verified battery packs into 25 kWh or 75 kWh racks.</p></div></div><button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="text-[10px] font-black uppercase tracking-widest text-cyan-600">Step 1</p><h2 className="text-base font-black text-slate-900">Select rack template</h2></div><div className="flex gap-2"><select value={template} onChange={event => setTemplate(event.target.value as typeof template)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><option value="RACK_25KWH">25 kWh rack · 5 × 5 kWh</option><option value="RACK_75KWH">75 kWh rack · 10 × 7.5 kWh</option></select><input value={location} onChange={event => setLocation(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Rack location" /></div></div><div className="mb-4 flex items-center justify-between text-xs"><span className="font-semibold text-slate-500">Select {requiredCount} released {packLabel} packs</span><span className="font-black text-cyan-700">{selected.length} / {requiredCount}</span></div>{loading ? <p className="py-8 text-center text-xs text-slate-500">Loading released packs...</p> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">{batteries.map(item => <button type="button" key={item.id} onClick={() => toggleBattery(item.id)} className={`rounded-xl border p-3 text-left ${selected.includes(item.id) ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 hover:border-cyan-300'}`}><span className="block font-mono text-xs font-black text-slate-900">{item.serialNumber}</span><span className="mt-1 block text-[10px] text-slate-500">{item.status} · {item.productName}</span></button>)}</div>}<button type="button" disabled={saving || selected.length !== requiredCount} onClick={() => void assemble()} className="mt-5 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300"><PackageCheck className="h-4 w-4" />Assemble rack</button></section>
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-[10px] font-black uppercase tracking-widest text-cyan-600">Step 2</p><h2 className="text-base font-black text-slate-900">Rack register and sale</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500"><tr><th className="p-3">Rack</th><th className="p-3">Template</th><th className="p-3">QR</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{racks.map(rack => <tr key={rack.id}><td className="p-3 font-mono font-bold">{rack.serialNumber}</td><td className="p-3">{rack.rackTemplateCode} · {rack.requiredPackCount} packs</td><td className="p-3 font-mono"><QrCode className="mr-1 inline h-3.5 w-3.5" />{rack.qrCode}</td><td className="p-3 font-bold">{rack.status}</td><td className="p-3">{rack.status === 'IN_RACK' && <div className="flex min-w-64 gap-1"><input value={reference} onChange={event => setReference(event.target.value)} placeholder="Reference" className="w-24 rounded border border-slate-200 px-2 py-1" /><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="Destination" className="w-28 rounded border border-slate-200 px-2 py-1" /><button type="button" disabled={saving || !reference || !destination} onClick={() => void sell(rack)} className="rounded bg-emerald-600 px-2 py-1 font-bold text-white disabled:bg-slate-300"><Truck className="h-3.5 w-3.5" /></button></div>}</td></tr>)}</tbody></table></div></section>
  </div></div>;
};
