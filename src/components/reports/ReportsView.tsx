import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  BarChart3,
  TrendingUp,
  Award,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  Calendar,
  CheckCircle2,
  Sparkles,
  RefreshCw,
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
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <BarChart3 className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Factory Quality & Throughput Analytics
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Statistical Process Control (SPC), cell variance distribution, first-pass yield, and Pareto defect analytics computed from actual manufacturing records.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadStats}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center space-x-1.5 transition-colors self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Analytics</span>
        </button>
      </div>

      {!hasData ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs space-y-4">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                First Pass Yield (FPY)
              </span>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-black font-mono text-emerald-600">{stats?.totalCycles ? `${fpy}%` : '—'}</span>
                <span className="text-xs text-slate-500 font-mono">{stats?.testedCells || 0} cells + {stats?.testedBatteries || 0} packs tested</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${Math.min(100, fpy)}%` }}></div>
              </div>
              <p className="text-[11px] text-slate-500">
                Based on {totalCycles.toLocaleString()} recorded cell and pack test cycles
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Laser Welding Seam Quality
              </span>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-black font-mono text-emerald-600">{stats?.weldedModules ? `${laserWeldQuality}%` : '—'}</span>
                <span className="text-xs text-slate-500 font-mono">{stats?.weldedModules || 0} weld records</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${laserWeldQuality}%` }}></div>
              </div>
              <p className="text-[11px] text-slate-500">
                Calculated from live Trumpf laser welding cycle telemetry
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                BMS Telemetry & CAN 2.0B Pass Rate
              </span>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-black font-mono text-emerald-600">{stats?.testedBms ? `${bmsTelemetryRate.toFixed(1)}%` : '—'}</span>
                <span className="text-xs text-slate-500 font-mono">{stats?.testedBms || 0} of {stats?.totalBms || 0} BMS tested</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${bmsTelemetryRate}%` }}></div>
              </div>
              <p className="text-[11px] text-slate-500">
                Calculated from automated Kvaser CAN bus test stations
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Cells tracked', stats?.totalCells || 0],
              ['Available cells', stats?.availableCells || 0],
              ['Modules tracked', stats?.totalModules || 0],
              ['Batteries tracked', stats?.totalBatteries || 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-slate-200 bg-slate-50 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border border-slate-200 bg-slate-50 rounded-xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reserved / assigned cells</p>
              <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number(stats?.reservedCells || 0).toLocaleString()}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 rounded-xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scrap records</p>
              <p className="mt-1 text-2xl font-black font-mono text-slate-900">{Number((stats?.quarantineOpen || 0) + (stats?.quarantineResolved || 0)).toLocaleString()}</p>
            </div>
          </div>

          {/* Statistical Distribution & Pareto Analysis Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cell Matching Distribution */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold text-slate-900">Cell OCV & IR Distribution Envelope</h2>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                  Real Inventory Data
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Histogram of {stats?.totalCells ?? 0} imported cells across calibrated voltage bands.
              </p>

              <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 px-3 bg-slate-50/70 rounded-xl border border-slate-200">
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
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold text-slate-900">Defect Pareto Breakdown (Quality Isolation)</h2>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-200 font-mono">
                  Scrap Logs
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Isolated failure modes routed to scrap review ({stats?.quarantineOpen ?? 0} open, {stats?.quarantineResolved ?? 0} resolved).
              </p>

              {pareto.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  Zero active scrap defects recorded.
                </div>
              ) : (
                <div className="space-y-3.5 pt-2">
                  {pareto.map((def: any, idx: number) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="font-semibold text-slate-800">{def.mode}</span>
                        <span className="text-slate-500">{def.count} incident{def.count !== 1 ? 's' : ''} ({def.pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className={`${def.color} h-2 rounded-full`} style={{ width: `${def.pct}%` }}></div>
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
  );
};
