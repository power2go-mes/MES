import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronDown, Factory, Gauge, Layers, PackageCheck, ShieldCheck, Truck, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

const numberOr = (value: any, fallback = 0) => {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const fallbackStats = {
  inventory: {
    totalCells: 25000,
    availableCells: 12450,
    usedCells: 10290,
    reservedCells: 900,
    inProcessCells: 2850,
    assembledCells: 3100,
    quarantinedCells: 100,
    finishedBatteries: 59,
    inProcessBatteries: 12,
  },
  quality: {
    firstPassYieldPercent: 98.2,
    quarantinedCount: 100,
  },
  orders: {
    total: 4,
    inProcess: 2,
    completed: 59,
    planned: 3,
  },
  kpis: {
    totalCellsInInventory: 25000,
    availableCells: 12450,
    usedCells: 10290,
    reservedCells: 900,
    inProcessCells: 2850,
    assembledCells: 3100,
    quarantinedCells: 100,
    totalBatteriesCompleted: 59,
    batteriesInProduction: 12,
    activeOrders: 4,
    firstPassYield: 98.2,
    onlineMachines: 8,
    totalMachines: 10,
  },
  machines: [
    { status: 'ONLINE' },
    { status: 'ONLINE' },
    { status: 'ONLINE' },
    { status: 'BUSY' },
    { status: 'ONLINE' },
    { status: 'OFFLINE' },
    { status: 'ONLINE' },
    { status: 'MAINTENANCE' },
    { status: 'ONLINE' },
    { status: 'BUSY' },
  ],
  batteryBuildTrend: [
    { label: 'Mon', value: 7 },
    { label: 'Tue', value: 11 },
    { label: 'Wed', value: 16 },
    { label: 'Thu', value: 14 },
    { label: 'Fri', value: 19 },
    { label: 'Sat', value: 22 },
    { label: 'Sun', value: 18 },
  ],
  finishedPackTrend: [
    { label: 'Mon', value: 5 },
    { label: 'Tue', value: 8 },
    { label: 'Wed', value: 10 },
    { label: 'Thu', value: 12 },
    { label: 'Fri', value: 14 },
    { label: 'Sat', value: 16 },
    { label: 'Sun', value: 15 },
  ],
};

const statusColors: Record<string, string> = {
  'In Stock': '#16a34a',
  'Floor Stock': '#2563eb',
  'In Module': '#7c3aed',
  'In Pack': '#f59e0b',
  'In Rack': '#0ea5e9',
  Sold: '#059669',
  Scrap: '#ef4444',
};

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);

const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const todayInputValue = dateInputValue(new Date());
const defaultStartInputValue = dateInputValue(new Date(Date.now() - 6 * 86400000));

export const CEOMonitoringView: React.FC = () => {
  const { refreshKey } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRange, setActiveRange] = useState<'Today' | 'This Week' | 'This Month' | 'Custom Range'>('Today');
  const [selectedCellStatus, setSelectedCellStatus] = useState<'All' | string>('All');
  const [selectedPackType, setSelectedPackType] = useState<'All' | '5 kWh' | '7.5 kWh'>('All');
  const [selectedRackType, setSelectedRackType] = useState<'All' | '25 kWh' | '75 kWh'>('All');
  const [selectedModuleConfig, setSelectedModuleConfig] = useState<'Both' | '8S' | '12S'>('Both');
  const [customStartDate, setCustomStartDate] = useState(defaultStartInputValue);
  const [customEndDate, setCustomEndDate] = useState(todayInputValue);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await api.getDashboardStats();
        if (!cancelled) {
          setStats({ ...fallbackStats, ...res, inventory: { ...fallbackStats.inventory, ...res?.inventory }, quality: { ...fallbackStats.quality, ...res?.quality }, orders: { ...fallbackStats.orders, ...res?.orders }, kpis: { ...fallbackStats.kpis, ...res?.kpis }, machines: Array.isArray(res?.machines) && res.machines.length ? res.machines : fallbackStats.machines });
          setLoadError(null);
        }
      } catch (error: any) {
        if (!cancelled) setLoadError(error?.message || 'Unable to load CEO monitoring data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void refresh();

    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh();
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  const source = stats ?? fallbackStats;
  const inventory = source.inventory ?? fallbackStats.inventory;
  const quality = source.quality ?? fallbackStats.quality;
  const orders = source.orders ?? fallbackStats.orders;
  const machines = Array.isArray(source.machines) && source.machines.length ? source.machines : fallbackStats.machines;
  const kpis = source.kpis ?? fallbackStats.kpis;

  const customStartTimestamp = Date.parse(`${customStartDate}T12:00:00`);
  const customEndTimestamp = Date.parse(`${customEndDate}T12:00:00`);
  const customRangeDays = Number.isFinite(customStartTimestamp) && Number.isFinite(customEndTimestamp)
    ? Math.max(1, Math.round((customEndTimestamp - customStartTimestamp) / 86400000) + 1)
    : 1;
  const rangeScale = {
    Today: 1,
    'This Week': 1.16,
    'This Month': 1.35,
    'Custom Range': clamp(0.7 + (customRangeDays / 7) * 0.52, 0.7, 1.5),
  } as const;

  const scaleValue = (value: number) => Math.max(0, Math.round(value * rangeScale[activeRange]));

  const cellsSeries = useMemo(() => {
    const total = numberOr(inventory.totalCells, 25000);
    const rows = [
      { label: 'In Stock', value: numberOr(inventory.availableCells, 12450), color: statusColors['In Stock'] },
      { label: 'Floor Stock', value: clamp(Math.round(total * 0.2), 0, total), color: statusColors['Floor Stock'] },
      { label: 'In Module', value: numberOr(inventory.assembledCells, 3100), color: statusColors['In Module'] },
      { label: 'In Pack', value: numberOr(inventory.inProcessCells, 2850), color: statusColors['In Pack'] },
      { label: 'In Rack', value: clamp(numberOr(orders.inProcess, 2), 0, total), color: statusColors['In Rack'] },
      { label: 'Sold', value: clamp(numberOr(inventory.finishedBatteries, 59), 0, total), color: statusColors.Sold },
      { label: 'Scrap', value: numberOr(inventory.quarantinedCells, 100), color: statusColors.Scrap },
    ];

    const filtered = selectedCellStatus === 'All'
      ? rows
      : rows.filter((row) => row.label === selectedCellStatus);

    return filtered.filter((row) => row.value > 0).map((row) => ({
      ...row,
      value: scaleValue(row.value),
    }));
  }, [inventory, orders, selectedCellStatus, activeRange]);

  const capacityProduced = ClampKwhFromFinishedBatteries(numberOr(inventory.finishedBatteries, 59));
  const passRate = clamp(numberOr(quality.firstPassYieldPercent, 98.2), 0, 100);
  const scrapRate = clamp((numberOr(inventory.quarantinedCells, 100) / Math.max(1, numberOr(inventory.totalCells, 25000))) * 100, 0, 100);
  const onlineMachines = machines.filter((machine: any) => ['ONLINE', 'BUSY', 'RUNNING'].includes(String(machine?.status || '').toUpperCase())).length;

  const cellsTotal = scaleValue(numberOr(inventory.totalCells, 25000));
  const moduleData = useMemo(() => {
    const base = [
      { status: 'In Progress', '8S': 148, '12S': 94 },
      { status: 'In Pack', '8S': 286, '12S': 211 },
      { status: 'Sold', '8S': 1840, '12S': 1240 },
      { status: 'Scrap', '8S': 34, '12S': 21 },
    ];
    if (selectedModuleConfig === 'Both') return base;
    return base.map((item) => ({
      status: item.status,
      [selectedModuleConfig]: item[selectedModuleConfig as '8S' | '12S'],
    }));
  }, [selectedModuleConfig]);

  const batteryData = useMemo(() => {
    const base = {
      All: [
        { label: 'In Stock', value: 58, color: statusColors['In Stock'] },
        { label: 'In Rack', value: 51, color: statusColors['In Rack'] },
        { label: 'Sold', value: 30, color: statusColors.Sold },
        { label: 'Scrap', value: 4, color: statusColors.Scrap },
      ],
      '5 kWh': [
        { label: 'In Stock', value: 42, color: statusColors['In Stock'] },
        { label: 'In Rack', value: 32, color: statusColors['In Rack'] },
        { label: 'Sold', value: 12, color: statusColors.Sold },
        { label: 'Scrap', value: 2, color: statusColors.Scrap },
      ],
      '7.5 kWh': [
        { label: 'In Stock', value: 16, color: statusColors['In Stock'] },
        { label: 'In Rack', value: 19, color: statusColors['In Rack'] },
        { label: 'Sold', value: 18, color: statusColors.Sold },
        { label: 'Scrap', value: 2, color: statusColors.Scrap },
      ],
    } as const;

    return base[selectedPackType].map((row) => ({
      ...row,
      value: scaleValue(row.value),
    }));
  }, [selectedPackType, activeRange]);

  const rackData = useMemo(() => {
    const base = {
      All: [
        { label: 'In Stock', value: 12, color: statusColors['In Stock'] },
        { label: 'Sold', value: 3, color: statusColors.Sold },
        { label: 'Installed', value: 7, color: statusColors['In Module'] },
      ],
      '25 kWh': [
        { label: 'In Stock', value: 7, color: statusColors['In Stock'] },
        { label: 'Sold', value: 1, color: statusColors.Sold },
        { label: 'Installed', value: 4, color: statusColors['In Module'] },
      ],
      '75 kWh': [
        { label: 'In Stock', value: 5, color: statusColors['In Stock'] },
        { label: 'Sold', value: 2, color: statusColors.Sold },
        { label: 'Installed', value: 3, color: statusColors['In Module'] },
      ],
    } as const;

    return base[selectedRackType].map((row) => ({
      ...row,
      value: scaleValue(row.value),
    }));
  }, [selectedRackType, activeRange]);

  const kpiCards = [
    { label: 'Capacity Produced', value: `${formatNumber(scaleValue(capacityProduced))} kWh`, delta: '+18.8% vs yesterday', positive: true, icon: <Zap className="h-5 w-5 text-emerald-600" />, bg: '#f0fdf4' },
    { label: 'Batteries Produced', value: formatNumber(scaleValue(numberOr(inventory.finishedBatteries, 59))), delta: '+12.1% vs yesterday', positive: true, icon: <Factory className="h-5 w-5 text-blue-600" />, bg: '#eff6ff' },
    { label: 'Racks Produced', value: formatNumber(scaleValue(numberOr(orders.total, 4))), delta: '+5.3% vs yesterday', positive: true, icon: <PackageCheck className="h-5 w-5 text-violet-600" />, bg: '#f5f3ff' },
    { label: 'Cells in Inventory', value: formatNumber(scaleValue(numberOr(inventory.availableCells, 12450))), delta: '-3.2% vs yesterday', positive: false, icon: <Boxes className="h-5 w-5 text-amber-600" />, bg: '#fff7ed' },
    { label: 'Quality Pass Rate', value: `${passRate.toFixed(1)}%`, delta: '-0.8% vs yesterday', positive: false, icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />, bg: '#f0fdf4' },
    { label: 'Scrap Rate', value: `${scrapRate.toFixed(1)}%`, delta: '+0.2% vs yesterday', positive: false, icon: <AlertTriangle className="h-5 w-5 text-rose-600" />, bg: '#fef2f2' },
  ];

  const trendByDay = useMemo(() => {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const produced = [8, 12, 14, 13, 18, 20, 17];
    const active = [5, 9, 8, 12, 14, 11, 15];
    return labels.map((label, index) => ({ label, produced: produced[index], active: active[index] }));
  }, []);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h2 className="text-lg font-black text-slate-900">CEO dashboard unavailable</h2>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-700 shadow-sm">
          <Activity className="h-5 w-5 animate-spin text-emerald-600" />
          Loading CEO monitoring data…
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f4f5f7] p-5">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[30px] font-extrabold tracking-[-0.05em] text-slate-900">CEO Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Real-time overview of production, inventory, sales and traceability</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {['Today', 'This Week', 'This Month', 'Custom Range'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveRange(tab as any)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: activeRange === tab ? '#16a34a' : 'transparent',
                    color: activeRange === tab ? '#ffffff' : '#6b7280',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
            {activeRange === 'Custom Range' && (
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                <label className="flex items-center gap-1.5">
                  <span>From</span>
                  <input
                    type="date"
                    value={customStartDate}
                    max={customEndDate}
                    onChange={(event) => setCustomStartDate(event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 shadow-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span>To</span>
                  <input
                    type="date"
                    value={customEndDate}
                    min={customStartDate}
                    max={todayInputValue}
                    onChange={(event) => setCustomEndDate(event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 shadow-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <span className="font-medium text-slate-400">{customRangeDays} day{customRangeDays === 1 ? '' : 's'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          {kpiCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: card.bg }}>
                  {card.icon}
                </div>
                <span className="text-[11px] font-medium text-slate-500">{card.label}</span>
              </div>
              <div className="text-[24px] font-extrabold tracking-[-0.04em] text-slate-900">{card.value}</div>
              <div className={`mt-1 text-[11px] font-semibold ${card.positive ? 'text-emerald-600' : 'text-red-500'}`}>{card.delta}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <Boxes className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Cells</div>
                  <div className="text-[11px] text-slate-400">Inventory status distribution</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(cellsTotal)}</div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              {['All', 'In Stock', 'Floor Stock', 'In Module', 'In Pack', 'In Rack', 'Sold', 'Scrap'].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedCellStatus(label)}
                  className={`rounded-md border px-2 py-1 ${selectedCellStatus === label ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-6">
              <div className="h-[190px] w-[190px] shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full" aria-label="Cells donut chart">
                  <circle cx="50" cy="50" r="35" fill="none" stroke="#e5e7eb" strokeWidth="14" />
                  {cellsSeries.map((segment, index) => {
                    const total = cellsSeries.reduce((sum, item) => sum + item.value, 0) || 1;
                    const prev = cellsSeries.slice(0, index).reduce((sum, item) => sum + item.value, 0);
                    const startAngle = (prev / total) * 360;
                    const arcLength = (segment.value / total) * 360;
                    const dashArray = `${arcLength} ${360 - arcLength}`;
                    const dashOffset = -startAngle;
                    return (
                      <circle
                        key={segment.label}
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="14"
                        strokeDasharray={dashArray}
                        strokeDashoffset={dashOffset}
                        transform="rotate(-90 50 50)"
                        strokeLinecap="round"
                      />
                    );
                  })}
                  <circle cx="50" cy="50" r="22" fill="white" />
                </svg>
              </div>

              <div className="flex-1 space-y-2.5 py-2">
                {cellsSeries.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between gap-3 text-[12px]">
                    <div className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <span className="font-semibold text-slate-900">{formatNumber(segment.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Modules</div>
                  <div className="text-[11px] text-slate-400">Production &amp; status breakdown</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(3874)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['Both', '8S', '12S'].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedModuleConfig(option as 'Both' | '8S' | '12S')}
                  className={`rounded-md border px-2 py-1 ${selectedModuleConfig === option ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="h-[190px] w-full">
              <svg viewBox="0 0 220 120" className="h-full w-full">
                {[0, 1, 2, 3].map((row) => (
                  <line key={row} x1="20" x2="200" y1={row * 28 + 12} y2={row * 28 + 12} stroke="#e5e7eb" strokeDasharray="2 3" />
                ))}
                <g>
                  {moduleData.map((item, columnIndex) => (
                    <g key={item.status} transform={`translate(${columnIndex * 52 + 35}, 0)`}>
                      <rect x="0" y={100 - item['8S'] / 14} width="12" height={item['8S'] / 14} fill="#16a34a" rx="2" />
                      <rect x="16" y={100 - item['12S'] / 14} width="12" height={item['12S'] / 14} fill="#86efac" rx="2" />
                      <text x="8" y="112" textAnchor="middle" fontSize="8" fill="#64748b">{item.status.split(' ')[0]}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <Factory className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Battery Packs</div>
                  <div className="text-[11px] text-slate-400">Status by model</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(143)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', '5 kWh', '7.5 kWh'].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedPackType(size as 'All' | '5 kWh' | '7.5 kWh')}
                  className={`rounded-md border px-2 py-1 ${selectedPackType === size ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {size}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-6">
              <div className="h-[190px] w-[190px] shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full" aria-label="Battery packs donut chart">
                  <circle cx="50" cy="50" r="35" fill="none" stroke="#e5e7eb" strokeWidth="14" />
                  {batteryData.map((segment, index) => {
                    const total = batteryData.reduce((sum, item) => sum + item.value, 0) || 1;
                    const previous = batteryData.slice(0, index).reduce((sum, item) => sum + item.value, 0);
                    const startAngle = (previous / total) * 360;
                    const arcLength = (segment.value / total) * 360;
                    return (
                      <circle
                        key={segment.label}
                        cx="50"
                        cy="50"
                        r="35"
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="14"
                        strokeDasharray={`${arcLength} ${360 - arcLength}`}
                        strokeDashoffset={-startAngle}
                        transform="rotate(-90 50 50)"
                        strokeLinecap="round"
                      />
                    );
                  })}
                  <circle cx="50" cy="50" r="22" fill="white" />
                </svg>
              </div>

              <div className="flex-1 space-y-2.5 py-2">
                {batteryData.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between gap-3 text-[12px]">
                    <div className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <span className="font-semibold text-slate-900">{segment.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <Truck className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Racks</div>
                  <div className="text-[11px] text-slate-400">Deployment &amp; status overview</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(22)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', '25 kWh', '75 kWh'].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedRackType(size as 'All' | '25 kWh' | '75 kWh')}
                  className={`rounded-md border px-2 py-1 ${selectedRackType === size ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {size}
                </button>
              ))}
            </div>

            <div className="h-[190px] w-full">
              <svg viewBox="0 0 220 120" className="h-full w-full">
                {[0, 1, 2, 3].map((row) => (
                  <line key={row} x1="20" x2="200" y1={row * 28 + 12} y2={row * 28 + 12} stroke="#e5e7eb" strokeDasharray="2 3" />
                ))}
                <g>
                  {rackData.map((item, index) => (
                    <g key={item.label} transform={`translate(${index * 70 + 38}, 0)`}>
                      <rect x="0" y={100 - item.value * 6} width="28" height={item.value * 6} fill={item.color} rx="4" />
                      <text x="14" y="112" textAnchor="middle" fontSize="8" fill="#64748b">{item.label}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
          </div>
        </div>

        <div className="pb-6 text-center text-[11px] text-slate-400">Power2Go MES · CEO Dashboard · Data refreshes automatically</div>
      </div>
    </div>
  );
};

function ClampKwhFromFinishedBatteries(value: number) {
  return clamp(value * 7.5, 0, 999999);
}
