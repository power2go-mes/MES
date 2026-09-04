import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  Layers,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  CalendarCheck,
  Truck,
  Activity,
  ArrowRight,
  TrendingUp,
  Cpu,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Pencil,
  Trash2,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const { setActiveView, setActiveBatteryId, refreshKey } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await api.getDashboardStats();
        if (!cancelled) {
          setStats(res);
          setLoadError(null);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Unable to load dashboard telemetry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void refresh();
    const refreshWhenVisible = () => {
      if (!document.hidden) void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshKey]);

  const loadStats = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getDashboardStats();
      setStats(res);
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to load dashboard telemetry.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWipBattery = async (battery: any) => {
    if (!window.confirm(`Delete battery ${battery.serialNumber}? Its reserved cells and controllers will return to inventory.`)) return;
    try {
      await api.deleteBattery(battery.id);
      await loadStats();
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to delete battery.');
    }
  };

  const handleEditWipBattery = (battery: any) => {
    setActiveBatteryId(battery.id);
    setActiveView('workflow-pack');
  };

  if (loadError) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-slate-700" />
          <h2 className="text-base font-black text-slate-900">Dashboard unavailable</h2>
          <p className="mt-2 text-xs text-slate-500">{loadError}</p>
          <button type="button" onClick={() => void loadStats()} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">Retry</button>
        </div>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Activity className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider font-mono">Loading Real-time MES Telemetry...</p>
        </div>
      </div>
    );
  }

  const inventory = stats.inventory || {};
  const controllerInventory = stats.controllerInventory || {
    availableBms: Number(inventory.availableBms || 0),
    availableBmu: Number(inventory.availableBmu || 0),
    totalBms: Number(inventory.totalBms || 0),
    totalBmu: Number(inventory.totalBmu || 0),
  };
  const finishedPackTrend = Array.isArray(stats.finishedPackTrend) ? stats.finishedPackTrend : [];
  const activeBatchTrend = Array.isArray(stats.activeBatchTrend) ? stats.activeBatchTrend : [];
  const batteryBuildTrend = Array.isArray(stats.batteryBuildTrend) ? stats.batteryBuildTrend : [];
  const finishedTrendMax = Math.max(1, ...finishedPackTrend.map((item: any) => Number(item.value) || 0));
  const batteryBuildMax = Math.max(1, ...batteryBuildTrend.map((item: any) => Number(item.value) || 0));
  const activeTrendMax = Math.max(1, ...activeBatchTrend.map((item: any) => Number(item.value) || 0));
  const totalCells = Math.max(1, Number(inventory.totalCells || 0));
  const usedCells = Number(inventory.usedCells ?? Math.max(0, Number(inventory.totalCells || 0) - Number(inventory.availableCells || 0)));
  const productionBars = [
    { label: 'Available', actual: Number(inventory.availableCells || 0), target: Number(inventory.totalCells || 0) },
    { label: 'Reserved', actual: Number(inventory.reservedCells || 0), target: Number(inventory.reservedCells || 0) },
    { label: 'In Process', actual: Number(inventory.inProcessCells || 0), target: Number(inventory.inProcessCells || 0) },
    { label: 'Assembled', actual: Number(inventory.assembledCells || 0), target: Number(inventory.assembledCells || 0) },
    { label: 'Scrap', actual: Number(inventory.quarantinedCells || 0), target: Number(inventory.quarantinedCells || 0) },
  ];
  const statusTotal = Math.max(1, productionBars.reduce((sum, bar) => sum + bar.actual, 0));
  const statusSegments = productionBars.map((bar, index) => ({
    ...bar,
    color: ['#3aaa35', '#f59e0b', '#2699dc', '#5c45d8', '#aaaaaa'][index],
    percentage: (bar.actual / statusTotal) * 100,
  }));
  let statusOffset = 0;
  const donutGradient = statusSegments.map(segment => {
    const start = statusOffset;
    statusOffset += segment.percentage;
    return `${segment.color} ${start}% ${statusOffset}%`;
  }).join(', ');

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Geometric Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-emerald-50 border border-emerald-100 text-emerald-700 rounded">
              Line 01 Active
            </span>
            <span className="text-xs font-mono text-slate-400">Station ID: LINE-01-MES</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Manufacturing Execution & ERP Control
          </h1>
          <p className="text-xs text-slate-500">
            Real-time battery pack assembly orchestration with zero-redundant automated telemetry.
          </p>
        </div>

        <button
          onClick={() => {
            setActiveBatteryId(null);
            setActiveView('planning');
          }}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center space-x-2 shadow-xs transition-all shrink-0"
        >
          <Layers className="w-4 h-4" />
          <span>Launch 2D Visual Battery Builder</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Available Cells</span>
            <Boxes className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-end justify-between">
            <span className="text-3xl font-black font-mono text-slate-900">
              {stats?.inventory?.availableCells ?? stats?.kpis?.availableCells ?? 0}
            </span>
            <span className="text-[10px] font-bold text-slate-500">{stats?.inventory?.totalCells ?? stats?.kpis?.totalCellsInInventory ?? 0} total</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-600" style={{ width: `${Math.min(100, ((stats?.inventory?.availableCells ?? stats?.kpis?.availableCells ?? 0) / Math.max(1, stats?.inventory?.totalCells ?? stats?.kpis?.totalCellsInInventory ?? 1)) * 100)}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">{usedCells} cells used or allocated</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">First-Pass Yield</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-end justify-between">
            <span className="text-3xl font-black font-mono text-emerald-600">
              {Number(stats?.inventory?.finishedBatteries || 0) > 0 || Number(stats?.quality?.quarantinedCount || 0) > 0
                ? `${stats?.quality?.firstPassYieldPercent ?? 0}%`
                : '—'}
            </span>
            <span className="text-[10px] font-bold text-slate-500">Target 99%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${Math.min(100, Number(stats?.quality?.firstPassYieldPercent ?? 0))}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">{stats?.quality?.quarantinedCount ?? stats?.quarantineOpenCount ?? 0} items currently in scrap review</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Finished Packs</span>
            <Zap className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-end justify-between">
            <span className="text-3xl font-black font-mono text-slate-900">
              {stats?.inventory?.finishedBatteries ?? stats?.kpis?.totalBatteriesCompleted ?? 0}
            </span>
            <span className="text-[10px] font-bold text-emerald-600">Released</span>
          </div>
          <div className="flex items-end gap-1 h-9" aria-label="Finished pack trend">
            {finishedPackTrend.map((item: any) => (
              <div key={item.label} className="flex-1 rounded-t-md bg-gradient-to-t from-emerald-500 to-emerald-300" title={`${item.label}: ${item.value}`} style={{ height: `${Math.max(4, (Number(item.value) / finishedTrendMax) * 100)}%` }} />
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{finishedPackTrend.length} released pack records in the latest trend window</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active Batches</span>
            <CalendarCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-end justify-between">
            <span className="text-3xl font-black font-mono text-slate-900">
              {stats?.orders?.inProcess ?? stats?.kpis?.activeOrders ?? 0}
            </span>
            <span className="text-[10px] font-bold text-slate-500">{stats?.orders?.completed ?? 0} done</span>
          </div>
          <div className="flex items-end gap-1 h-9" aria-label="Active batch trend">
            {activeBatchTrend.map((item: any) => (
              <div key={item.label} className="flex-1 rounded-t-md bg-gradient-to-t from-slate-500 to-slate-300" title={`${item.label}: ${item.value} in process`} style={{ height: `${Math.max(4, (Number(item.value) / activeTrendMax) * 100)}%` }} />
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{stats?.orders?.total ?? 0} total scheduled batches</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Controller stock</p>
            <h2 className="text-base font-bold text-slate-900">BMS and BMU remaining</h2>
          </div>
          <Cpu className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[
            { label: 'BMS', available: controllerInventory.availableBms, total: controllerInventory.totalBms, color: 'bg-emerald-500' },
            { label: 'BMU', available: controllerInventory.availableBmu, total: controllerInventory.totalBmu, color: 'bg-cyan-500' },
          ].map(item => {
            const percentage = item.total > 0 ? Math.min(100, (item.available / item.total) * 100) : 0;
            return (
              <div key={item.label} className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-700">
                  <span>{item.label}</span>
                  <span className="font-mono">{item.available} available / {item.total} total</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr,1fr] gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Production Trend</p>
              <h3 className="text-base font-bold text-slate-900">Inventory movement</h3>
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">Live data</span>
          </div>
          <div className="flex items-end justify-between gap-3 h-44 pt-4">
            {productionBars.map((bar, idx) => (
              <div key={bar.label} className="flex h-full flex-1 items-end justify-center gap-1">
                <div className="w-1/3 rounded-t-md bg-emerald-500" style={{ height: `${Math.max(5, (bar.actual / totalCells) * 100)}%` }} title={`${bar.label}: ${bar.actual}`} />
                <span className="sr-only">{bar.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[10px] font-bold text-slate-500">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />Live count</span>
            {productionBars.map(bar => <span key={bar.label}>{bar.label}: {bar.actual}</span>)}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Capacity mix</p>
              <h3 className="text-base font-bold text-slate-900">Inventory status</h3>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${donutGradient})` }}>
              <div className="absolute inset-5 rounded-full bg-white border border-slate-100" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {statusSegments.map(segment => (
                <div key={segment.label} className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-600">
                  <span className="flex min-w-0 items-center gap-1.5"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />{segment.label}</span>
                  <span className="font-mono">{segment.actual}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Build output</p>
              <h3 className="text-base font-bold text-slate-900">Batteries built</h3>
            </div>
            <span className="text-[10px] font-bold text-emerald-600">{Number(inventory.finishedBatteries || 0)} total</span>
          </div>
          {batteryBuildTrend.length === 0 ? (
            <div className="h-32 flex items-center justify-center rounded-xl border border-dashed border-slate-200 text-[11px] text-slate-400">No completed battery records</div>
          ) : (
            <div className="h-32 flex items-end gap-2 border-b border-slate-100 px-2" aria-label="Batteries built by day">
              {batteryBuildTrend.map((item: any) => (
                <div key={item.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] font-mono font-bold text-slate-600">{item.value}</span>
                  <div className="w-full max-w-12 rounded-t-md bg-emerald-500" title={`${item.label}: ${item.value} batteries built`} style={{ height: `${Math.max(6, (Number(item.value) / batteryBuildMax) * 82)}%` }} />
                  <span className="text-[9px] text-slate-400">{item.label === 'Unknown' ? item.label : item.label.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Stock remaining</p>
              <h3 className="text-base font-bold text-slate-900">Inventory by status</h3>
            </div>
            <span className="text-[10px] font-bold text-slate-500">{Number(inventory.totalCells || 0)} cells tracked</span>
          </div>
          <div className="space-y-3">
            {statusSegments.map(segment => (
              <div key={segment.label} className="grid grid-cols-[82px,1fr,42px] items-center gap-2 text-[10px]">
                <span className="font-bold text-slate-600">{segment.label}</span>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (segment.actual / Math.max(1, Number(inventory.totalCells || 0))) * 100)}%`, backgroundColor: segment.color }} />
                </div>
                <span className="text-right font-mono font-bold text-slate-700">{segment.actual}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Authoritative Manufacturing Pipeline Map */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
        <div>
          <span className="text-[10px] uppercase tracking-widest font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
            Authoritative MES Standard Operating Procedure
          </span>
          <h2 className="text-base font-bold text-slate-900 mt-1.5">Battery Manufacturing Pipeline Map</h2>
          <p className="text-xs text-slate-500">
            Standard sequential flow of the Power2Go battery production line. Actions must complete in order to pass quality gates.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
          
          {/* Phase 1: Planning */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">01. INGEST & ORDER</h3>
            <div className="space-y-2">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex items-center space-x-2 shadow-2xs">
                <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-semibold">Supplier Ingest</span>
              </div>
              <div className="text-center text-slate-300 font-bold text-xs py-0.5">↓</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex items-center space-x-2 shadow-2xs">
                <Boxes className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-semibold">Cell Inventory</span>
              </div>
              <div className="text-center text-slate-300 font-bold text-xs py-0.5">↓</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex items-center space-x-2 shadow-2xs">
                <CalendarCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-semibold">Production Order</span>
              </div>
            </div>
          </div>

          {/* Phase 2: Component Assignment */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">02. 2D BUILDER</h3>
            <div className="space-y-2">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex flex-col space-y-1.5 shadow-2xs">
                <div className="flex items-center space-x-2">
                  <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold">2D Builder Setup</span>
                </div>
                <div className="pl-5 border-l-2 border-dashed border-slate-200 space-y-1 mt-1">
                  <p className="text-[10px] font-semibold text-slate-600">• Scan Cell Barcodes</p>
                  <p className="text-[10px] font-semibold text-slate-600">• Scan BMS/BMU QR</p>
                </div>
              </div>
            </div>
          </div>

          {/* Phase 3: Cell Processing */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">03. CELL WORKFLOW</h3>
            <div className="space-y-2">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex flex-col space-y-1.5 shadow-2xs">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold">Cell Workflow Gates</span>
                </div>
                <div className="grid grid-cols-2 gap-1 pt-1">
                  <span className="text-[9px] font-bold bg-slate-50 border border-slate-100 rounded text-center py-0.5 text-slate-600">Acknowledgment</span>
                  <span className="text-[9px] font-bold bg-slate-50 border border-slate-100 rounded text-center py-0.5 text-slate-600">OCV Checking</span>
                  <span className="text-[9px] font-bold bg-slate-50 border border-slate-100 rounded text-center py-0.5 text-slate-600">IR Probing</span>
                  <span className="text-[9px] font-bold bg-slate-50 border border-slate-100 rounded text-center py-0.5 text-slate-600">Grading Engine</span>
                </div>
                <p className="text-[9px] text-slate-400 italic text-center border-t border-slate-100 pt-1 mt-1">
                  Includes Damage Log
                </p>
              </div>
              <div className="text-center text-slate-300 font-bold text-xs py-0.5">↓</div>
              <div className="bg-white p-2 text-center rounded-lg border border-slate-200 text-xs font-bold text-emerald-700 bg-emerald-50/50 shadow-2xs">
                Cell Matching Module
              </div>
            </div>
          </div>

          {/* Phase 4: Module Assembly */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">04. MODULE WORKFLOW</h3>
            <div className="space-y-2">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex flex-col space-y-1.5 shadow-2xs">
                <div className="flex items-center space-x-2">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold">Module Assembly</span>
                </div>
                <div className="pl-5 border-l-2 border-dashed border-slate-200 space-y-1 mt-1 text-[10px] text-slate-600 font-semibold">
                  <p>1. Assembly Fixture</p>
                  <p>2. Laser Welding</p>
                  <p>3. QC Physical Check</p>
                  <p>4. QC Voltage Measurement</p>
                </div>
              </div>
            </div>
          </div>

          {/* Phase 5: Pack & Release */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 md:col-span-4 lg:col-span-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">05. PACK & RELEASE</h3>
            <div className="space-y-2">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex flex-col space-y-1 shadow-2xs">
                <span className="font-bold text-slate-800">Pack Workflow</span>
                <span className="text-[9px] text-slate-500">• Assembly & BMS Check</span>
                <span className="text-[9px] text-slate-500">• Pack IR Electrical Test</span>
                <span className="text-[9px] text-slate-500">• Final QC Sign-off</span>
              </div>
              <div className="text-center text-slate-300 font-bold text-xs py-0.5">↓</div>
              <div className="bg-slate-900 text-white p-2.5 text-center rounded-lg text-xs font-black shadow-2xs flex items-center justify-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>QR GENEALOGY RELEASE</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Live WIP Batteries & Active Manufacturing Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live WIP Battery Units */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[10px] uppercase tracking-widest font-black text-slate-400">Work In Progress</span>
              <h2 className="text-base font-bold text-slate-900">Live WIP Battery Packs ({Number(inventory.inProcessBatteries || 0)} in process)</h2>
            </div>
            <button
              onClick={() => setActiveView('production')}
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center space-x-1 uppercase tracking-wider"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {(stats?.recentBatteries || []).length === 0 ? (
              <div className="p-8 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200 space-y-3">
                <p className="text-xs font-semibold text-slate-700">No active WIP battery packs on the floor</p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Receive supplier cell manifests and launch a production order to begin automated line orchestration.
                </p>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    onClick={() => setActiveView('supplier')}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 text-emerald-600 border border-emerald-200 text-xs font-bold rounded-xl transition-colors shadow-2xs"
                  >
                    + Import Cells
                  </button>
                  <button
                    onClick={() => setActiveView('planning')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors shadow-2xs"
                  >
                    + New Order
                  </button>
                </div>
              </div>
            ) : (
              stats.recentBatteries.map((b: any) => (
                <div
                  key={b.id}
                  onClick={() => {
                    setActiveBatteryId(b.id);
                    setActiveView('production');
                  }}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-100/80 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-xs text-slate-900 group-hover:text-emerald-600 transition-colors">
                        {b.serialNumber}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                        {b.productName}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Station: <strong className="text-slate-700 font-semibold">{String(b.currentStep || 'NOT STARTED').replace(/_/g, ' ')}</strong>
                    </p>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-slate-800">{b.progressPercent == null ? '—' : `${b.progressPercent}%`}</span>
                      <div className="w-28 bg-slate-200 rounded-full h-1.5 overflow-hidden mt-1">
                        <div
                          className="bg-emerald-600 h-1.5 rounded-full"
                          style={{ width: `${Math.max(0, Math.min(100, Number(b.progressPercent) || 0))}%` }}
                        ></div>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase font-mono ${
                        b.status === 'FINISHED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {b.status}
                    </span>
                    <button type="button" onClick={event => { event.stopPropagation(); handleEditWipBattery(b); }} className="text-slate-500 hover:text-emerald-600" title="Edit battery" aria-label={`Edit ${b.serialNumber}`}><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={event => { event.stopPropagation(); void handleDeleteWipBattery(b); }} className="text-slate-500 hover:text-red-600" title="Delete battery" aria-label={`Delete ${b.serialNumber}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right 1 Col: Production Flow Quick Jump & Machine Health */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div>
            <span className="text-[10px] uppercase tracking-widest font-black text-slate-400">Lean Routing</span>
            <h2 className="text-base font-bold text-slate-900">12-Step Manufacturing Pipeline</h2>
          </div>

          <div className="space-y-1.5 text-xs max-h-[440px] overflow-y-auto pr-1">
            {[
              { num: '01', name: 'Supplier Manifest Ingestion', view: 'supplier' },
              { num: '02', name: 'Cell Inventory & Storage', view: 'inventory' },
              { num: '03', name: 'Production Order & Reservation', view: 'planning' },
              { num: '04', name: 'Cell Identification (Scan)', view: 'production' },
              { num: '05', name: 'Cell Testing (Auto / Inherit)', view: 'production' },
              { num: '06', name: 'Auto Grading Engine', view: 'production' },
              { num: '07', name: 'Intelligent Cell Matching', view: 'production' },
              { num: '08', name: 'Module Fixture & Laser Welding', view: 'production' },
              { num: '09', name: 'Module QC Inspection', view: 'production' },
              { num: '10', name: 'Pack Assembly & BMS Testing', view: 'production' },
              { num: '11', name: 'Final Hi-Pot & 100A Dyn Load', view: 'production' },
              { num: '12', name: 'Final Release & Compliance QR', view: 'production' },
            ].map(step => (
              <button
                key={step.num}
                onClick={() => setActiveView(step.view as any)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 text-left border border-slate-100 transition-colors group"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="font-mono text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    {step.num}
                  </span>
                  <span className="font-semibold text-slate-700 text-xs">{step.name}</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      
      {/* Workflow Diagram */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden mt-8 text-white p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider mb-6 text-emerald-400">Power2Go Authoritative Manufacturing Flow</h2>
        <div className="font-mono text-[10px] sm:text-xs whitespace-pre bg-black/50 p-6 rounded-xl border border-slate-800 overflow-x-auto text-slate-300">
{`===========================================================
CORE HIERARCHY
===========================================================

SUPPLIER EXCEL DATA
        ↓
2D BATTERY BUILDER
      ├── CELL SCAN
      └── BMS/BMU SCAN
        ↓
CELL WORKFLOW (Cell-by-Cell)
      ├── IR & OCV
      ├── GRADING (Good/Damaged)
      └── DAMAGE HISTORY (if required)
        ↓
MODULE WORKFLOW (Module-by-Module)
      ├── LASER WELDING
      ├── QC PHYSICAL
      └── QC VOLTAGE
        ↓
BATTERY PACK WORKFLOW (Global)
      ├── PACK ASSEMBLY
      ├── PACK IR
      └── FINAL QC
        ↓
RELEASE
        ↓
QR + INVENTORY + GENEALOGY`}
        </div>
      </div>

    </div>
    </div>
  );
};
