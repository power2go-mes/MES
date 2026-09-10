import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit, RackUnit } from '../../types';
import { PackageCheck, Pencil, RefreshCw, Search, ShoppingCart, Trash2 } from 'lucide-react';

type SaleType = 'BATTERY' | 'RACK';
type BatterySummary = Pick<BatteryUnit, 'id' | 'serialNumber' | 'productName' | 'status' | 'lifecycleStatus'>;
type SaleHistoryItem = {
  id: string;
  entityType: SaleType;
  entityId: string;
  serialNumber: string;
  clientName: string;
  soldAt: string;
  persisted?: boolean;
};

export const SoldView: React.FC = () => {
  const { refreshKey, addNotification, triggerRefresh } = useApp();
  const [batteries, setBatteries] = useState<BatterySummary[]>([]);
  const [racks, setRacks] = useState<RackUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saleType, setSaleType] = useState<SaleType>('BATTERY');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [client, setClient] = useState('');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<SaleHistoryItem[]>([]);
  const [editingSale, setEditingSale] = useState<SaleHistoryItem | null>(null);
  const [editClient, setEditClient] = useState('');

  useEffect(() => {
    void loadItems();
  }, [refreshKey]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const [allBatteries, allRacks, saleHistory] = await Promise.all([api.getBatterySummaries(), api.getRacks(), api.getSaleHistory()]);
      setBatteries(allBatteries as BatterySummary[]);
      setRacks(allRacks);
      setHistory(saleHistory as SaleHistoryItem[]);
    } catch (error: any) {
      addNotification('error', 'Sold Load Failed', error.message || 'Could not load sale items.');
      setBatteries([]);
      setRacks([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (sale: SaleHistoryItem) => {
    setEditingSale(sale);
    setEditClient(sale.clientName);
  };

  const saveEdit = async () => {
    if (!editingSale || !editClient.trim()) return;
    setSaving(true);
    try {
      await api.updateSaleHistory(editingSale.id, editClient.trim());
      setHistory(current => current.map(item => item.id === editingSale.id ? { ...item, clientName: editClient.trim() } : item));
      setEditingSale(null);
      addNotification('success', 'Sale Updated', `${editingSale.serialNumber} client was updated.`);
    } catch (error: any) {
      addNotification('error', 'Update Failed', error.message || 'Could not update sale history.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSale = async (sale: SaleHistoryItem) => {
    if (!window.confirm(`Delete the sale history for ${sale.serialNumber}? The item will remain SOLD.`)) return;
    setSaving(true);
    try {
      await api.deleteSaleHistory(sale.id);
      setHistory(current => current.filter(item => item.id !== sale.id));
      addNotification('success', 'History Deleted', `${sale.serialNumber} sale history was deleted.`);
    } catch (error: any) {
      addNotification('error', 'Delete Failed', error.message || 'Could not delete sale history.');
    } finally {
      setSaving(false);
    }
  };

  const availableBatteries = batteries.filter(item => !['SOLD', 'SCRAP'].includes(String(item.lifecycleStatus || '').toUpperCase()));
  const availableRacks = racks.filter(item => !['SOLD', 'SCRAP'].includes(String(item.status || '').toUpperCase()));
  const soldBatteries = batteries.filter(item => String(item.lifecycleStatus || '').toUpperCase() === 'SOLD');
  const soldRacks = racks.filter(item => String(item.status || '').toUpperCase() === 'SOLD');
  const candidates = saleType === 'BATTERY' ? availableBatteries : availableRacks;
  const filteredCandidates = candidates.filter(item =>
    `${item.serialNumber} ${'productName' in item ? item.productName || '' : item.rackTemplateCode || ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const allFilteredSelected = filteredCandidates.length > 0 && filteredCandidates.every(item => selectedIds.includes(item.id));

  const toggleSelected = (id: string) => {
    setSelectedIds(current => current.includes(id)
      ? current.filter(itemId => itemId !== id)
      : [...current, id]);
  };

  const toggleAllFiltered = () => {
    setSelectedIds(current => allFilteredSelected
      ? current.filter(id => !filteredCandidates.some(item => item.id === id))
      : Array.from(new Set([...current, ...filteredCandidates.map(item => item.id)])));
  };

  const submitSale = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedIds.length === 0 || !client.trim()) return;
    setSaving(true);
    try {
      for (const selectedId of selectedIds) {
        if (saleType === 'BATTERY') {
          await api.sellBattery(selectedId, client.trim());
        } else {
          await api.sellRack(selectedId, client.trim(), client.trim());
        }
      }
      addNotification('success', 'Sale Recorded', `${selectedIds.length} item(s) were marked SOLD for ${client.trim()}.`);
      setSelectedIds([]);
      setClient('');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Sale Failed', error.message || 'Could not mark the item as sold.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600"><ShoppingCart className="w-5 h-5" /></span>
          <div><h1 className="text-xl font-black text-slate-900">Sold</h1><p className="text-xs text-slate-500">Select a battery pack or rack, enter the client, and record the sale.</p></div>
        </div>
        <button type="button" onClick={() => void loadItems()} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Refresh sale items"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <form onSubmit={submitSale} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-600"><PackageCheck className="w-4 h-4 text-emerald-600" /> Record sale</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={saleType} onChange={event => { setSaleType(event.target.value as SaleType); setSelectedIds([]); }} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold">
            <option value="BATTERY">Battery Pack</option>
            <option value="RACK">Rack</option>
          </select>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs md:col-span-2">
            <span className="font-semibold text-slate-600">{selectedIds.length} selected</span>
            <button type="button" onClick={toggleAllFiltered} disabled={loading || filteredCandidates.length === 0} className="font-bold text-emerald-700 disabled:text-slate-300">{allFilteredSelected ? 'Clear visible' : 'Select all visible'}</button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 md:col-span-2"><Search className="w-3.5 h-3.5 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search available items" className="w-full outline-none" /></div>
          <input value={client} onChange={event => setClient(event.target.value)} placeholder="Client name" required className="px-3 py-2 border border-slate-200 rounded-lg text-xs" />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {filteredCandidates.length === 0 ? <div className="p-4 text-xs text-slate-500">No available items found.</div> : filteredCandidates.map(item => (
            <label key={item.id} className="flex items-center gap-3 px-3 py-2.5 text-xs hover:bg-slate-50">
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} disabled={saving} className="h-4 w-4 accent-emerald-600" />
              <span className="font-mono font-bold text-slate-900">{item.serialNumber}</span>
              <span className="text-slate-500">{'productName' in item ? item.productName || item.status : item.rackTemplateCode}</span>
            </label>
          ))}
        </div>
        <button type="submit" disabled={saving || loading || selectedIds.length === 0 || !client.trim()} className="w-full md:w-auto px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:bg-slate-300">{saving ? 'Saving sale...' : `Mark ${selectedIds.length || ''} as Sold`}</button>
      </form>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"><div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Sold battery packs ({soldBatteries.length})</div><div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">{soldBatteries.length === 0 ? <div className="p-4 text-xs text-slate-500">No sold battery packs found.</div> : soldBatteries.map(item => <div key={item.id} className="p-3 text-xs"><div className="font-bold text-slate-900 font-mono">{item.serialNumber}</div><div className="mt-1 text-slate-500">{item.productName || 'Battery Pack'} · SOLD</div></div>)}</div></section>
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"><div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Sold racks ({soldRacks.length})</div><div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">{soldRacks.length === 0 ? <div className="p-4 text-xs text-slate-500">No sold racks found.</div> : soldRacks.map(item => <div key={item.id} className="p-3 text-xs"><div className="font-bold text-slate-900 font-mono">{item.serialNumber}</div><div className="mt-1 text-slate-500">{item.rackTemplateCode} · SOLD</div></div>)}</div></section>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div><h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">Sale history</h2><p className="mt-1 text-xs text-slate-500">All successfully sold battery packs and racks.</p></div>
          <span className="text-xs font-bold text-slate-500">{history.length} records</span>
        </div>
        {history.length === 0 ? <div className="p-5 text-xs text-slate-500">No sale history found.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="p-3">Type</th><th className="p-3">Serial</th><th className="p-3">Client</th><th className="p-3">Sold at</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{history.map(sale => <tr key={sale.id}><td className="p-3 font-bold">{sale.entityType === 'BATTERY' ? 'Battery Pack' : 'Rack'}</td><td className="p-3 font-mono font-bold">{sale.serialNumber}</td><td className="p-3">{sale.clientName}</td><td className="p-3 text-slate-500">{new Date(sale.soldAt).toLocaleString()}</td><td className="p-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => startEdit(sale)} disabled={saving || !sale.persisted} title={sale.persisted ? 'Edit client' : 'Legacy sale: history record not stored'} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Pencil className="h-3 w-3" />Edit</button><button type="button" onClick={() => void deleteSale(sale)} disabled={saving || !sale.persisted} title={sale.persisted ? 'Delete history record' : 'Legacy sale: history record not stored'} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3 w-3" />Delete</button></div></td></tr>)}</tbody></table></div>}
      </section>

      {editingSale && <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-xs"><div className="flex flex-col gap-3 md:flex-row md:items-end"><label className="flex-1 text-xs font-bold text-slate-600">Client for {editingSale.serialNumber}<input value={editClient} onChange={event => setEditClient(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" /></label><button type="button" onClick={() => void saveEdit()} disabled={saving || !editClient.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">Save</button><button type="button" onClick={() => setEditingSale(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button></div></div>}
    </div>
  );
};
/*
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit, ModuleItem, RackUnit } from '../../types';
import { PackageCheck, RefreshCw, Search } from 'lucide-react';

export const SoldView: React.FC = () => {
  const { refreshKey, addNotification } = useApp();
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [racks, setRacks] = useState<RackUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void loadSoldItems();
  }, [refreshKey]);

  const loadSoldItems = async () => {
    setLoading(true);
    try {
      const [allBatteries, allModules, allRacks] = await Promise.all([
        api.getBatteries(),
        api.getModules(),
        api.getRacks(),
      ]);

      setBatteries(allBatteries.filter(item => String(item.status || '').toUpperCase() === 'SOLD' || String(item.lifecycleStatus || '').toUpperCase() === 'SOLD'));
      setModules(allModules.filter(item => String(item.status || '').toUpperCase() === 'SOLD' || String(item.lifecycleStatus || '').toUpperCase() === 'SOLD'));
      setRacks(allRacks.filter(item => String(item.status || '').toUpperCase() === 'SOLD'));
    } catch (error: any) {
      addNotification('error', 'Sold Load Failed', error.message || 'Could not load sold items.');
      setBatteries([]);
      setModules([]);
      setRacks([]);
    } finally {
      setLoading(false);
    }
  };

  const totalCount = useMemo(
    () => batteries.length + modules.length + racks.length,
    [batteries.length, modules.length, racks.length],
  );

  const filteredBatteries = batteries.filter(item =>
    `${item.serialNumber} ${item.productName || ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredModules = modules.filter(item =>
    `${item.serialNumber} ${item.moduleType || ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredRacks = racks.filter(item =>
    `${item.serialNumber}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600">
            <PackageCheck className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-xl font-black text-slate-900">Sold</h1>
            <p className="text-xs text-slate-500">Completed stock that has been sold or dispatched.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadSoldItems()}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          title="Refresh sold items"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 bg-slate-50 w-full md:max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search serial or SKU"
              className="w-full bg-transparent outline-none"
            />
          </div>

          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Total sold: {totalCount}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500 shadow-xs">
          Loading sold items...
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Battery packs ({filteredBatteries.length})</div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {filteredBatteries.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">No sold battery packs found.</div>
              ) : filteredBatteries.map(item => (
                <div key={item.id} className="p-3 text-xs">
                  <div className="font-bold text-slate-900 font-mono">{item.serialNumber}</div>
                  <div className="mt-1 text-slate-500">{item.productName || 'N/A'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Modules ({filteredModules.length})</div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {filteredModules.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">No sold modules found.</div>
              ) : filteredModules.map(item => (
                <div key={item.id} className="p-3 text-xs">
                  <div className="font-bold text-slate-900 font-mono">{item.serialNumber}</div>
                  <div className="mt-1 text-slate-500">{item.moduleType || 'Module'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">Racks ({filteredRacks.length})</div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {filteredRacks.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">No sold racks found.</div>
              ) : filteredRacks.map(item => (
                <div key={item.id} className="p-3 text-xs">
                  <div className="font-bold text-slate-900 font-mono">{item.serialNumber}</div>
                  <div className="mt-1 text-slate-500">Rack</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
*/
