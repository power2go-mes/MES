import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit, RackUnit } from '../../types';
import { ArrowRight, PackageCheck, QrCode, RefreshCw, Truck } from 'lucide-react';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';

type RackTemplate = 'RACK_25KWH' | 'RACK_45KWH' | 'RACK_60KWH' | 'RACK_70KWH' | 'RACK_75KWH';

const rackTemplateConfig: Record<RackTemplate, { capacity: number; requiredCount: number; packLabel: string; packCapacity: number }> = {
  RACK_25KWH: { capacity: 25, requiredCount: 5, packLabel: '5 kWh', packCapacity: 5 },
  RACK_45KWH: { capacity: 45, requiredCount: 6, packLabel: '7.5 kWh', packCapacity: 7.5 },
  RACK_60KWH: { capacity: 60, requiredCount: 8, packLabel: '7.5 kWh', packCapacity: 7.5 },
  RACK_70KWH: { capacity: 70, requiredCount: 9, packLabel: '7.5 kWh', packCapacity: 7.5 },
  RACK_75KWH: { capacity: 75, requiredCount: 10, packLabel: '7.5 kWh', packCapacity: 7.5 },
};

export const RackAssemblyView: React.FC = () => {
  const { addNotification, refreshKey, triggerRefresh } = useApp();
  const [template, setTemplate] = useState<RackTemplate>('RACK_25KWH');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [racks, setRacks] = useState<RackUnit[]>([]);
  const [location, setLocation] = useState('RACK_ASSEMBLY');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrRack, setQrRack] = useState<RackUnit | null>(null);
  const [physicalQc, setPhysicalQc] = useState(false);
  const [voltageQc, setVoltageQc] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [batterySearch, setBatterySearch] = useState('');

  const { capacity: rackCapacity, requiredCount, packLabel, packCapacity } = rackTemplateConfig[template];
  const filteredBatteries = batteries.filter(item => {
    const query = batterySearch.trim().toLowerCase();
    if (!query) return true;
    const serial = String(item.serialNumber || '').toLowerCase();
    return serial.slice(-4) === query || serial.includes(query);
  });

  const load = async () => {
    setLoading(true);
    try {
      const [allBatteries, allRacks] = await Promise.all([api.getBatteries(), api.getRacks()]);
      setBatteries(allBatteries.filter(item => ['RELEASED', 'FINISHED', 'WAREHOUSE'].includes(item.status)));
      setRacks(allRacks);
    } catch (error: any) {
      addNotification('error', 'Rack Load Failed', error.message || 'Could not load rack data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);
  useEffect(() => {
    setSelected([]);
    setPhysicalQc(false);
    setVoltageQc(false);
  }, [template]);

  const continueToBuilder = () => {
    setSelected([]);
    setPhysicalQc(false);
    setVoltageQc(false);
    setBuilderOpen(true);
  };

  const toggleBattery = (id: string) => setSelected(current => (
    current.includes(id)
      ? current.filter(item => item !== id)
      : current.length < requiredCount ? [...current, id] : current
  ));

  const handleBatteryScan = async (barcode: string) => {
    const normalized = barcode.trim().toLowerCase().replace(/\s+/g, '');
    const payload = normalized.split('|')[0];
    const battery = batteries.find(item => [item.id, item.serialNumber, item.qrCode]
      .filter(Boolean)
      .map(value => String(value).toLowerCase().replace(/\s+/g, ''))
      .some(value => value === normalized || value === payload || value.split('|')[0] === payload));
    if (!battery) throw new Error(`Battery '${barcode}' was not found in released pack inventory.`);
    if (selected.includes(battery.id)) throw new Error(`${battery.serialNumber} is already selected for this rack.`);
    if (selected.length >= requiredCount) throw new Error(`This rack accepts exactly ${requiredCount} packs.`);
    const expectedCapacity = packCapacity;
    const capacity = Number((battery as any).capacityKwh ?? (battery as any).capacity_kwh ?? 0);
    if (capacity > 0 && Math.abs(capacity - expectedCapacity) > 0.01) {
      throw new Error(`${battery.serialNumber} is not compatible with this ${rackCapacity} kWh rack.`);
    }
    setSelected(current => [...current, battery.id]);
    setScannerOpen(false);
    addNotification('success', 'Battery Scanned', `${battery.serialNumber} assigned to rack slot ${selected.length + 1}.`);
  };

  const assemble = async () => {
    if (selected.length !== requiredCount || !physicalQc || !voltageQc) return;
    setSaving(true);
    try {
      const result = await api.assembleRack(template, selected, location);
      addNotification('success', 'Rack Assembled', `${result.serialNumber} created with ${requiredCount} compatible packs.`);
      setSelected([]);
      setBuilderOpen(false);
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Rack Assembly Failed', error.message || 'Could not assemble rack.');
    } finally {
      setSaving(false);
    }
  };

  const sell = async (rack: RackUnit) => {
    if (!destination.trim() || !reference.trim()) return;
    setSaving(true);
    try {
      await api.sellRack(rack.id, destination.trim(), reference.trim());
      addNotification('success', 'Rack Sold', `${rack.serialNumber} was marked SOLD.`);
      setDestination('');
      setReference('');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Rack Sale Failed', error.message || 'Could not sell rack.');
    } finally {
      setSaving(false);
    }
  };

  if (!builderOpen) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
        <div className="mx-auto flex min-h-full max-w-2xl items-center justify-center">
          <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <PackageCheck className="mx-auto mb-3 h-12 w-12 text-slate-400" />
            <h1 className="text-xl font-black text-slate-900">SELECT RACK TO ASSEMBLE</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">Select the rack template first, then choose the released battery packs in the 2D rack builder.</p>
            <label className="mt-6 block text-left text-xs font-bold text-slate-600">
              Rack template
              <select value={template} onChange={event => setTemplate(event.target.value as RackTemplate)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm font-bold">
                <option value="RACK_25KWH">25 kWh Rack · 5 × 5 kWh packs</option>
                <option value="RACK_45KWH">45 kWh Rack · 6 × 7.5 kWh packs</option>
                <option value="RACK_60KWH">60 kWh Rack · 8 × 7.5 kWh packs</option>
                <option value="RACK_70KWH">70 kWh Rack · 9 × 7.5 kWh packs</option>
                <option value="RACK_75KWH">75 kWh Rack · 10 × 7.5 kWh packs</option>
              </select>
            </label>
            <button type="button" onClick={continueToBuilder} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-bold text-white hover:bg-cyan-700">
              Continue to 2D Rack Builder <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center">
          <div className="flex items-center gap-3"><PackageCheck className="h-6 w-6 text-cyan-600" /><div><p className="text-[10px] font-black uppercase tracking-widest text-cyan-600">2D Rack Builder</p><h1 className="text-xl font-black text-slate-900">{rackCapacity} kWh Rack Component Layout</h1><p className="text-xs text-slate-500">Select {requiredCount} released {packLabel} battery packs for this rack.</p></div></div>
          <div className="flex gap-2"><input value={location} onChange={event => setLocation(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Rack location" /><button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"><RefreshCw className="h-4 w-4" />Refresh</button></div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="text-[10px] font-black uppercase tracking-widest text-cyan-600">Pack slots</p><h2 className="text-base font-black text-slate-900">Physical Rack Layout</h2></div><div className="flex items-center gap-2"><span className="rounded-lg bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-700">{selected.length} / {requiredCount} selected</span><button type="button" onClick={() => setScannerOpen(true)} disabled={selected.length >= requiredCount} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"><QrCode className="h-4 w-4" />Scan battery</button></div></div>
          {!loading && <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><label className="text-xs font-bold text-slate-600">Search battery pack<input value={batterySearch} onChange={event => setBatterySearch(event.target.value.replace(/\D/g, '').slice(-4))} inputMode="numeric" maxLength={4} placeholder="Last 4 serial digits" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono sm:w-56" /></label><span className="text-[11px] text-slate-500">Showing {filteredBatteries.length} of {batteries.length} released packs</span></div>}
          {loading ? <p className="py-8 text-center text-xs text-slate-500">Loading released packs...</p> : filteredBatteries.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">No released battery pack matches those last four digits.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{filteredBatteries.map(item => <button type="button" key={item.id} onClick={() => toggleBattery(item.id)} className={`rounded-xl border p-4 text-left transition-colors ${selected.includes(item.id) ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-200' : 'border-slate-200 hover:border-cyan-300'}`}><span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-cyan-700">Pack slot {selected.includes(item.id) ? selected.indexOf(item.id) + 1 : '-'}</span><span className="block truncate font-mono text-xs font-black text-slate-900">{item.serialNumber}</span><span className="mt-1 block text-[10px] text-slate-500">{item.status} · {item.productName}</span></button>)}</div>}
          <div className="mt-5 grid gap-2 md:grid-cols-2"><label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-700"><input type="checkbox" checked={physicalQc} onChange={event => setPhysicalQc(event.target.checked)} /> Physical rack inspection passed</label><label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-700"><input type="checkbox" checked={voltageQc} onChange={event => setVoltageQc(event.target.checked)} /> Rack voltage verification passed</label></div>
          <button type="button" onClick={() => void assemble()} disabled={saving || selected.length !== requiredCount || !physicalQc || !voltageQc} className="mt-4 w-full rounded-lg bg-cyan-600 px-4 py-3 text-xs font-bold text-white disabled:bg-slate-300">{saving ? 'Assembling rack...' : 'Assemble rack'}</button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-[10px] font-black uppercase tracking-widest text-cyan-600">Rack register and sale</p><h2 className="text-base font-black text-slate-900">Completed racks</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500"><tr><th className="p-3">Rack</th><th className="p-3">Template</th><th className="p-3">QR</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{racks.map(rack => <tr key={rack.id}><td className="p-3 font-mono font-bold">{rack.serialNumber}</td><td className="p-3">{rack.rackTemplateCode} · {rack.requiredPackCount} packs</td><td className="p-3 font-mono"><button type="button" onClick={() => setQrRack(rack)} className="text-cyan-700"><QrCode className="mr-1 inline h-3.5 w-3.5" />{rack.qrCode}</button></td><td className="p-3 font-bold">{rack.status}</td><td className="p-3">{rack.status === 'IN_STOCK' && <div className="flex min-w-64 gap-1"><input value={reference} onChange={event => setReference(event.target.value)} placeholder="Reference" className="w-24 rounded border border-slate-200 px-2 py-1" /><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="Destination" className="w-28 rounded border border-slate-200 px-2 py-1" /><button type="button" disabled={saving || !reference || !destination} onClick={() => void sell(rack)} className="rounded bg-emerald-600 px-2 py-1 font-bold text-white disabled:bg-slate-300"><Truck className="h-3.5 w-3.5" /></button></div>}</td></tr>)}</tbody></table></div></section>
        <ScannerModal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleBatteryScan} title="Scan battery pack" subtitle="Scan the QR code or serial number of a released battery pack" />
        <QRCodeModal isOpen={Boolean(qrRack)} onClose={() => setQrRack(null)} title="Rack Traceability QR" qrPayload={qrRack?.qrCode || `${qrRack?.serialNumber}|RACK:${qrRack?.id}` || ''} serialNumber={qrRack?.serialNumber || 'RACK'} itemType="RACK" metadata={{ template: qrRack?.rackTemplateCode || '-', status: qrRack?.status || '-' }} />
      </div>
    </div>
  );
};
