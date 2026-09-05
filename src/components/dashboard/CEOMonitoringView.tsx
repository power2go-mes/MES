import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronDown, Download, Factory, Gauge, Layers, PackageCheck, ShieldCheck, Truck, Wrench, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

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
  Sold: '#059669',
  Scrap: '#ef4444',
};
const packColors = ['#2563eb', '#f59e0b', '#16a34a'];
type ChartRow = { label: string; value: number; color?: string };
type ModuleRow = { status: string; value: number };

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);
const formatShare = (value: number, total: number) => `${((value / Math.max(1, total)) * 100).toFixed(1)}%`;

const normalizeLifecycleBuckets = (rows: any[], entity: 'module' | 'battery') => {
  const totals = new Map<string, number>();
  (rows || []).forEach((row: any) => {
    const raw = String(row.label || '').replace(/_/g, ' ').toUpperCase();
    const label = entity === 'module'
      ? raw === 'IN PACK' ? 'In Pack' : raw === 'IN RACK' ? 'In Rack' : 'Available'
      : raw === 'IN RACK' ? 'In Rack' : raw === 'SOLD' ? 'Sold' : 'Available';
    totals.set(label, (totals.get(label) || 0) + numberOr(row.value));
  });
  const labels = entity === 'module' ? ['Available', 'In Pack', 'In Rack'] : ['Available', 'In Rack', 'Sold'];
  return labels.map(label => ({ label, value: totals.get(label) || 0 }));
};

const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const todayInputValue = dateInputValue(new Date());
const defaultStartInputValue = dateInputValue(new Date(Date.now() - 6 * 86400000));

export const CEOMonitoringView: React.FC = () => {
  const { refreshKey, addNotification } = useApp();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRange, setActiveRange] = useState<'Today' | 'This Week' | 'This Month' | 'Custom Range'>('Today');
  const [selectedCellStatus, setSelectedCellStatus] = useState<'All' | string>('All');
  const [selectedPackType, setSelectedPackType] = useState('All');
  const [selectedRackType, setSelectedRackType] = useState('All');
  const [selectedModuleConfig, setSelectedModuleConfig] = useState('All');
  const [customStartDate, setCustomStartDate] = useState(defaultStartInputValue);
  const [customEndDate, setCustomEndDate] = useState(todayInputValue);

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
  const machines = Array.isArray(source.machines) ? source.machines : [];
  const kpis = source.kpis ?? {};

  const customStartTimestamp = Date.parse(`${customStartDate}T12:00:00`);
  const customEndTimestamp = Date.parse(`${customEndDate}T12:00:00`);
  const customRangeDays = Number.isFinite(customStartTimestamp) && Number.isFinite(customEndTimestamp)
    ? Math.max(1, Math.round((customEndTimestamp - customStartTimestamp) / 86400000) + 1)
    : 1;
  const scaleValue = (value: number) => Math.max(0, Math.round(value));

  const cellsSeries = useMemo<ChartRow[]>(() => {
    const rows: ChartRow[] = (source.cellBuckets || []).map((row: any) => ({ label: row.label, value: numberOr(row.value), color: statusColors[row.label] || '#64748b' }));

    const filtered: ChartRow[] = selectedCellStatus === 'All'
      ? rows
      : rows.filter((row) => row.label === selectedCellStatus);

    return filtered.filter((row) => row.value > 0).map((row) => ({
      ...row,
      value: scaleValue(row.value),
    }));
  }, [source.cellBuckets, selectedCellStatus, activeRange]);

  const capacityProduced = ClampKwhFromFinishedBatteries(numberOr(inventory.finishedBatteries));
  const passRate = clamp(numberOr(quality.firstPassYieldPercent), 0, 100);
  const scrapRate = clamp((numberOr(inventory.quarantinedCells) / Math.max(1, numberOr(inventory.totalCells))) * 100, 0, 100);
  const onlineMachines = machines.filter((machine: any) => ['ONLINE', 'BUSY', 'RUNNING'].includes(String(machine?.status || '').toUpperCase())).length;
  const totalCells = Math.max(1, scaleValue(numberOr(inventory.totalCells)));
  const usedCellShare = clamp((scaleValue(numberOr(inventory.usedCells)) / totalCells) * 100, 0, 100);
  const completedOrders = scaleValue(numberOr(orders.completed));
  const totalOrders = Math.max(1, scaleValue(numberOr(orders.total)));
  const orderCompletion = clamp((completedOrders / totalOrders) * 100, 0, 100);
  const totalControllers = Math.max(1, scaleValue(numberOr(source.controllerInventory?.totalBms)) + scaleValue(numberOr(source.controllerInventory?.totalBmu)));
  const availableControllers = scaleValue(numberOr(source.controllerInventory?.availableBms)) + scaleValue(numberOr(source.controllerInventory?.availableBmu));
  const controllerReadiness = clamp((availableControllers / totalControllers) * 100, 0, 100);
  const openRisks = scaleValue(numberOr(source.quarantineOpenCount ?? quality.quarantinedCount ?? inventory.quarantinedCells));

  const cellsBucketTotal = (source.cellBuckets || []).reduce((sum: number, row: any) => sum + scaleValue(numberOr(row.value)), 0);
  const cellsTotal = cellsBucketTotal || scaleValue(numberOr(inventory.totalCells));
  const moduleBuckets = useMemo<ChartRow[]>(() => (source.moduleTypeBuckets || source.moduleStatusBuckets || []).map((row: any) => ({ label: String(row.label || ''), value: numberOr(row.value) })), [source.moduleTypeBuckets, source.moduleStatusBuckets]);
  const moduleData = useMemo<ModuleRow[]>(() => moduleBuckets.map((row) => ({ status: row.label, value: numberOr(row.value) })), [moduleBuckets]);
  const filteredModuleData: ModuleRow[] = selectedModuleConfig === 'All' ? moduleData : moduleData.filter((row) => row.status === selectedModuleConfig);
  const moduleTotal = filteredModuleData.reduce((sum: number, row: ModuleRow) => sum + row.value, 0);
  const moduleChartMax = Math.max(1, ...filteredModuleData.map((row: ModuleRow) => row.value));

  const batteryData = useMemo(() => {
    return normalizeLifecycleBuckets(source.batteryStatusBuckets, 'battery').map((row: any) => ({ label: row.label, value: scaleValue(numberOr(row.value)), color: statusColors[row.label] || '#64748b' }));
  }, [source.batteryStatusBuckets, activeRange]);
  const batteryPackData = useMemo<ChartRow[]>(() => (source.batteryPackBuckets || []).map((row: any, index: number) => ({
    label: String(row.label || 'Unnamed Pack'),
    value: scaleValue(numberOr(row.value)),
    color: packColors[index % packColors.length],
  })), [source.batteryPackBuckets]);
  const filteredBatteryPackData: ChartRow[] = selectedPackType === 'All' ? batteryPackData : batteryPackData.filter((row) => row.label === selectedPackType);
  const batteryPackTotal = filteredBatteryPackData.reduce((sum: number, row: ChartRow) => sum + row.value, 0);

  const rackData = useMemo<ChartRow[]>(() => {
    return (source.rackStatusBuckets || []).map((row: any) => ({ label: String(row.label).replace(/_/g, ' '), value: scaleValue(numberOr(row.value)), color: statusColors[String(row.label).replace(/_/g, ' ')] || '#64748b' }));
  }, [source.rackStatusBuckets, activeRange]);
  const filteredRackData: ChartRow[] = selectedRackType === 'All' ? rackData : rackData.filter((row) => row.label === selectedRackType);
  const rackTotal = filteredRackData.reduce((sum: number, row: ChartRow) => sum + row.value, 0);
  const rackChartMax = Math.max(1, ...filteredRackData.map((row: ChartRow) => row.value));

  const kpiCards = [
    { label: 'Capacity Produced', value: `${formatNumber(scaleValue(capacityProduced))} kWh`, delta: 'Live database value', positive: true, icon: <Zap className="h-5 w-5 text-emerald-600" />, bg: '#f0fdf4' },
    { label: 'Batteries Produced', value: formatNumber(scaleValue(numberOr(inventory.finishedBatteries))), delta: 'Live database value', positive: true, icon: <Factory className="h-5 w-5 text-blue-600" />, bg: '#eff6ff' },
    { label: 'Racks Produced', value: formatNumber(rackTotal), delta: 'Live database value', positive: true, icon: <PackageCheck className="h-5 w-5 text-violet-600" />, bg: '#f5f3ff' },
    { label: 'Cells in Inventory', value: formatNumber(scaleValue(numberOr(inventory.availableCells))), delta: 'Live database value', positive: true, icon: <Boxes className="h-5 w-5 text-amber-600" />, bg: '#fff7ed' },
    { label: 'Quality Pass Rate', value: `${passRate.toFixed(1)}%`, delta: 'Live database value', positive: true, icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />, bg: '#f0fdf4' },
    { label: 'Scrap Rate', value: `${scrapRate.toFixed(1)}%`, delta: 'Live database value', positive: true, icon: <AlertTriangle className="h-5 w-5 text-rose-600" />, bg: '#fef2f2' },
  ];

  const exportReport = () => {
    setExporting(true);
    try {
      const reportDate = new Date().toISOString().slice(0, 10);
      const rangeLabel = activeRange === 'Custom Range'
        ? `${customStartDate} to ${customEndDate}`
        : activeRange;
      const statusRows = (statuses: string[], sourceRows: any[], colorMap: Record<string, string>) => {
        const values = new Map((sourceRows || []).map((row: any) => [String(row.label).replace(/_/g, ' ').toUpperCase(), numberOr(row.value)]));
        return statuses.map((status) => ({
          label: status.replace(/_/g, ' '),
          value: values.get(status.replace(/_/g, ' ').toUpperCase()) || 0,
          color: colorMap[status.replace(/_/g, ' ')] || '#94a3b8',
        }));
      };
      const cellReportRows = statusRows(
        ['In Stock', 'Floor Stock', 'In Module', 'In Pack', 'In Rack', 'Sold', 'Scrap'],
        source.cellBuckets,
        statusColors,
      );
      const batteryReportRows = statusRows(
        ['Available', 'In Rack', 'Sold'],
        normalizeLifecycleBuckets(source.batteryStatusBuckets, 'battery'),
        statusColors,
      );
      const moduleReportRows = statusRows(
        ['Available', 'In Pack', 'In Rack'],
        normalizeLifecycleBuckets(source.moduleStatusBuckets, 'module'),
        statusColors,
      );
      const rackReportRows = statusRows(
        ['IN_STOCK', 'IN_RACK', 'SOLD', 'SCRAP'],
        source.rackStatusBuckets,
        statusColors,
      );
      const reportBatteryTotal = batteryReportRows.reduce((sum, row) => sum + row.value, 0);
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;
      const green = [58, 170, 53] as const;
      const ink = [17, 17, 17] as const;
      const muted = [100, 116, 139] as const;
      const light = [244, 245, 247] as const;
      const hexRgb = (hex: string): [number, number, number] => {
        const value = hex.replace('#', '');
        return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
      };
      const drawTitle = (title: string, subtitle: string) => {
        doc.setFillColor(...ink);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(title, margin, 11);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(subtitle, margin, 18);
        doc.setTextColor(...ink);
      };
      const drawDonut = (x: number, y: number, radius: number, rows: { label: string; value: number; color: string }[], title: string) => {
        const total = rows.reduce((sum, row) => sum + row.value, 0);
        const chartTotal = total || 1;
        let start = -Math.PI / 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(title, x - radius, y - radius - 5);
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
        doc.setFontSize(13);
        doc.text(formatNumber(total), x, y + 2, { align: 'center' });
        rows.slice(0, 8).forEach((row, index) => {
          const legendColumn = index < 4 ? 0 : 1;
          const legendIndex = index % 4;
          const legendX = x - radius - 13 + legendColumn * 35;
          const legendY = y + radius + 8 + legendIndex * 5;
          doc.setFillColor(...hexRgb(row.color));
          doc.rect(legendX, legendY - 3, 2, 2, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.5);
          doc.setTextColor(...muted);
          doc.text(`${row.label.slice(0, 9)} ${formatNumber(row.value)}`, legendX + 3, legendY);
        });
      };
      const drawBars = (x: number, y: number, width: number, height: number, rows: { label: string; value: number; color: string }[], title: string) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...ink);
        doc.text(title, x, y - 5);
        const visibleRows = rows.sort((left, right) => right.value - left.value).slice(0, 6);
        if (!visibleRows.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text('No recorded data', x, y + height / 2);
          return;
        }
        const max = Math.max(...visibleRows.map((row) => row.value), 1);
        const barWidth = Math.min(18, (width - Math.max(visibleRows.length - 1, 0) * 5) / Math.max(visibleRows.length, 1));
        visibleRows.forEach((row, index) => {
          const barHeight = row.value > 0 ? Math.max((row.value / max) * height, 1.5) : 0;
          const barX = x + index * (barWidth + 5);
          doc.setFillColor(...hexRgb(row.color));
          doc.roundedRect(barX, y + height - barHeight, barWidth, barHeight, 1.5, 1.5, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(...muted);
          doc.text(row.label.slice(0, 12), barX + barWidth / 2, y + height + 7, { align: 'center' });
          doc.text(formatNumber(row.value), barX + barWidth / 2, y + height - barHeight - 2, { align: 'center' });
        });
      };
      const drawTable = (title: string, columns: string[], rows: string[][], y: number, x = margin, tableWidth = pageWidth - margin * 2, compact = false) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(compact ? 7 : 10);
        doc.setTextColor(...ink);
        if (title) doc.text(title, x, y);
        const rowHeight = compact ? 4 : 7;
        const columnWidth = tableWidth / columns.length;
        doc.setFillColor(...ink);
        doc.rect(x, y + 3, tableWidth, rowHeight, 'F');
        doc.setFontSize(compact ? 5 : 7);
        doc.setTextColor(255, 255, 255);
        columns.forEach((column, index) => doc.text(column, x + index * columnWidth + 2, y + (compact ? 6 : 8)));
        rows.forEach((row, rowIndex) => {
          const rowY = y + (compact ? 7 : 10) + rowIndex * rowHeight;
          const rowColor: [number, number, number] = rowIndex % 2 ? [250, 250, 250] : [255, 255, 255];
          doc.setFillColor(...rowColor);
          doc.rect(x, rowY, tableWidth, rowHeight, 'F');
          doc.setTextColor(...muted);
          row.forEach((value, index) => doc.text(String(value).slice(0, compact ? 24 : 30), x + index * columnWidth + 2, rowY + (compact ? 2.8 : 5)));
        });
      };

      drawTitle('POWER2GO MES | CEO PERFORMANCE REPORT', `Reporting range: ${rangeLabel}   |   Generated: ${reportDate}`);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...green);
      doc.text('EXECUTIVE SNAPSHOT', margin, 34);
      kpiCards.forEach((card, index) => {
        const cardWidth = (pageWidth - margin * 2 - 15) / 6;
        const x = margin + index * (cardWidth + 3);
        doc.setFillColor(...light);
        doc.roundedRect(x, 39, cardWidth, 25, 2, 2, 'F');
        doc.setTextColor(...muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(card.label, x + 3, 46, { maxWidth: cardWidth - 6 });
        doc.setTextColor(...ink);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(card.value, x + 3, 57);
      });
      drawDonut(30, 94, 15, cellReportRows, 'CELL INVENTORY');
      drawBars(78, 77, 48, 38, moduleReportRows, 'MODULE STATUS');
      drawBars(143, 77, 55, 38, batteryReportRows, 'BATTERY PACK STATUS');
      drawBars(216, 77, 60, 38, rackReportRows, 'RACK STATUS');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...green);
      doc.text('EXECUTIVE PULSE', margin, 140);
      const pulseRows = [
        ['Inventory utilization', `${usedCellShare.toFixed(1)}%`, `${formatNumber(scaleValue(numberOr(inventory.usedCells)))} used cells`],
        ['Controller readiness', `${controllerReadiness.toFixed(1)}%`, `${formatNumber(availableControllers)} available BMS/BMU`],
        ['Order completion', `${orderCompletion.toFixed(1)}%`, `${formatNumber(completedOrders)} of ${formatNumber(totalOrders)} orders`],
        ['Open operational risks', formatNumber(openRisks), 'Open quarantine records'],
      ];
      const pulseWidth = (pageWidth - margin * 2 - 9) / 4;
      pulseRows.forEach((row, index) => {
        const x = margin + index * (pulseWidth + 3);
        doc.setFillColor(...light);
        doc.roundedRect(x, 145, pulseWidth, 20, 2, 2, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(...muted);
        doc.text(row[0], x + 3, 151, { maxWidth: pulseWidth - 6 });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...ink);
        doc.text(row[1], x + 3, 158);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.setTextColor(...muted);
        doc.text(row[2], x + 3, 163, { maxWidth: pulseWidth - 6 });
      });
      const contextRows = [
        ['Reporting range', rangeLabel],
        ['Generated at', new Date().toLocaleString()],
        ['Total cell records', formatNumber(numberOr(inventory.totalCells))],
        ['Available cells', formatNumber(numberOr(inventory.availableCells))],
        ['Reserved cells', formatNumber(numberOr(inventory.reservedCells))],
        ['Cells in process', formatNumber(numberOr(inventory.inProcessCells))],
        ['Cells assembled', formatNumber(numberOr(inventory.assembledCells))],
        ['Open quarantines', formatNumber(numberOr(quality.quarantinedCount ?? inventory.quarantinedCells))],
        ['Quality pass rate', `${passRate.toFixed(1)}%`],
        ['Scrap rate', `${scrapRate.toFixed(1)}%`],
        ['Online machines', `${onlineMachines} / ${machines.length}`],
        ['Total batteries', formatNumber(reportBatteryTotal)],
        ['Total racks', formatNumber(rackTotal)],
        ['Orders total', formatNumber(numberOr(orders.total))],
        ['Orders in process', formatNumber(numberOr(orders.inProcess))],
        ['Orders completed', formatNumber(numberOr(orders.completed))],
        ['Orders planned', formatNumber(numberOr(orders.planned))],
        ['Inventory utilization', `${usedCellShare.toFixed(1)}%`],
        ['Order completion', `${orderCompletion.toFixed(1)}%`],
        ['Controller readiness', `${controllerReadiness.toFixed(1)}%`],
        ['Open operational risks', formatNumber(openRisks)],
      ];
      drawTable('REPORT CONTEXT', ['Field', 'Value'], contextRows.slice(0, 7), 168, margin, 88, true);
      drawTable('', ['Field', 'Value'], contextRows.slice(7, 14), 168, 110, 88, true);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...muted);
      doc.text(`Active filters: Cells ${selectedCellStatus} | Packs ${selectedPackType} | Racks ${selectedRackType} | Modules ${selectedModuleConfig}`, margin, pageHeight - 2);

      doc.addPage();
      drawTitle('POWER2GO MES | OPERATIONS DETAIL', `Live database report   |   ${reportDate}`);
      drawTable('CELL STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], cellReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, cellReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 35, margin, 88, true);
      drawTable('MODULE STATUS', ['Status', 'Quantity', 'Share'], moduleReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, moduleReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 35, 110, 88, true);
      drawTable('BATTERY PACK STATUS', ['Status', 'Quantity', 'Share'], batteryReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, batteryReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 105, margin, 88, true);
      drawTable('RACK STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], rackReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, rackReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 105, 110, 88, true);
      drawTable('REPORT CONTEXT CONTINUED', ['Field', 'Value'], contextRows.slice(14), 165, margin, 88, true);
      drawTable('MACHINE STATUS', ['Machine', 'Type', 'Status'], machines.map((machine: any) => [machine.name || machine.id || 'Unnamed', machine.type || '-', machine.status || 'UNKNOWN']), 165, 110, 88, true);

      const recentRows = (source.recentBatteries || []).slice(0, 12).map((battery: any) => [
        battery.serialNumber || battery.serial_number || battery.id || '-',
        battery.productName || battery.product_name || '-',
        `${numberOr(battery.progressPercent ?? battery.progress_percent)}%`,
        String(battery.status || '-'),
      ]);
      if (recentRows.length) {
        doc.addPage();
        drawTitle('POWER2GO MES | PRODUCTION DETAIL', `Recent batteries   |   ${reportDate}`);
        drawTable('RECENT BATTERY BUILDS', ['Serial', 'Product', 'Progress', 'Status'], recentRows, 35, margin, pageWidth - margin * 2, true);
      }

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
            <p className="mt-1 text-sm text-slate-500">Real-time overview of production, inventory, sales and traceability</p>
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Inventory Utilization', value: `${usedCellShare.toFixed(1)}%`, detail: `${formatNumber(scaleValue(numberOr(inventory.usedCells)))} used cells`, icon: <Gauge className="h-4 w-4 text-emerald-600" />, color: '#16a34a', progress: usedCellShare },
            { label: 'Controller Readiness', value: `${controllerReadiness.toFixed(1)}%`, detail: `${formatNumber(availableControllers)} available BMS/BMU`, icon: <Wrench className="h-4 w-4 text-amber-600" />, color: '#f59e0b', progress: controllerReadiness },
          ].map((pulse) => (
            <div key={pulse.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50">{pulse.icon}</div>
                  <span className="text-[11px] font-semibold text-slate-500">{pulse.label}</span>
                </div>
                <span className="text-[20px] font-extrabold text-slate-900">{pulse.value}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pulse.progress}%`, backgroundColor: pulse.color }} />
              </div>
              <div className="mt-2 text-[10px] text-slate-400">{pulse.detail}</div>
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
                  {cellsSeries.filter((segment) => segment.value > 0).map((segment, index, visibleSegments) => {
                    const total = visibleSegments.reduce((sum, item) => sum + item.value, 0) || 1;
                    const prev = visibleSegments.slice(0, index).reduce((sum, item) => sum + item.value, 0);
                    const startPercent = (prev / total) * 100;
                    const segmentPercent = (segment.value / total) * 100;
                    return (
                      <circle
                        className="chart-donut-segment"
                        key={segment.label}
                        cx="50"
                        cy="50"
                        r="35"
                        pathLength="100"
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="14"
                        strokeDasharray={`${segmentPercent} ${100 - segmentPercent}`}
                        strokeDashoffset={-startPercent}
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
                    <span className="font-semibold text-slate-900">{formatNumber(segment.value)} <span className="font-normal text-slate-400">({formatShare(segment.value, cellsTotal)})</span></span>
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(moduleTotal)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', ...moduleData.map((item) => item.status)].map((option) => (
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

            <div className="h-[190px] w-full">
              <svg viewBox="0 0 220 120" className="h-full w-full">
                {[0, 1, 2, 3].map((row) => (
                  <line key={row} x1="20" x2="200" y1={row * 28 + 12} y2={row * 28 + 12} stroke="#e5e7eb" strokeDasharray="2 3" />
                ))}
                <g>
                  {filteredModuleData.length === 0 && <text x="110" y="60" textAnchor="middle" fontSize="9" fill="#94a3b8">No recorded data</text>}
                  {filteredModuleData.map((item, columnIndex) => {
                    const slotWidth = 180 / Math.max(filteredModuleData.length, 1);
                    const barHeight = (item.value / moduleChartMax) * 82;
                    const labelParts = item.status.split(' ');
                    return (
                    <g key={`${item.status}-${item.value}`} transform={`translate(${20 + columnIndex * slotWidth + slotWidth / 2 - 8}, 0)`}>
                      <rect className="chart-bar" x="0" y={94 - barHeight} width="16" height={barHeight} fill="#16a34a" rx="2">
                        <title>{`${item.status}: ${formatNumber(item.value)}`}</title>
                      </rect>
                      <text x="8" y={Math.max(8, 90 - barHeight)} textAnchor="middle" fontSize="7" fontWeight="600" fill="#111111">{formatNumber(item.value)}</text>
                      <text x="8" y="108" textAnchor="middle" fontSize="7" fill="#64748b">{labelParts[0]}</text>
                      {labelParts.length > 1 && <text x="8" y="117" textAnchor="middle" fontSize="7" fill="#64748b">{labelParts.slice(1).join(' ')}</text>}
                    </g>
                    );
                  })}
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(batteryPackTotal)}</div>
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

            <div className="flex items-center gap-6">
              <div className="h-[190px] w-[190px] shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full" aria-label="Battery packs donut chart">
                  <circle cx="50" cy="50" r="35" fill="none" stroke="#e5e7eb" strokeWidth="14" />
                  {filteredBatteryPackData.filter((segment) => segment.value > 0).map((segment, index, visibleSegments) => {
                    const total = visibleSegments.reduce((sum, item) => sum + item.value, 0) || 1;
                    const previous = visibleSegments.slice(0, index).reduce((sum, item) => sum + item.value, 0);
                    const startPercent = (previous / total) * 100;
                    const segmentPercent = (segment.value / total) * 100;
                    return (
                      <circle
                        className="chart-donut-segment"
                        key={segment.label}
                        cx="50"
                        cy="50"
                        r="35"
                        pathLength="100"
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="14"
                        strokeDasharray={`${segmentPercent} ${100 - segmentPercent}`}
                        strokeDashoffset={-startPercent}
                        transform="rotate(-90 50 50)"
                        strokeLinecap="round"
                      />
                    );
                  })}
                  <circle cx="50" cy="50" r="22" fill="white" />
                </svg>
              </div>

              <div className="flex-1 space-y-2.5 py-2">
                  {filteredBatteryPackData.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between gap-3 text-[12px]">
                    <div className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <span className="font-semibold text-slate-900">{formatNumber(segment.value)} <span className="font-normal text-slate-400">({formatShare(segment.value, batteryPackTotal)})</span></span>
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

            <div className="h-[190px] w-full">
              <svg viewBox="0 0 220 120" className="h-full w-full">
                {[0, 1, 2, 3].map((row) => (
                  <line key={row} x1="20" x2="200" y1={row * 28 + 12} y2={row * 28 + 12} stroke="#e5e7eb" strokeDasharray="2 3" />
                ))}
                <g>
                  {filteredRackData.length === 0 && <text x="110" y="60" textAnchor="middle" fontSize="9" fill="#94a3b8">No recorded data</text>}
                  {filteredRackData.map((item, index) => {
                    const slotWidth = 180 / Math.max(filteredRackData.length, 1);
                    const barHeight = (item.value / rackChartMax) * 82;
                    const labelParts = item.label.split(' ');
                    return (
                    <g key={`${item.label}-${item.value}`} transform={`translate(${20 + index * slotWidth + slotWidth / 2 - 12}, 0)`}>
                      <rect className="chart-bar" x="0" y={94 - barHeight} width="24" height={barHeight} fill={item.color} rx="4">
                        <title>{`${item.label}: ${formatNumber(item.value)}`}</title>
                      </rect>
                      <text x="12" y={Math.max(8, 90 - barHeight)} textAnchor="middle" fontSize="7" fontWeight="600" fill="#111111">{formatNumber(item.value)}</text>
                      <text x="12" y="108" textAnchor="middle" fontSize="7" fill="#64748b">{labelParts[0]}</text>
                      {labelParts.length > 1 && <text x="12" y="117" textAnchor="middle" fontSize="7" fill="#64748b">{labelParts.slice(1).join(' ')}</text>}
                    </g>
                    );
                  })}
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
