import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronDown, Download, Factory, Gauge, Layers, PackageCheck, ShieldCheck, Truck, Zap } from 'lucide-react';
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

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh();
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
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

  const cellsSeries = useMemo(() => {
    const rows = (source.cellBuckets || []).map((row: any) => ({ label: row.label, value: numberOr(row.value), color: statusColors[row.label] || '#64748b' }));

    const filtered = selectedCellStatus === 'All'
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

  const cellsTotal = scaleValue(numberOr(inventory.totalCells));
  const moduleData = useMemo(() => (source.moduleStatusBuckets || []).map((row: any) => ({ status: String(row.label).replace(/_/g, ' '), value: numberOr(row.value) })), [source.moduleStatusBuckets]);
  const filteredModuleData = selectedModuleConfig === 'All' ? moduleData : moduleData.filter((row) => row.status === selectedModuleConfig);
  const moduleTotal = filteredModuleData.reduce((sum, row) => sum + row.value, 0);

  const batteryData = useMemo(() => {
    return (source.batteryStatusBuckets || []).map((row: any) => ({ label: String(row.label).replace(/_/g, ' '), value: scaleValue(numberOr(row.value)), color: statusColors[String(row.label).replace(/_/g, ' ')] || '#64748b' }));
  }, [source.batteryStatusBuckets, activeRange]);
  const filteredBatteryData = selectedPackType === 'All' ? batteryData : batteryData.filter((row) => row.label === selectedPackType);
  const batteryTotal = filteredBatteryData.reduce((sum, row) => sum + row.value, 0);

  const rackData = useMemo(() => {
    return (source.rackStatusBuckets || []).map((row: any) => ({ label: String(row.label).replace(/_/g, ' '), value: scaleValue(numberOr(row.value)), color: statusColors[String(row.label).replace(/_/g, ' ')] || '#64748b' }));
  }, [source.rackStatusBuckets, activeRange]);
  const filteredRackData = selectedRackType === 'All' ? rackData : rackData.filter((row) => row.label === selectedRackType);
  const rackTotal = filteredRackData.reduce((sum, row) => sum + row.value, 0);

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
        ['CREATED', 'ASSEMBLY', 'TESTING', 'QC', 'RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED', 'IN_PROCESS', 'QUARANTINED'],
        source.batteryStatusBuckets,
        statusColors,
      );
      const moduleReportRows = statusRows(
        ['CREATED', 'CELLS_ASSIGNED', 'ASSEMBLED', 'WELDED', 'QC', 'PASSED', 'FAILED', 'QUARANTINED'],
        source.moduleStatusBuckets,
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
          const legendY = y - radius + index * 7;
          doc.setFillColor(...hexRgb(row.color));
          doc.rect(x + radius + 8, legendY - 3, 3, 3, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...muted);
          doc.text(`${row.label}: ${formatNumber(row.value)}`, x + radius + 13, legendY);
        });
      };
      const drawBars = (x: number, y: number, width: number, height: number, rows: { label: string; value: number; color: string }[], title: string) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...ink);
        doc.text(title, x, y - 5);
        const visibleRows = rows.filter((row) => row.value > 0).sort((left, right) => right.value - left.value).slice(0, 6);
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
          const barHeight = (row.value / max) * height;
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
      drawDonut(43, 104, 22, cellReportRows, 'CELL INVENTORY');
      drawBars(105, 82, 82, 44, batteryReportRows, 'BATTERY PACK STATUS');
      drawBars(205, 82, 70, 44, rackReportRows, 'RACK STATUS');
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
      ];
      drawTable('REPORT CONTEXT', ['Field', 'Value'], contextRows.slice(0, 9), 145, margin, 88, true);
      drawTable('', ['Field', 'Value'], contextRows.slice(9), 145, 110, 88, true);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...muted);
      doc.text(`Active filters: Cells ${selectedCellStatus} | Packs ${selectedPackType} | Racks ${selectedRackType} | Modules ${selectedModuleConfig}`, margin, pageHeight - 12);

      doc.addPage();
      drawTitle('POWER2GO MES | OPERATIONS DETAIL', `Live database report   |   ${reportDate}`);
      drawTable('CELL STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], cellReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, cellReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 35, margin, 88, true);
      drawTable('MODULE STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], moduleReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, moduleReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 35, 110, 88, true);
      drawTable('BATTERY STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], batteryReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, batteryReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 105, margin, 88, true);
      drawTable('RACK STATUS - ALL ENUM VALUES', ['Status', 'Quantity', 'Share'], rackReportRows.map((row) => [row.label, formatNumber(row.value), `${((row.value / Math.max(1, rackReportRows.reduce((sum, item) => sum + item.value, 0))) * 100).toFixed(1)}%`]), 105, 110, 88, true);
      drawTable('MACHINE STATUS', ['Machine', 'Type', 'Status'], machines.map((machine: any) => [machine.name || machine.id || 'Unnamed', machine.type || '-', machine.status || 'UNKNOWN']), 165, margin, 176, true);

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
                  {filteredModuleData.map((item, columnIndex) => (
                    <g key={item.status} transform={`translate(${columnIndex * 52 + 35}, 0)`}>
                      <rect x="0" y={100 - item.value / 14} width="12" height={item.value / 14} fill="#16a34a" rx="2" />
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
              <div className="text-[18px] font-extrabold text-slate-900">{formatNumber(batteryTotal)}</div>
            </div>

            <div className="mb-3 flex gap-2 text-[10px]">
              {['All', ...batteryData.map((item) => item.label)].map((size) => (
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
                {filteredBatteryData.map((segment) => (
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
                  {filteredRackData.map((item, index) => (
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
