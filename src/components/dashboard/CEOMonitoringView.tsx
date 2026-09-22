import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Activity, AlertTriangle, Boxes, ChevronDown, Cpu, Download, Factory, PackageCheck, Truck, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { downloadBatteryReport, downloadCellReport, downloadModuleReport, downloadRackReport, downloadSoldReport, downloadWarehouseReport } from '../../lib/cellReportExport';
import { buildDashboardDistribution, DashboardDistribution, DashboardChartRow, normalizeCellBucketLabels } from '../../lib/dashboardCharts';

const numberOr = (value: any, fallback = 0) => {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const reportColors = {
  green: '#10A36D',
  blue: '#2979C7',
  amber: '#F4A62A',
  red: '#DC3545',
  slate: '#64748B',
  silver: '#C0C0C0',
  navy: '#101828',
  card: '#EAF7F2',
  canvas: '#F7F9FB',
  border: '#E2E8F0',
  white: '#FFFFFF',
} as const;

const statusColors: Record<string, string> = {
  'In Stock': reportColors.green,
  'Floor Stock': reportColors.amber,
  'In Module': reportColors.green,
  'In Pack': reportColors.green,
  'In Rack': reportColors.green,
  'Karachi Warehouse': reportColors.green,
  'Lahore Warehouse': reportColors.green,
  Sold: reportColors.silver,
  Damage: reportColors.red,
  Reusable: reportColors.green,
};
const packColors = [reportColors.blue, reportColors.green];
const ceoDonutPalette = ['#245501', '#538D22', '#1A4301', '#73A942', '#143601', '#AAD576'];
const applyPalette = <T extends { color?: string }>(rows: T[], palette = ceoDonutPalette) => rows.map((row, index) => ({ ...row, color: palette[index % palette.length] }));
const packColorByModel: Record<string, string> = {
  'WallMount 5kWh': reportColors.blue,
  '5 kWh Battery Pack': reportColors.blue,
  '7.5 kWh Battery Pack': reportColors.green,
};
const reportDarkGrey = reportColors.slate;
const reportGreen = reportColors.green;
const reportCabinetBlue = reportColors.blue;
const rackPowerColors: Record<string, string> = {
  '25': reportColors.blue,
  '45': reportColors.blue,
  '60': reportColors.blue,
  '70': reportColors.blue,
  '75': reportColors.blue,
};
type ChartRow = DashboardChartRow;

const DistributionDonut: React.FC<{ distribution: DashboardDistribution; ariaLabel: string; showShare?: boolean; extraRows?: ChartRow[]; large?: boolean; compactLegend?: boolean; legendBelow?: boolean; showSegmentLabels?: boolean; showSegmentLabelLines?: boolean; showLegendValues?: boolean; legendLabelClassName?: string; stackLegend?: boolean; legendMarginLeft?: boolean; legendMarginRight?: boolean; donutMarginLeft?: boolean; donutMarginTop?: boolean; balancedVerticalMargin?: boolean; dropdowns?: Array<{ label: string; open: boolean; onToggle: () => void; serials: string[] }> }> = ({ distribution, ariaLabel, showShare = true, extraRows = [], large = true, compactLegend = true, legendBelow = false, showSegmentLabels = false, showSegmentLabelLines = false, showLegendValues = true, legendLabelClassName = 'text-[12px] text-slate-600', stackLegend = false, legendMarginLeft = false, legendMarginRight = false, donutMarginLeft = false, donutMarginTop = false, balancedVerticalMargin = false, dropdowns = [] }) => {
  const visible = distribution.rows.filter((row) => row.value > 0 && row.share > 0);
  const centerLabel = /cell inventory/i.test(ariaLabel) ? 'CELLS' : 'TOTAL';
  const [hoveredRow, setHoveredRow] = useState<DashboardDistribution['rows'][number] | null>(null);
  let offset = 0;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${balancedVerticalMargin ? 'my-[24px]' : ''} ${legendBelow ? 'mt-auto min-h-[340px] flex-col justify-start' : 'flex-col sm:flex-row sm:gap-2'} ${large && !legendBelow ? 'sm:justify-center sm:gap-2' : ''}`}>
      <div className={`relative shrink-0 ${donutMarginLeft ? 'sm:ml-[10mm]' : ''} ${donutMarginTop ? 'sm:translate-y-[10px]' : ''} ${large ? `${legendBelow ? 'h-[220px] w-[220px] sm:h-[250px] sm:w-[250px]' : 'flex h-[220px] w-[220px] items-center justify-center sm:h-[250px] sm:w-[52%]'}` : 'h-[160px] w-[160px] sm:h-[180px] sm:w-[180px]'}`}>
        {hoveredRow && <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg">{hoveredRow.label}: {formatNumber(hoveredRow.value)} ({hoveredRow.share.toFixed(2)}%)</div>}
        {distribution.total === 0 ? <div className="grid h-full place-items-center rounded-full border-[14px] border-slate-100 text-center"><span className="text-[11px] font-semibold text-slate-400">No recorded data</span></div> : <svg viewBox="0 0 100 100" className="h-full w-full" aria-label={ariaLabel}>
          <circle cx="50" cy="50" r="35" fill="none" stroke={reportColors.border} strokeWidth="14" />
          {visible.map((row) => {
            const start = offset;
            offset += row.share;
            const circumference = 2 * Math.PI * 35;
            const gap = visible.length > 1 ? 1.8 : 0;
            const segmentLength = Math.max(0, (row.share / 100) * circumference - gap);
            const dashOffset = -((start / 100) * circumference + gap / 2);
            const midAngle = ((start + row.share / 2) * 3.6 - 90) * (Math.PI / 180);
            const labelX = 50 + Math.cos(midAngle) * 48;
            const labelY = 50 + Math.sin(midAngle) * 48;
            const labelAnchor = Math.cos(midAngle) >= 0 ? 'start' : 'end';
            const lineStartX = 50 + Math.cos(midAngle) * 38;
            const lineStartY = 50 + Math.sin(midAngle) * 38;
            const lineEndX = 50 + Math.cos(midAngle) * 44;
            const lineEndY = 50 + Math.sin(midAngle) * 44;
            return <g key={row.label}><circle className="chart-donut-segment" cx="50" cy="50" r="35" fill="none" stroke={row.color} strokeWidth={hoveredRow?.label === row.label ? '16' : '14'} strokeDasharray={`${segmentLength} ${circumference - segmentLength}`} strokeDashoffset={dashOffset} transform="rotate(-90 50 50)" strokeLinecap="butt" onMouseEnter={() => setHoveredRow(row)} onMouseLeave={() => setHoveredRow(null)}><title>{`${row.label}: ${formatNumber(row.value)}${showShare ? ` (${row.share.toFixed(2)}%)` : ''}`}</title></circle>{showSegmentLabels && <>{showSegmentLabelLines && <line x1={lineStartX} y1={lineStartY} x2={lineEndX} y2={lineEndY} stroke={reportColors.slate} strokeWidth="0.5" />}<text x={labelX} y={labelY} textAnchor={labelAnchor} dominantBaseline="middle" fontSize="3.8" fontWeight="700" fill={reportColors.navy}>{`${row.label.toUpperCase()} - ${row.share.toFixed(0)}% (${formatNumber(row.value)})`}</text></>}</g>;
          })}
          <circle cx="50" cy="50" r="22" fill={reportColors.white} />
          <text x="50" y="49" textAnchor="middle" fontSize="9" fontWeight="700" fill={reportColors.navy}>{formatNumber(distribution.total)}</text>
          <text x="50" y="57" textAnchor="middle" fontSize="4.5" fill={reportColors.slate}>{centerLabel}</text>
        </svg>}
      </div>
      <div className={`min-w-0 py-2 ${legendMarginLeft ? 'sm:ml-[15mm]' : ''} ${legendMarginRight ? 'sm:mr-[18mm]' : ''} ${legendBelow ? 'w-full' : 'w-full flex-1 sm:w-auto'}`}>
        <div className="grid gap-y-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 46px 5mm', columnGap: '0.15rem' }}>
          {distribution.rows.map((row) => {
            const dropdown = dropdowns.find((item) => item.label === row.label);
            const isDropdownOpen = Boolean(dropdown?.open);
            return (
              <React.Fragment key={row.label}>
                <div className={`relative flex min-w-0 items-center gap-2 ${legendLabelClassName}`} style={{ marginLeft: '-10mm' }}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} aria-hidden="true" />
                  <span className="truncate">{row.label}</span>
                  {dropdown && (
                    <button
                      type="button"
                      onClick={dropdown.onToggle}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors hover:border-emerald-200 hover:text-emerald-700"
                      aria-label={`Toggle ${dropdown.label} sold serial numbers`}
                    >
                      <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  {isDropdownOpen && dropdown && (
                    <div className="absolute left-0 top-full z-30 mt-2 w-[220px] max-w-[220px] rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                      {dropdown.serials.length > 0 ? (
                        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto">
                          {dropdown.serials.map((serial) => (
                            <span key={serial} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-700">
                              {serial}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400">No sold serial numbers available.</div>
                      )}
                    </div>
                  )}
                </div>
                {showLegendValues ? (
                  <span className="whitespace-nowrap text-right text-[12px] font-semibold text-slate-900" style={{ marginLeft: '5mm' }}>{formatNumber(row.value)}</span>
                ) : <span />}
                {showLegendValues && showShare ? (
                  <span className="whitespace-nowrap text-right text-[12px] font-normal text-slate-400" style={{ marginLeft: '3mm', marginRight: '5mm' }}>({row.share.toFixed(2)}%)</span>
                ) : showLegendValues ? <span className="text-right text-[12px] font-normal text-slate-400" style={{ marginLeft: '3mm', marginRight: '5mm' }} /> : <span />}
              </React.Fragment>
            );
          })}
          {extraRows.map((row) => (
            <React.Fragment key={row.label}>
              <div className={`flex min-w-0 items-center gap-2 ${legendLabelClassName}`} style={{ marginLeft: '-10mm' }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} aria-hidden="true" />
                <span className="truncate">{row.label}</span>
              </div>
              {showLegendValues ? (
                <span className="whitespace-nowrap text-right text-[12px] font-semibold text-slate-900" style={{ marginLeft: '5mm' }}>{formatNumber(row.value)}</span>
              ) : <span />}
              <span className="text-right text-[12px] font-normal text-slate-400" style={{ marginLeft: '3mm', marginRight: '5mm' }} />
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

const DistributionBars: React.FC<{ distribution: DashboardDistribution; colors?: string[]; ariaLabel: string; large?: boolean }> = ({ distribution, colors, ariaLabel, large = false }) => {
  const max = Math.max(1, ...distribution.rows.map((row) => row.value));
  if (distribution.total === 0) return <div className="grid h-[150px] place-items-center rounded-lg border border-dashed border-slate-200 text-center"><div><div className="text-xs font-semibold text-slate-500">No recorded data</div><div className="mt-1 text-[10px] text-slate-400">No data is available for this chart yet.</div></div></div>;
  return <svg viewBox="0 0 220 130" className={`${large ? 'h-[250px]' : 'h-[190px]'} w-full`} role="img" aria-label={ariaLabel}>
    {[0, 1, 2, 3].map((line) => <line key={line} x1="20" x2="200" y1={line * 28 + 12} y2={line * 28 + 12} stroke={reportColors.border} strokeDasharray="2 3" />)}
    {distribution.rows.map((row, index) => {
      const slotWidth = 180 / Math.max(distribution.rows.length, 1);
      const height = row.value > 0 ? Math.max((row.value / max) * 82, 1.5) : 0;
      const barWidth = 16;
      const x = 20 + index * slotWidth + slotWidth / 2 - barWidth / 2;
      const labelParts = row.label.split(' ');
      return <g key={row.label} transform={`translate(${x}, 0)`}><rect className="chart-bar" x="0" y={94 - height} width={barWidth} height={height} fill={colors?.[index] || row.color} rx="3"><title>{`${row.label}: ${formatNumber(row.value)} (${row.share.toFixed(2)}%)`}</title></rect><text x={barWidth / 2} y={Math.max(8, 89 - height)} textAnchor="middle" fontSize="6.5" fontWeight="600" fill={reportColors.navy}>{formatNumber(row.value)}</text><text x={barWidth / 2} y="108" textAnchor="middle" fontSize="6.5" fill={reportColors.slate}>{labelParts[0]}</text>{labelParts.length > 1 && <text x={barWidth / 2} y="116" textAnchor="middle" fontSize="5.5" fill={reportColors.slate}>{labelParts.slice(1).join(' ')}</text>}<text x={barWidth / 2} y="125" textAnchor="middle" fontSize="5.5" fill={reportColors.slate}>{row.share.toFixed(2)}%</text></g>;
    })}
  </svg>;
};

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);
const CELL_NOMINAL_CAPACITY_AH = 100;
const CELL_NOMINAL_VOLTAGE_V = 3.2;
const CELL_CAPACITY_KWH = (CELL_NOMINAL_CAPACITY_AH * CELL_NOMINAL_VOLTAGE_V) / 1000;
const roundMwh = (capacityKwh: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(((capacityKwh / 1000) + Number.EPSILON) * factor) / factor;
};
const formatMwh = (capacityKwh: number) => {
  const mwh = roundMwh(capacityKwh);
  return `${mwh.toFixed(mwh > 0 && mwh < 0.01 ? 3 : 2)} MWh`;
};
const formatCellTotalMwh = (capacityKwh: number) => `${roundMwh(capacityKwh).toFixed(2)} MWh`;
const formatCellRowMwh = (capacityKwh: number) => `${roundMwh(capacityKwh).toFixed(2)} MWh`;
const formatShare = (value: number, total: number) => `${((value / Math.max(1, total)) * 100).toFixed(2)}%`;
export const CEOMonitoringView: React.FC = () => {
  const { refreshKey, addNotification } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingCells, setExportingCells] = useState(false);
  const [exportingModules, setExportingModules] = useState(false);
  const [exportingBatteryReport, setExportingBatteryReport] = useState(false);
  const [exportingRackReport, setExportingRackReport] = useState(false);
  const [exportingWarehouseReport, setExportingWarehouseReport] = useState(false);
  const [exportingSoldReport, setExportingSoldReport] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCellStatus, setSelectedCellStatus] = useState<'All' | string>('All');
  const [selectedPackType, setSelectedPackType] = useState('All');
  const [selectedRackType, setSelectedRackType] = useState('All');
  const [selectedWarehouseRackType, setSelectedWarehouseRackType] = useState('All');
  const [selectedWarehouseInventoryType, setSelectedWarehouseInventoryType] = useState<'All' | 'Racks' | 'Battery Packs'>('All');
  const [selectedWarehouseBatteryType, setSelectedWarehouseBatteryType] = useState('All');
  const [openWarehouseFilter, setOpenWarehouseFilter] = useState<'Racks' | 'Battery Packs' | null>(null);
  const [openCellFilter, setOpenCellFilter] = useState(false);
  const [selectedModuleConfig, setSelectedModuleConfig] = useState('All');
  const [selectedSoldEntity, setSelectedSoldEntity] = useState('All');
  const [openSoldDetail, setOpenSoldDetail] = useState<'Racks' | 'Battery Packs' | null>(null);
  const [openDonutDetail, setOpenDonutDetail] = useState<Record<string, boolean>>({});
  const normalizeDonutLabel = (label: string) => String(label || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const resolveDonutSerials = (rowLabel: string, serialMap: Record<string, string[]> = {}) => {
    const direct = serialMap[rowLabel] || serialMap[String(rowLabel).replace(/_/g, ' ')] || [];
    if (direct.length > 0) return direct;
    const key = normalizeDonutLabel(rowLabel);
    for (const [candidateLabel, serials] of Object.entries(serialMap)) {
      const candidateKey = normalizeDonutLabel(candidateLabel);
      if (candidateKey === key ||
          (candidateKey === 'reusable' && (key === 'recycle' || key === 'reusable')) ||
          (candidateKey === 'recycle' && (key === 'reusable' || key === 'recycle')) ||
          (candidateKey === 'damage' && (key === 'scrap' || key === 'damage')) ||
          (candidateKey === 'scrap' && (key === 'damage' || key === 'scrap'))) {
        if (serials.length > 0) return serials;
      }
    }
    return [];
  };
  const makeDonutDropdowns = (rows: Array<{ label: string; value: number; color: string }>, serialMap: Record<string, string[]> = {}) => rows.map((row) => ({
    label: row.label,
    open: !!openDonutDetail[row.label],
    onToggle: () => setOpenDonutDetail((current) => ({ ...current, [row.label]: !current[row.label] })),
    serials: resolveDonutSerials(row.label, serialMap),
  }));
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [res, quarantineRecords] = await Promise.all([
          api.getDashboardStats(undefined, undefined, (summary: any) => {
            if (!cancelled) {
              setStats(summary);
              setLoading(false);
            }
          }),
          api.getQuarantineRecords().catch(() => []),
        ]);

        const reusableCellIds = new Set(quarantineRecords.filter((record: any) => {
          const entityType = String(record.entityType || record.entity_type || '').toUpperCase();
          const entityId = String(record.entityId || record.entity_id || '');
          const disposition = String(record.disposition || '').toUpperCase();
          return entityType === 'CELL' && entityId && ['RELEASE_APPROVED', 'REWORK'].includes(disposition);
        }).map((record: any) => String(record.entityId || record.entity_id)));

        const existingDamageValue = numberOr(res.cellBuckets?.find((row: any) => ['SCRAP', 'DAMAGE'].includes(String(row.label || '').toUpperCase()))?.value);
        const existingReusableValue = numberOr(res.cellBuckets?.find((row: any) => ['RECYCLE', 'REUSABLE'].includes(String(row.label || '').toUpperCase()))?.value);
        const scrapCellCount = existingDamageValue || 0;
        const reusableCount = existingReusableValue > 0 ? existingReusableValue : reusableCellIds.size;
        const reusableToReclassify = existingReusableValue > 0 ? 0 : reusableCount;
        const patchedBuckets = normalizeCellBucketLabels(
          (res.cellBuckets || [])
            .filter((row: any) => !['SCRAP', 'DAMAGE', 'RECYCLE', 'REUSABLE'].includes(String(row.label || '').toUpperCase()))
            .map((row: any) => String(row.label || '').toUpperCase() === 'FLOOR STOCK'
              ? { ...row, value: Math.max(0, numberOr(row.value) - reusableToReclassify) }
              : row)
            .concat([
              { label: 'Damage', value: scrapCellCount },
              { label: 'Reusable', value: reusableCount },
            ]),
        );

        if (!cancelled) {
          setStats({ ...res, cellBuckets: patchedBuckets });
          setLoadError(null);
        }
      } catch (error: any) {
        if (!cancelled) {
          console.warn('CEO dashboard refresh failed:', error);
          setLoadError(error?.message || 'Dashboard data could not be loaded.');
          setStats((prev: any) => prev ?? {});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void refresh();

    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);

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
  const controllerInventory = source.controllerInventory ?? {};
  const quality = source.quality ?? {};
  const orders = source.orders ?? {};
  const production = source.production ?? {};
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

  const cellRows = useMemo<ChartRow[]>(() => normalizeCellBucketLabels((source.cellBuckets || []) as Array<{ label?: unknown; value?: unknown }>)
    .filter((row) => !['Reusable', 'Recycle'].includes(row.label))
    .map((row) => ({
      label: row.label,
      value: row.value,
      color: statusColors[row.label] || reportColors.slate,
    })), [source.cellBuckets]);
  const cellBucketTotal = (...labels: string[]) => (source.cellBuckets || [])
    .filter((row: any) => labels.includes(String(row.label || '').toUpperCase()))
    .reduce((total: number, row: any) => total + numberOr(row.value), 0);
  const filteredCellRows = selectedCellStatus === 'All' ? cellRows : cellRows.filter((row) => row.label === selectedCellStatus);
  const cellDistribution = useMemo(() => buildDashboardDistribution(
    filteredCellRows,
    Object.entries(statusColors).map(([label], index) => ({
      label,
      color: label === 'Damage' ? ceoDonutPalette[0] : ceoDonutPalette[(index + 1) % ceoDonutPalette.length],
    })),
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
    const rows: ChartRow[] = selectedWarehouseInventoryType === 'Racks'
      ? [
        { label: 'Karachi Racks', value: rackKarachi, color: ceoDonutPalette[0] },
        { label: 'Lahore Racks', value: rackLahore, color: ceoDonutPalette[1] },
      ]
      : selectedWarehouseInventoryType === 'Battery Packs'
        ? [
          { label: 'Karachi Battery Packs', value: batteryKarachi, color: ceoDonutPalette[2] },
          { label: 'Lahore Battery Packs', value: batteryLahore, color: ceoDonutPalette[3] },
        ]
        : [
          { label: 'Karachi Racks', value: rackKarachi, color: ceoDonutPalette[0] },
          { label: 'Lahore Racks', value: rackLahore, color: ceoDonutPalette[1] },
          { label: 'Karachi Battery Packs', value: batteryKarachi, color: ceoDonutPalette[2] },
          { label: 'Lahore Battery Packs', value: batteryLahore, color: ceoDonutPalette[3] },
        ];

    return applyPalette(rows.filter((row) => row.value > 0 || (source.inventory && (source.inventory.karachiWarehouseRacks !== undefined || source.inventory.lahoreWarehouseRacks !== undefined))));
  }, [source.inventory, selectedWarehouseInventoryType, selectedWarehouseRackType, selectedWarehouseBatteryType]);

  const warehouseRackTypeOptions = useMemo(() => {
    const types = Array.isArray(source.inventory?.warehouseRackTypeCounts) ? source.inventory.warehouseRackTypeCounts.map((row: any) => String(row.type || '')) : [];
    return ['All', ...types
      .filter(Boolean)
      .filter(type => type !== 'UNKNOWN_RACK')
      .sort((left, right) => {
        const leftPower = Number(left.match(/RACK_(\d+(?:\.\d+)?)KWH/i)?.[1] || 0);
        const rightPower = Number(right.match(/RACK_(\d+(?:\.\d+)?)KWH/i)?.[1] || 0);
        return rightPower - leftPower;
      })];
  }, [source.inventory]);

  const warehouseRackTypeLabel = (type: string) => {
    const match = type.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
    if (!match) return type.replace(/^RACK_/i, '').replace(/_/g, ' ');
    const power = match[1] === '70' ? '67.9' : match[1];
    return `${power} kWh`;
  };
  const warehouseBatteryTypeOptions = useMemo(() => {
    const types = Array.isArray(source.inventory?.warehouseBatteryTypeCounts) ? source.inventory.warehouseBatteryTypeCounts.map((row: any) => String(row.type || '')) : [];
    return ['All', ...types
      .filter(Boolean)
      .sort((left, right) => {
        const leftPower = Number(left.match(/(\d+(?:\.\d+)?)\s*KWH/i)?.[1] || 0);
        const rightPower = Number(right.match(/(\d+(?:\.\d+)?)\s*KWH/i)?.[1] || 0);
        return rightPower - leftPower;
      })];
  }, [source.inventory]);

  const warehouseDistribution = useMemo(() => buildDashboardDistribution(
    warehouseRows,
    warehouseRows.map(row => ({ label: row.label, color: row.color })),
    warehouseRows.reduce((sum, row) => sum + row.value, 0),
  ), [warehouseRows]);
  const damageReusableRows = useMemo<ChartRow[]>(() => {
    const damageValue = numberOr(source.cellBuckets?.find((row: any) => ['DAMAGE', 'SCRAP'].includes(String(row.label || '').toUpperCase()))?.value);
    const reusableValue = numberOr(source.cellBuckets?.find((row: any) => ['RECYCLE', 'REUSABLE'].includes(String(row.label || '').toUpperCase()))?.value);
    const rows: ChartRow[] = [
      { label: 'Damage', value: damageValue, color: ceoDonutPalette[0] },
      { label: 'Reusable', value: reusableValue, color: ceoDonutPalette[5] },
    ];
    return rows.filter(row => row.value > 0 || damageValue > 0 || reusableValue > 0);
  }, [source.cellBuckets]);
  const damageReusableDistribution = useMemo(() => buildDashboardDistribution(
    damageReusableRows,
    damageReusableRows.map(row => ({ label: row.label, color: row.color })),
    damageReusableRows.reduce((sum, row) => sum + row.value, 0),
  ), [damageReusableRows]);
  const controllerRows = useMemo<ChartRow[]>(() => {
    const bmsTotal = numberOr(controllerInventory.totalBms ?? source.totalBms ?? 0);
    const bmuTotal = numberOr(controllerInventory.totalBmu ?? source.totalBmu ?? 0);
    const rows: ChartRow[] = [
      { label: 'BMS', value: bmsTotal, color: ceoDonutPalette[0] },
      { label: 'BMU', value: bmuTotal, color: ceoDonutPalette[1] },
    ];
    return rows.filter((row) => row.value > 0 || bmsTotal > 0 || bmuTotal > 0);
  }, [controllerInventory, source.totalBms, source.totalBmu]);
  const controllerDistribution = useMemo(() => buildDashboardDistribution(
    controllerRows,
    controllerRows.map(row => ({ label: row.label, color: row.color })),
    controllerRows.reduce((sum, row) => sum + row.value, 0),
  ), [controllerRows]);
  const warehouseCellTotal = cellBucketTotal('KARACHI WAREHOUSE', 'LAHORE WAREHOUSE');
  const moduleCellTotal = cellBucketTotal('IN MODULE');
  const batteryPackCellTotal = cellBucketTotal('IN PACK');
  const rackCellTotal = numberOr(source.inventory?.rackCellCount, cellBucketTotal('IN RACK'));
  const moduleData = useMemo<ChartRow[]>(() => applyPalette((source.moduleTypeBuckets || source.moduleStatusBuckets || [])
    .map((row: any) => ({ label: String(row.label || ''), value: numberOr(row.value), color: reportColors.blue }))
    .sort((left, right) => Number(right.label.match(/\d+/)?.[0] || 0) - Number(left.label.match(/\d+/)?.[0] || 0))), [source.moduleTypeBuckets, source.moduleStatusBuckets]);
  const filteredModuleRows = selectedModuleConfig === 'All' ? moduleData : moduleData.filter((row) => row.label === selectedModuleConfig);
  const moduleDistribution = useMemo(() => buildDashboardDistribution(
    filteredModuleRows,
    [{ label: '8S', color: ceoDonutPalette[0] }, { label: '12S', color: ceoDonutPalette[5] }],
    selectedModuleConfig === 'All' ? source.moduleTotal : undefined,
  ), [filteredModuleRows, selectedModuleConfig, source.moduleTotal]);
  const soldData = useMemo<ChartRow[]>(() => {
    const soldBatteries = numberOr(source.batteryStatusBuckets?.find((row: any) => String(row.label || '').toUpperCase() === 'SOLD')?.value);
    const soldRacks = (source.rackStatusBuckets || [])
      .filter((row: any) => String(row.label || row.status || '').toUpperCase().replace(/_/g, ' ') === 'SOLD')
      .reduce((total: number, row: any) => total + numberOr(row.value), 0);
    return applyPalette([
      { label: 'Racks', value: soldRacks, color: ceoDonutPalette[0] },
      { label: 'Battery Packs', value: soldBatteries, color: ceoDonutPalette[1] },
    ]);
  }, [source.batteryStatusBuckets, source.rackStatusBuckets]);
  const soldRackSerialNumbers = useMemo(() => {
    const values = Array.isArray(source.soldRackSerialNumbers) ? source.soldRackSerialNumbers : [];
    return values.filter((value: unknown) => String(value || '').trim().length > 0);
  }, [source.soldRackSerialNumbers]);
  const soldBatterySerialNumbers = useMemo(() => {
    const values = Array.isArray(source.soldBatterySerialNumbers) ? source.soldBatterySerialNumbers : [];
    return values.filter((value: unknown) => String(value || '').trim().length > 0);
  }, [source.soldBatterySerialNumbers]);
  const warehouseSerialDetails = useMemo(() => ({
    'Karachi Racks': Array.isArray(source.warehouseStatusSerialNumbers?.['Karachi Racks']) ? source.warehouseStatusSerialNumbers['Karachi Racks'] : [],
    'Lahore Racks': Array.isArray(source.warehouseStatusSerialNumbers?.['Lahore Racks']) ? source.warehouseStatusSerialNumbers['Lahore Racks'] : [],
    'Karachi Battery Packs': Array.isArray(source.warehouseStatusSerialNumbers?.['Karachi Battery Packs']) ? source.warehouseStatusSerialNumbers['Karachi Battery Packs'] : [],
    'Lahore Battery Packs': Array.isArray(source.warehouseStatusSerialNumbers?.['Lahore Battery Packs']) ? source.warehouseStatusSerialNumbers['Lahore Battery Packs'] : [],
  }), [source.warehouseStatusSerialNumbers]);
  const rackSerialDetailMap = useMemo(() => {
    const entries = source.rackStatusSerialNumbersByType || {};
    return Object.fromEntries(Object.entries(entries).map(([label, serials]) => [String(label), Array.isArray(serials) ? serials.filter(Boolean) : []]));
  }, [source.rackStatusSerialNumbersByType]);
  const batterySerialDetailMap = useMemo(() => {
    const entries = source.batteryPackSerialNumbersByLabel || {};
    return Object.fromEntries(Object.entries(entries).map(([label, serials]) => [String(label), Array.isArray(serials) ? serials.filter(Boolean) : []]));
  }, [source.batteryPackSerialNumbersByLabel]);
  const moduleSerialDetailMap = useMemo(() => {
    const entries = source.moduleSerialNumbersByLabel || {};
    return Object.fromEntries(Object.entries(entries).map(([label, serials]) => [String(label), Array.isArray(serials) ? serials.filter(Boolean) : []]));
  }, [source.moduleSerialNumbersByLabel]);
  const aliasMap = (obj: Record<string, string[]> = {}, aliases: Record<string, string[]>) => {
    const merged: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(obj)) {
      merged[key] = Array.isArray(values) ? values.filter(Boolean) : [];
    }
    for (const [key, values] of Object.entries(aliases)) {
      merged[key] = [...(merged[key] || []), ...(Array.isArray(values) ? values.filter(Boolean) : [])];
    }
    return merged;
  };
  const cellSerialDetailMap = useMemo(() => {
    const entries = source.cellStatusSerialNumbersByLabel || {};
    const result: Record<string, string[]> = {};
    const addKey = (label: string, ...extraLabels: string[]) => {
      const serials = [...new Set([
        ...(entries[label] || []),
        ...extraLabels.flatMap((extraLabel) => entries[extraLabel] || []),
      ].filter(Boolean))];
      if (serials.length > 0) result[label] = serials;
    };
    cellRows.forEach((row) => {
      const label = row.label;
      if (label === 'Damage') addKey(label, 'Scrap');
      else if (label === 'Reusable') addKey(label, 'Recycle');
      else if (label === 'Recycle') addKey(label, 'Reusable');
      else if (label === 'Sold') addKey(label);
      else addKey(label);
    });
    return result;
  }, [cellRows, source.cellStatusSerialNumbersByLabel]);
  const damageReusableSerialDetailMap = useMemo(() => {
    const entries = source.damageReusableSerialNumbers || {};
    const aliasEntries: Record<string, string[]> = {
      Damage: [...(entries.Damage || []), ...(entries.Scrap || [])],
      Reusable: [...(entries.Reusable || []), ...(entries.Recycle || [])],
      Recycle: [...(entries.Recycle || []), ...(entries.Reusable || [])],
      Scrap: [...(entries.Scrap || []), ...(entries.Damage || [])],
    };
    return aliasMap(entries, aliasEntries);
  }, [source.damageReusableSerialNumbers]);
  const controllerSerialDetailMap = useMemo(() => {
    const entries = source.controllerSerialNumbersByLabel || {};
    const aliasEntries: Record<string, string[]> = {
      BMS: entries.BMS || [],
      BMU: entries.BMU || [],
    };
    return aliasMap(entries, aliasEntries);
  }, [source.controllerSerialNumbersByLabel]);
  const soldCellTotal = numberOr(inventory.soldCells ?? source.cellBuckets?.find((row: any) => row.label === 'Sold')?.value);
  const filteredSoldRows = selectedSoldEntity === 'All' ? soldData : soldData.filter(row => row.label === selectedSoldEntity);
  const soldDistribution = useMemo(() => buildDashboardDistribution(
    filteredSoldRows,
    soldData.map(row => ({ label: row.label, color: row.color })),
    selectedSoldEntity === 'All' ? undefined : filteredSoldRows.reduce((total, row) => total + row.value, 0),
  ), [filteredSoldRows, selectedSoldEntity, soldData]);
  const batteryPackData = useMemo<ChartRow[]>(() => applyPalette((source.batteryPackBuckets || [])
    .map((row: any) => ({
      label: String(row.label || 'Unnamed Pack'),
      value: numberOr(row.value),
      color: reportColors.green,
    }))
    .sort((left, right) => Number(right.label.match(/\d+(?:\.\d+)?/)?.[0] || 0) - Number(left.label.match(/\d+(?:\.\d+)?/)?.[0] || 0))), [source.batteryPackBuckets]);
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
        const match = rackType.match(/RACK_(25|45|60|70|75)KWH/i);
        if (match) totals.set(match[1], (totals.get(match[1]) || 0) + numberOr(type.value));
      });
    });
    return applyPalette(Array.from(totals.entries())
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => Number(right) - Number(left))
      .map(([power, value]) => ({
        label: `${power === '70' ? '67.9' : power} kWh ${power === '25' ? 'Rack' : 'Cabinet'}`,
        value,
        color: reportColors.green,
      })));
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
  const cabinetDistributionSummary = useMemo(() => {
    const totals = new Map<string, number>();
    (source.rackStatusBuckets || []).forEach((status: any) => {
      (status.rackTypes || []).forEach((rackTypeInfo: any) => {
        const rackType = String(rackTypeInfo.rackType || '').toUpperCase();
        const match = rackType.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
        if (!match) return;
        const capacityValue = Number(match[1]);
        if (capacityValue >= 45 && capacityValue <= 75 && capacityValue !== 25) {
          const normalizedKey = capacityValue === 70 ? '69.7' : String(capacityValue);
          totals.set(normalizedKey, (totals.get(normalizedKey) || 0) + numberOr(rackTypeInfo.value));
        }
      });
    });

    const distribution = [
      { key: '69.7', label: '69.7kWh', value: totals.get('69.7') || 0 },
      { key: '60', label: '60kWh', value: totals.get('60') || 0 },
      { key: '45', label: '45kWh', value: totals.get('45') || 0 },
    ].filter((entry) => entry.value > 0);

    return distribution.length > 0 ? distribution.map((entry) => `${entry.value} (${entry.label})`).join(' / ') : '0 (0kWh)';
  }, [source.rackStatusBuckets]);

  const batteryPackModelSummary = useMemo(() => {
    const normalizeLabel = (label: string) => String(label || '').toLowerCase().replace(/[^a-z0-9.]/g, '');

    const lv = batteryPackData.reduce((sum: number, row: any) => {
      const normalized = normalizeLabel(row.label);
      return normalized === '5kwhbatterypack' ? sum + numberOr(row.value) : sum;
    }, 0);

    const wallMount = batteryPackData.reduce((sum: number, row: any) => {
      const normalized = normalizeLabel(row.label);
      return normalized === 'wallmount5kwh' ? sum + numberOr(row.value) : sum;
    }, 0);

    const hv = batteryPackData.reduce((sum: number, row: any) => {
      const normalized = normalizeLabel(row.label);
      return normalized === '7.5kwhbatterypack' || normalized === '7kwhbatterypack' ? sum + numberOr(row.value) : sum;
    }, 0);

    const combinedLv = lv + wallMount;

    return {
      lv,
      wallMount,
      hv,
      combinedLv,
      label: `${formatNumber(combinedLv)} (5kWh) / ${formatNumber(hv)} (7.5kWh)`,
    };
  }, [batteryPackData]);

  const kpiCards = [
    { label: 'Nominal Capacity Produced', value: `${formatNumber(capacityProduced)} kWh`, delta: '', positive: true, icon: <Zap className="h-5 w-5 text-emerald-600" />, bg: reportColors.card },
    {
      label: 'Battery Packs Produced',
      value: formatNumber(batteryPackModelSummary.lv + batteryPackModelSummary.wallMount + batteryPackModelSummary.hv),
      delta: '',
      positive: releaseTrendChange === null || releaseTrendChange >= 0,
      icon: <Factory className="h-5 w-5 text-blue-600" />,
      bg: reportColors.card,
      detail: (
        <div className="mt-1 text-[10px] font-medium text-emerald-600">
          <span className="inline-block text-[10px] text-emerald-600">
            <span className="text-[13px] font-bold text-emerald-700">{formatNumber(batteryPackModelSummary.combinedLv)}</span>
            <span className="text-[9px] text-emerald-600"> (5kWh)</span>
          </span>
          <span className="inline-block px-1 text-[10px] text-emerald-600">/</span>
          <span className="inline-block text-[10px] text-emerald-600">
            <span className="text-[13px] font-bold text-emerald-700">{formatNumber(batteryPackModelSummary.hv)}</span>
            <span className="text-[9px] text-emerald-600"> (7.5kWh)</span>
          </span>
        </div>
      ),
    },
    {
      label: 'Cabinet Produced',
      value: formatNumber(scaleValue(cabinetProduced)),
      delta: '',
      positive: true,
      icon: <PackageCheck className="h-5 w-5 text-blue-600" />,
      bg: reportColors.card,
      detail: (
        <div className="mt-1 text-[10px] font-medium text-emerald-600">
          {cabinetDistributionSummary.split(' / ').map((part) => {
            const match = part.match(/^(\d+)\s*\(([^)]+)\)$/);
            if (!match) return <span key={part} className="text-[10px] text-emerald-600">{part}</span>;
            const [, count, capacity] = match;
            return (
              <span key={part} className="mr-1 inline-block text-[10px] text-emerald-600">
                <span className="text-[13px] font-bold text-emerald-700">{count}</span>
                <span className="text-[9px] text-emerald-600"> ({capacity})</span>
              </span>
            );
          })}
        </div>
      ),
    },
    {
      label: 'Rack Produced',
      value: formatNumber(scaleValue(rackProduced)),
      delta: '',
      positive: true,
      icon: <PackageCheck className="h-5 w-5 text-blue-600" />,
      bg: reportColors.card,
      detail: (
        <div className="mt-1 text-[10px] font-medium text-emerald-600">
          <span className="mr-1 inline-block text-[10px] text-emerald-600">
            <span className="text-[13px] font-bold text-emerald-700">{scaleValue(rackProduced)}</span>
            <span className="text-[9px] text-emerald-600"> (25kWh)</span>
          </span>
        </div>
      ),
    },
    { label: 'In Stock Cells', value: formatNumber(inStockCells), delta: '', positive: true, icon: <Boxes className="h-5 w-5 text-emerald-600" />, bg: reportColors.card },
    { label: 'Floor Stock Cells', value: formatNumber(floorStockCells), delta: '', positive: true, icon: <Boxes className="h-5 w-5 text-amber-600" />, bg: '#FFF7E8' },
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

  const exportModuleReport = async () => {
    setExportingModules(true);
    try {
      const modules = await api.getModules({ includeCells: true });
      downloadModuleReport(modules);
      addNotification('success', 'Module report exported', `${modules.length.toLocaleString()} module records were exported.`);
    } catch (error: any) {
      addNotification('error', 'Module export failed', error?.message || 'Unable to export the module report.');
    } finally {
      setExportingModules(false);
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

  const exportWarehouseReport = async () => {
    setExportingWarehouseReport(true);
    try {
      const [batteries, racks, warehouseStatuses] = await Promise.all([
        api.getBatteries(),
        api.getRacks(),
        api.getWarehouseEntityStatuses(),
      ]);
      downloadWarehouseReport(batteries, racks, warehouseStatuses);
      addNotification('success', 'Warehouse report exported', 'Karachi and Lahore racks and battery packs were exported.');
    } catch (error: any) {
      addNotification('error', 'Warehouse export failed', error?.message || 'Unable to export warehouse inventory.');
    } finally {
      setExportingWarehouseReport(false);
    }
  };

  const exportSoldReport = async () => {
    setExportingSoldReport(true);
    try {
      const [batteries, racks, saleHistory] = await Promise.all([api.getBatteries(), api.getRacks(), api.getSaleHistory()]);
      downloadSoldReport(batteries, racks, saleHistory);
      addNotification('success', 'Sold report exported', 'Sold battery packs and racks were exported.');
    } catch (error: any) {
      addNotification('error', 'Sold export failed', error?.message || 'Unable to export sold inventory.');
    } finally {
      setExportingSoldReport(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const reportDate = new Date().toISOString().slice(0, 10);
      const rangeLabel = 'All available data';
      const [quarantineRecords] = await Promise.all([
        api.getQuarantineRecords().catch(() => []),
      ]);
      const reusableCellIds = new Set(quarantineRecords.filter((record: any) => {
        const entityType = String(record.entityType || record.entity_type || '').toUpperCase();
        const entityId = String(record.entityId || record.entity_id || '');
        const disposition = String(record.disposition || '').toUpperCase();
        return entityType === 'CELL' && entityId && ['RELEASE_APPROVED', 'REWORK'].includes(disposition);
      }).map((record: any) => String(record.entityId || record.entity_id)));
      const reusableScrapCount = reusableCellIds.size;
      const scrapCellCount = numberOr(source.cellBuckets?.find((row: any) => ['SCRAP', 'DAMAGE'].includes(String(row.label || '').toUpperCase()))?.value);
      const damageScrapCount = scrapCellCount;
      const statusRows = (statuses: string[], sourceRows: any[], colorMap: Record<string, string>, defaultCapacityKwh: (status: string) => number = () => 0) => {
        const values = new Map((sourceRows || []).map((row: any) => [String(row.label).replace(/_/g, ' ').toUpperCase(), { value: numberOr(row.value), capacityKwh: numberOr(row.capacityKwh) }]));
        return statuses.map((status) => ({
          label: status.replace(/_/g, ' '),
          value: values.get(status.replace(/_/g, ' ').toUpperCase())?.value || 0,
          capacityKwh: values.get(status.replace(/_/g, ' ').toUpperCase())?.capacityKwh || (values.get(status.replace(/_/g, ' ').toUpperCase())?.value || 0) * defaultCapacityKwh(status),
          color: Object.entries(colorMap).find(([label]) => label.toUpperCase() === status.replace(/_/g, ' ').toUpperCase())?.[1] || reportColors.slate,
        }));
      };
      const cellReportRows = statusRows(
        ['In Stock', 'Floor Stock', 'In Module', 'In Pack', 'In Rack', 'Karachi Warehouse', 'Lahore Warehouse', 'Sold'],
        source.cellBuckets,
        statusColors,
        () => CELL_CAPACITY_KWH,
      ).concat([
        { label: 'Damage', value: damageScrapCount, capacityKwh: damageScrapCount * CELL_CAPACITY_KWH, color: statusColors.Damage || statusColors.Scrap },
        { label: 'Recycle', value: reusableScrapCount, capacityKwh: reusableScrapCount * CELL_CAPACITY_KWH, color: reportGreen },
      ]).map((row) => row.label === 'In Module'
        ? { ...row, label: 'In Module (standalone)' }
        : row);
      const moduleReportRows = statusRows(
        ['8S', '12S'],
        source.moduleTypeBuckets,
        { '8S': reportGreen, '12S': reportGreen },
        (status) => status === '12S' ? 3.75 : 2.5,
      );
      const batteryReportRows = (source.batteryPackBuckets || []).map((row: any, index: number) => {
        const label = String(row.label || 'Unnamed Pack');
        return {
          label,
          value: numberOr(row.value),
          capacityKwh: numberOr(row.capacityKwh),
          color: reportGreen,
        };
      });
      const cabinetReportRows = [{
        label: 'Cabinet · 7.5 kWh batteries',
        value: cabinetProduced,
        capacityKwh: cabinetProduced * 7.5,
        color: reportGreen,
      }];
      const scrapReportRows = [
        { label: 'Damage', value: damageScrapCount, capacityKwh: damageScrapCount * CELL_CAPACITY_KWH, color: statusColors.Damage || statusColors.Scrap },
        { label: 'Recycle', value: reusableScrapCount, capacityKwh: reusableScrapCount * CELL_CAPACITY_KWH, color: statusColors.Recycle },
      ];
      const soldBatteryCount = numberOr(source.soldBatteryPackCount ?? source.batteryStatusBuckets?.find((row: any) => String(row.label || '').toUpperCase() === 'SOLD')?.value);
      const soldRackCount = numberOr(source.rackStatusBuckets?.find((row: any) => String(row.label || row.status || '').toUpperCase().replace(/_/g, ' ') === 'SOLD')?.value);
      const soldBatteryCellCapacityKwh = numberOr(source.soldBatteryCellCount) * CELL_CAPACITY_KWH;
      const soldRackCellCapacityKwh = numberOr(source.soldRackCellCount) * CELL_CAPACITY_KWH;
      const soldCellQuantity = numberOr(source.soldCellCount ?? source.cellBuckets?.find((row: any) => String(row.label || '').toUpperCase() === 'SOLD')?.value);
      const soldReportRows = [
        { label: 'Battery Pack units', value: soldBatteryCount, capacityKwh: soldBatteryCellCapacityKwh, color: reportGreen },
        { label: 'Rack units', value: soldRackCount, capacityKwh: soldRackCellCapacityKwh, color: reportGreen },
      ];
      const rackTypeTotals = new Map<string, { value: number; capacityKwh: number }>();
      const rackColor = (rackType: string) => {
        const powerMatch = rackType.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
        return reportGreen;
      };
      const formatRackLabel = (rackType: string) => {
        const powerMatch = rackType.match(/RACK_(\d+(?:\.\d+)?)KWH/i);
        const powerValue = powerMatch?.[1] === '70' ? '67.9' : powerMatch?.[1];
        const power = powerValue ? `${powerValue}kWh` : rackType.replace(/^RACK_/i, '').replace(/_/g, ' ');
        const category = /RACK_25KWH/i.test(rackType) ? 'Rack' : 'Cabinet';
        return `${power.replace('kWh', ' kWh')} ${category}`;
      };
      (source.rackStatusBuckets || []).forEach((row: any) => {
        const typeRows = Array.isArray(row.rackTypes) ? row.rackTypes : [];
        typeRows.forEach((type: any) => {
          const rackType = String(type.rackType || 'UNKNOWN_RACK');
          if (!/RACK_(25|45|60|70|75)KWH/i.test(rackType)) return;
          const current = rackTypeTotals.get(rackType) || { value: 0, capacityKwh: 0 };
          current.value += numberOr(type.value);
          current.capacityKwh += numberOr(type.capacityKwh);
          rackTypeTotals.set(rackType, current);
        });
      });
      const rackReportRows = Array.from(rackTypeTotals.entries())
        .sort(([leftType], [rightType]) => {
          const leftPower = Number(leftType.match(/RACK_(\d+(?:\.\d+)?)KWH/i)?.[1] || Number.MAX_SAFE_INTEGER);
          const rightPower = Number(rightType.match(/RACK_(\d+(?:\.\d+)?)KWH/i)?.[1] || Number.MAX_SAFE_INTEGER);
          return leftPower - rightPower;
        })
        .map(([rackType, totals]) => ({
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
        { label: 'Total', value: bmsTotal, capacityKwh: 0, color: reportGreen },
        { label: 'Available', value: bmsAvailable, capacityKwh: 0, color: reportGreen },
        { label: 'Used', value: Math.max(0, bmsTotal - bmsAvailable), capacityKwh: 0, color: reportGreen },
      ];
      const bmuReportRows = [
        { label: 'Total', value: bmuTotal, capacityKwh: 0, color: reportGreen },
        { label: 'Available', value: bmuAvailable, capacityKwh: 0, color: reportGreen },
        { label: 'Used', value: Math.max(0, bmuTotal - bmuAvailable), capacityKwh: 0, color: reportGreen },
      ];
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;
      const chartGap = 10;
      const chartWidth = (pageWidth - margin * 2 - chartGap) / 2;
      const leftChartX = margin;
      const rightChartX = margin + chartWidth + chartGap;
      const hexRgb = (hex: string): [number, number, number] => {
        const value = hex.replace('#', '');
        return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
      };
      const green = hexRgb(reportColors.green);
      const ink = hexRgb(reportColors.navy);
      const muted = hexRgb(reportColors.slate);
      const light = hexRgb(reportColors.card);
      const border = hexRgb(reportColors.border);
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
      const drawDonut = (x: number, y: number, radius: number, rows: { label: string; value: number; capacityKwh: number; color: string }[], title: string, legendOnRight = false, legendRightX = pageWidth - margin, showShare = true, capacityFormatter = formatMwh, includeValueInLegend = false, rightLegendOffset: number | undefined = undefined, legendRowGap = 10) => {
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
        const segmentGap = rows.length > 1 ? 0.035 : 0;
        doc.setFont('helvetica', 'bold');
        reportFontSize(9);
        doc.text(title, x - radius, y - radius - 10);
        rows.forEach((row) => {
          const end = start + (row.value / chartTotal) * Math.PI * 2;
          doc.setFillColor(...hexRgb(row.color));
          const segmentStart = start + segmentGap / 2;
          const segmentEnd = end - segmentGap / 2;
          for (let angle = segmentStart; angle < segmentEnd; angle += 0.035) {
            const next = Math.min(angle + 0.04, segmentEnd);
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
        doc.text(title === 'CELL INVENTORY' ? 'CELLS' : 'TOTAL', x, y + 7, { align: 'center' });
        reportFontSize(5);
        doc.text(capacityFormatter(totalCapacityKwh), x, y + 25, { align: 'center' });
        const centeredLegendOffset = rightLegendOffset ?? -((rows.length - 1) * legendRowGap) / 2;
        rows.forEach((row, index) => {
          if (legendOnRight) {
            const legendX = x + radius + 4;
            const legendY = y + centeredLegendOffset + index * legendRowGap;
            doc.setFillColor(...hexRgb(row.color));
            doc.roundedRect(legendX, legendY - 4.35, 2.5, 2.5, 0.5, 0.5, 'F');
            doc.setFont('helvetica', includeValueInLegend ? 'bold' : 'normal');
            reportFontSize(includeValueInLegend ? 4.8 : 5.8);
            doc.setTextColor(...muted);
            if (includeValueInLegend) {
              const unitLabel = title === 'CELL INVENTORY' ? ' cells' : '';
              doc.text(`${row.label} (${formatCellRowMwh(row.capacityKwh)}) ${formatNumber(row.value)}${unitLabel}`, legendX + 5, legendY - 2.6);
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
        const titleLines = doc.splitTextToSize(title, width);
        doc.text(titleLines, x, y - 16, { maxWidth: width, lineHeightFactor: 1.1 });
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
          doc.setFillColor(...hexRgb(hasValue ? row.color : reportColors.border));
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
      drawDonut(leftChartX + 23, 158, 20, cellReportRows, 'CELL INVENTORY', true, leftChartX + chartWidth, false, formatCellTotalMwh, true, undefined, 7);
      drawDonut(rightChartX + 23, 158, 20, moduleReportRows, 'MODULE CONFIGURATION', true, rightChartX + chartWidth, false, formatMwh, true, undefined, 7);
      drawDonut(leftChartX + 23, 254, 20, batteryReportRows, 'BATTERY PACK MODEL', true, leftChartX + chartWidth, false, formatMwh, true, undefined, 7);
      drawDonut(rightChartX + 23, 254, 20, rackReportRows, 'RACK/CABINET STATUS', true, rightChartX + chartWidth, false, formatMwh, true, undefined, 7);
      doc.addPage();
      drawTitle('POWER2GO MES | CEO PERFORMANCE REPORT', `Operational detail   |   ${rangeLabel}   |   ${reportDate}`);
      drawSingleKpi(leftChartX, 70, chartWidth, cabinetReportRows, 'CABINET STATUS');
      drawBars(leftChartX, 171, chartWidth, 34, bmsReportRows, 'BMS INVENTORY - TOTAL / AVAILABLE / USED', false, false, true);
      drawBars(rightChartX, 171, chartWidth, 34, bmuReportRows, 'BMU INVENTORY - TOTAL / AVAILABLE / USED', false, false, true);
      drawBars(leftChartX, 230, chartWidth, 32, scrapReportRows, 'DAMAGE STATUS');
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
      doc.save(`power2go-ceo-report-${reportDate}.pdf`);
      addNotification('success', 'Report exported', 'The CEO monitoring report has been downloaded.');
    } catch (error: any) {
      addNotification('error', 'Export failed', error?.message || 'Unable to generate the CEO monitoring report.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-[#F7F9FB] p-3 sm:p-5">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[30px] font-extrabold tracking-[-0.05em] text-slate-900">CEO Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Live production, inventory, quality and traceability overview</p>
          </div>
          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <button
                type="button"
                onClick={exportReport}
                disabled={exporting}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60"
                title="Download the current CEO monitoring report as a PDF"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? 'Exporting...' : 'Export Overview Report'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {kpiCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: card.bg }}>
                  {card.icon}
                </div>
                <span className="text-[11px] font-medium text-slate-500">{card.label}</span>
              </div>
              <div className="text-[24px] font-extrabold tracking-[-0.04em] text-slate-900">{card.value}</div>
              {'detail' in card && card.detail ? card.detail : (card.delta ? <div className={`mt-1 text-[11px] font-semibold ${card.positive ? 'text-emerald-600' : 'text-red-500'}`}>{card.delta}</div> : <div className="mt-1 h-[14px]" />)}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-2">
          <div className="order-1 xl:col-span-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2">
                <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(soldCellTotal)}</div>
                <button
                  type="button"
                  onClick={() => void exportSoldReport()}
                  disabled={exportingSoldReport}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                  title="Export sold report"
                >
                  <Download className="h-3 w-3" />
                  {exportingSoldReport ? 'Exporting...' : 'Export Sold Report'}
                </button>
              </div>
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

            <DistributionDonut
              distribution={soldDistribution}
              ariaLabel="Sold entity distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={soldData.map((row) => {
                const serials = row.label === 'Racks' ? soldRackSerialNumbers : row.label === 'Battery Packs' ? soldBatterySerialNumbers : [];
                return {
                  label: row.label,
                  open: openSoldDetail === row.label,
                  onToggle: () => setOpenSoldDetail((current) => current === row.label ? null : row.label as 'Racks' | 'Battery Packs'),
                  serials,
                };
              })}
            />
          </div>

          <div className="order-2 xl:col-span-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2"><div className="text-[18px] font-extrabold text-slate-900">{formatNumber(warehouseCellTotal)}</div><button type="button" onClick={() => void exportWarehouseReport()} disabled={exportingWarehouseReport} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60" title="Export warehouse report"><Download className="h-3 w-3" />{exportingWarehouseReport ? 'Exporting...' : 'Export Warehouse Report'}</button></div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              <button type="button" onClick={() => { setSelectedWarehouseInventoryType('All'); setOpenWarehouseFilter(null); }} className={`rounded-md border px-2 py-1 ${selectedWarehouseInventoryType === 'All' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>All</button>
              {(['Racks', 'Battery Packs'] as const).map(type => <div key={type} className="relative">
                <button type="button" onClick={() => { setSelectedWarehouseInventoryType(type); setOpenWarehouseFilter(openWarehouseFilter === type ? null : type); }} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${selectedWarehouseInventoryType === type ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`} aria-expanded={openWarehouseFilter === type}>
                  {type}<ChevronDown className="h-3 w-3" />
                </button>
                {openWarehouseFilter === type && <div className="absolute left-0 top-full z-20 mt-1 flex min-w-max flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                  {(type === 'Racks' ? warehouseRackTypeOptions : warehouseBatteryTypeOptions).map(filterType => <button key={filterType} type="button" onClick={() => { if (type === 'Racks') setSelectedWarehouseRackType(filterType); else setSelectedWarehouseBatteryType(filterType); setOpenWarehouseFilter(null); }} className={`whitespace-nowrap rounded-md px-2 py-1.5 text-left ${((type === 'Racks' ? selectedWarehouseRackType : selectedWarehouseBatteryType) === filterType) ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}>{filterType === 'All' ? `All ${type.toLowerCase()}` : type === 'Racks' ? warehouseRackTypeLabel(filterType) : filterType}</button>)}
                </div>}
              </div>)}
            </div>
            <DistributionDonut
              distribution={warehouseDistribution}
              ariaLabel="Warehouse distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(warehouseDistribution.rows, warehouseSerialDetails)}
            />
          </div>

          <div className="order-3 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2"><div className="text-[18px] font-extrabold text-slate-900">{formatNumber(rackCellTotal || rackTotal)}</div><button type="button" onClick={() => void exportRackReport()} disabled={exportingRackReport} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60" title="Export rack report"><Download className="h-3 w-3" />{exportingRackReport ? 'Exporting...' : 'Export Rack Report'}</button></div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
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

            <DistributionDonut
              distribution={rackDistribution}
              ariaLabel="Rack status distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(rackDistribution.rows, rackSerialDetailMap)}
            />
          </div>

          <div className="order-4 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2"><div className="text-[18px] font-extrabold text-slate-900">{formatNumber(batteryPackCellTotal)}</div><button type="button" onClick={() => void exportBatteryReport()} disabled={exportingBatteryReport} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60" title="Export battery report"><Download className="h-3 w-3" />{exportingBatteryReport ? 'Exporting...' : 'Export Battery Report'}</button></div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
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

            <DistributionDonut
              distribution={batteryPackDistribution}
              ariaLabel="Battery pack model distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(batteryPackDistribution.rows, batterySerialDetailMap)}
            />
          </div>

          <div className="order-5 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2"><div className="text-[18px] font-extrabold text-slate-900">{formatNumber(moduleCellTotal)}</div><button type="button" onClick={() => void exportModuleReport()} disabled={exportingModules} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60" title="Export module report"><Download className="h-3 w-3" />{exportingModules ? 'Exporting...' : 'Export Module Report'}</button></div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
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

            <DistributionDonut
              distribution={moduleDistribution}
              ariaLabel="Module distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(moduleDistribution.rows, moduleSerialDetailMap)}
            />
          </div>

          <div className="order-6 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="flex items-center gap-2"><div className="text-[18px] font-extrabold text-slate-900">{formatNumber(cellDistribution.total)}</div><button type="button" onClick={() => void exportCellReport()} disabled={exportingCells} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60" title="Export cell report"><Download className="h-3 w-3" />{exportingCells ? 'Exporting...' : 'Export Cell Report'}</button></div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
              <button
                type="button"
                onClick={() => setSelectedCellStatus('All')}
                className={`rounded-md border px-2 py-1 ${selectedCellStatus === 'All' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
              >
                All cells
              </button>
              {['In Stock', 'Floor Stock', 'Damage', 'Reusable'].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedCellStatus(label)}
                  className={`rounded-md border px-2 py-1 ${selectedCellStatus === label ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  {label}
                </button>
              ))}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenCellFilter(open => !open)}
                  aria-expanded={openCellFilter}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${selectedCellStatus === 'All' || !['In Stock', 'Floor Stock', 'Damage', 'Reusable'].includes(selectedCellStatus) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                >
                  Other<ChevronDown className="h-3 w-3" />
                </button>
                {openCellFilter && <div className="absolute left-0 top-full z-20 mt-1 flex min-w-max flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                  {['In Module', 'In Pack', 'In Rack', 'Karachi Warehouse', 'Lahore Warehouse', 'Sold'].map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setSelectedCellStatus(label); setOpenCellFilter(false); }}
                      className={`whitespace-nowrap rounded-md px-2 py-1.5 text-left ${selectedCellStatus === label ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>}
              </div>
            </div>

            <DistributionDonut
              distribution={cellDistribution}
              ariaLabel="Cells distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={[]}
            />
          </div>

          <div className="order-7 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">Damage vs Reusable</div>
                  <div className="text-[11px] text-slate-400">Damage review split</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(damageReusableDistribution.total)}</div>
            </div>

            <DistributionDonut
              distribution={damageReusableDistribution}
              ariaLabel="Damage versus reusable split"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(damageReusableDistribution.rows, damageReusableSerialDetailMap)}
            />
          </div>

          <div className="order-8 xl:col-span-1 flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50">
                  <Cpu className="h-4 w-4 text-sky-600" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900">BMS / BMU</div>
                  <div className="text-[11px] text-slate-400">Controller inventory split</div>
                </div>
              </div>
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(controllerDistribution.total)}</div>
            </div>

            <DistributionDonut
              distribution={controllerDistribution}
              ariaLabel="BMS and BMU count distribution"
              showShare
              large
              compactLegend
              showLegendValues
              legendLabelClassName="text-[12px] text-slate-600"
              stackLegend
              legendMarginRight
              donutMarginLeft
              donutMarginTop
              balancedVerticalMargin
              dropdowns={makeDonutDropdowns(controllerDistribution.rows, controllerSerialDetailMap)}
            />
          </div>
        </div>

        <div className="pb-6 text-center text-[11px] text-slate-400">Power2Go MES · CEO Dashboard · Data refreshes automatically</div>
      </div>
    </div>
  );
};

