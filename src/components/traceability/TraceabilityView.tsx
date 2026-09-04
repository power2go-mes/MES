import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  GitMerge,
  Search,
  ArrowRight,
  ArrowDown,
  Layers,
  Cpu,
  Boxes,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ShieldCheck,
  Zap,
  Sparkles,
  ChevronRight,
  Package,
  Factory,
  ScanLine,
  Download,
} from 'lucide-react';

interface TraceNode {
  key: string;
  title: string;
  subtitle?: string;
  type: string;
  badge?: string;
  data: any;
  children?: TraceNode[];
}

const fmt = (v: any): string =>
  v === undefined || v === null || v === '' ? 'Not recorded' : String(v);

function makeNode(
  key: string,
  title: string,
  type: string,
  data: any,
  subtitle?: string,
  badge?: string,
  children?: TraceNode[]
): TraceNode {
  return { key, title, type, data, subtitle, badge, children };
}

function batterySubtree(bat: any, bms: any, bmu: any, modules = bat.modules || []): TraceNode {
  const children: TraceNode[] = [];
  modules.forEach((m: any, mi: number) => {
    const cellChildren: TraceNode[] = (m.cells || []).map((c: any, ci: number) =>
      makeNode(`cell-${c.id}`, c.internalSerial || c.supplierBarcode, 'CELL', c, `Cell ${mi + 1}-${ci + 1}`)
    );
    children.push(
      makeNode(`mod-${m.id}`, m.serialNumber, 'MODULE', m, `Module ${mi + 1}`, undefined, cellChildren)
    );
  });
  if (bms) children.push(makeNode('bms-' + bat.serialNumber, bms.serialNumber, 'BMS', bms, 'BMS/BMU'));
  if (bmu) children.push(makeNode('bmu-' + bat.serialNumber, bmu.serialNumber, 'BMU', bmu, 'BMS/BMU'));
  if (bat.finalQcResult)
    children.push(makeNode('finalqc-' + bat.serialNumber, 'Final QC', 'FINAL_QC', bat.finalQcResult, 'Final QC'));
  children.push(makeNode('release-' + bat.serialNumber, 'Release', 'RELEASE', { status: bat.status }, bat.status));
  return makeNode('battery-' + bat.serialNumber, bat.serialNumber, 'BATTERY', bat, 'Battery Pack', undefined, children);
}

function buildTree(t: any): TraceNode[] {
  const type = t.entityType;
  const e = t.entity;

  if (type === 'CELL') {
    const roots: TraceNode[] = [];
    const cellChildren: TraceNode[] = [];
    if (t.module) cellChildren.push(makeNode('module', t.module.serialNumber, 'MODULE', t.module, 'Module'));
    if (t.battery) {
      const bChildren: TraceNode[] = [];
      if (t.bms) bChildren.push(makeNode('bms-' + t.battery.serialNumber, t.bms.serialNumber, 'BMS', t.bms, 'BMS/BMU'));
      if (t.bmu) bChildren.push(makeNode('bmu-' + t.battery.serialNumber, t.bmu.serialNumber, 'BMU', t.bmu, 'BMS/BMU'));
      if (t.battery.finalQcResult)
        bChildren.push(makeNode('finalqc-' + t.battery.serialNumber, 'Final QC', 'FINAL_QC', t.battery.finalQcResult, 'Final QC'));
      bChildren.push(makeNode('release-' + t.battery.serialNumber, 'Release', 'RELEASE', { status: t.battery.status }, t.battery.status));
      cellChildren.push(
        makeNode('battery-' + t.battery.serialNumber, t.battery.serialNumber, 'BATTERY', t.battery, 'Battery Pack', undefined, bChildren)
      );
    }
    roots.push(makeNode('cell', e.internalSerial || e.supplierBarcode, 'CELL', e, 'Cell', e.status, cellChildren));
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  if (type === 'MODULE') {
    const modChildren: TraceNode[] = (t.cells || e.cells || []).map((c: any, ci: number) =>
      makeNode(`cell-${c.id}`, c.internalSerial || c.supplierBarcode, 'CELL', c, `Cell ${ci + 1}`)
    );
    if (t.battery) {
      const bChildren: TraceNode[] = [];
      if (t.bms) bChildren.push(makeNode('bms', t.bms.serialNumber, 'BMS', t.bms, 'BMS/BMU'));
      if (t.bmu) bChildren.push(makeNode('bmu', t.bmu.serialNumber, 'BMU', t.bmu, 'BMS/BMU'));
      if (t.battery.finalQcResult)
        bChildren.push(makeNode('finalqc', 'Final QC', 'FINAL_QC', t.battery.finalQcResult, 'Final QC'));
      bChildren.push(makeNode('release', 'Release', 'RELEASE', { status: t.battery.status }, t.battery.status));
      modChildren.push(
        makeNode('battery', t.battery.serialNumber, 'BATTERY', t.battery, 'Battery Pack', undefined, bChildren)
      );
    }
    const roots = [makeNode('module', e.serialNumber, 'MODULE', e, 'Module', e.status, modChildren)];
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  if (type === 'BATTERY') {
    const roots = [batterySubtree(e, t.bms, t.bmu, t.modules || [])];
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  if (type === 'BMS' || type === 'BMU') {
    const roots: TraceNode[] = [];
    const compChildren: TraceNode[] = [];
    if (t.battery) {
      compChildren.push(batterySubtree(t.battery, t.battery.bms, t.battery.bmu));
      const supplier = t.cells && t.cells[0] ? t.cells[0].supplierName : null;
      if (supplier) compChildren.push(makeNode('supplier', supplier, 'SUPPLIER', { name: supplier }, 'Supplier'));
    }
    roots.push(makeNode(type === 'BMS' ? 'bms' : 'bmu', e.serialNumber, type, e, type, e.status, compChildren));
    return roots;
  }

  if (type === 'PRODUCTION_ORDER') {
    const orderChildren: TraceNode[] = (t.batteries || []).map((b: any) =>
      batterySubtree(b, b.bms, b.bmu)
    );
    const roots = [makeNode('order', e.orderNumber, 'PRODUCTION_ORDER', e, 'Production Order', e.status, orderChildren)];
    return roots;
  }

  if (type === 'SUPPLIER_BATCH') {
    const batchChildren: TraceNode[] = (t.cells || []).map((c: any) =>
      makeNode(`cell-${c.id}`, c.internalSerial || c.supplierBarcode, 'CELL', c, 'Cell')
    );
    const roots = [makeNode('batch', e.batchIdentifier, 'BATCH', e, 'Supplier Batch', undefined, batchChildren)];
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  return [];
}

function findNode(key: string, nodes: TraceNode[]): TraceNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    if (n.children) {
      const found = findNode(key, n.children);
      if (found) return found;
    }
  }
  return null;
}

const NODE_ICON: Record<string, React.FC<any>> = {
  CELL: Cpu,
  MODULE: Layers,
  BATTERY: Zap,
  BMS: Cpu,
  BMU: Cpu,
  SUPPLIER: Truck,
  FINAL_QC: ShieldCheck,
  RELEASE: CheckCircle2,
  PRODUCTION_ORDER: Factory,
  BATCH: Boxes,
};

const TYPE_LABEL: Record<string, string> = {
  CELL: 'CELL',
  MODULE: 'MODULE',
  BATTERY: 'BATTERY',
  BMS: 'BMS',
  BMU: 'BMU',
  SUPPLIER: 'SUPPLIER',
  FINAL_QC: 'FINAL QC',
  RELEASE: 'RELEASE',
  PRODUCTION_ORDER: 'PRODUCTION ORDER',
  BATCH: 'SUPPLIER BATCH',
};

function detailFields(node: TraceNode): { label: string; value: string }[] {
  const d = node.data || {};
  switch (node.type) {
    case 'CELL':
      return [
        { label: 'Internal Serial', value: fmt(d.internalSerial) },
        { label: 'Supplier Barcode', value: fmt(d.supplierBarcode) },
        { label: 'Supplier Name', value: fmt(d.supplierName) },
        { label: 'Capacity (Supplier)', value: fmt(d.supplierCapacityAh) },
        { label: 'Supplier OCV', value: fmt(d.supplierOcvV) },
        { label: 'Production OCV', value: fmt(d.productionOcvV) },
        { label: 'Supplier IR', value: fmt(d.supplierIrMilliOhm) },
        { label: 'Production IR', value: fmt(d.productionIrMilliOhm) },
        { label: 'Grade (Supplier)', value: fmt(d.supplierGrade) },
        { label: 'Grade (Production)', value: fmt(d.productionGrade) },
        { label: 'Batch', value: fmt(d.batchNumber) },
        { label: 'Pallet', value: fmt(d.palletNumber) },
        { label: 'Box', value: fmt(d.boxNumber) },
        { label: 'Status', value: fmt(d.status) },
        { label: 'Tested At', value: fmt(d.testedAt) },
        { label: 'Tested By', value: fmt(d.testedBy) },
      ];
    case 'MODULE':
      return [
        { label: 'Module Serial', value: fmt(d.serialNumber) },
        { label: 'Matching Score', value: fmt(d.matchingScore) },
        { label: 'Assembly Status', value: fmt(d.status) },
        { label: 'Welding Status', value: fmt(d.weldingResult?.status) },
        { label: 'Laser Power (W)', value: fmt(d.weldingResult?.laserPowerWatts) },
        { label: 'Weld Pull Force (kg)', value: fmt(d.weldingResult?.pullForceKg) },
        { label: 'QC Physical OK', value: fmt(d.qcResult?.physicalVisualOk) },
        { label: 'QC Pack Voltage', value: fmt(d.qcResult?.packVoltageV) },
        { label: 'QC Status', value: fmt(d.qcResult?.status) },
        { label: 'Operator', value: fmt(d.weldingResult?.operatorId) },
        { label: 'Welded At', value: fmt(d.weldingResult?.weldedAt) },
      ];
    case 'BATTERY':
      return [
        { label: 'Battery Serial', value: fmt(d.serialNumber) },
        { label: 'Product', value: fmt(d.productName) },
        { label: 'Status', value: fmt(d.status) },
        { label: 'Modules', value: fmt((d.modules || []).length) },
        { label: 'Pack IR (mΩ)', value: fmt(d.finalQcResult?.internalResistanceMilliOhm) },
        { label: 'Pack Voltage (V)', value: fmt(d.finalQcResult?.packVoltageV) },
        { label: 'Final QC Status', value: fmt(d.finalQcResult?.status) },
        { label: 'QR Code', value: fmt(d.qrCode) },
        { label: 'Created', value: fmt(d.createdAt) },
      ];
    case 'BMS':
    case 'BMU':
      return [
        { label: 'Serial', value: fmt(d.serialNumber) },
        { label: 'Type', value: node.type },
        { label: 'Model', value: fmt(d.model) },
        { label: 'Protocol', value: fmt(d.protocol) },
        { label: 'Test Status', value: fmt(d.testResult?.status) },
        { label: 'CAN Comms OK', value: fmt(d.testResult?.canCommsOk) },
        { label: 'Operator', value: fmt(d.testResult?.testedBy) },
        { label: 'Tested At', value: fmt(d.testResult?.testedAt) },
        { label: 'Status', value: fmt(d.status) },
      ];
    case 'SUPPLIER':
      return [
        { label: 'Name', value: fmt(d.name) },
        { label: 'Code', value: fmt(d.code) },
        { label: 'Country', value: fmt(d.country) },
        { label: 'Chemistry', value: fmt(d.cellChemistry) },
        { label: 'Capacity (Ah)', value: fmt(d.nominalCapacityAh) },
        { label: 'Rating', value: fmt(d.ratingScore) },
      ];
    case 'FINAL_QC':
      return [
        { label: 'Status', value: fmt(d.status) },
        { label: 'Pack Voltage (V)', value: fmt(d.packVoltageV) },
        { label: 'Pack IR (mΩ)', value: fmt(d.internalResistanceMilliOhm) },
        { label: 'Hi-Pot Insulation (MΩ)', value: fmt(d.hiPotInsulationMOhm) },
        { label: 'BMS Telemetry OK', value: fmt(d.bmsTelemetryOk) },
        { label: 'Tested By', value: fmt(d.testedBy) },
        { label: 'Tested At', value: fmt(d.testedAt) },
      ];
    case 'RELEASE':
      return [{ label: 'Release Status', value: fmt(d.status) }];
    case 'PRODUCTION_ORDER':
      return [
        { label: 'Order Number', value: fmt(d.orderNumber) },
        { label: 'Product', value: fmt(d.productName) },
        { label: 'Quantity Planned', value: fmt(d.quantityPlanned) },
        { label: 'Completed', value: fmt(d.quantityCompleted) },
        { label: 'In Process', value: fmt(d.quantityInProcess) },
        { label: 'Status', value: fmt(d.status) },
      ];
    case 'BATCH':
      return [
        { label: 'Identifier', value: fmt(d.batchIdentifier) },
        { label: 'Match Field', value: fmt(d.matchField) },
        { label: 'Cell Count', value: fmt(d.cellCount) },
        { label: 'Supplier', value: fmt(d.supplierName) },
      ];
    default:
      return [];
  }
}

function csvValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function flattenTraceNodes(nodes: TraceNode[], parent = ''): string[][] {
  return nodes.flatMap(node => {
    const details = detailFields(node)
      .map(field => `${field.label}: ${field.value}`)
      .join('; ');
    const row = [node.type, node.title, parent, node.subtitle || '', node.badge || '', details];
    return [row, ...flattenTraceNodes(node.children || [], node.title)];
  });
}

const TreeNode: React.FC<{
  node: TraceNode;
  selectedKey: string;
  onSelect: (key: string) => void;
  depth: number;
}> = ({ node, selectedKey, onSelect, depth }) => {
  const Icon = NODE_ICON[node.type] || GitMerge;
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div>
      <button
        onClick={() => onSelect(node.key)}
        className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-left transition-all ${
          selectedKey === node.key
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'hover:bg-slate-50 border border-transparent text-slate-700'
        }`}
        style={{ marginLeft: depth * 14 }}
      >
        <Icon className="w-4 h-4 text-emerald-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold truncate">{node.title}</div>
          {node.subtitle && <div className="text-[10px] text-slate-400 truncate">{node.subtitle}</div>}
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
          {TYPE_LABEL[node.type] || node.type}
        </span>
      </button>
      {hasChildren &&
        node.children!.map(child => (
          <TreeNode key={child.key} node={child} selectedKey={selectedKey} onSelect={onSelect} depth={depth + 1} />
        ))}
    </div>
  );
};

export const TraceabilityView: React.FC = () => {
  const { quickSearchQuery, refreshKey } = useApp();
  const [query, setQuery] = useState(quickSearchQuery || '');
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<any | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [recentSerials, setRecentSerials] = useState<{ label: string; serial: string }[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    loadRecentSerials();
  }, [refreshKey]);

  useEffect(() => {
    if (quickSearchQuery) {
      setQuery(quickSearchQuery);
      handleSearch(quickSearchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSearchQuery]);

  const loadRecentSerials = async () => {
    try {
      setRecentSerials(await api.getRecentTraceItems());
    } catch {
      /* ignore */
    }
  };

  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery || query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setTrace(null);
    setSelectedKey('');
    try {
      const result = await api.universalTrace(q);
      setTrace(result);
    } catch (err: any) {
      setTrace(null);
      setError({ message: err.message || 'Traceability record not found.' });
    } finally {
      setLoading(false);
    }
  };

  const exportTraceReport = () => {
    if (!trace || tree.length === 0) return;

    const header = ['Type', 'Identifier', 'Parent', 'Relationship', 'Status', 'Details'];
    const rows = flattenTraceNodes(tree).map(row => [row[0], row[1], row[2], row[3], row[4], row[5]]);
    const csv = [header, ...rows].map(row => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const identifier = String(trace.identifier || trace.entity?.serialNumber || trace.entity?.id || 'trace')
      .replace(/[^a-z0-9_-]+/gi, '_');
    link.href = url;
    link.download = `${identifier}_trace_report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tree = trace ? buildTree(trace) : [];
  const activeNode = (selectedKey && findNode(selectedKey, tree)) || tree[0] || null;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
            <GitMerge className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
              Genealogy &amp; Traceability
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Trace any component, production order, supplier record, or finished battery.
            </p>
          </div>
        </div>

        {recentSerials.length > 0 && (
          <div className="flex items-center flex-wrap gap-2 mt-4">
            <span className="text-[11px] text-slate-400 font-semibold">Quick Trace:</span>
            {recentSerials.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setQuery(item.serial);
                  handleSearch(item.serial);
                }}
                className="px-2.5 py-1 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 text-[11px] font-mono font-semibold rounded-lg border border-slate-200 transition-colors"
              >
                {item.serial}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSearch();
          }}
          className="flex gap-2.5"
        >
          <div className="relative flex-1">
            <ScanLine className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Scan or enter any Cell, Module, Battery, BMS/BMU, Supplier or Production identifier..."
              className="w-full pl-10 pr-4 py-2.5 text-xs font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors"
          >
            <span>{loading ? 'Searching...' : 'Explore Trace'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Error Card */}
      {error && (
        <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 flex items-start space-x-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-rose-800">Identifier Not Found</p>
            <p className="text-[11px] mt-1">{error.message}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {trace && activeNode && (
        <>
          {/* Entity Found Header */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-md border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase tracking-wider font-mono">
                ENTITY FOUND
              </span>
              <div className="mt-2 space-y-1 text-xs">
                <p><span className="text-slate-400">Type:</span> <strong className="text-white">{TYPE_LABEL[trace.entityType] || trace.entityType}</strong></p>
                <p><span className="text-slate-400">Identifier:</span> <strong className="font-mono text-emerald-300">{trace.identifier}</strong></p>
                <p><span className="text-slate-400">Status:</span> <strong className="text-white">{trace.status}</strong></p>
              </div>
            </div>
            <button
              type="button"
              onClick={exportTraceReport}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-500/25"
              title="Download genealogy report"
            >
              <Download className="w-4 h-4" />
              <span>Export Trace CSV</span>
            </button>
          </div>

          {/* Tree + Detail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Traceability Map */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2 mb-2">
                <GitMerge className="w-4 h-4 text-slate-400" />
                <span>Traceability Map</span>
              </h3>
              {tree.map(node => (
                <TreeNode key={node.key} node={node} selectedKey={selectedKey} onSelect={setSelectedKey} depth={0} />
              ))}
            </div>

            {/* Detail Panel */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <ChevronRight className="w-4 h-4 text-emerald-500" />
                <span>{TYPE_LABEL[activeNode.type] || activeNode.type} Details</span>
              </h3>
              <dl className="divide-y divide-slate-100">
                {detailFields(activeNode).map((f, i) => (
                  <div key={i} className="py-2 flex items-center justify-between text-xs">
                    <dt className="text-slate-500 font-medium">{f.label}</dt>
                    <dd className="font-mono font-semibold text-slate-900 text-right truncate max-w-[60%]">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Audit Trail */}
          {trace.auditTrail && trace.auditTrail.length > 0 && (
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>Immutable Production Audit Trail</span>
              </h3>
              <div className="divide-y divide-slate-100">
                {trace.auditTrail.map((log: any) => (
                  <div key={log.id} className="py-3.5 flex items-start justify-between text-xs">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-900">{log.action}</p>
                      {log.reason && (
                        <p className="text-[11px] text-slate-700 font-medium bg-slate-50 px-2 py-0.5 rounded inline-block">
                          Reason: {log.reason}
                        </p>
                      )}
                      <div className="text-[10px] text-slate-400 font-mono">
                        User: <strong className="text-slate-700">{log.userName}</strong> ({log.userRole})
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!trace && !error && !loading && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400 text-xs">
          <ScanLine className="w-8 h-8 mx-auto mb-3 text-slate-300" />
          Enter any traceable identifier above to explore its complete genealogy.
        </div>
      )}
    </div>
  );
};

