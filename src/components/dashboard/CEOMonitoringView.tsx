import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Activity, AlertTriangle, Boxes, Download, Factory, PackageCheck, Truck, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { downloadBatteryReport, downloadCellReport, downloadRackReport } from '../../lib/cellReportExport';
import { buildDashboardDistribution, DashboardDistribution, DashboardChartRow } from '../../lib/dashboardCharts';

const numberOr = (value: any, fallback = 0) => {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const statusColors: Record<string, string> = {
  'In Stock': '#16a34a',
  'Floor Stock': '#2563eb',
  'In Module': '#7c3aed',
  'In Pack': '#f59e0b',
  'In Rack': '#0ea5e9',
  'Karachi Warehouse': '#14532d',
  'Lahore Warehouse': '#2563eb',
  Sold: '#059669',
  Scrap: '#ef4444',
};
const packColors = ['#2563eb', '#f59e0b', '#16a34a'];
const packColorByModel: Record<string, string> = {
  'WallMount 5kWh': '#2563eb',
  '5 kWh Battery Pack': '#f59e0b',
  '7.5 kWh Battery Pack': '#16a34a',
};
const reportDarkGrey = '#374151';
const reportGreen = '#16a34a';
const reportCabinetBlue = '#2563eb';
const rackPowerColors: Record<string, string> = {
  '25': '#16a34a',
  '45': '#2563eb',
  '60': '#6b7280',
  '70': '#86efac',
  '75': '#f59e0b',
};
type ChartRow = DashboardChartRow;

const DistributionDonut: React.FC<{ distribution: DashboardDistribution; ariaLabel: string; showShare?: boolean; extraRows?: ChartRow[] }> = ({ distribution, ariaLabel, showShare = true, extraRows = [] }) => {
  const visible = distribution.rows.filter((row) => row.value > 0 && row.share > 0);
  let offset = 0;
  return (
    <div className="flex min-w-0 items-center gap-6">
      <div className="h-[190px] w-[190px] shrink-0">
        {distribution.total === 0 ? <div className="grid h-full place-items-center rounded-full border-[14px] border-slate-100 text-center"><span className="text-[11px] font-semibold text-slate-400">No recorded data</span></div> : <svg viewBox="0 0 100 100" className="h-full w-full" aria-label={ariaLabel}>
          <circle cx="50" cy="50" r="35" fill="none" stroke="#e5e7eb" strokeWidth="14" />
          {visible.map((row) => {
            const start = offset;
            offset += row.share;
            const circumference = 2 * Math.PI * 35;
            const gap = visible.length > 1 ? 0.7 : 0;
            const segmentLength = Math.max(0, (row.share / 100) * circumference - gap);
            const dashOffset = -((start / 100) * circumference + gap / 2);
            return <circle className="chart-donut-segment" key={row.label} cx="50" cy="50" r="35" fill="none" stroke={row.color} strokeWidth="14" strokeDasharray={`${segmentLength} ${circumference - segmentLength}`} strokeDashoffset={dashOffset} transform="rotate(-90 50 50)" strokeLinecap="butt"><title>{`${row.label}: ${formatNumber(row.value)}${showShare ? ` (${row.share.toFixed(2)}%)` : ''}`}</title></circle>;
          })}
          <circle cx="50" cy="50" r="22" fill="white" />
          <text x="50" y="49" textAnchor="middle" fontSize="9" fontWeight="700" fill="#111111">{formatNumber(distribution.total)}</text>
          <text x="50" y="57" textAnchor="middle" fontSize="4.5" fill="#94a3b8">TOTAL</text>
        </svg>}
      </div>
      <div className="min-w-0 flex-1 space-y-2.5 py-2">
        {distribution.rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 text-[12px]"><div className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.color }} />{row.label}</div><span className="font-semibold text-slate-900">{formatNumber(row.value)}{showShare && <span className="font-normal text-slate-400"> ({row.share.toFixed(2)}%)</span>}</span></div>)}
        {extraRows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 text-[12px]"><div className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.color }} />{row.label}</div><span className="font-semibold text-slate-900">{formatNumber(row.value)}</span></div>)}
      </div>
    </div>
  );
};

const DistributionBars: React.FC<{ distribution: DashboardDistribution; colors?: string[]; ariaLabel: string }> = ({ distribution, colors, ariaLabel }) => {
  const max = Math.max(1, ...distribution.rows.map((row) => row.value));
  if (distribution.total === 0) return <div className="grid h-[150px] place-items-center rounded-lg border border-dashed border-slate-200 text-center"><div><div className="text-xs font-semibold text-slate-500">No recorded data</div><div className="mt-1 text-[10px] text-slate-400">No data is available for this chart yet.</div></div></div>;
  return <svg viewBox="0 0 220 130" className="h-[190px] w-full" role="img" aria-label={ariaLabel}>
    {[0, 1, 2, 3].map((line) => <line key={line} x1="20" x2="200" y1={line * 28 + 12} y2={line * 28 + 12} stroke="#e5e7eb" strokeDasharray="2 3" />)}
    {distribution.rows.map((row, index) => {
      const slotWidth = 180 / Math.max(distribution.rows.length, 1);
      const height = row.value > 0 ? Math.max((row.value / max) * 82, 1.5) : 0;
      const x = 20 + index * slotWidth + slotWidth / 2 - 10;
      const labelParts = row.label.split(' ');
      return <g key={row.label} transform={`translate(${x}, 0)`}><rect className="chart-bar" x="0" y={94 - height} width="20" height={height} fill={colors?.[index] || row.color} rx="3"><title>{`${row.label}: ${formatNumber(row.value)} (${row.share.toFixed(2)}%)`}</title></rect><text x="10" y={Math.max(8, 89 - height)} textAnchor="middle" fontSize="6.5" fontWeight="600" fill="#111111">{formatNumber(row.value)}</text><text x="10" y="108" textAnchor="middle" fontSize="6.5" fill="#64748b">{labelParts[0]}</text>{labelParts.length > 1 && <text x="10" y="116" textAnchor="middle" fontSize="5.5" fill="#64748b">{labelParts.slice(1).join(' ')}</text>}<text x="10" y="125" textAnchor="middle" fontSize="5.5" fill="#94a3b8">{row.share.toFixed(2)}%</text></g>;
    })}
  </svg>;
};

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);
const formatMwh = (capacityKwh: number) => `${(capacityKwh / 1000).toFixed(2)} MWh`;
const formatCellTotalMwh = (capacityKwh: number) => `${(Math.ceil((capacityKwh / 1000) * 10) / 10).toFixed(1)}MWh`;
const formatCellRowMwh = (capacityKwh: number) => `${(capacityKwh / 1000).toFixed(2)}MWh`;
const formatShare = (value: number, total: number) => `${((value / Math.max(1, total)) * 100).toFixed(2)}%`;
export const CEOMonitoringView: React.FC = () => {
  const { refreshKey, addNotification } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingCells, setExportingCells] = useState(false);
  const [exportingBatteryReport, setExportingBatteryReport] = useState(false);
  const [exportingRackReport, setExportingRackReport] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCellStatus, setSelectedCellStatus] = useState<'All' | string>('All');
  const [selectedPackType, setSelectedPackType] = useState('All');
  const [selectedRackType, setSelectedRackType] = useState('All');
  const [selectedWarehouseRackType, setSelectedWarehouseRackType] = useState('All');
  const [selectedWarehouseInventoryType, setSelectedWarehouseInventoryType] = useState<'All' | 'Racks' | 'Battery Packs'>('All');
  const [selectedWarehouseBatteryType, setSelectedWarehouseBatteryType] = useState('All');
  const [selectedModuleConfig, setSelectedModuleConfig] = useState('All');
  const [selectedSoldEntity, setSelectedSoldEntity] = useState('All');
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await api.getDashboardStats();
        if (!cancelled) {
          setStats(res);
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

    const handleVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshKey]);

  const source = stats ?? {};
  const inventory = source.inventory ?? {};
  const quality = source.quality ?? {};
  const orders = source.orders ?? {};
  const production = source.production ?? {};
  const attention = source.attention ?? {};
  const kpis = source.kpis ?? {};

  const scaleValue = (value: number) => Math.max(0, Math.round(value));

  const capacityProduced = numberOr(production.capacityProducedKwh);
  const completedBatteries = numberOr(source.completedBatteriesTotal ?? production.completedBatteries ?? inventory.finishedBatteries);
  const targetBatteries = numberOr(production.targetBatteries);
  const batteryProgress = targetBatteries > 0 ? clamp((completedBatteries / targetBatteries) * 100, 0, 100) : null;
  const inStockCells = scaleValue(numberOr(source.cellBuckets?.find((row: any) => row.label === 'In Stock')?.value));
  const floorStockCells = scaleValue(numberOr(source.cellBuckets?.find((row: any) => row.label === 'Floor Stock')?.value));
  const completedOrders = scaleValue(numberOr(orders.completed));
  const totalOrders = scaleValue(numberOr(orders.total));
  const remainingOrders = Math.max(0, totalOrders - completedOrders);
  const orderCompletion = totalOrders > 0 ? clamp((completedOrders / totalOrders) * 100, 0, 100) : 0;
  const openRisks = scaleValue(numberOr(attention.openQuarantines ?? source.quarantineOpenCount ?? quality.quarantinedCount));
  const delayedOrders = scaleValue(numberOr(attention.delayedOrders));
  const qcIssues = scaleValue(numberOr(attention.qcIssues));
  const riskDetails = [
    openRisks > 0 ? `${formatNumber(openRisks)} quarantine` : '',
    delayedOrders > 0 ? `${formatNumber(delayedOrders)} delayed orders` : '',
    qcIssues > 0 ? `${formatNumber(qcIssues)} QC issues` : '',
  ].filter(Boolean).join(' · ') || 'No active risks';
  const lastUpdated = source.updatedAt ? new Date(source.updatedAt).toLocaleString() : 'Live';

  const cellRows = useMemo<ChartRow[]>(() => (source.cellBuckets || []).map((row: any) => ({ label: String(row.label || ''), value: numberOr(row.value), color: statusColors[row.label] || '#64748b' })), [source.cellBuckets]);
  const filteredCellRows = selectedCellStatus === 'All' ? cellRows : cellRows.filter((row) => row.label === selectedCellStatus);
  const cellDistribution = useMemo(() => buildDashboardDistribution(
    filteredCellRows,
    Object.entries(statusColors).map(([label, color]) => ({ label, color })),
    selectedCellStatus === 'All' ? source.cellTotal : undefined,
  ), [cellRows, filteredCellRows, selectedCellStatus, source.cellTotal]);
  const warehouseRows = useMemo<ChartRow[]>(() => {
    const typeRows = Array.isArray(source.inventory?.warehouseRackTypeCounts) ? source.inventory.warehouseRackTypeCounts : [];
    const selectedType = typeRows.find((row: any) => row.type === selectedWarehouseRackType);
    const batteryTypeRows = Array.isArray(source.inventory?.warehouseBatteryTypeCounts) ? source.inventory.warehouseBatteryTypeCounts : [];
    const selectedBatteryType = batteryTypeRows.find((row: any) => row.type === selectedWarehouseBatteryType);
    const rackKarachi = selectedWarehouseRackType === 'All' ? numberOr(source.inventory?.karachiWarehouseRacks, 0) : numberOr(selectedType?.KARACHI, 0);
    const rackLahore = selectedWarehouseRackType === 'All' ? numberOr(source.inventory?.lahoreWarehouseRacks, 0) : numberOr(selectedType?.LAHORE, 0);
    const batteryKarachi = selectedWarehouseBatteryType === 'All' ? numberOr(source.inventory?.karachiWarehouseBatteries, 0) : numberOr(selectedBatteryType?.KARACHI, 0);
    const batteryLahore = selectedWarehouseBatteryType === 'All' ? numberOr(source.inventory?.lahoreWarehouseBatteries, 0) : numberOr(selectedBatteryType?.LAHORE, 0);
    const karachiValue = selectedWarehouseInventoryType === 'Racks' ? rackKarachi : selectedWarehouseInventoryType === 'Battery Packs' ? batteryKarachi : rackKarachi + batteryKarachi;
    const lahoreValue = selectedWarehouseInventoryType === 'Racks' ? rackLahore : selectedWarehouseInventoryType === 'Battery Packs' ? batteryLahore : rackLahore + batteryLahore;

    const rows: ChartRow[] = [
      { label: 'Karachi Warehouse', value: karachiValue, color: statusColors['Karachi Warehouse'] || '#14532d' },
      { label: 'Lahore Warehouse', value: lahoreValue, color: statusColors['Lahore Warehouse'] || '#2563eb' },
    ];

    return rows.filter((row) => row.value > 0 || (source.inventory && (source.inventory.karachiWarehouseRacks !== undefined || source.inventory.lahoreWarehouseRacks !== undefined)));
  }, [source.inventory, selectedWarehouseInventoryType, selectedWarehouseRackType, selectedWarehouseBatteryType]);

  const warehouseRackTypeOptions = useMemo(() => {
    const types = Array.isArray(source.inventory?.warehouseRackTypeCounts) ? source.inventory.warehouseRackTypeCounts.map((row: any) => String(row.type || '')) : [];
    return ['All', ...types.filter(Boolean).filter(type => type !== 'UNKNOWN_RACK')];
  }, [source.inventory]);

  const warehouseRackTypeLabel = (type: string) => {
    const match = type.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
    return match ? `${match[1]} kWh` : type.replace(/^RACK_/i, '').replace(/_/g, ' ');
  };
  const warehouseBatteryTypeOptions = useMemo(() => {
    const types = Array.isArray(source.inventory?.warehouseBatteryTypeCounts) ? source.inventory.warehouseBatteryTypeCounts.map((row: any) => String(row.type || '')) : [];
    return ['All', ...types.filter(Boolean)];
  }, [source.inventory]);

  const warehouseDistribution = useMemo(() => buildDashboardDistribution(
    warehouseRows,
    warehouseRows.map(row => ({ label: row.label, color: row.color })),
    warehouseRows.reduce((sum, row) => sum + row.value, 0),
  ), [warehouseRows]);
  const moduleData = useMemo<ChartRow[]>(() => (source.moduleTypeBuckets || source.moduleStatusBuckets || []).map((row: any) => ({ label: String(row.label || ''), value: numberOr(row.value), color: '#16a34a' })), [source.moduleTypeBuckets, source.moduleStatusBuckets]);
  const filteredModuleRows = selectedModuleConfig === 'All' ? moduleData : moduleData.filter((row) => row.label === selectedModuleConfig);
  const moduleDistribution = useMemo(() => buildDashboardDistribution(
    filteredModuleRows,
    [{ label: '8S', color: '#16a34a' }, { label: '12S', color: '#2563eb' }],
    selectedModuleConfig === 'All' ? source.moduleTotal : undefined,
  ), [filteredModuleRows, selectedModuleConfig, source.moduleTotal]);
  const soldData = useMemo<ChartRow[]>(() => {
    const soldCells = numberOr(inventory.soldCells ?? source.cellBuckets?.find((row: any) => row.label === 'Sold')?.value);
    const soldBatteries = numberOr(source.batteryStatusBuckets?.find((row: any) => String(row.label || '').toUpperCase() === 'SOLD')?.value);
    const soldRacks = (source.rackStatusBuckets || [])
      .filter((row: any) => String(row.label || row.status || '').toUpperCase().replace(/_/g, ' ') === 'SOLD')
      .reduce((total: number, row: any) => total + numberOr(row.value), 0);
    return [
      { label: 'Cells', value: soldCells, color: '#059669' },
      { label: 'Battery Packs', value: soldBatteries, color: '#f59e0b' },
      { label: 'Racks', value: soldRacks, color: '#0ea5e9' },
    ];
  }, [inventory.soldCells, source.batteryStatusBuckets, source.cellBuckets, source.rackStatusBuckets]);
  const filteredSoldRows = selectedSoldEntity === 'All' ? soldData : soldData.filter(row => row.label === selectedSoldEntity);
  const soldDistribution = useMemo(() => buildDashboardDistribution(
    filteredSoldRows,
    soldData.map(row => ({ label: row.label, color: row.color })),
    selectedSoldEntity === 'All' ? undefined : filteredSoldRows.reduce((total, row) => total + row.value, 0),
  ), [filteredSoldRows, selectedSoldEntity, soldData]);
  const batteryPackData = useMemo<ChartRow[]>(() => (source.batteryPackBuckets || []).map((row: any, index: number) => ({
    label: String(row.label || 'Unnamed Pack'),
    value: numberOr(row.value),
    color: packColorByModel[String(row.label || '')] || packColors[index % packColors.length],
  })), [source.batteryPackBuckets]);
  const filteredBatteryPackRows = selectedPackType === 'All' ? batteryPackData : batteryPackData.filter((row) => row.label === selectedPackType);
  const batteryPackDistribution = useMemo(() => buildDashboardDistribution(
    filteredBatteryPackRows,
    batteryPackData.map(row => ({ label: row.label, color: row.color })),
    selectedPackType === 'All' ? source.batteryPackTotal : undefined,
  ), [batteryPackData, filteredBatteryPackRows, selectedPackType, source.batteryPackTotal]);
  const releasedTrend = Array.isArray(source.batteryPackTrend) ? source.batteryPackTrend : [];
  const releasedTrendValues = releasedTrend.map((point: any) => (point.series || []).reduce((sum: number, row: any) => sum + numberOr(row.value), 0));
  const recentTrendTotal = releasedTrendValues.slice(-7).reduce((sum: number, value: number) => sum + value, 0);
  const previousTrendTotal = releasedTrendValues.slice(-14, -7).reduce((sum: number, value: number) => sum + value, 0);
  const releaseTrendChange = previousTrendTotal > 0 ? ((recentTrendTotal - previousTrendTotal) / previousTrendTotal) * 100 : null;

  const rackData = useMemo<ChartRow[]>(() => {
    const totals = new Map<string, number>();
    (source.rackStatusBuckets || []).forEach((row: any) => {
      const rackTypes = Array.isArray(row.rackTypes) ? row.rackTypes : [];
      rackTypes.forEach((type: any) => {
        const rackType = String(type.rackType || 'UNKNOWN_RACK');
        const match = rackType.match(/RACK_(25|45|60|70)KWH/i);
        if (match) totals.set(match[1], (totals.get(match[1]) || 0) + numberOr(type.value));
      });
    });
    return Array.from(totals.entries()).filter(([, value]) => value > 0).map(([power, value]) => ({
      label: `${power} kWh ${power === '25' ? 'Rack' : 'Cabinet'}`,
      value,
      color: rackPowerColors[power] || '#64748b',
    }));
  }, [source.rackStatusBuckets]);
  const filteredRackRows = selectedRackType === 'All' ? rackData : rackData.filter((row) => row.label === selectedRackType);
  const rackDistribution = useMemo(() => buildDashboardDistribution(
    filteredRackRows,
    rackData.map(row => ({ label: row.label, color: row.color })),
    filteredRackRows.reduce((total, row) => total + row.value, 0),
  ), [filteredRackRows, rackData]);
  const rackTotal = rackDistribution.total;
  const producedCategoryBuckets = Array.isArray(source.producedCategoryBuckets) ? source.producedCategoryBuckets : [];
  const cabinetProduced = numberOr(producedCategoryBuckets.find((row: any) => row.label === 'Cabinet')?.value);
  const rackProduced = numberOr(producedCategoryBuckets.find((row: any) => row.label === 'Rack')?.value);

  const kpiCards = [
    { label: 'Nominal Capacity Produced', value: `${formatNumber(capacityProduced)} kWh`, delta: 'Nominal capacity produced · Live', positive: true, icon: <Zap className="h-5 w-5 text-emerald-600" />, bg: '#f0fdf4' },
    { label: 'Battery Packs Produced', value: formatNumber(scaleValue(completedBatteries)), delta: releaseTrendChange === null ? (targetBatteries > 0 ? `${batteryProgress?.toFixed(1)}% of target` : 'Produced/warehouse · Live') : `${releaseTrendChange >= 0 ? '+' : ''}${releaseTrendChange.toFixed(1)}% vs prior 7 days`, positive: releaseTrendChange === null || releaseTrendChange >= 0, icon: <Factory className="h-5 w-5 text-blue-600" />, bg: '#eff6ff' },
    { label: 'Cabinet Produced', value: formatNumber(scaleValue(cabinetProduced)), delta: '7.5 kWh battery packs · Live', positive: true, icon: <PackageCheck className="h-5 w-5 text-violet-600" />, bg: '#f5f3ff' },
    { label: 'Rack Produced', value: formatNumber(scaleValue(rackProduced)), delta: '5 kWh battery packs · Live', positive: true, icon: <PackageCheck className="h-5 w-5 text-cyan-600" />, bg: '#ecfeff' },
    { label: 'In Stock Cells', value: formatNumber(inStockCells), delta: 'Inventory · In stock · Live', positive: true, icon: <Boxes className="h-5 w-5 text-amber-600" />, bg: '#fff7ed' },
    { label: 'Floor Stock Cells', value: formatNumber(floorStockCells), delta: 'Inventory · Floor stock · Live', positive: true, icon: <Boxes className="h-5 w-5 text-orange-600" />, bg: '#fff7ed' },
  ];

  const exportCellReport = async () => {
    setExportingCells(true);
    try {
      const [cells, counts, warehouseStatuses] = await Promise.all([
        api.getCells(),
        api.getCellCounts(),
        api.getWarehouseCellStatuses(),
      ]);
      downloadCellReport(cells, {
        rows: (source.cellBuckets || []).map((row: any) => ({ label: String(row.label || ''), value: Number(row.value) || 0 })),
        total: Number(source.cellTotal || inventory.totalCells || counts.total || 0),
      }, { warehouseStatuses });
      addNotification('success', 'Cell report exported', `${counts.total.toLocaleString()} cell records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Cell export failed', error?.message || 'Unable to export the cell inventory report.');
    } finally {
      setExportingCells(false);
    }
  };

  const exportBatteryReport = async () => {
    setExportingBatteryReport(true);
    try {
      const [batteries, warehouseStatuses] = await Promise.all([api.getBatteries(), api.getWarehouseEntityStatuses()]);
      downloadBatteryReport(batteries, { warehouseStatuses });
      addNotification('success', 'Battery report exported', `${batteries.length.toLocaleString()} battery records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Battery export failed', error?.message || 'Unable to export the battery report.');
    } finally {
      setExportingBatteryReport(false);
    }
  };

  const exportRackReport = async () => {
    setExportingRackReport(true);
    try {
      const [racks, warehouseStatuses] = await Promise.all([api.getRacks(), api.getWarehouseEntityStatuses()]);
      downloadRackReport(racks, { warehouseStatuses });
      addNotification('success', 'Rack report exported', `${racks.length.toLocaleString()} rack records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Rack export failed', error?.message || 'Unable to export the rack report.');
    } finally {
      setExportingRackReport(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const reportDate = new Date().toISOString().slice(0, 10);
      const rangeLabel = 'All available data';
      const quarantineRecords = await api.getQuarantineRecords().catch(() => []);
      const reusableScrapCount = quarantineRecords.filter((record: any) => ['RELEASE_APPROVED', 'REWORK'].includes(String(record.disposition || '').toUpperCase())).length;
      const damageScrapCount = Math.max(0, quarantineRecords.length - reusableScrapCount);
      const statusRows = (statuses: string[], sourceRows: any[], colorMap: Record<string, string>, defaultCapacityKwh: (status: string) => number = () => 0) => {
        const values = new Map((sourceRows || []).map((row: any) => [String(row.label).replace(/_/g, ' ').toUpperCase(), { value: numberOr(row.value), capacityKwh: numberOr(row.capacityKwh) }]));
        return statuses.map((status) => ({
          label: status.replace(/_/g, ' '),
          value: values.get(status.replace(/_/g, ' ').toUpperCase())?.value || 0,
          capacityKwh: values.get(status.replace(/_/g, ' ').toUpperCase())?.capacityKwh || (values.get(status.replace(/_/g, ' ').toUpperCase())?.value || 0) * defaultCapacityKwh(status),
          color: Object.entries(colorMap).find(([label]) => label.toUpperCase() === status.replace(/_/g, ' ').toUpperCase())?.[1] || '#94a3b8',
        }));
      };
      const cellReportRows = statusRows(
        ['In Stock', 'Floor Stock', 'In Module', 'In Pack', 'In Rack', 'Karachi Warehouse', 'Lahore Warehouse', 'Sold', 'Scrap'],
        source.cellBuckets,
        statusColors,
        () => 0.3125,
      ).map((row) => row.label === 'Scrap' ? { ...row, label: 'Scrap / Recycle' } : row);
      const moduleReportRows = statusRows(
        ['8S', '12S'],
        source.moduleTypeBuckets,
        { '8S': reportDarkGrey, '12S': reportGreen },
        (status) => status === '12S' ? 3.75 : 2.5,
      );
      const batteryReportRows = (source.batteryPackBuckets || []).map((row: any, index: number) => {
        const label = String(row.label || 'Unnamed Pack');
        return {
          label,
          value: numberOr(row.value),
          capacityKwh: numberOr(row.capacityKwh),
          color: index % 2 === 0 ? reportGreen : reportDarkGrey,
        };
      });
      const cabinetReportRows = [{
        label: 'Cabinet · 7.5 kWh batteries',
        value: cabinetProduced,
        capacityKwh: cabinetProduced * 7.5,
        color: reportGreen,
      }];
      const scrapReportRows = [
        { label: 'Damage', value: damageScrapCount, capacityKwh: 0, color: reportDarkGrey },
        { label: 'Reusable', value: reusableScrapCount, capacityKwh: 0, color: reportGreen },
      ];
      const soldReportRows = [
        { label: 'Battery Packs', value: numberOr(source.batteryStatusBuckets?.find((row: any) => String(row.label || '').toUpperCase() === 'SOLD')?.value), capacityKwh: 0, color: reportDarkGrey },
        { label: 'Racks', value: numberOr(source.rackStatusBuckets?.find((row: any) => String(row.label || row.status || '').toUpperCase().replace(/_/g, ' ') === 'SOLD')?.value), capacityKwh: 0, color: reportCabinetBlue },
      ];
      const rackTypeTotals = new Map<string, { value: number; capacityKwh: number }>();
      const rackColor = (rackType: string) => {
        const powerMatch = rackType.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
        return (powerMatch && rackPowerColors[powerMatch[1]]) || reportCabinetBlue;
      };
      const formatRackLabel = (rackType: string) => {
        const powerMatch = rackType.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
        const power = powerMatch ? `${powerMatch[1]}kWh` : rackType.replace(/^RACK_/i, '').replace(/_/g, ' ');
        const category = /RACK_25KWH/i.test(rackType) ? 'Rack' : 'Cabinet';
        return `${power.replace('kWh', ' kWh')} ${category}`;
      };
      (source.rackStatusBuckets || []).forEach((row: any) => {
        const typeRows = Array.isArray(row.rackTypes) ? row.rackTypes : [];
        typeRows.forEach((type: any) => {
          const rackType = String(type.rackType || 'UNKNOWN_RACK');
          if (!/RACK_(25|45|60|70)KWH/i.test(rackType)) return;
          const current = rackTypeTotals.get(rackType) || { value: 0, capacityKwh: 0 };
          current.value += numberOr(type.value);
          current.capacityKwh += numberOr(type.capacityKwh);
          rackTypeTotals.set(rackType, current);
        });
      });
      const rackReportRows = Array.from(rackTypeTotals.entries()).map(([rackType, totals]) => ({
        label: formatRackLabel(rackType),
        ...totals,
        color: rackColor(rackType),
      }));
      const controllerInventory = source.controllerInventory || {};
      const bmsTotal = numberOr(controllerInventory.totalBms);
      const bmuTotal = numberOr(controllerInventory.totalBmu);
      const bmsAvailable = numberOr(controllerInventory.availableBms);
      const bmuAvailable = numberOr(controllerInventory.availableBmu);
      const bmsReportRows = [
        { label: 'Total', value: bmsTotal, capacityKwh: 0, color: reportDarkGrey },
        { label: 'Available', value: bmsAvailable, capacityKwh: 0, color: reportGreen },
        { label: 'Used', value: Math.max(0, bmsTotal - bmsAvailable), capacityKwh: 0, color: reportDarkGrey },
      ];
      const bmuReportRows = [
        { label: 'Total', value: bmuTotal, capacityKwh: 0, color: reportDarkGrey },
        { label: 'Available', value: bmuAvailable, capacityKwh: 0, color: reportGreen },
        { label: 'Used', value: Math.max(0, bmuTotal - bmuAvailable), capacityKwh: 0, color: reportDarkGrey },
      ];
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;
      const chartGap = 10;
      const chartWidth = (pageWidth - margin * 2 - chartGap) / 2;
      const leftChartX = margin;
      const rightChartX = margin + chartWidth + chartGap;
      const green = [16, 157, 105] as const;
      const ink = [15, 23, 42] as const;
      const muted = [71, 85, 105] as const;
      const light = [240, 250, 246] as const;
      const border = [203, 213, 225] as const;
      const hexRgb = (hex: string): [number, number, number] => {
        const value = hex.replace('#', '');
        return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
      };
      const reportFontSize = (size: number) => doc.setFontSize(size * 1.08);
      const drawTitle = (title: string, subtitle: string) => {
        doc.setFillColor(...ink);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setFillColor(...green);
        doc.rect(0, 24, pageWidth, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        reportFontSize(18);
        doc.text(title, margin, 11);
        doc.setFont('helvetica', 'normal');
        reportFontSize(8);
        doc.text(subtitle, margin, 18);
        doc.setTextColor(...ink);
      };
      const drawDonut = (x: number, y: number, radius: number, rows: { label: string; value: number; capacityKwh: number; color: string }[], title: string, legendOnRight = false, legendRightX = pageWidth - margin, showShare = true, capacityFormatter = formatMwh, includeValueInLegend = false, rightLegendOffset = -25) => {
        const total = rows.reduce((sum, row) => sum + row.value, 0);
        const totalCapacityKwh = rows.reduce((sum, row) => sum + row.capacityKwh, 0);
        if (total === 0) {
          doc.setFont('helvetica', 'bold');
          reportFontSize(9);
          doc.setTextColor(...ink);
          doc.text(title, x - radius, y - radius - 10);
          doc.setFont('helvetica', 'normal');
          reportFontSize(8);
          doc.setTextColor(...muted);
          doc.text('No recorded data', x, y, { align: 'center' });
          return;
        }
        const chartTotal = total;
        let start = -Math.PI / 2;
        doc.setFont('helvetica', 'bold');
        reportFontSize(9);
        doc.text(title, x - radius, y - radius - 10);
        rows.forEach((row) => {
          const end = start + (row.value / chartTotal) * Math.PI * 2;
          doc.setFillColor(...hexRgb(row.color));
          for (let angle = start; angle < end; angle += 0.035) {
            const next = Math.min(angle + 0.04, end);
            const points = [[x, y], [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius], [x + Math.cos(next) * radius, y + Math.sin(next) * radius]];
            doc.triangle(points[0][0], points[0][1], points[1][0], points[1][1], points[2][0], points[2][1], 'F');
          }
          start = end;
        });
        doc.setFillColor(255, 255, 255);
        doc.circle(x, y, radius * 0.58, 'F');
        doc.setTextColor(...ink);
        doc.setFont('helvetica', 'bold');
        reportFontSize(13);
        doc.text(formatNumber(total), x, y + 2, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        reportFontSize(6);
        doc.text('TOTAL', x, y + 7, { align: 'center' });
        reportFontSize(5);
        doc.text(capacityFormatter(totalCapacityKwh), x, y + 25, { align: 'center' });
        rows.slice(0, 8).forEach((row, index) => {
          if (legendOnRight) {
            const legendX = x + radius + 4;
            const legendY = y + rightLegendOffset + index * 10;
            doc.setFillColor(...hexRgb(row.color));
            doc.roundedRect(legendX, legendY - 3, 2.5, 2.5, 0.5, 0.5, 'F');
            doc.setFont('helvetica', 'normal');
            reportFontSize(includeValueInLegend ? 5.4 : 5.8);
            doc.setTextColor(...muted);
            if (includeValueInLegend) {
              doc.text(`${row.label} (${formatCellRowMwh(row.capacityKwh)}) ${formatNumber(row.value)}`, legendX + 5, legendY, { maxWidth: legendRightX - legendX - 7 });
              return;
            }
            doc.text(row.label, legendX + 5, legendY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...ink);
            doc.text(formatNumber(row.value), legendRightX - 23, legendY + 1, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...muted);
            doc.text(formatMwh(row.capacityKwh), legendRightX, legendY + 1, { align: 'right' });
            return;
          }
          const legendColumn = index < 4 ? 0 : 1;
          const legendIndex = index % 4;
          const legendX = x - radius - 13 + legendColumn * 35;
          const legendY = y + radius + 8 + legendIndex * 5;
          doc.setFillColor(...hexRgb(row.color));
          doc.rect(legendX, legendY - 3, 2, 2, 'F');
          doc.setFont('helvetica', 'normal');
          reportFontSize(5.2);
          doc.setTextColor(...muted);
          doc.text(`${row.label} ${formatNumber(row.value)} · ${formatMwh(row.capacityKwh)}`, legendX + 3, legendY);
        });
      };
      const drawBars = (x: number, y: number, width: number, height: number, rows: { label: string; value: number; capacityKwh: number; color: string }[], title: string, compactSingle = false, showEnergy = true, preserveOrder = false, narrowBars = false) => {
        doc.setFont('helvetica', 'bold');
        reportFontSize(9);
        doc.setTextColor(...ink);
        doc.text(title, x, y - 16);
        const visibleRows = (preserveOrder ? [...rows] : [...rows].sort((left, right) => right.value - left.value)).slice(0, 6);
        if (!visibleRows.length || visibleRows.every((row) => row.value <= 0)) {
          doc.setFont('helvetica', 'normal');
          reportFontSize(8);
          doc.setTextColor(...muted);
          doc.text('No recorded data', x, y + height / 2);
          return;
        }
        const max = Math.max(...visibleRows.map((row) => row.value), 1);
        const singleRecord = compactSingle && visibleRows.length === 1;
        const gridColumns = !singleRecord && visibleRows.length > 4 ? 3 : visibleRows.length;
        const gridRows = Math.ceil(visibleRows.length / Math.max(gridColumns, 1));
        const cellWidth = width / Math.max(gridColumns, 1);
        const cellHeight = height / Math.max(gridRows, 1);
        const barWidth = singleRecord ? Math.min(28, width * 0.32) : Math.min(narrowBars ? 12 : 18, cellWidth - 5);
        const plotHeight = singleRecord ? Math.min(height, 22) : Math.max(8, cellHeight - 12);
        visibleRows.forEach((row, index) => {
          const hasValue = row.value > 0;
          const barHeight = hasValue ? Math.max((row.value / max) * plotHeight, 1.5) : 1.2;
          const gridColumn = index % gridColumns;
          const gridRow = Math.floor(index / gridColumns);
          const cellX = x + gridColumn * cellWidth;
          const cellY = y + gridRow * cellHeight;
          const barX = singleRecord ? x + (width - barWidth) / 2 : cellX + (cellWidth - barWidth) / 2;
          const baseline = singleRecord ? y + height : cellY + cellHeight - 12;
          doc.setFillColor(...hexRgb(hasValue ? row.color : '#e2e8f0'));
          doc.roundedRect(barX, baseline - barHeight, barWidth, barHeight, 1.5, 1.5, 'F');
          const barTop = baseline - barHeight;
          doc.setFont('helvetica', 'bold');
          reportFontSize(7);
          doc.setTextColor(...muted);
          doc.text(formatNumber(row.value), barX + barWidth / 2, barTop - 6, { align: 'center' });
          if (showEnergy) {
            doc.setFont('helvetica', 'normal');
            reportFontSize(5);
            doc.text(formatMwh(row.capacityKwh), barX + barWidth / 2, barTop - 2, { align: 'center' });
          }
          reportFontSize(5.8);
          doc.text(row.label, cellX + cellWidth / 2, baseline + 4, { align: 'center', maxWidth: cellWidth - 3 });
        });
      };
      const drawSingleKpi = (x: number, y: number, width: number, rows: { label: string; value: number; capacityKwh: number; color: string }[], title: string) => {
        const row = rows[0];
        doc.setFont('helvetica', 'bold');
        reportFontSize(9);
        doc.setTextColor(...ink);
        doc.text(title, x, y - 16);
        if (!row) {
          doc.setFont('helvetica', 'normal');
          reportFontSize(7);
          doc.setTextColor(...muted);
          doc.text('No recorded data', x + width / 2, y + 10, { align: 'center' });
          return;
        }
        doc.setFillColor(...light);
        doc.roundedRect(x, y - 8, width, 25, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        reportFontSize(16);
        doc.setTextColor(...ink);
        doc.text(formatNumber(row.value), x + 8, y + 3);
        doc.setFont('helvetica', 'normal');
        reportFontSize(6.5);
        doc.setTextColor(...muted);
        doc.text(row.label, x + 8, y + 10, { maxWidth: width - 16 });
        reportFontSize(6);
        doc.text(formatMwh(row.capacityKwh), x + width - 8, y + 3, { align: 'right' });
        reportFontSize(5.8);
        doc.text('Nominal capacity', x + width - 8, y + 10, { align: 'right' });
      };
      const drawTable = (title: string, columns: string[], rows: string[][], y: number, x = margin, tableWidth = pageWidth - margin * 2, compact = false) => {
        doc.setFont('helvetica', 'bold');
        reportFontSize(compact ? 7.5 : 10);
        doc.setTextColor(...ink);
        if (title) doc.text(title, x, y);
        const columnWidths = columns.length === 3
          ? [tableWidth * 0.5, tableWidth * 0.2, tableWidth * 0.3]
          : columns.map(() => tableWidth / columns.length);
        const rowText = rows.map((row) => row.map((value, index) => doc.splitTextToSize(String(value), columnWidths[index] - 4)));
        const rowHeights = rowText.map((row) => compact ? Math.max(4.8, Math.min(9.6, Math.max(...row.map((lines) => lines.length)) * 4.8)) : 7);
        const headerHeight = compact ? 4.8 : 7;
        doc.setFillColor(...ink);
        doc.rect(x, y + 3, tableWidth, headerHeight, 'F');
        reportFontSize(compact ? 5.8 : 7);
        doc.setTextColor(255, 255, 255);
        let columnOffset = 0;
        columns.forEach((column, index) => {
          doc.text(column, x + columnOffset + 2, y + (compact ? 6 : 8));
          columnOffset += columnWidths[index];
        });
        let rowY = y + (compact ? 7 : 10);
        rowText.forEach((row, rowIndex) => {
          const rowHeight = rowHeights[rowIndex];
          const rowColor: [number, number, number] = rowIndex % 2 ? [250, 250, 250] : [255, 255, 255];
          doc.setFillColor(...rowColor);
          doc.rect(x, rowY, tableWidth, rowHeight, 'F');
          doc.setTextColor(...muted);
          let cellOffset = 0;
          row.forEach((lines, index) => {
            doc.text(lines, x + cellOffset + 2, rowY + (compact ? 3.2 : 5), { lineHeightFactor: 1.05 });
            cellOffset += columnWidths[index];
          });
          rowY += rowHeight;
        });
        doc.setDrawColor(...border);
        doc.setLineWidth(0.2);
        doc.rect(x, y + 3, tableWidth, headerHeight + rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0));
      };

      drawTitle('POWER2GO MES | CEO PERFORMANCE REPORT', `Reporting range: ${rangeLabel}   |   Generated: ${reportDate}`);
      doc.setFont('helvetica', 'bold');
      reportFontSize(9);
      doc.setTextColor(...green);
      doc.text('EXECUTIVE SNAPSHOT', margin, 34);
      kpiCards.filter((card) => !['First-Pass Quality Yield', 'Cell Scrap / Recycle Rate'].includes(card.label)).forEach((card, index) => {
        const cardWidth = (pageWidth - margin * 2 - 6) / 2;
        const x = margin + (index % 2) * (cardWidth + 6);
        const y = 39 + Math.floor(index / 2) * 25;
        doc.setFillColor(...light);
        doc.roundedRect(x, y, cardWidth, 20, 2, 2, 'F');
        doc.setTextColor(...muted);
        doc.setFont('helvetica', 'normal');
        reportFontSize(7);
        doc.text(card.label, x + 3, y + 7, { maxWidth: cardWidth - 6 });
        doc.setTextColor(...ink);
        doc.setFont('helvetica', 'bold');
        reportFontSize(12);
        doc.text(card.value, x + 3, y + 15);
      });
      doc.setFont('helvetica', 'bold');
      reportFontSize(9);
      doc.setTextColor(...green);
      drawDonut(leftChartX + 23, 150, 20, cellReportRows, 'CELL INVENTORY', true, leftChartX + chartWidth, false, formatCellTotalMwh, true);
      drawBars(rightChartX, 136, chartWidth, 36, moduleReportRows, 'MODULE CONFIGURATION');
      drawBars(leftChartX, 230, chartWidth, 36, batteryReportRows, 'BATTERY PACK MODEL');
      drawDonut(rightChartX + 23, 244, 20, rackReportRows, 'RACK/CABINET STATUS', true, rightChartX + chartWidth, false, formatMwh, true, -15);
      doc.addPage();
      drawTitle('POWER2GO MES | CEO PERFORMANCE REPORT', `Operational detail   |   ${rangeLabel}   |   ${reportDate}`);
      drawSingleKpi(leftChartX, 70, chartWidth, cabinetReportRows, 'CABINET STATUS');
      drawBars(leftChartX, 171, chartWidth, 34, bmsReportRows, 'BMS INVENTORY - TOTAL / AVAILABLE / USED', false, false, true);
      drawBars(rightChartX, 171, chartWidth, 34, bmuReportRows, 'BMU INVENTORY - TOTAL / AVAILABLE / USED', false, false, true);
      drawBars(leftChartX, 230, chartWidth, 32, scrapReportRows, 'SCRAP STATUS');
      drawBars(rightChartX, 230, chartWidth, 32, soldReportRows, 'SOLD STATUS');
      const reportRows = (rows: { label: string; value: number; capacityKwh: number }[]) => {
        const total = rows.reduce((summary, row) => ({
          value: summary.value + row.value,
          capacityKwh: summary.capacityKwh + row.capacityKwh,
        }), { value: 0, capacityKwh: 0 });
        return [
          ...rows.map((row) => [row.label, formatNumber(row.value), formatMwh(row.capacityKwh)]),
          ['TOTAL', formatNumber(total.value), formatMwh(total.capacityKwh)],
        ];
      };
      const detailWidth = (pageWidth - margin * 2 - 6) / 2;
      drawTable('CELL INVENTORY', ['Status', 'Qty', 'Capacity'], reportRows(cellReportRows), 39, margin, detailWidth, true);
      drawTable('MODULE CONFIGURATION', ['Type', 'Qty', 'Capacity'], reportRows(moduleReportRows), 39, margin + detailWidth + 6, detailWidth, true);
      drawTable('BATTERY PACK MODEL', ['Model', 'Qty', 'Capacity'], reportRows(batteryReportRows), 109, margin, detailWidth, true);
      drawTable('RACK/CABINET STATUS', ['Status', 'Qty', 'Capacity'], reportRows(rackReportRows), 109, margin + detailWidth + 6, detailWidth, true);
      reportFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...muted);
      doc.text(`Active filters: Cells ${selectedCellStatus} | Packs ${selectedPackType} | Racks ${selectedRackType} | Modules ${selectedModuleConfig}`, margin, pageHeight - 12);

      doc.save(`power2go-ceo-report-${reportDate}.pdf`);
      addNotification('success', 'Report exported', 'The CEO monitoring report has been downloaded.');
    } catch (error: any) {
      addNotification('error', 'Export failed', error?.message || 'Unable to generate the CEO monitoring report.');
    } finally {
      setExporting(false);
    }
  };

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
            <p className="mt-1 text-sm text-slate-500">Live production, inventory, quality and traceability overview</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={exportReport}
                disabled={exporting}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                title="Download the current CEO monitoring report as a PDF"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? 'Exporting...' : 'Export Report'}
              </button>
              <button
                type="button"
                onClick={() => void exportCellReport()}
                disabled={exportingCells}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                title="Export detailed cell inventory to Excel"
              >
                <Download className="h-3.5 w-3.5" />
                {exportingCells ? 'Exporting Cells...' : 'Export Cell Report'}
              </button>
              <button
                type="button"
                onClick={() => void exportBatteryReport()}
                disabled={exportingBatteryReport}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                title="Export battery inventory to Excel"
              >
                <Download className="h-3.5 w-3.5" />
                {exportingBatteryReport ? 'Exporting Batteries...' : 'Export Battery Report'}
              </button>
              <button
                type="button"
                onClick={() => void exportRackReport()}
                disabled={exportingRackReport}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                title="Export rack inventory to Excel"
              >
                <Download className="h-3.5 w-3.5" />
                {exportingRackReport ? 'Exporting Racks...' : 'Export Rack Report'}
              </button>
            </div>
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
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between"><div><div className="text-[15px] font-bold text-slate-900">Needs Attention</div><div className="text-[11px] text-slate-400">Live operational exceptions</div></div><span className="text-[10px] font-semibold text-slate-400">Updated {lastUpdated}</span></div>
            {openRisks + delayedOrders + qcIssues === 0 ? <div className="rounded-lg bg-emerald-50 px-3 py-4 text-center text-xs font-semibold text-emerald-700">No active exceptions</div> : <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ['Open quarantine', openRisks],
                ['Delayed orders', delayedOrders],
                ['QC issues', qcIssues],
              ].filter(([, value]) => Number(value) > 0).map(([label, value]) => <div key={String(label)} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50 px-3 py-2"><span className="text-rose-700">{label}</span><strong className="text-rose-900">{formatNumber(Number(value))}</strong></div>)}
            </div>}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Warehouse</div>
                  <div className="text-[11px] text-slate-400">Karachi vs Lahore warehouse stock</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(warehouseDistribution.total)}</div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              {(['All', 'Racks', 'Battery Packs'] as const).map(type => <button key={type} type="button" onClick={() => setSelectedWarehouseInventoryType(type)} className={`rounded-md border px-2 py-1 ${selectedWarehouseInventoryType === type ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{type}</button>)}
            </div>
            {selectedWarehouseInventoryType !== 'Battery Packs' && <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              {warehouseRackTypeOptions.map(type => <button key={type} type="button" onClick={() => setSelectedWarehouseRackType(type)} className={`rounded-md border px-2 py-1 ${selectedWarehouseRackType === type ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{type === 'All' ? 'All racks' : warehouseRackTypeLabel(type)}</button>)}
            </div>
            }
            {selectedWarehouseInventoryType !== 'Racks' && <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              {warehouseBatteryTypeOptions.map(type => <button key={type} type="button" onClick={() => setSelectedWarehouseBatteryType(type)} className={`rounded-md border px-2 py-1 ${selectedWarehouseBatteryType === type ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{type === 'All' ? 'All battery packs' : type}</button>)}
            </div>}
            <DistributionBars distribution={warehouseDistribution} ariaLabel="Warehouse distribution" />
          </div>

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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(cellDistribution.total)}</div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              {['All', 'In Stock', 'Floor Stock', 'In Module', 'In Pack', 'In Rack', 'Karachi Warehouse', 'Lahore Warehouse', 'Sold', 'Scrap'].map((label) => (
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

            <DistributionDonut
              distribution={cellDistribution}
              ariaLabel="Cells distribution"
              showShare={false}
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(moduleDistribution.total)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', ...moduleData.map((item) => item.label)].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedModuleConfig(option)}
                  className={`rounded-md border px-2 py-1 ${selectedModuleConfig === option ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {option}
                </button>
              ))}
            </div>

            <DistributionBars distribution={moduleDistribution} ariaLabel="Module distribution" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Sold</div>
                  <div className="text-[11px] text-slate-400">Terminal sales by entity</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(soldDistribution.total)}</div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
              {['All', ...soldData.map(row => row.label)].map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedSoldEntity(option)}
                  className={`rounded-md border px-2 py-1 ${selectedSoldEntity === option ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {option}
                </button>
              ))}
            </div>

            <DistributionDonut distribution={soldDistribution} ariaLabel="Sold entity distribution" showShare={false} />
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(batteryPackDistribution.total)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', ...batteryPackData.map((item) => item.label)].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedPackType(size)}
                  className={`rounded-md border px-2 py-1 ${selectedPackType === size ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {size}
                </button>
              ))}
            </div>

            <DistributionDonut distribution={batteryPackDistribution} ariaLabel="Battery pack model distribution" />
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(rackTotal)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', ...rackData.map((item) => item.label)].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedRackType(size)}
                  className={`rounded-md border px-2 py-1 ${selectedRackType === size ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {size}
                </button>
              ))}
            </div>

            <DistributionBars distribution={rackDistribution} ariaLabel="Rack status distribution" />
          </div>
        </div>

        <div className="pb-6 text-center text-[11px] text-slate-400">Power2Go MES · CEO Dashboard · Data refreshes automatically</div>
      </div>
    </div>
  );
};

