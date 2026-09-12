import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit, ModuleItem, RackUnit } from '../../types';
import { PackageCheck, Pencil, RefreshCw, ScanLine, Trash2 } from 'lucide-react';
import { ScannerModal } from '../common/ScannerModal';

export const WarehouseView: React.FC = () => {
  const { refreshKey, addNotification, triggerRefresh } = useApp();
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [racks, setRacks] = useState<RackUnit[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [location, setLocation] = useState('KARACHI');
  const [selectedBattery, setSelectedBattery] = useState('');
  const [receiveType, setReceiveType] = useState<'MODULE' | 'BATTERY' | 'RACK'>('BATTERY');
  const [selectedEntity, setSelectedEntity] = useState('');
  const [selectedReceiveIds, setSelectedReceiveIds] = useState<string[]>([]);
  const [serialSearch, setSerialSearch] = useState('');
  const [subFilter, setSubFilter] = useState('ALL');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{ entityType: 'MODULE' | 'BATTERY' | 'RACK'; entityId: string; label: string; currentLocation: 'KARACHI' | 'LAHORE' } | null>(null);
  const [editingLocation, setEditingLocation] = useState<'KARACHI' | 'LAHORE'>('KARACHI');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const getWarehouseLocationForEntity = (entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string): 'KARACHI' | 'LAHORE' => {
    if (entityType === 'RACK') {
      const rack = racks.find(item => item.id === entityId);
      const rackLocation = String(rack?.location || '').toUpperCase();
      return rackLocation === 'LAHORE' ? 'LAHORE' : 'KARACHI';
    }

    const historyEntry = [...movements]
      .filter(entry => String(entry.entity_type || entry.entityType || '').toUpperCase() === entityType)
      .filter(entry => String(entry.entity_id || entry.entityId || '') === entityId)
      .sort((left, right) => new Date(right.movedAt || right.moved_at || 0).getTime() - new Date(left.movedAt || left.moved_at || 0).getTime())[0];

    const latestLocation = String(historyEntry?.toLocation || historyEntry?.to_location || '').toUpperCase();
    return latestLocation === 'LAHORE' ? 'LAHORE' : 'KARACHI';
  };

  const load = async () => {
    setLoading(true);
    try {
      const [allBatteries, history, allRacks, allModules] = await Promise.all([
        api.getBatterySummaries(),
        api.getWarehouseMovements(undefined, 500),
        api.getRacks({ summaryOnly: true }),
        api.getModules({ includeCells: false }),
      ]);
      const rackBatteryIds = new Set(allRacks.flatMap(rack => rack.batteryIds || []));
      setBatteries(allBatteries.filter(b => (
        ['FINISHED', 'RELEASED', 'WAREHOUSE'].includes(b.status)
        || b.lifecycleStatus === 'IN_STOCK'
      ) && !['SOLD', 'QUARANTINED'].includes(b.status) && !rackBatteryIds.has(b.id)) as BatteryUnit[]);
      setRacks(allRacks.filter(rack => rack.status !== 'SOLD' && rack.status !== 'SCRAP'));
      setModules(allModules.filter(module => !module.batteryId && module.lifecycleStatus !== 'SOLD' && module.lifecycleStatus !== 'SCRAP'));
      setMovements(history);
    } catch (error: any) {
      addNotification('error', 'Warehouse Load Failed', error.message || 'Could not load warehouse data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);

  const receiveIdentifiers = async (identifiers: string[]) => {
    const values = Array.from(new Set(identifiers.map(value => value.trim()).filter(Boolean)));
    if (values.length === 0 || !location.trim()) return;
    setSaving(true);
    try {
      for (const identifier of values) {
        await api.receiveWarehouseEntity(receiveType, identifier, location as 'KARACHI' | 'LAHORE');
      }
      addNotification('success', 'Warehouse Receipt Recorded', `${values.length} ${receiveType.toLowerCase()} item(s) added to ${location}.`);
      setSerialSearch('');
      setSelectedEntity('');
      setSelectedBattery('');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Receipt Failed', error.message || 'Could not receive selected item(s).');
    } finally {
      setSaving(false);
    }
  };

  const toggleReceiveSelection = (id: string) => {
    setSelectedReceiveIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const selectAllVisible = () => {
    const visibleIds = filteredReceiveItems.map(item => item.id);
    setSelectedReceiveIds(current => visibleIds.every(id => current.includes(id))
      ? current.filter(id => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])));
  };

  const openEditLocation = (entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string, label: string) => {
    const currentLocation = getWarehouseLocationForEntity(entityType, entityId);
    setEditingItem({ entityType, entityId, label, currentLocation });
    setEditingLocation(currentLocation);
  };

  const saveWarehouseLocationEdit = async () => {
    if (!editingItem) return;
    setSaving(true);
    try {
      await api.updateWarehouseEntityLocation(editingItem.entityType, editingItem.entityId, editingLocation);
      addNotification('success', 'Warehouse Location Updated', `${editingItem.label} moved to ${editingLocation}.`);
      setEditingItem(null);
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Location Update Failed', error.message || 'Could not update warehouse location.');
    } finally {
      setSaving(false);
    }
  };

  const removeFromWarehouse = async (entityType: 'MODULE' | 'BATTERY' | 'RACK', entityId: string, label: string) => {
    if (!window.confirm(`Remove ${label} from warehouse stock?`)) return;
    setSaving(true);
    try {
      await api.removeWarehouseEntity(entityType, entityId);
      addNotification('success', 'Removed from Warehouse', `${label} was removed from warehouse stock.`);
      setEditingItem(null);
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Warehouse Removal Failed', error.message || 'Could not remove item from warehouse.');
    } finally {
      setSaving(false);
    }
  };

  const searchValue = serialSearch.trim().toLowerCase();
  const matchesSerial = (serial: string) => !searchValue || serial.toLowerCase().endsWith(searchValue) || serial.toLowerCase().includes(searchValue);
  const matchesSubtype = (item: BatteryUnit | ModuleItem | RackUnit) => {
    if (subFilter === 'ALL' || receiveType === 'RACK') return true;
    if (receiveType === 'MODULE') return String((item as ModuleItem).moduleType || '').toUpperCase() === subFilter;
    const battery = item as BatteryUnit;
    const haystack = `${battery.serialNumber} ${battery.productName}`.toUpperCase();
    const capacity = Number((battery as BatteryUnit & { capacityKwh?: number }).capacityKwh || 0);
    return subFilter === '5KWH'
      ? (capacity > 0 ? capacity < 7 : haystack.includes('5KWH'))
      : (capacity >= 7 && capacity <= 8) || haystack.includes('7.5KWH') || haystack.includes('7KWH') || haystack.includes('8KWH');
  };
  const filteredReceiveItems = receiveType === 'BATTERY'
    ? batteries.filter(item => matchesSerial(item.serialNumber) && matchesSubtype(item))
    : receiveType === 'MODULE'
      ? modules.filter(item => matchesSerial(item.serialNumber) && matchesSubtype(item))
      : racks.filter(item => matchesSerial(item.serialNumber) && matchesSubtype(item));

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3"><PackageCheck className="w-6 h-6 text-emerald-600" /><div><h1 className="text-xl font-black text-slate-900">Warehouse</h1><p className="text-xs text-slate-500">Receive packs, modules, and racks into Karachi or Lahore warehouse stock.</p></div></div>
        <button type="button" onClick={() => void load()} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Refresh warehouse"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs grid grid-cols-1 md:grid-cols-4 gap-3">
        <select value={receiveType} onChange={e => { setReceiveType(e.target.value as typeof receiveType); setSubFilter('ALL'); setSelectedEntity(''); setSelectedReceiveIds([]); }} className="px-3 py-2 border border-slate-200 rounded-lg text-xs"><option value="BATTERY">Battery Pack</option><option value="MODULE">Module</option><option value="RACK">Rack</option></select>
        <input value={serialSearch} onChange={e => setSerialSearch(e.target.value)} placeholder="Search last 4 serial digits" inputMode="numeric" className="px-3 py-2 border border-slate-200 rounded-lg text-xs" />
        <select value={subFilter} onChange={e => { setSubFilter(e.target.value); setSelectedReceiveIds([]); }} disabled={receiveType === 'RACK'} className="px-3 py-2 border border-slate-200 rounded-lg text-xs"><option value="ALL">All {receiveType === 'MODULE' ? 'module types' : 'pack powers'}</option>{receiveType === 'MODULE' ? <><option value="8S">8S</option><option value="12S">12S</option></> : receiveType === 'BATTERY' ? <><option value="5KWH">5 kWh</option><option value="7.5KWH">7.5 kWh</option></> : <option value="ALL">All racks</option>}</select>
        <select value={receiveType === 'BATTERY' ? selectedBattery : selectedEntity} onChange={e => { const id = e.target.value; if (receiveType === 'BATTERY') setSelectedBattery(id); else setSelectedEntity(id); if (id) setSelectedReceiveIds(current => current.includes(id) ? current : [...current, id]); }} className="px-3 py-2 border border-slate-200 rounded-lg text-xs md:col-span-2"><option value="">Select {receiveType.toLowerCase()} ({filteredReceiveItems.length} found)</option>{filteredReceiveItems.map(item => <option key={item.id} value={item.id}>{item.serialNumber} ({item.status})</option>)}</select>
        <select value={location} onChange={e => setLocation(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs"><option value="KARACHI">Karachi Warehouse</option><option value="LAHORE">Lahore Warehouse</option></select>
        <button type="button" onClick={() => setScannerOpen(true)} disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold disabled:bg-slate-300 flex items-center justify-center gap-2"><ScanLine className="w-4 h-4" />Scan</button>
        <button type="button" onClick={() => void receiveIdentifiers(selectedReceiveIds)} disabled={saving || selectedReceiveIds.length === 0} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:bg-slate-300">Receive Selected ({selectedReceiveIds.length})</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3"><span className="text-xs font-bold uppercase tracking-wider text-slate-600">Select {receiveType.toLowerCase()} items</span><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={filteredReceiveItems.length > 0 && filteredReceiveItems.every(item => selectedReceiveIds.includes(item.id))} onChange={selectAllVisible} className="h-4 w-4 accent-emerald-600" /> Select all visible</label></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto">{filteredReceiveItems.map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"><input type="checkbox" checked={selectedReceiveIds.includes(item.id)} onChange={() => toggleReceiveSelection(item.id)} className="h-4 w-4 accent-emerald-600" /><span className="truncate font-mono font-semibold">{item.serialNumber}</span></label>)}</div>
      </div>
      {editingItem && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Edit warehouse location</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{editingItem.label}</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={editingLocation} onChange={e => setEditingLocation(e.target.value as 'KARACHI' | 'LAHORE')} className="px-3 py-2 border border-slate-200 rounded-lg text-xs">
                <option value="KARACHI">Karachi Warehouse</option>
                <option value="LAHORE">Lahore Warehouse</option>
              </select>
              <button type="button" onClick={() => void saveWarehouseLocationEdit()} disabled={saving} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:bg-slate-300">Save</button>
              <button type="button" onClick={() => setEditingItem(null)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
      <ScannerModal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={value => { setScannerOpen(false); void receiveIdentifiers([value]); }} title={`Scan ${receiveType}`} subtitle={`Scan a ${receiveType.toLowerCase()} identifier for ${location} warehouse`} />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"><div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Movement History</div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-3">Entity</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Time</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{movements.map(m => { const entityType = String(m.entityType || m.entity_type || '').toUpperCase() as 'MODULE' | 'BATTERY' | 'RACK'; const entityId = String(m.entityId || m.entity_id || ''); const label = String(m.entitySerial || entityId || m.id); const canManage = ['MODULE', 'BATTERY', 'RACK'].includes(entityType) && Boolean(entityId); return <tr key={m.id}><td className="p-3 font-mono">{label}</td><td className="p-3">{m.fromLocation || m.from_location || '-'}</td><td className="p-3">{m.toLocation || m.to_location}</td><td className="p-3">{new Date(m.movedAt || m.moved_at).toLocaleString()}</td><td className="p-3"><div className="flex items-center gap-1">{canManage && <><button type="button" onClick={() => openEditLocation(entityType, entityId, label)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"><Pencil className="h-3 w-3" />Edit</button><button type="button" onClick={() => void removeFromWarehouse(entityType, entityId, label)} disabled={saving} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3 w-3" />Delete</button></>}</div></td></tr>; })}</tbody></table></div></div>
    </div>
  );
};
