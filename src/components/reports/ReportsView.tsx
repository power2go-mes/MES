import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  BarChart3,
  AlertTriangle,
  RefreshCw,
  Gauge,
  Database,
  Factory,
  ShieldCheck,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { refreshKey, setActiveView } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await api.getReportsAnalytics();
        if (!cancelled) {
          setStats(res);
          setLoadError(null);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Unable to load report analytics.');
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
      const res = await api.getReportsAnalytics();
      setStats(res);
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to load report analytics.');
    } finally {
      setLoading(false);
    }
  };

  const hasData = stats?.hasData && (stats?.totalCells > 0 || stats?.totalBatteries > 0);
  const fpy = stats?.fpy ?? 0;
  const totalCycles = stats?.totalCycles ?? 0;
  const laserWeldQuality = stats?.laserWeldQuality ?? 0;
  const bmsTelemetryRate = stats?.bmsTelemetryRate ?? 0;
  const ocvDistribution = stats?.ocvDistribution || [];
  const pareto = stats?.pareto || [];
  const inventoryBars = [
    { label: 'Cells tracked', value: Number(stats?.totalCells || 0), color: 'bg-emerald-600' },
    { label: 'Available cells', value: Number(stats?.availableCells || 0), color: 'bg-emerald-500' },
    { label: 'Reserved / assigned', value: Number(stats?.reservedCells || 0), color: 'bg-slate-700' },
    { label: 'Modules tracked', value: Number(stats?.totalModules || 0), color: 'bg-blue-500' },
    { label: 'Batteries tracked', value: Number(stats?.totalBatteries || 0), color: 'bg-amber-500' },
  ];
  const inventoryMax = Math.max(1, ...inventoryBars.map((item) => item.value));
  const activityBars = [
    { label: 'Total test cycles', value: Number(totalCycles), color: 'bg-emerald-600' },
    { label: 'Cells tested', value: Number(stats?.testedCells || 0), color: 'bg-blue-500' },
    { label: 'Packs tested', value: Number(stats?.testedBatteries || 0), color: 'bg-amber-500' },
    { label: 'Weld records', value: Number(stats?.weldedModules || 0), color: 'bg-slate-700' },
    { label: 'BMS tested', value: Number(stats?.testedBms || 0), color: 'bg-rose-500' },
  ];
  const activityMax = Math.max(1, ...activityBars.map((item) => item.value));

  if (loading && !stats) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider font-mono">Loading live quality records...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-slate-700" />
          <h2 className="text-base font-black text-slate-900">Reports unavailable</h2>
          <p className="mt-2 text-xs text-slate-500">{loadError}</p>
          <button type="button" onClick={() => void loadStats()} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f4f5f7] p-4 sm:p-6">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 px-5 py-5 text-white shadow-sm sm:px-7 sm:py-6">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-emerald-500/10 [clip-path:polygon(35%_0,100%_0,100%_100%,0_100%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">Operations intelligence</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-semibold text-slate-300">LIVE RECORDS</span>
                </div>
                <h1 className="text-xl font-black tracking-tight sm:text-2xl">Factory Quality &amp; Throughput Analytics</h1>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-300">Statistical Process Control (SPC), cell variance distribution, first-pass yield, and Pareto defect analytics computed from actual manufacturing records.</p>
              </div>
            </div>
            <button
              onClick={loadStats}
              disabled={loading}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-white/15 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Analytics
            </button>
          </div>
        </div>

      {!hasData ? (
        /* Empty State */
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
            <BarChart3 className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">No production data available</h3>
            <p className="text-xs text-slate-500">
              Statistical Process Control (SPC), First Pass Yield (FPY), and Pareto defect breakdowns are calculated strictly from genuine manufacturing test runs.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => setActiveView('supplier')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              Ingest Supplier Manifest
            </button>
            <button
              onClick={() => setActiveView('planning')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
            >
              Start Production Order
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Quality Summary Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { label: 'First Pass Yield (FPY)', value: stats?.totalCycles ? `${fpy}%` : '—', detail: `${stats?.testedCells || 0} cells + ${stats?.testedBatteries || 0} packs tested`, note: `Based on ${totalCycles.toLocaleString()} recorded cell and pack test cycles`, percent: fpy, icon: <Gauge className="h-4 w-4" /> },
              { label: 'Laser Welding Seam Quality', value: stats?.weldedModules ? `${laserWeldQuality}%` : '—', detail: `${stats?.weldedModules || 0} weld records`, note: 'Calculated from live Trumpf laser welding cycle telemetry', percent: laserWeldQuality, icon: <Factory className="h-4 w-4" /> },
              { label: 'BMS Telemetry & CAN 2.0B Pass Rate', value: stats?.testedBms ? `${bmsTelemetryRate.toFixed(1)}%` : '—', detail: `${stats?.testedBms || 0} of ${stats?.totalBms || 0} BMS tested`, note: 'Calculated from automated Kvaser CAN bus test stations', percent: bmsTelemetryRate, icon: <ShieldCheck className="h-4 w-4" /> },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{metric.label}</span>
                  <span className="text-emerald-600">{metric.icon}</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <span className="text-3xl font-black tracking-tight text-slate-900">{metric.value}</span>
                  <span className="pb-1 text-right text-[10px] font-semibold text-slate-500">{metric.detail}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Number(metric.percent) || 0)}%` }} /></div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">{metric.note}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Cells tracked', stats?.totalCells || 0],
              ['Available cells', stats?.availableCells || 0],
              ['Modules tracked', stats?.totalModules || 0],
              ['Batteries tracked', stats?.totalBatteries || 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number(value).toLocaleString()}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (Number(value) / inventoryMax) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reserved / assigned cells</p>
              <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number(stats?.reservedCells || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scrap records</p>
              <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number((stats?.quarantineOpen || 0) + (stats?.quarantineResolved || 0)).toLocaleString()}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, ((Number(stats?.quarantineOpen || 0) + Number(stats?.quarantineResolved || 0)) / Math.max(1, Number(stats?.totalCells || 0))) * 100)}%` }} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">Inventory footprint</p><h2 className="mt-1 text-sm font-bold text-slate-900">Material volume comparison</h2></div>
                <Database className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-5 space-y-3">
                {inventoryBars.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-semibold text-slate-700">{item.label}</span>
                      <span className="font-mono font-bold text-slate-900">{item.value.toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`${item.color} h-full rounded-full transition-all`} style={{ width: `${(item.value / inventoryMax) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Test activity</p><h2 className="mt-1 text-sm font-bold text-slate-900">Recorded quality workload</h2></div>
                <BarChart3 className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-5 grid grid-cols-5 items-end gap-3 border-b border-slate-200 pb-1 pt-3">
                {activityBars.map((item) => (
                  <div key={item.label} className="flex min-w-0 flex-col items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-slate-700">{item.value.toLocaleString()}</span>
                    <div className="flex h-28 w-full items-end rounded-t-md bg-slate-50"><div className={`${item.color} w-full rounded-t-md transition-all`} style={{ height: `${Math.max(5, (item.value / activityMax) * 100)}%` }} /></div>
                    <span className="w-full truncate text-center text-[9px] font-semibold text-slate-500" title={item.label}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Statistical Distribution & Pareto Analysis Cards */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Cell Matching Distribution */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">Cell quality</p><h2 className="mt-1 text-sm font-bold text-slate-900">Cell OCV &amp; IR Distribution Envelope</h2></div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                  Real Inventory Data
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Histogram of {stats?.totalCells ?? 0} imported cells across calibrated voltage bands.
              </p>

              <div className="mt-4 flex h-48 items-end justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 pb-3 pt-6">
                {ocvDistribution.map((bar: any, idx: number) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[9px] font-mono font-bold text-slate-600">{bar.count}</span>
                    <div
                      className="w-full bg-emerald-600 rounded-t-md transition-all hover:bg-emerald-500"
                      style={{ height: bar.height }}
                    ></div>
                    <span className="text-[9px] font-mono text-slate-400 mt-1">{bar.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pareto Defect Breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600">Quality isolation</p><h2 className="mt-1 text-sm font-bold text-slate-900">Defect Pareto Breakdown (Quality Isolation)</h2></div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-200 font-mono">
                  Scrap Logs
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Isolated failure modes routed to scrap review ({stats?.quarantineOpen ?? 0} open, {stats?.quarantineResolved ?? 0} resolved).
              </p>

              {pareto.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  Zero active scrap defects recorded.
                </div>
              ) : (
                <div className="space-y-4 pt-5">
                  {pareto.map((def: any, idx: number) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-xs font-mono">
                        <span className="font-semibold text-slate-800">{def.mode}</span>
                        <span className="text-slate-500">{def.count} incident{def.count !== 1 ? 's' : ''} ({def.pct}%)</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`${def.color} h-full rounded-full`} style={{ width: `${def.pct}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
};
