import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  Activity, AlertTriangle, ArrowUpRight, Boxes, CalendarCheck, ChevronRight, PackageCheck,
  Cpu, Factory, Layers, Pencil, RefreshCw, ShieldCheck, Sparkles, Trash2,
  Truck, Zap,
} from 'lucide-react';

const navActions = [
  { label: 'Receive cells', view: 'supplier', icon: Truck },
  { label: 'Plan production', view: 'planning', icon: CalendarCheck },
  { label: 'Open production', view: 'production', icon: Factory },
  { label: 'View inventory', view: 'inventory', icon: Boxes },
];

const pipeline = [
  ['01', 'Receiving', 'supplier'], ['02', 'Cell testing', 'production'],
  ['03', 'Cell matching', 'production'], ['04', 'Module build', 'production'],
  ['05', 'Pack assembly', 'production'], ['06', 'Final release', 'production'],
] as const;

export const DashboardView: React.FC = () => {
  const { setActiveView, setActiveBatteryId, refreshKey } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<'7D' | '30D'>('7D');

  const loadStats = async () => {
    setLoading(true);
    setLoadError(null);
    try { setStats(await api.getDashboardStats()); }
    catch (error: any) { setLoadError(error?.message || 'Unable to load dashboard telemetry.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await api.getDashboardStats();
        if (!cancelled) { setStats(result); setLoadError(null); }
      } catch (error: any) {
        if (!cancelled) setLoadError(error?.message || 'Unable to load dashboard telemetry.');
      } finally { if (!cancelled) setLoading(false); }
    };
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshKey]);

  if (loadError) return <div className="flex-1 grid place-items-center p-8"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
    <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-slate-700" /><h2 className="text-base font-black text-slate-900">Dashboard unavailable</h2>
    <p className="mt-2 text-xs text-slate-500">{loadError}</p><button type="button" onClick={() => void loadStats()} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white">Retry</button>
  </div></div>;

  if (loading || !stats) return <div className="flex-1 grid place-items-center p-8"><div className="text-center"><Activity className="mx-auto h-8 w-8 animate-spin text-emerald-600" /><p className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Loading line telemetry</p></div></div>;

  const inventory = stats.inventory || {};
  const quality = stats.quality || {};
  const controller = stats.controllerInventory || {};
  const totalCells = Math.max(1, Number(inventory.totalCells || 0));
  const yieldRate = Number(quality.firstPassYieldPercent || 0);
  const liveCellBuckets = Array.isArray(stats.cellBuckets) ? stats.cellBuckets : [];
  const cellBucketValues = new Map<string, number>(liveCellBuckets.map((row: any) => [String(row.label), Number(row.value) || 0] as [string, number]));
  const statusRows = [
    { label: 'In Stock', value: cellBucketValues.get('In Stock') ?? Number(inventory.inStockCells || 0), color: '#36a852' },
    { label: 'Floor Stock', value: cellBucketValues.get('Floor Stock') ?? Number(inventory.floorStockCells || 0), color: '#2a9bd2' },
    { label: 'In Module', value: cellBucketValues.get('In Module') ?? Number(inventory.inModuleCells || 0), color: '#1b1b1b' },
    { label: 'In Pack', value: cellBucketValues.get('In Pack') ?? Number(inventory.inPackCells || 0), color: '#e8a323' },
    { label: 'In Rack', value: cellBucketValues.get('In Rack') ?? Number(inventory.inRackCells || 0), color: '#0ea5e9' },
    { label: 'Karachi Warehouse', value: cellBucketValues.get('Karachi Warehouse') ?? Number(inventory.karachiWarehouseCells || 0), color: '#14532d' },
    { label: 'Lahore Warehouse', value: cellBucketValues.get('Lahore Warehouse') ?? Number(inventory.lahoreWarehouseCells || 0), color: '#2563eb' },
    { label: 'Sold', value: cellBucketValues.get('Sold') ?? Number(inventory.soldCells || 0), color: '#059669' },
    { label: 'Scrap', value: cellBucketValues.get('Scrap') ?? Number(inventory.scrapCells || 0), color: '#b7b7b7' },
  ];
  const available = statusRows
    .filter(row => row.label === 'In Stock' || row.label === 'Floor Stock')
    .reduce((sum, row) => sum + row.value, 0);
  const statusTotal = Math.max(1, statusRows.reduce((sum, row) => sum + row.value, 0));
  let donutOffset = 0;
  const donut = statusRows.map(row => { const start = donutOffset; donutOffset += row.value / statusTotal * 100; return `${row.color} ${start}% ${donutOffset}%`; }).join(', ');
  const recentBatteries = (stats.recentBatteries || []).slice(0, 5);
  const packColors = ['#2563eb', '#f59e0b', '#16a34a'];
  const packRows = (stats.batteryPackBuckets || []).map((row: any, index: number) => ({
    label: String(row.label || 'Unnamed Pack'),
    value: Math.max(0, Number(row.value) || 0),
    color: packColors[index % packColors.length],
  }));
  const rackCapacities = [25, 45, 60, 70, 75];
  const rackCountByCapacity = new Map<number, number>();
  (stats.rackStatusBuckets || []).forEach((row: any) => {
    (row.rackTypes || []).forEach((rackType: any) => {
      const capacity = Number(String(rackType.rackType || '').match(/^RACK_(\d+)KWH$/i)?.[1]);
      if (rackCapacities.includes(capacity)) rackCountByCapacity.set(capacity, (rackCountByCapacity.get(capacity) || 0) + Math.max(0, Number(rackType.value) || 0));
    });
  });
  const rackCapacityRows = rackCapacities.map(capacity => ({
    label: `${capacity} kWh ${capacity === 25 ? 'rack' : 'cabinet'}`,
    value: rackCountByCapacity.get(capacity) || 0,
  }));
  const rackCountTotal = rackCapacityRows.reduce((sum, row) => sum + row.value, 0);
  const moduleProgressRows = (stats.moduleProgressBuckets || []).map((row: any) => ({
    label: String(row.label || 'Unknown'),
    value: Math.max(0, Number(row.value) || 0),
  }));
  const moduleProgressTotal = Math.max(1, moduleProgressRows.reduce((sum: number, row: any) => sum + row.value, 0));
  const rackProgressRows = (stats.rackStatusBuckets || []).map((row: any) => ({
    label: String(row.label || 'Unknown').replace(/_/g, ' '),
    value: Math.max(0, Number(row.value) || 0),
  }));
  const rackProgressTotal = Math.max(1, rackProgressRows.reduce((sum: number, row: any) => sum + row.value, 0));
  const packMax = Math.max(1, ...packRows.map((row: any) => row.value));
  const packTrend = (stats.batteryPackTrend || []).slice(range === '7D' ? -7 : -30);
  const moduleTrend = (stats.moduleTypeTrend || []).slice(range === '7D' ? -7 : -30);
  const trendLabels = Array.from(new Set([...packTrend, ...moduleTrend].map((point: any) => String(point.label)))).sort();
  const moduleTrendNames = Array.from(new Set(moduleTrend.flatMap((point: any) => (point.series || []).map((row: any) => String(row.name)))));
  const trendSeries = [
    ...packRows.map((row: any, index: number) => ({ key: `battery:${row.label}`, name: `Battery · ${row.label}`, sourceName: row.label, kind: 'battery', color: ['#2563eb', '#f59e0b', '#16a34a'][index % 3] })),
    ...moduleTrendNames.map((name: string, index: number) => ({ key: `module:${name}`, name: `Module · ${name}`, sourceName: name, kind: 'module', color: ['#7c3aed', '#db2777', '#0891b2'][index % 3] })),
  ];
  const trendValue = (series: any, label: string) => {
    const source = series.kind === 'module' ? moduleTrend : packTrend;
    const point = source.find((item: any) => String(item.label) === label);
    return Number(point?.series?.find((item: any) => String(item.name) === series.sourceName)?.value) || 0;
  };
  const trendMax = Math.max(1, ...trendSeries.flatMap((series: any) => trendLabels.map(label => trendValue(series, label))));
  const chartWidth = 760;
  const chartHeight = 190;
  const chartPoint = (index: number, value: number) => ({
    x: trendLabels.length > 1 ? (index / (trendLabels.length - 1)) * chartWidth : chartWidth / 2,
    y: chartHeight - ((value / trendMax) * (chartHeight - 24)) - 12,
  });

  const deleteBattery = async (battery: any) => {
    if (!window.confirm(`Delete battery ${battery.serialNumber}? Its reserved cells and controllers will return to inventory.`)) return;
    try { await api.deleteBattery(battery.id); await loadStats(); }
    catch (error: any) { setLoadError(error?.message || 'Unable to delete battery.'); }
  };

  return <div className="dashboard-view flex-1 overflow-y-auto bg-slate-100 px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1500px] space-y-5">
    <section className="dashboard-hero relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7 sm:py-6"><div className="dashboard-grid absolute inset-0 opacity-10" />
      <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div className="max-w-2xl"><div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]"><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Line 01 online</span><span className="text-slate-400">Power2Go MES / Control room</span></div><h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Good morning, Administrator.</h1><p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">Here is the current pulse of your battery manufacturing line.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void loadStats()} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700 hover:border-emerald-500"><RefreshCw className="h-4 w-4 text-emerald-600" /> Refresh</button><button type="button" onClick={() => { setActiveBatteryId(null); setActiveView('production-flow'); }} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-700"><Sparkles className="h-4 w-4" /> Start a batch</button></div>
      </div><div className="relative mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"><HeroMetric label="Line state" value="RUNNING" accent="text-emerald-600" /><HeroMetric label="Cells tracked" value={Number(inventory.totalCells || 0).toLocaleString()} accent="text-slate-900" /><HeroMetric label="Packs released" value={Number(inventory.finishedBatteries || 0).toLocaleString()} accent="text-slate-900" /><HeroMetric label="Open batches" value={Number(stats.orders?.inProcess || 0).toLocaleString()} accent="text-slate-900" /></div>
    </section>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{navActions.map(({ label, view, icon: Icon }) => <button key={label} type="button" onClick={() => setActiveView(view as any)} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-md"><span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Icon className="h-5 w-5" /></span><span className="text-sm font-bold text-slate-800">{label}</span></span><ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-emerald-600" /></button>)}</section>

    <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr,1fr]"><Panel eyebrow="Output rhythm" title="Production by type" action={<div className="flex rounded-lg bg-slate-100 p-1">{(['7D', '30D'] as const).map(item => <button key={item} type="button" onClick={() => setRange(item)} className={`rounded-md px-3 py-1.5 text-[10px] font-black ${range === item ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{item}</button>)}</div>}>
      <div className="mt-6 border-b border-slate-100 px-1">
        {trendLabels.length === 0 ? <div className="grid h-56 place-items-center text-xs text-slate-400">No production trend data yet</div> : <>
          <div className="h-56 w-full overflow-hidden">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Battery and module production by type">
              {[0, 1, 2, 3].map((line) => <line key={line} x1="0" x2={chartWidth} y1={12 + line * ((chartHeight - 24) / 3)} y2={12 + line * ((chartHeight - 24) / 3)} stroke="#e5e7eb" strokeDasharray="3 5" />)}
              {trendSeries.map((series: any) => {
                const points = trendLabels.map((label, index) => chartPoint(index, trendValue(series, label)));
                return <g key={series.key}>
                  <polyline points={points.map((point: any) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  {points.map((point: any, index: number) => { const value = trendValue(series, trendLabels[index]); return <circle key={`${series.key}-${index}`} cx={point.x} cy={point.y} r="3.5" fill={series.color}><title>{`${series.name} | ${trendLabels[index]}: ${value}`}</title></circle>; })}
                </g>;
              })}
            </svg>
          </div>
          <div className="flex justify-between text-[9px] text-slate-400"><span>{String(trendLabels[0] || '').slice(5)}</span><span>{String(trendLabels[trendLabels.length - 1] || '').slice(5)}</span></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pb-3 text-[10px] text-slate-500">{trendSeries.map((series: any) => <span key={series.key} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: series.color }} />{series.name}</span>)}</div>
        </>}
      </div>
      <div className="mt-5 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{range === '7D' ? 'Latest release window' : 'Monthly build output'}</span><button type="button" onClick={() => setActiveView('reports')} className="flex items-center gap-1 text-xs font-bold text-emerald-600">Open reports <ChevronRight className="h-3.5 w-3.5" /></button></div>
    </Panel><Panel eyebrow="Inventory composition" title="Where the cells are" action={<Boxes className="h-5 w-5 text-emerald-600" />}><div className="mt-5 flex items-center gap-6"><div className="relative grid h-40 w-40 shrink-0 place-items-center rounded-full shadow-inner" style={{ background: `conic-gradient(${donut})` }}><div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-sm"><strong className="text-2xl font-black text-slate-900">{totalCells.toLocaleString()}</strong><span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">tracked cells</span></div></div><div className="min-w-0 flex-1 space-y-2.5">{statusRows.map(row => <div key={row.label} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 font-semibold text-slate-600"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} /><span className="truncate">{row.label}</span></span><b className="font-mono text-slate-900">{row.value.toLocaleString()}</b></div>)}</div></div><div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4"><div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">Available now</p><p className="mt-1 text-lg font-black text-emerald-900">{available.toLocaleString()}</p></div><div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">Utilized / placed</p><p className="mt-1 text-lg font-black text-slate-900">{Math.max(0, totalCells - available).toLocaleString()}</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(100, available / totalCells * 100)}%` }} /></div></Panel></section>

    <section className="grid grid-cols-1 gap-5 lg:grid-cols-3"><Panel eyebrow="Pack mix" title="Battery packs by model" action={<Factory className="h-5 w-5 text-emerald-600" />}><div className="mt-5 space-y-4">{packRows.length === 0 ? <div className="py-8 text-center text-xs text-slate-400">No pack model data yet</div> : packRows.map((row: any) => <div key={row.label}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 font-semibold text-slate-600"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} /><span className="truncate">{row.label}</span></span><b className="font-mono text-slate-900">{row.value.toLocaleString()}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${(row.value / packMax) * 100}%`, background: row.color }} /></div></div>)}</div></Panel><Panel eyebrow="Rack inventory" title={`Racks by capacity · ${rackCountTotal.toLocaleString()} total`} action={<PackageCheck className="h-5 w-5 text-cyan-600" />}><div className="mt-5 space-y-3">{rackCapacityRows.map(row => <div key={row.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 text-xs"><span className="font-semibold text-slate-600">{row.label}</span><b className="font-mono text-slate-900">{row.value.toLocaleString()}</b></div>)}</div></Panel><Panel eyebrow="Quality gate" title="First-pass yield" action={<ShieldCheck className="h-5 w-5 text-emerald-600" />}><div className="mt-5 flex items-end justify-between"><span className="text-5xl font-black tracking-tight text-slate-900">{yieldRate ? `${yieldRate}%` : '—'}</span><span className="mb-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">Target 99%</span></div><div className="mt-6 h-3 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, yieldRate)}%` }} /></div><p className="mt-3 text-xs text-slate-500">{Number(quality.quarantinedCount || inventory.quarantinedCells || 0).toLocaleString()} items require quality review.</p></Panel>
      <Panel eyebrow="Component readiness" title="Controllers on hand" action={<Cpu className="h-5 w-5 text-emerald-600" />}><div className="mt-5 grid grid-cols-2 gap-3">{[['BMS', controller.availableBms, controller.assignedBms, controller.totalBms], ['BMU', controller.availableBmu, controller.assignedBmu, controller.totalBmu]].map(([label, value, assigned, total]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-4"><span className="text-xs font-black text-slate-500">{label}</span><strong className="mt-2 block text-2xl font-black text-slate-900">{Number(value || 0).toLocaleString()}</strong><span className="text-[10px] text-slate-400">available of {Number(total || 0).toLocaleString()} total</span><span className="mt-1 block text-[10px] font-semibold text-emerald-600">{Number(assigned || 0).toLocaleString()} assigned</span></div>)}</div></Panel>
      <Panel eyebrow="Line routing" title="Six production gates" action={<Zap className="h-5 w-5 text-emerald-600" />}><div className="mt-4 grid grid-cols-2 gap-2">{pipeline.map(([number, label, view]) => <button key={number} type="button" onClick={() => setActiveView(view as any)} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2.5 text-left hover:border-emerald-400 hover:bg-emerald-50"><span className="font-mono text-[10px] font-black text-emerald-600">{number}</span><span className="text-[11px] font-bold text-slate-600">{label}</span></button>)}</div></Panel></section>

    <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr,1fr]"><Panel eyebrow="Needs attention" title={`Live WIP / ${Number(inventory.inProcessBatteries || 0)} in process`} action={<button type="button" onClick={() => setActiveView('production')} className="text-xs font-bold text-emerald-600">View all <ArrowUpRight className="inline h-3.5 w-3.5" /></button>}><div className="mt-4 space-y-2">{recentBatteries.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center"><Layers className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-xs font-bold text-slate-600">No active packs on the floor</p><button type="button" onClick={() => setActiveView('planning')} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white">Create production order</button></div> : recentBatteries.map((battery: any) => <div key={battery.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50"><button type="button" onClick={() => { setActiveBatteryId(battery.id); setActiveView('production'); }} className="min-w-0 flex-1 text-left"><span className="block truncate font-mono text-xs font-black text-slate-900">{battery.serialNumber}</span><span className="mt-1 block text-[11px] text-slate-500">{String(battery.currentStep || 'NOT STARTED').replace(/_/g, ' ')}</span></button><div className="w-24"><div className="text-right text-[10px] font-black text-slate-600">{battery.progressPercent ?? 0}%</div><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Number(battery.progressPercent) || 0)}%` }} /></div></div><button type="button" onClick={() => { setActiveBatteryId(battery.id); setActiveView('workflow-pack'); }} className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Edit battery"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void deleteBattery(battery)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900" title="Delete battery"><Trash2 className="h-4 w-4" /></button></div>)}</div></Panel>
      <Panel eyebrow="Operational health" title="At a glance" action={<Activity className="h-5 w-5 text-emerald-600" />}><div className="mt-4 divide-y divide-slate-100">{[['Quality review', `${Number(quality.quarantinedCount || 0)} open`, false], ['Scheduled batches', `${Number(stats.orders?.total || 0)} total`, false], ['Completed batches', `${Number(stats.orders?.completed || 0)} total`, false]].map(([label, value, online]) => <div key={String(label)} className="flex items-center justify-between py-3"><span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><i className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />{label}</span><b className={`text-xs font-black ${online ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</b></div>)}</div></Panel>
    </section>

    <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ProgressPanel
        eyebrow="Module progress"
        title={`${moduleProgressTotal.toLocaleString()} modules by stage`}
        icon={<Layers className="h-5 w-5 text-emerald-600" />}
        rows={moduleProgressRows}
        color="bg-emerald-500"
        emptyLabel="No module progress data"
      />
      <ProgressPanel
        eyebrow="Rack & cabinet progress"
        title={`${rackProgressTotal.toLocaleString()} racks in lifecycle`}
        icon={<PackageCheck className="h-5 w-5 text-cyan-600" />}
        rows={rackProgressRows}
        color="bg-cyan-500"
        emptyLabel="No rack progress data"
        footer={rackCapacityRows.filter((row: any) => row.value > 0).map((row: any) => `${row.label}: ${row.value}`).join(' · ') || 'No racks recorded'}
      />
    </section>
  </div></div>;
};

function HeroMetric({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return <div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p><p className={`mt-1 text-sm font-black ${accent}`}>{value}</p></div>;
}

function Panel({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p><h2 className="mt-1 text-base font-black tracking-tight text-slate-900">{title}</h2></div>{action}</div>{children}</article>;
}

function ProgressPanel({ eyebrow, title, icon, rows, color, emptyLabel, footer }: { eyebrow: string; title: string; icon: React.ReactNode; rows: Array<{ label: string; value: number }>; color: string; emptyLabel: string; footer?: string }) {
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  return <Panel eyebrow={eyebrow} title={title} action={icon}><div className="mt-5 space-y-3">{rows.length === 0 ? <div className="py-8 text-center text-xs text-slate-400">{emptyLabel}</div> : rows.map(row => <div key={row.label}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="font-semibold capitalize text-slate-600">{row.label}</span><b className="font-mono text-slate-900">{row.value.toLocaleString()}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(100, (row.value / total) * 100)}%` }} /></div></div>)}</div>{footer && <div className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-semibold text-slate-400">Capacity mix: {footer}</div>}</Panel>;
}
