import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { CellItem, BMSItem, BMUItem, ModuleItem, BatteryUnit } from '../../types';
import { downloadBatteryReport, downloadCellReport, downloadRackReport } from '../../lib/cellReportExport';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';
import { BatteryReportModal } from '../common/BatteryReportModal';
import {
  Boxes,
  Layers,
  Cpu,
  Search,
  Filter,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  Eye,
  Plus,
  Pencil,
  Trash2,
  Download,
} from 'lucide-react';

type Tab = 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS';

const cellStatuses = [
  'IN_STOCK', 'FLOOR_STOCK', 'IN_MODULE', 'IN_PACK', 'IN_RACK', 'KARACHI_WAREHOUSE', 'LAHORE_WAREHOUSE', 'SOLD', 'SCRAP',
] as const;

export const InventoryView: React.FC = () => {
  const { setActiveView, setActiveModuleId, setActiveBatteryId, setBatteryBuilderEditRequested, setQuickSearchQuery, refreshKey, addNotification, triggerRefresh, inventoryTab, setInventoryTab } = useApp();
  const activeTab = inventoryTab;
  const setActiveTab = setInventoryTab;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [cellsView, setCellsView] = useState<'ALL' | 'USED'>('ALL');

  const [cells, setCells] = useState<CellItem[]>([]);
  const [allCells, setAllCells] = useState<CellItem[]>([]);
  const [cellBuckets, setCellBuckets] = useState<Array<{ cellId: string; bucket: 'AVAILABLE' | 'RESERVED' | 'IN_PROCESS' | 'DAMAGE' }>>([]);
  const [warehouseCellStatuses, setWarehouseCellStatuses] = useState<Record<string, string>>({});
  const [warehouseEntityStatuses, setWarehouseEntityStatuses] = useState<Record<string, string>>({});
  const [allCellsCount, setAllCellsCount] = useState(0);
  const [usedCellsCount, setUsedCellsCount] = useState(0);
  const [inventoryPage, setInventoryPage] = useState(0);
  const [hasMoreInventory, setHasMoreInventory] = useState(false);
  const [bmsUnits, setBmsUnits] = useState<BMSItem[]>([]);
  const [bmuUnits, setBmuUnits] = useState<BMUItem[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingCells, setExportingCells] = useState(false);
  const [exportingBatteryReport, setExportingBatteryReport] = useState(false);
  const [exportingRackReport, setExportingRackReport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<Tab, string[]>>({
    CELLS: [],
    BMS: [],
    BMU: [],
    MODULES: [],
    BATTERIES: [],
    RACKS: [],
  });

  // BMS Ingestion Modal
  const [showBmsModal, setShowBmsModal] = useState(false);
  const [bmsCount, setBmsCount] = useState(10);
  const [bmsModel, setBmsModel] = useState('PACE-51.2V-100A-CAN');
  const [bmsManufacturer, setBmsManufacturer] = useState('');
  const [bmsBatchNumber, setBmsBatchNumber] = useState('');
  const [bmsSerials, setBmsSerials] = useState('');
  const [ingestingBms, setIngestingBms] = useState(false);
  const [showBmuModal, setShowBmuModal] = useState(false);
  const [bmuCount, setBmuCount] = useState(10);
  const [bmuModel, setBmuModel] = useState('Power2Go BMU-X1');
  const [bmuManufacturer, setBmuManufacturer] = useState('Power2Go');
  const [bmuBatchNumber, setBmuBatchNumber] = useState('');
  const [bmuSerials, setBmuSerials] = useState('');
  const [serialScanner, setSerialScanner] = useState<'BMS' | 'BMU' | null>(null);
  const [ingestingBmu, setIngestingBmu] = useState(false);

  // Detail Modal & QR Modal
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrData, setQrData] = useState<any | null>(null);
  const [reportBattery, setReportBattery] = useState<BatteryUnit | null>(null);

  useEffect(() => {
    setInventoryPage(0);
    setHasMoreInventory(false);
    const timer = window.setTimeout(() => {
      void loadInventory(0);
    }, search ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, search, statusFilter, cellsView, refreshKey]);

  const loadInventory = async (page = 0) => {
    const append = page > 0;
    const pageSize = 50;
    setLoading(true);
    try {
      if (activeTab === 'CELLS') {
        const serverLifecycleStatus = !['KARACHI_WAREHOUSE', 'LAHORE_WAREHOUSE'].includes(statusFilter) && cellStatuses.includes(statusFilter as typeof cellStatuses[number])
          ? statusFilter
          : undefined;
        const warehouseFilterSelected = statusFilter === 'KARACHI_WAREHOUSE' || statusFilter === 'LAHORE_WAREHOUSE';
        const [res, counts, warehouseStatuses] = await Promise.all([
          api.getCells({
            search: search || undefined,
            lifecycleStatus: serverLifecycleStatus,
            usedOnly: cellsView === 'USED' ? true : undefined,
            limit: pageSize,
            offset: page * pageSize,
            fields: 'id,internal_serial,supplier_barcode,qr_code,supplier_id,batch_number,pallet_number,box_number,supplier_ocv_v,supplier_ir_mohm,production_ocv_v,production_ir_mohm,grade,status,lifecycle_status,reserved_for_order_id,reserved_for_battery_id,tested_at,created_at,updated_at,supplier:suppliers(name)',
          }),
          !search && !statusFilter
            ? api.getCellCounts()
            : Promise.resolve({ total: allCellsCount, used: usedCellsCount, available: 0, quarantined: 0 }),
          warehouseFilterSelected ? api.getWarehouseCellStatuses() : Promise.resolve({}),
        ]);
        setCells(previous => append ? [...previous, ...res] : res);
        setWarehouseCellStatuses(warehouseStatuses);
        setHasMoreInventory(res.length === pageSize);
        setInventoryPage(page);
        setAllCellsCount(counts.total);
        setUsedCellsCount(counts.used);
        if (!search && !statusFilter) {
          setAllCells(cellsView === 'USED' ? res : []);
        }

        if (cellsView === 'USED') {
          try {
            const [loadedModules, loadedBatteries, buckets] = await Promise.all([
              api.getModules(),
              api.getBatterySummaries(),
              api.getCellInventoryBuckets(),
            ]);
            setModules(loadedModules);
            setBatteries(loadedBatteries as BatteryUnit[]);
            setCellBuckets(buckets);
          } catch (error) {
            console.error('Failed to load used-cell relationships', error);
            setCellBuckets([]);
          }
        }
      } else if (activeTab === 'BMS') {
        const res = await api.getBmsUnits();
        setBmsUnits(res);
        setHasMoreInventory(false);
      } else if (activeTab === 'BMU') {
        const res = await api.getBmuUnits();
        setBmuUnits(res);
        setHasMoreInventory(false);
      } else if (activeTab === 'MODULES') {
        const res = await api.getModules({ limit: pageSize, offset: page * pageSize });
        setModules(previous => append ? [...previous, ...res] : res);
        setHasMoreInventory(res.length === pageSize);
        setInventoryPage(page);
      } else if (activeTab === 'BATTERIES') {
        const [res, warehouseStatuses] = await Promise.all([api.getBatteries({ limit: pageSize, offset: page * pageSize }), api.getWarehouseEntityStatuses()]);
        setBatteries(previous => append ? [...previous, ...res] : res);
        setWarehouseEntityStatuses(warehouseStatuses);
        setHasMoreInventory(res.length === pageSize);
        setInventoryPage(page);
      } else if (activeTab === 'RACKS') {
        const [res, warehouseStatuses] = await Promise.all([api.getRacks({ limit: pageSize, offset: page * pageSize }), api.getWarehouseEntityStatuses()]);
        setRacks(previous => append ? [...previous, ...res] : res);
        setWarehouseEntityStatuses(warehouseStatuses);
        setHasMoreInventory(res.length === pageSize);
        setInventoryPage(page);
      }
    } catch (err) {
      console.error('Failed to load inventory', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreInventory = () => {
    if (loading || !hasMoreInventory) return;
    void loadInventory(inventoryPage + 1);
  };

  const normalizeSerialList = (input: string): string[] => {
    const seen = new Set<string>();
    return input
      .split(/[\n,;]+/)
      .map(value => value.trim())
      .filter(Boolean)
      .filter(value => {
        const key = value.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const exportCellReport = async () => {
    setExportingCells(true);
    try {
      const [exportCells, counts, warehouseStatuses] = await Promise.all([
        api.getCells(),
        api.getCellCounts(),
        api.getWarehouseCellStatuses(),
      ]);
      if (exportCells.length === 0) throw new Error('No cell records are available to export.');
      downloadCellReport(exportCells, {
        rows: [],
        total: counts.total,
      }, { warehouseStatuses });
      addNotification('success', 'Cell report exported', `${exportCells.length.toLocaleString()} cell records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Cell export failed', error?.message || 'Unable to export the cell inventory report.');
    } finally {
      setExportingCells(false);
    }
  };

  const exportBatteryReport = async () => {
    setExportingBatteryReport(true);
    try {
      const exportBatteries = await api.getBatteries();
      downloadBatteryReport(exportBatteries);
      addNotification('success', 'Battery report exported', `${exportBatteries.length.toLocaleString()} battery records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Battery export failed', error?.message || 'Unable to export the battery report.');
    } finally {
      setExportingBatteryReport(false);
    }
  };

  const exportRackReport = async () => {
    setExportingRackReport(true);
    try {
      const exportRacks = await api.getRacks();
      downloadRackReport(exportRacks);
      addNotification('success', 'Rack report exported', `${exportRacks.length.toLocaleString()} rack records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Rack export failed', error?.message || 'Unable to export the rack report.');
    } finally {
      setExportingRackReport(false);
    }
  };

  const handleIngestBmu = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestingBmu(true);
    try {
      const serialNumbers = normalizeSerialList(bmuSerials);
      if (serialNumbers.length === 0) {
        throw new Error('Enter at least one BMU serial or leave the field empty to auto-generate values.');
      }
      const finalCount = serialNumbers.length;
      setBmuCount(finalCount);
      const res = await api.createBmuBatch({ count: finalCount, model: bmuModel, manufacturer: bmuManufacturer, batchNumber: bmuBatchNumber, serialNumbers });
      addNotification('success', 'BMU Batch Received', `Successfully ingested ${res.count} ${bmuModel} controllers`);
      setShowBmuModal(false);
      triggerRefresh();
      loadInventory();
    } catch (err: any) {
      addNotification('error', 'Ingestion Failed', err.message);
    } finally {
      setIngestingBmu(false);
    }
  };

  const handleIngestBms = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestingBms(true);
    try {
      const serialNumbers = normalizeSerialList(bmsSerials);
      if (serialNumbers.length === 0) {
        throw new Error('Enter at least one BMS serial or leave the field empty to auto-generate values.');
      }
      const finalCount = serialNumbers.length;
      setBmsCount(finalCount);
      const res = await api.createBmsBatch({ count: finalCount, model: bmsModel, supplier: bmsManufacturer || 'Unknown Supplier', manufacturer: bmsManufacturer, batchNumber: bmsBatchNumber, serialNumbers });
      addNotification('success', 'BMS Batch Received', `Successfully ingested ${res.count} ${bmsModel} controllers`);
      setShowBmsModal(false);
      triggerRefresh();
      loadInventory();
    } catch (err: any) {
      addNotification('error', 'Ingestion Failed', err.message);
    } finally {
      setIngestingBms(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
      case 'IN_STOCK':
      case 'FLOOR_STOCK':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'RESERVED':
        return 'bg-slate-50 text-slate-700 border-slate-200';
      case 'ASSEMBLED':
      case 'IN_PROCESS':
      case 'IN_MODULE':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'IN_PACK':
      case 'IN_RACK':
      case 'SOLD':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'KARACHI_WAREHOUSE':
        return 'bg-green-50 text-green-800 border-green-200';
      case 'LAHORE_WAREHOUSE':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'FINISHED':
        return 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold';
      case 'QUARANTINED':
      case 'FAILED':
        return 'bg-slate-100 text-black border-slate-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const batteryById = new Map(batteries.map(battery => [battery.id, battery]));
  const moduleById = new Map(modules.map(module => [module.id, module]));
  const getCellDisplayStatus = (cell: CellItem) => {
    const warehouseStatus = warehouseCellStatuses[cell.id];
    if (warehouseStatus) return warehouseStatus;
    const lifecycleStatus = String(cell.lifecycleStatus || '').toUpperCase();
    if (lifecycleStatus === 'SCRAP' || ['QUARANTINED', 'REJECTED'].includes(String(cell.status).toUpperCase())) return 'SCRAP';
    if (lifecycleStatus === 'SOLD') return 'SOLD';
    if (lifecycleStatus === 'IN_RACK') return 'IN_RACK';

    const module = cell.assignedToModuleId ? moduleById.get(cell.assignedToModuleId) : undefined;
    const battery = batteryById.get(cell.reservedForBatteryId || module?.batteryId || '');
    const batteryStatus = String((cell as any).assignedBatteryStatus || battery?.status || '').toUpperCase();
    if (lifecycleStatus === 'IN_PACK' || ['RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED'].includes(batteryStatus)) return 'IN_PACK';
    if (lifecycleStatus === 'IN_MODULE' || module || cell.reservedForBatteryId) return 'IN_MODULE';
    if (lifecycleStatus) return lifecycleStatus;
    return String(cell.status || 'UNKNOWN').toUpperCase();
  };

  const formatCellStatus = (status: string) => status === 'KARACHI_WAREHOUSE'
    ? 'Karachi Warehouse'
    : status === 'LAHORE_WAREHOUSE'
      ? 'Lahore Warehouse'
      : status;
  const formatWarehouseStatus = (status: string) => status === 'KARACHI_WAREHOUSE'
    ? 'Karachi Warehouse'
    : status === 'LAHORE_WAREHOUSE'
      ? 'Lahore Warehouse'
      : status;

  const filteredCells = cells.filter(c => {
    const internalSerial = (c.internalSerial || '').toLowerCase();
    const supplierBarcode = (c.supplierBarcode || '').toLowerCase();
    const supplierName = (c.supplierName || '').toLowerCase();
    const matchesSearch =
      !search ||
      internalSerial.includes(search.toLowerCase()) ||
      supplierBarcode.includes(search.toLowerCase()) ||
      supplierName.includes(search.toLowerCase());
    const matchesStatus = !statusFilter || getCellDisplayStatus(c) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredBms = bmsUnits.filter(b => {
    const matchesSearch = !search || b.serialNumber.toLowerCase().includes(search.toLowerCase()) || b.model.toLowerCase().includes(search.toLowerCase());
    const displayStatus = warehouseEntityStatuses[`BMS:${b.id}`] || b.status;
    const matchesStatus = !statusFilter || displayStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredBmus = bmuUnits.filter(b => {
    const matchesSearch = !search || b.serialNumber.toLowerCase().includes(search.toLowerCase()) || b.model.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredModules = modules.filter(m => {
    const matchesSearch = !search || m.serialNumber.toLowerCase().includes(search.toLowerCase());
    const displayStatus = warehouseEntityStatuses[`MODULE:${m.id}`] || m.lifecycleStatus || m.status;
    const matchesStatus = !statusFilter || displayStatus === statusFilter || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredBatteries = batteries.filter(b => {
    const rawBattery = b as any;
    const serialNumber = String(rawBattery.serialNumber ?? rawBattery.serial_number ?? '').toLowerCase();
    const productName = String(rawBattery.productName ?? rawBattery.product_name ?? '').toLowerCase();
    const query = String(search ?? '').toLowerCase();
    const matchesSearch = !query || serialNumber.includes(query) || productName.includes(query);
    const displayStatus = warehouseEntityStatuses[`BATTERY:${b.id}`] || b.lifecycleStatus || b.status;
    const matchesStatus = !statusFilter || displayStatus === statusFilter || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const filteredRacks = racks.filter(rack => {
    const displayStatus = warehouseEntityStatuses[`RACK:${rack.id}`] || rack.status;
    const haystack = [rack.serialNumber, rack.serial_number, rack.rackTemplateCode, rack.rack_template_code, displayStatus, rack.location, rack.qrCode, rack.qr_code].filter(Boolean).join(' ').toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (!statusFilter || displayStatus === statusFilter);
  });

  const displayedCells = filteredCells;

  const getTabItems = (tab: Tab): Array<{ id: string }> => {
    if (tab === 'CELLS') return filteredCells;
    if (tab === 'BMS') return filteredBms;
    if (tab === 'BMU') return filteredBmus;
    if (tab === 'MODULES') return filteredModules;
    if (tab === 'BATTERIES') return filteredBatteries;
    return filteredRacks;
  };

  const toggleSelectItem = (tab: Tab, id: string) => {
    setSelectedIds(prev => {
      const current = prev[tab] ?? [];
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      return { ...prev, [tab]: next };
    });
  };

  const toggleSelectAll = (tab: Tab, items: Array<{ id: string }>) => {
    if (!items.length) return;

    setSelectedIds(prev => {
      const current = prev[tab] ?? [];
      const ids = items.map(item => item.id);
      const allSelected = ids.every(id => current.includes(id));
      const next = allSelected ? current.filter(id => !ids.includes(id)) : Array.from(new Set([...current, ...ids]));
      return { ...prev, [tab]: next };
    });
  };

  const activeTabSelectedCount = selectedIds[activeTab]?.length ?? 0;

  const handleDeleteSelected = async () => {
    const ids = selectedIds[activeTab] ?? [];
    if (ids.length === 0) return;

    const itemLabel = activeTab.slice(0, -1).toLowerCase();
    if (!window.confirm(`Delete ${ids.length} selected ${itemLabel}${ids.length > 1 ? 's' : ''}?`)) return;

    try {
      if (activeTab === 'CELLS') {
        await Promise.all(ids.map(id => api.deleteCell(id)));
      } else if (activeTab === 'BMS') {
        await Promise.all(ids.map(id => api.deleteBms(id)));
      } else if (activeTab === 'BMU') {
        await Promise.all(ids.map(id => api.deleteBmu(id)));
      } else if (activeTab === 'MODULES') {
        await Promise.all(ids.map(id => api.deleteModule(id)));
      } else if (activeTab === 'BATTERIES') {
        await Promise.all(ids.map(id => api.deleteBattery(id)));
      } else if (activeTab === 'RACKS') {
        await Promise.all(ids.map(id => api.deleteRack(id)));
      }

      setSelectedIds(prev => ({ ...prev, [activeTab]: [] }));
      triggerRefresh();
      addNotification('success', 'Delete Complete', `Deleted ${ids.length} selected items.`);
    } catch (err: any) {
      addNotification('error', 'Delete Failed', err.message || 'Unable to remove selected inventory item(s).');
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <Boxes className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Manufacturing & Warehouse Inventory
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time material lifecycle tracking from raw cells to finished certified packs.
              </p>
        </div>
      </div>
      </div>
        <div className="flex bg-slate-100/80 p-1.5 rounded-xl text-xs font-semibold border border-slate-200">
          <button onClick={() => { setActiveTab('CELLS'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'CELLS' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>Cells ({cells.length})</button>
          <button onClick={() => { setActiveTab('BMS'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'BMS' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>BMS ({bmsUnits.length})</button>
          <button onClick={() => { setActiveTab('BMU'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'BMU' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>BMU ({bmuUnits.length})</button>
          <button onClick={() => { setActiveTab('MODULES'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'MODULES' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>Modules ({modules.length})</button>
          <button onClick={() => { setActiveTab('BATTERIES'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'BATTERIES' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>Batteries ({batteries.length})</button>
          <button onClick={() => { setActiveTab('RACKS'); setStatusFilter(''); }} className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === 'RACKS' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}>Racks ({racks.length})</button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${activeTab.toLowerCase()} by serial, barcode, model...`}
            className="w-full pl-9 pr-4 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3.5 py-2.5 text-xs font-semibold bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Statuses</option>

        {activeTab === 'BATTERIES' && (
          <button
            type="button"
            onClick={() => void exportBatteryReport()}
            disabled={exportingBatteryReport}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
            title="Export battery inventory to Excel"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingBatteryReport ? 'Exporting...' : 'Export Battery Report'}
          </button>
        )}
        {activeTab === 'RACKS' && (
          <button
            type="button"
            onClick={() => void exportRackReport()}
            disabled={exportingRackReport}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
            title="Export rack inventory to Excel"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingRackReport ? 'Exporting...' : 'Export Rack Report'}
          </button>
        )}
            {activeTab === 'CELLS' ? (
              cellStatuses.map(status => <option key={status} value={status}>{formatCellStatus(status)}</option>)
            ) : (
              <>
                <option value="IN_STOCK">IN STOCK</option>
                <option value="FLOOR_STOCK">FLOOR STOCK</option>
                <option value="IN_MODULE">IN MODULE</option>
                <option value="IN_PACK">IN PACK</option>
                <option value="IN_RACK">IN RACK</option>
                <option value="SOLD">SOLD</option>
                <option value="SCRAP">SCRAP</option>
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="RESERVED">RESERVED</option>
                <option value="IN_PROCESS">IN PROCESS</option>
                <option value="VALIDATING">VALIDATING</option>
                <option value="TESTING">TESTING</option>
                <option value="KARACHI_WAREHOUSE">Karachi Warehouse</option>
                <option value="LAHORE_WAREHOUSE">Lahore Warehouse</option>
                <option value="SCANNED">SCANNED</option>
                <option value="PASSED">PASSED</option>
                <option value="ASSEMBLED">ASSEMBLED</option>
                <option value="FINISHED">FINISHED</option>
                <option value="QUARANTINED">SCRAP</option>
                <option value="FAILED">FAILED</option>
              </>
            )}
          </select>

          <button
            type="button"
            onClick={() => toggleSelectAll(activeTab, getTabItems(activeTab))}
            className="px-3.5 py-2.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl transition-colors shrink-0"
          >
            {activeTabSelectedCount > 0 ? 'Clear all' : 'Select all'}
          </button>
          {activeTabSelectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleDeleteSelected()}
                className="px-3.5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors shrink-0"
              >
                Delete selected
              </button>
              <span className="text-[11px] font-medium text-slate-500">{activeTabSelectedCount} selected</span>
            </>
          )}
          {activeTab === 'BMS' && (
            <button
              onClick={() => setShowBmsModal(true)}
              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 shadow-xs transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Receive BMS Batch</span>
            </button>
          )}
          {activeTab === 'BMU' && (
            <button
              onClick={() => setShowBmuModal(true)}
              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 shadow-xs transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Receive BMU Batch</span>
            </button>
          )}
        </div>
      </div>

      {/* CELLS — Used / All toggle + summary tiles */}
      {activeTab === 'CELLS' && (
        <div className="space-y-4">
          {/* Sub-tab toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold border border-slate-200">
              <button
                onClick={() => { setCellsView('ALL'); setStatusFilter(''); }}
                className={`px-4 py-1.5 rounded-lg transition-all ${
                  cellsView === 'ALL' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                All Cells ({allCellsCount})
              </button>
              <button
                onClick={() => { setCellsView('USED'); setStatusFilter(''); }}
                className={`px-4 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  cellsView === 'USED' ? 'bg-black text-white shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                Used Cells ({usedCellsCount})
              </button>
            </div>
            {cellsView === 'USED' && (
              <span className="text-xs text-slate-400 font-medium">Showing cells reserved for an order or assigned to production.</span>
            )}
            <button
              type="button"
              onClick={() => void exportCellReport()}
              disabled={exportingCells}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
              title="Export all cell statuses, barcodes, and serial numbers to Excel"
            >
              <Download className="h-3.5 w-3.5" />
              {exportingCells ? 'Exporting...' : 'Export Cell Report'}
            </button>
          </div>

          {/* Used cells breakdown tiles */}
          {cellsView === 'USED' && (() => {
            const inventoryCells = allCells.length > 0 ? allCells : cells;
            const bucketByCellId = new Map(cellBuckets.map(bucket => [bucket.cellId, bucket.bucket]));
            const hasBucketProjection = bucketByCellId.size === inventoryCells.length && inventoryCells.length > 0;
            const batteryById = new Map(batteries.map(battery => [battery.id, battery]));
            const moduleById = new Map(modules.map(module => [module.id, module]));
            const getBattery = (cell: CellItem) => {
              const module = cell.assignedToModuleId ? moduleById.get(cell.assignedToModuleId) : undefined;
              return batteryById.get(cell.reservedForBatteryId || module?.batteryId || '');
            };
            const isDamage = (cell: CellItem) => (hasBucketProjection && bucketByCellId.get(cell.id) === 'DAMAGE') ||
              ['SCRAP', 'QUARANTINED', 'REJECTED', 'FAILED'].includes(String(cell.lifecycleStatus || '').toUpperCase()) ||
              ['QUARANTINED', 'REJECTED', 'FAILED'].includes(String(cell.status || '').toUpperCase()) ||
              ['DAMAGED', 'FAILED'].includes(cell.productionGrade || cell.supplierGrade || '') ||
              Boolean(cell.quarantineReason);
            const isReleased = (cell: CellItem) => {
              const battery = getBattery(cell);
              return (hasBucketProjection && bucketByCellId.get(cell.id) === 'RESERVED') || ['FINISHED', 'RELEASED', 'DISPATCHED'].includes(battery?.status || '');
            };
            const isInProcess = (cell: CellItem) => {
              const battery = getBattery(cell);
              const module = cell.assignedToModuleId ? moduleById.get(cell.assignedToModuleId) : undefined;
              return (hasBucketProjection && bucketByCellId.get(cell.id) === 'IN_PROCESS') || ['PLANNED', 'IN_PROCESS', 'ASSEMBLED', 'TESTING', 'FINAL_QC'].includes(battery?.status || '') ||
                ['IN_PROCESS', 'ASSEMBLED'].includes(module?.status || '') ||
                ['IN_PROCESS', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED'].includes(cell.status);
            };
            // Reservation is ownership, while status changes during testing and assembly.
            // Count each physical cell once so reserved and assigned are not double-counted.
            const isReserved = (cell: CellItem) => Boolean(cell.reservedForOrderId || cell.reservedForBatteryId);
            const damage       = inventoryCells.filter(isDamage).length;
            const reserved     = inventoryCells.filter(cell => !isDamage(cell) && isReserved(cell)).length;
            const inProcess    = inventoryCells.filter(cell => !isDamage(cell) && isReserved(cell) && isInProcess(cell)).length;
            const available     = inventoryCells.filter(cell => !isDamage(cell) && !isReserved(cell)).length;
            const other        = Math.max(0, inventoryCells.length - damage - available - reserved);
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Reserved / Assigned', value: reserved, color: 'border-l-4 border-l-slate-400' },
                  { label: 'Used / In Process (Included)', value: inProcess, color: 'border-l-4 border-l-green-500' },
                  { label: 'Damage', value: damage, color: 'border-l-4 border-l-red-500' },
                  { label: 'Available', value: available, color: 'border-l-4 border-l-emerald-500' },
                ].map(tile => (
                  <div key={tile.label} className={`bg-white rounded-xl border border-slate-200 p-3 shadow-xs ${tile.color}`}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tile.label}</p>
                    <p className="text-2xl font-black text-slate-900 mt-0.5">{tile.value}</p>
                  </div>
                ))}
                {other > 0 && <div className="col-span-2 text-[11px] text-slate-400">{other} records need classification from their battery or module relationship.</div>}
              </div>
            );
          })()}

        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredCells.length > 0 && filteredCells.every(cell => selectedIds.CELLS.includes(cell.id))}
                      onChange={() => toggleSelectAll('CELLS', filteredCells)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-5 py-3">Internal Serial</th>
                  <th className="px-5 py-3">Supplier Barcode</th>
                  <th className="px-5 py-3">Manufacturer</th>
                  <th className="px-5 py-3">Capacity</th>
                  <th className="px-5 py-3">OCV / IR</th>
                  <th className="px-5 py-3">Grade</th>
                  <th className="px-5 py-3">Pallet / Box</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right font-sans">QR / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedCells.map(cell => (
                  <tr key={cell.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.CELLS.includes(cell.id)}
                        onChange={() => toggleSelectItem('CELLS', cell.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{cell.internalSerial}</td>
                    <td className="px-5 py-3.5 text-slate-500 text-[11px]">{cell.supplierBarcode}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans">{cell.supplierName}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-700">{cell.supplierCapacityAh} Ah</td>
                    <td className="px-5 py-3.5 text-slate-700">
                      <span>{(cell.supplierOcvV ?? 0).toFixed(3)}V</span> • <span>{(cell.supplierIrMilliOhm ?? 0).toFixed(2)}mΩ</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold text-[10px] border border-slate-200">
                        {cell.supplierGrade}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-[10px]">
                      {cell.palletNumber.slice(-8)} / {cell.boxNumber.slice(-8)}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(getCellDisplayStatus(cell))}`}>
                        {formatCellStatus(getCellDisplayStatus(cell))}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1 font-sans">
                      <button
                        onClick={() => {
                          setQrData({
                            title: `Cell QR: ${cell.internalSerial}`,
                            qrPayload: cell.supplierBarcode,
                            serial: cell.internalSerial,
                            itemType: 'CELL',
                            metadata: {
                              SUPPLIER: cell.supplierName,
                              CAPACITY: `${cell.supplierCapacityAh} Ah`,
                              OCV: `${cell.supplierOcvV} V`,
                              IR: `${cell.supplierIrMilliOhm} mΩ`,
                              STATUS: getCellDisplayStatus(cell),
                            },
                          });
                          setQrModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Print QR"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setQuickSearchQuery(cell.internalSerial);
                          setActiveView('traceability');
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Trace Genealogy"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 font-sans">
            <span className="text-[11px] font-medium text-slate-400">
              Showing {displayedCells.length} of {filteredCells.length} cells
            </span>
            {hasMoreInventory && (
              <button
                type="button"
                onClick={loadMoreInventory}
                disabled={loading}
                className="px-3.5 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
              >
                {loading ? 'Loading...' : 'See more'}
              </button>
            )}
          </div>
        </div>
        </div>
      )}

      {/* BMS TABLE */}
      {activeTab === 'BMS' && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredBms.length > 0 && filteredBms.every(item => selectedIds.BMS.includes(item.id))}
                      onChange={() => toggleSelectAll('BMS', filteredBms)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-5 py-3">Serial Number</th>
                  <th className="px-5 py-3">Model</th>
                  <th className="px-5 py-3">Protocol</th>
                  <th className="px-5 py-3">Firmware</th>
                  <th className="px-5 py-3">Test Result</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right font-sans">QR / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBms.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.BMS.includes(b.id)}
                        onChange={() => toggleSelectItem('BMS', b.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{b.serialNumber}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans">{b.model}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-700">{b.protocol}</td>
                    <td className="px-5 py-3.5 text-slate-500">{b.firmwareVersion}</td>
                    <td className="px-5 py-3.5 font-sans">
                      {b.testResult?.status === 'PASSED' ? (
                        <span className="text-emerald-700 font-bold text-[10px] flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>PASSED (CAN OK)</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">PENDING TEST</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(warehouseEntityStatuses[`BATTERY:${b.id}`] || b.status)}`}>
                        {formatWarehouseStatus(warehouseEntityStatuses[`BATTERY:${b.id}`] || b.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-sans space-x-1">
                      <button
                        onClick={() => {
                          setQrData({
                            title: `BMS Controller QR: ${b.serialNumber}`,
                            qrPayload: `${b.serialNumber}|${b.model}|${b.protocol}`,
                            serial: b.serialNumber,
                            itemType: 'BMS',
                            metadata: {
                              MODEL: b.model,
                              PROTOCOL: b.protocol,
                              FIRMWARE: b.firmwareVersion,
                              STATUS: formatWarehouseStatus(warehouseEntityStatuses[`BATTERY:${b.id}`] || b.status),
                            },
                          });
                          setQrModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          const status = window.prompt('BMS status', b.status);
                          if (!status || status === b.status) return;
                          try { await api.updateBms(b.id, { status }); triggerRefresh(); }
                          catch (err: any) { addNotification('error', 'Update Failed', err.message); }
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Update BMS"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete BMS ${b.serialNumber}?`)) return;
                          try { await api.deleteBms(b.id); triggerRefresh(); }
                          catch (err: any) { addNotification('error', 'Delete Failed', err.message); }
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete BMS"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BMU TABLE */}
      {activeTab === 'BMU' && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredBmus.length > 0 && filteredBmus.every(item => selectedIds.BMU.includes(item.id))}
                      onChange={() => toggleSelectAll('BMU', filteredBmus)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-5 py-3">Serial Number</th>
                  <th className="px-5 py-3">Model</th>
                  <th className="px-5 py-3">Manufacturer</th>
                  <th className="px-5 py-3">Protocol</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right font-sans">QR / Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBmus.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.BMU.includes(b.id)}
                        onChange={() => toggleSelectItem('BMU', b.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{b.serialNumber}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans">{b.model}</td>
                    <td className="px-5 py-3.5 text-slate-600 font-sans">{b.manufacturer || 'N/A'}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-700">{b.protocol || 'N/A'}</td>
                    <td className="px-5 py-3.5 font-sans"><span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(b.status)}`}>{b.status}</span></td>
                    <td className="px-5 py-3.5 text-right font-sans space-x-1">
                      <button onClick={() => { setQrData({ title: `BMU Controller QR: ${b.serialNumber}`, qrPayload: `${b.serialNumber}|${b.model}|${b.protocol || 'CAN'}`, serial: b.serialNumber, itemType: 'BMU', metadata: { MODEL: b.model, PROTOCOL: b.protocol || 'CAN', STATUS: b.status } }); setQrModalOpen(true); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Print QR"><QrCode className="w-4 h-4" /></button>
                      <button onClick={async () => { const status = window.prompt('BMU status', b.status); if (!status || status === b.status) return; try { await api.updateBmu(b.id, { status }); triggerRefresh(); } catch (err: any) { addNotification('error', 'Update Failed', err.message); } }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Update BMU"><Pencil className="w-4 h-4" /></button>
                      <button onClick={async () => { if (!window.confirm(`Delete BMU ${b.serialNumber}?`)) return; try { await api.deleteBmu(b.id); triggerRefresh(); } catch (err: any) { addNotification('error', 'Delete Failed', err.message); } }} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete BMU"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODULES TABLE */}
      {activeTab === 'MODULES' && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredModules.length > 0 && filteredModules.every(item => selectedIds.MODULES.includes(item.id))}
                      onChange={() => toggleSelectAll('MODULES', filteredModules)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-5 py-3">Module Serial</th>
                  <th className="px-5 py-3">Assigned Battery</th>
                  <th className="px-5 py-3">Cells Count</th>
                  <th className="px-5 py-3">Matching Score</th>
                  <th className="px-5 py-3">Welding Status</th>
                  <th className="px-5 py-3">QC Status</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right font-sans">QR / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredModules.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.MODULES.includes(m.id)}
                        onChange={() => toggleSelectItem('MODULES', m.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{m.serialNumber}</td>
                    <td className="px-5 py-3.5 text-slate-600">{m.batteryId || 'UNALLOCATED'}</td>
                    <td className="px-5 py-3.5 font-bold text-slate-800">{m.cells?.length ?? 0} cells</td>
                    <td className="px-5 py-3.5 text-emerald-600 font-bold">
                      {m.matchingScore > 0 ? `${m.matchingScore}%` : 'N/A'}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      {m.weldingResult?.status === 'PASSED' && <span className="text-emerald-700 font-bold text-[10px]">WELDED ✓</span>}
                      {m.weldingResult?.status === 'FAILED' && <span className="text-red-600 font-bold text-[10px]">FAILED</span>}
                      {m.weldingResult?.status === 'BYPASSED' && <span className="text-amber-600 font-bold text-[10px]">BYPASSED</span>}
                      {!m.weldingResult?.status && <span className="text-slate-500 font-bold text-[10px]">NOT WELDED</span>}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      {m.qcResult?.status === 'PASSED' || m.status === 'PASSED' ? (
                        <span className="text-emerald-700 font-bold text-[10px]">PASSED ✓</span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">PENDING</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(m.lifecycleStatus || (m as any).lifecycle_status || 'IN_STOCK')}`}>
                        {m.lifecycleStatus || (m as any).lifecycle_status || 'IN_STOCK'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-sans">
                      <button
                        onClick={() => {
                          setQrData({
                            title: `Module QR Label: ${m.serialNumber}`,
                            qrPayload: m.qrCode,
                            serial: m.serialNumber,
                            itemType: 'MODULE',
                            metadata: {
                              CELLS: m.cells.length,
                              MATCH_SCORE: `${m.matchingScore}%`,
                              STATUS: m.status,
                            },
                          });
                          setQrModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setActiveModuleId(m.id);
                          setActiveView('workflow-module');
                          addNotification('info', 'Module cells opened', `Editing cells for ${m.serialNumber}.`);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Edit module cells"
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { setActiveModuleId(m.id); setActiveView('workflow-module'); }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Edit module details"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete module ${m.serialNumber}?`)) return;
                          try { await api.deleteModule(m.id); triggerRefresh(); }
                          catch (err: any) { addNotification('error', 'Delete Failed', err.message); }
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete module"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMoreInventory && (
            <div className="flex justify-center border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={loadMoreInventory} disabled={loading} className="px-4 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60">
                {loading ? 'Loading...' : 'See more modules'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* BATTERIES TABLE */}
      {activeTab === 'BATTERIES' && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredBatteries.length > 0 && filteredBatteries.every(item => selectedIds.BATTERIES.includes(item.id))}
                      onChange={() => toggleSelectAll('BATTERIES', filteredBatteries)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-5 py-3">Pack Serial</th>
                  <th className="px-5 py-3">Product Name</th>
                  <th className="px-5 py-3">Modules Count</th>
                  <th className="px-5 py-3">BMS Serial</th>
                  <th className="px-5 py-3">BMU Serial</th>
                  <th className="px-5 py-3">Current Step</th>
                  <th className="px-5 py-3">Progress</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right font-sans">QR / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatteries.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.BATTERIES.includes(b.id)}
                        onChange={() => toggleSelectItem('BATTERIES', b.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{b.serialNumber}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans font-semibold">{b.productName}</td>
                    <td className="px-5 py-3.5">{b.modules?.length ?? 0} Modules</td>
                    <td className="px-5 py-3.5 text-emerald-700">{b.bms?.serialNumber || 'NONE'}</td>
                    <td className="px-5 py-3.5 text-emerald-700">{b.bmu?.serialNumber || 'NONE'}</td>
                    <td className="px-5 py-3.5 font-sans text-slate-700 font-medium">{String((b as any).currentStep ?? (b as any).current_step ?? 'UNKNOWN').replace(/_/g, ' ')}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-600">{b.progressPercent}%</td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(b.status)}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1 font-sans">
                      <button
                        onClick={() => {
                          setQrData({
                            title: `Battery Pack Compliance QR: ${b.serialNumber}`,
                            qrPayload: b.qrCode,
                            serial: b.serialNumber,
                            itemType: 'BATTERY',
                            metadata: {
                              PRODUCT: b.productName,
                              MODULES: b.modules?.length ?? 0,
                              BMS: b.bms?.serialNumber || 'N/A',
                              STATUS: b.status,
                            },
                          });
                          setQrModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Print QR"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setQuickSearchQuery(b.serialNumber);
                          setActiveView('traceability');
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="View Full Genealogy"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setReportBattery(b);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Export reports"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setActiveBatteryId(b.id);
                          setBatteryBuilderEditRequested(true);
                          setActiveView('workflow-pack');
                          addNotification('info', 'Battery Assembly Opened', `Opening auto battery pack assembly for ${b.serialNumber}.`);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Open battery assembly"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete battery ${b.serialNumber}? Its cells will return to available inventory, while linked modules, BMS/BMU records, and battery data will be permanently removed.`)) return;
                          try { await api.deleteBattery(b.id); triggerRefresh(); }
                          catch (err: any) { addNotification('error', 'Delete Failed', err.message); }
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete battery"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMoreInventory && (
            <div className="flex justify-center border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={loadMoreInventory} disabled={loading} className="px-4 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60">
                {loading ? 'Loading...' : 'See more batteries'}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'RACKS' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                <tr><th className="px-3 py-3 w-10"><input type="checkbox" checked={filteredRacks.length > 0 && filteredRacks.every(item => selectedIds.RACKS.includes(item.id))} onChange={() => toggleSelectAll('RACKS', filteredRacks)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></th><th className="px-5 py-3">Rack Serial</th><th className="px-5 py-3">Template</th><th className="px-5 py-3">Connected Batteries</th><th className="px-5 py-3">Location</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">QR / Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRacks.map(rack => {
                  const serial = rack.serialNumber || rack.serial_number || rack.id;
                  const template = rack.rackTemplateCode || rack.rack_template_code || '-';
                  const batteryIds = rack.batteryIds || rack.battery_ids || rack.rackPacks?.map((pack: any) => pack.batteryId || pack.battery_id) || [];
                  const status = warehouseEntityStatuses[`RACK:${rack.id}`] || rack.status || 'UNKNOWN';
                  return <tr key={rack.id} className="hover:bg-slate-50/70"><td className="px-3 py-3.5"><input type="checkbox" checked={selectedIds.RACKS.includes(rack.id)} onChange={() => toggleSelectItem('RACKS', rack.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></td><td className="px-5 py-3.5 font-mono font-bold text-slate-900">{serial}</td><td className="px-5 py-3.5 font-semibold text-slate-700">{template}</td><td className="px-5 py-3.5">{batteryIds.length} batteries</td><td className="px-5 py-3.5 text-slate-600">{rack.location || '-'}</td><td className="px-5 py-3.5"><span className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${getStatusBadge(status)}`}>{status}</span></td><td className="px-5 py-3.5 text-right font-sans space-x-1"><button onClick={() => { setQuickSearchQuery(serial); setActiveView('traceability'); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="View rack traceability"><Eye className="w-4 h-4" /></button><button onClick={() => { setQrData({ title: `Rack QR: ${serial}`, qrPayload: rack.qrCode || rack.qr_code || `${serial}|RACK:${rack.id}`, serial, itemType: 'RACK', metadata: { TEMPLATE: template, BATTERIES: batteryIds.length, LOCATION: rack.location || '-', STATUS: status } }); setQrModalOpen(true); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Print QR"><QrCode className="w-4 h-4" /></button><button onClick={() => { setActiveView('rack-assembly'); addNotification('info', 'Rack Assembly Opened', `Open the rack builder to edit ${serial}.`); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Edit rack"><Pencil className="w-4 h-4" /></button><button onClick={async () => { if (!window.confirm(`Delete rack ${serial}? Its connected packs will be returned to inventory.`)) return; try { await api.deleteRack(rack.id); triggerRefresh(); } catch (err: any) { addNotification('error', 'Delete Failed', err.message); } }} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete rack"><Trash2 className="w-4 h-4" /></button></td></tr>;
                })}
                {!loading && filteredRacks.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-xs text-slate-400">No racks recorded.</td></tr>}
              </tbody>
            </table>
          </div>
          {hasMoreInventory && (
            <div className="flex justify-center border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={loadMoreInventory} disabled={loading} className="px-4 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60">
                {loading ? 'Loading...' : 'See more racks'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* QR Modal */}
      {qrData && (
        <QRCodeModal
          isOpen={qrModalOpen}
          onClose={() => setQrModalOpen(false)}
          title={qrData.title}
          qrPayload={qrData.qrPayload}
          serialNumber={qrData.serial}
          itemType={qrData.itemType}
          metadata={qrData.metadata}
        />
      )}

      <BatteryReportModal
        isOpen={Boolean(reportBattery)}
        onClose={() => setReportBattery(null)}
        battery={reportBattery}
      />

      {/* Receive BMS Batch Modal */}
      {showBmsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center space-x-3">
              <span className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
                <Cpu className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-black text-slate-900">Receive BMS Inventory Batch</h3>
                <p className="text-xs text-slate-500">Ingest certified Battery Management System units</p>
              </div>
            </div>

            <form onSubmit={handleIngestBms} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Batch Quantity (Units)</label>
                <input
                  type="number"
                  min="1"
                  value={bmsCount}
                  onChange={e => setBmsCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={bmsManufacturer} onChange={e => setBmsManufacturer(e.target.value)} placeholder="Manufacturer name" className="px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl" required />
                <input value={bmsBatchNumber} onChange={e => setBmsBatchNumber(e.target.value)} placeholder="Supplier batch number" className="px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl" required />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">Bulk Paste Serial / Barcode Values</label>
                <textarea
                  value={bmsSerials}
                  onChange={e => {
                    const next = e.target.value;
                    setBmsSerials(next);
                    const parsed = next
                      .split(/[\n,;]+/)
                      .map(value => value.trim())
                      .filter(Boolean)
                      .filter((value, index, arr) => arr.findIndex(item => item.toUpperCase() === value.toUpperCase()) === index);
                    if (parsed.length > 0) setBmsCount(parsed.length);
                  }}
                  rows={5}
                  placeholder="Paste serials one per line or separated by commas"
                  className="w-full min-h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
                <button type="button" onClick={() => setSerialScanner('BMS')} className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg"><QrCode className="w-4 h-4" /> Scan BMS Serial</button>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBmsModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ingestingBms}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 rounded-xl shadow-xs transition-colors flex items-center space-x-1.5"
                >
                  <span>{ingestingBms ? 'Receiving...' : `Receive ${bmsCount} Units`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBmuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center space-x-3"><span className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100"><Cpu className="w-5 h-5" /></span><div><h3 className="text-base font-black text-slate-900">Receive BMU Inventory Batch</h3><p className="text-xs text-slate-500">Ingest certified Battery Management Unit controllers</p></div></div>
            <form onSubmit={handleIngestBmu} className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><input value={bmuManufacturer} onChange={e => setBmuManufacturer(e.target.value)} placeholder="Manufacturer name" className="px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl" required /><input value={bmuBatchNumber} onChange={e => setBmuBatchNumber(e.target.value)} placeholder="Supplier batch number" className="px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl" required /></div>
              <div className="space-y-2"><label className="block text-xs font-bold text-slate-700">Bulk Paste Serial / Barcode Values</label><textarea value={bmuSerials} onChange={e => { const next = e.target.value; setBmuSerials(next); const parsed = next.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean); if (parsed.length > 0) setBmuCount(parsed.length); }} rows={5} placeholder="Paste serials one per line or separated by commas" className="w-full min-h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" /></div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Batch Quantity (Units)</label><input type="number" min="1" value={bmuCount} onChange={e => setBmuCount(Math.max(1, parseInt(e.target.value) || 1))} className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500" required /></div>
              <button type="button" onClick={() => setSerialScanner('BMU')} className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-emerald-700 border border-emerald-200 rounded-lg"><QrCode className="w-4 h-4" /> Scan BMU Serial</button>
              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100"><button type="button" onClick={() => setShowBmuModal(false)} className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Cancel</button><button type="submit" disabled={ingestingBmu} className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 rounded-xl shadow-xs transition-colors">{ingestingBmu ? 'Receiving...' : `Receive ${bmuCount} Units`}</button></div>
            </form>
          </div>
        </div>
      )}
      <ScannerModal
        isOpen={serialScanner !== null}
        onClose={() => setSerialScanner(null)}
        title={`Scan ${serialScanner || ''} Serial / Barcode`}
        onScan={value => {
          if (serialScanner === 'BMS') setBmsSerials(current => current ? `${current}\n${value}` : value);
          if (serialScanner === 'BMU') setBmuSerials(current => current ? `${current}\n${value}` : value);
          setSerialScanner(null);
        }}
      />
    </div>
  );
};
