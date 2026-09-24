import React, { useState, useEffect, useRef } from 'react';
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
import { CopyToClipboardButton } from '../common/CopyToClipboardButton';
import { preferredLifecycleStatus } from '../../services/api';
import { normalizeBatterySerial } from '../../lib/batteryNaming';
import { normalizeRackSerial } from '../../lib/rackNaming';

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

const displayBatterySerial = normalizeBatterySerial;
const displayRackSerial = normalizeRackSerial;

const fmtDateOnly = (v: any): string => {
  if (v === undefined || v === null || v === '') return 'Not recorded';
  const datePart = String(v).split('T')[0];
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : fmt(v);
};

const fmtDateShort = (v: any): string => {
  const date = fmtDateOnly(v);
  return date.match(/^(\d{2})-(\d{2})-(\d{4})$/) ? `${date.slice(0, 6)}${date.slice(-2)}` : date;
};

const formatTraceStatus = (status: any): string => String(status || '')
  .replace(/^KARACHI_WAREHOUSE$/, 'Karachi Warehouse')
  .replace(/^LAHORE_WAREHOUSE$/, 'Lahore Warehouse')
  .replace(/_/g, ' ');

const getBatteryTraceStatus = (battery: any): string => String(
  battery?.status === 'KARACHI_WAREHOUSE' || battery?.status === 'LAHORE_WAREHOUSE'
    ? battery.status
    : battery?.lifecycleStatus || battery?.lifecycle_status || battery?.status || '',
);

const getRackTraceWarehouse = (rack: any): string | null => {
  const warehouse = String(rack?.status || rack?.location || '').toUpperCase();
  if (warehouse.includes('LAHORE')) return 'Lahore Warehouse';
  if (warehouse.includes('KARACHI')) return 'Karachi Warehouse';
  return null;
};

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

function batterySubtree(bat: any, bms: any, bmu: any, modules = bat.modules || [], rack?: any): TraceNode {
  const children: TraceNode[] = [];
  modules.forEach((m: any, mi: number) => {
    const cellChildren: TraceNode[] = (m.cells || []).map((c: any, ci: number) =>
      makeNode(`cell-${c.id}`, c.supplierBarcode || c.internalSerial || c.id, 'CELL', c, `Cell ${mi + 1} · Slot ${Number(c.moduleSlotIndex ?? ci) + 1}`)
    );
    children.push(
      makeNode(`mod-${m.id}`, m.serialNumber, 'MODULE', m, `Module ${mi + 1}`, undefined, cellChildren)
    );
  });
  if (bms) children.push(makeNode('bms-' + bat.serialNumber, bms.serialNumber, 'BMS', bms, 'BMS/BMU'));
  if (bmu && bmu.serialNumber !== bms?.serialNumber) children.push(makeNode('bmu-' + bat.serialNumber, bmu.serialNumber, 'BMU', bmu, 'BMS/BMU'));
  if (bat.finalQcResult)
    children.push(makeNode('finalqc-' + bat.serialNumber, 'Final QC', 'FINAL_QC', bat.finalQcResult, 'Final QC'));
  const batteryStatus = getBatteryTraceStatus(bat);
  children.push(makeNode('release-' + bat.serialNumber, 'Release', 'RELEASE', { status: batteryStatus }, batteryStatus));
  if (rack) children.push(makeNode('rack-' + displayRackSerial(rack.serialNumber || rack.id), displayRackSerial(rack.serialNumber || rack.id), 'RACK', rack, 'Rack', rack.status));
  return makeNode('battery-' + bat.serialNumber, displayBatterySerial(bat.serialNumber), 'BATTERY', bat, 'Battery Pack', undefined, children);
}

function rackSubtree(rack: any, batteries: any[] = []): TraceNode {
  const children = batteries.map((battery: any, index: number) => (
    batterySubtree(battery, battery.bms, battery.bmu, battery.modules || [])
  ));
  return makeNode('rack-' + displayRackSerial(rack.serialNumber || rack.id), displayRackSerial(rack.serialNumber || rack.id), 'RACK', rack, 'Rack', rack.status, children);
}

export function buildModuleTraceNodes(data: any): TraceNode[] {
  const moduleEntity = data.module || {};
  const moduleCells = Array.isArray(data.cells) ? data.cells : Array.isArray(data.entity?.cells) ? data.entity.cells : [];
  const modChildren: TraceNode[] = moduleCells.map((c: any, ci: number) =>
    makeNode(`cell-${c.id}`, c.supplierBarcode || c.internalSerial || c.id, 'CELL', c, `Slot ${Number(c.moduleSlotIndex ?? ci) + 1}`)
  );

  if (data.battery) {
    const bChildren: TraceNode[] = [];
    if (data.bms) bChildren.push(makeNode('bms', data.bms.serialNumber, 'BMS', data.bms, 'BMS/BMU'));
    if (data.bmu && data.bmu.serialNumber !== data.bms?.serialNumber) bChildren.push(makeNode('bmu', data.bmu.serialNumber, 'BMU', data.bmu, 'BMS/BMU'));
    if (data.battery.finalQcResult) bChildren.push(makeNode('finalqc', 'Final QC', 'FINAL_QC', data.battery.finalQcResult, 'Final QC'));
    const batteryStatus = getBatteryTraceStatus(data.battery);
    bChildren.push(makeNode('release', 'Release', 'RELEASE', { status: batteryStatus }, batteryStatus));
    if (data.rack) {
      const rack = data.rack;
      bChildren.push(makeNode('rack', displayRackSerial(rack.serialNumber || rack.id), 'RACK', rack, 'Rack', rack.status));
    }
    modChildren.push(makeNode(`battery-summary-${data.battery.id}`, displayBatterySerial(data.battery.serialNumber), 'BATTERY', data.battery, 'Battery Pack', undefined, bChildren));
  }

  if (data.rack && !data.battery) {
    modChildren.push(makeNode('rack', displayRackSerial(data.rack.serialNumber || data.rack.id), 'RACK', data.rack, 'Rack', data.rack.status));
  }

  const roots = [makeNode('module', moduleEntity.serialNumber || moduleEntity.id, 'MODULE', moduleEntity, 'Module', moduleEntity.lifecycleStatus || moduleEntity.lifecycle_status || moduleEntity.status, modChildren)];
  if (data.supplier) roots.unshift(makeNode('supplier', data.supplier.name, 'SUPPLIER', data.supplier, 'Supplier'));
  return roots;
}

export function buildTree(t: any): TraceNode[] {
  const type = t.entityType;
  const e = t.entity;
  const cellStatus = (cell: any) => cell.lifecycleStatus || cell.lifecycle_status || cell.status;

  if (type === 'CELL') {
    const roots: TraceNode[] = [];
    const cellChildren: TraceNode[] = [];
    if (t.module) cellChildren.push(makeNode('module', t.module.serialNumber || t.module.serial_number || t.module.id, 'MODULE', t.module, 'Module'));
    if (t.battery) {
      const bChildren: TraceNode[] = [];
      if (t.bms) bChildren.push(makeNode('bms-' + (t.battery.serialNumber || t.battery.serial_number), t.bms.serialNumber || t.bms.serial_number, 'BMS', t.bms, 'BMS/BMU'));
      if (t.bmu && (t.bmu.serialNumber || t.bmu.serial_number) !== (t.bms?.serialNumber || t.bms?.serial_number)) bChildren.push(makeNode('bmu-' + (t.battery.serialNumber || t.battery.serial_number), t.bmu.serialNumber || t.bmu.serial_number, 'BMU', t.bmu, 'BMS/BMU'));
      if (t.battery.finalQcResult)
        bChildren.push(makeNode('finalqc-' + (t.battery.serialNumber || t.battery.serial_number), 'Final QC', 'FINAL_QC', t.battery.finalQcResult, 'Final QC'));
      const batteryStatus = getBatteryTraceStatus(t.battery);
      bChildren.push(makeNode('release-' + (t.battery.serialNumber || t.battery.serial_number), 'Release', 'RELEASE', { status: batteryStatus }, batteryStatus));
      if (t.rack) {
        const rack = t.rack;
        bChildren.push(makeNode('rack-' + displayRackSerial(rack.serialNumber || rack.serial_number || rack.id), displayRackSerial(rack.serialNumber || rack.serial_number || rack.id), 'RACK', rack, 'Rack', rack.status));
      }
      if (String(t.battery.status || t.battery.lifecycleStatus || t.battery.lifecycle_status || '').toUpperCase() === 'SOLD') {
        bChildren.push(makeNode('sale-' + (t.battery.serialNumber || t.battery.serial_number), 'Sale', 'SOLD', { clientName: t.saleHistory?.client_name || t.saleHistory?.clientName || 'Not recorded' }, 'Sold'));
      }
      if (String(t.battery.status || t.battery.lifecycleStatus || t.battery.lifecycle_status || '').toUpperCase() === 'SCRAP') {
        bChildren.push(makeNode('scrap-' + (t.battery.serialNumber || t.battery.serial_number), 'Damage', 'SCRAP', { reason: t.scrapRecord?.reason || 'Damage record' }, 'Damage'));
      }
      cellChildren.push(
        makeNode('battery-' + (t.battery.serialNumber || t.battery.serial_number), displayBatterySerial(t.battery.serialNumber || t.battery.serial_number), 'BATTERY', t.battery, 'Battery Pack', undefined, bChildren)
      );
    }
    if (t.rack && !t.battery) {
      cellChildren.push(makeNode('rack-' + displayRackSerial(t.rack.serialNumber || t.rack.id), displayRackSerial(t.rack.serialNumber || t.rack.id), 'RACK', t.rack, 'Rack', t.rack.status));
    }
    roots.push(makeNode('cell', e.supplierBarcode || e.internalSerial || e.id, 'CELL', e, 'Cell', cellStatus(e), cellChildren));
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  if (type === 'MODULE') {
    return buildModuleTraceNodes({
      module: e,
      cells: t.cells || e.cells || [],
      battery: t.battery,
      bms: t.bms,
      bmu: t.bmu,
      rack: t.rack,
      supplier: t.supplier,
    });
  }

  if (type === 'BATTERY') {
    const batteryWithModules = { ...e, modules: t.modules || e.modules || [] };
    const roots = [batterySubtree(batteryWithModules, t.bms, t.bmu, batteryWithModules.modules, t.rack)];
    if (t.saleHistory) {
      roots.unshift(makeNode('sale', 'Sale', 'SOLD', { clientName: t.saleHistory.client_name || t.saleHistory.clientName || 'Not recorded' }, 'Sold'));
    }
    if (t.scrapRecord) {
      roots.unshift(makeNode('scrap', 'Scrap', 'SCRAP', { reason: t.scrapRecord.reason || 'Scrap record' }, 'Scrap'));
    }
    if (t.supplier) roots.unshift(makeNode('supplier', t.supplier.name, 'SUPPLIER', t.supplier, 'Supplier'));
    return roots;
  }

  if (type === 'RACK') {
    const roots = [rackSubtree({ ...e, batteries: t.batteries || [] }, t.batteries || [])];
    if (t.saleHistory) {
      roots.unshift(makeNode('sale', 'Sale', 'SOLD', { clientName: t.saleHistory.client_name || t.saleHistory.clientName || 'Not recorded' }, 'Sold'));
    }
    if (t.scrapRecord) {
      roots.unshift(makeNode('scrap', 'Scrap', 'SCRAP', { reason: t.scrapRecord.reason || 'Scrap record' }, 'Scrap'));
    }
    return roots;
  }

  if (type === 'BMS' || type === 'BMU') {
    const roots: TraceNode[] = [];
    const compChildren: TraceNode[] = [];
    if (t.battery) {
      const batteryWithModules = { ...t.battery, modules: t.modules || t.battery.modules || [] };
      compChildren.push(batterySubtree(batteryWithModules, undefined, undefined));
      const supplier = t.cells && t.cells[0] ? t.cells[0].supplierName : null;
      if (supplier) compChildren.push(makeNode('supplier', supplier, 'SUPPLIER', { name: supplier }, 'Supplier'));
    }
    if (e.status === 'SOLD') {
      compChildren.push(makeNode('sale', 'Sale', 'SOLD', { clientName: t.saleHistory?.client_name || t.saleHistory?.clientName || 'Not recorded' }, 'Sold'));
    }
    if (e.status === 'SCRAP' || e.status === 'QUARANTINED' || e.status === 'REJECTED') {
      compChildren.push(makeNode('scrap', 'Damage', 'SCRAP', { reason: t.scrapRecord?.reason || 'Damage record' }, 'Damage'));
    }
    roots.push(makeNode(type === 'BMS' ? 'bms' : 'bmu', e.serialNumber || e.serial_number || e.id, type, e, type, e.status, compChildren));
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
      makeNode(`cell-${c.id}`, c.supplierBarcode || c.internalSerial || c.id, 'CELL', c, 'Cell')
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
  RACK: Package,
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
  RACK: 'RACK',
};

function detailFields(node: TraceNode): { label: string; value: string }[] {
  const d = node.data || {};
  switch (node.type) {
    case 'CELL':
      return [
        { label: 'Internal Serial', value: fmt(d.internalSerial) },
        { label: 'Supplier Barcode', value: fmt(d.supplierBarcode) },
        { label: 'Pallet', value: fmt(d.palletNumber) },
        { label: 'Status', value: fmt(d.lifecycleStatus || d.lifecycle_status || d.status) },
      ];
    case 'MODULE':
      return [
        { label: 'Module Serial', value: fmt(d.serialNumber) },
        { label: 'Status', value: fmt(d.status || d.lifecycleStatus || d.lifecycle_status) },
      ];
    case 'BATTERY':
      return [
          { label: 'Battery Serial', value: displayBatterySerial(d.serialNumber) },
        { label: 'Status', value: fmt(getBatteryTraceStatus(d)) },
        { label: 'Modules', value: fmt(Array.isArray(d.modules) ? d.modules.length : 0) },
        { label: 'Created', value: fmtDateShort(d.createdAt || d.created_at) },
      ];
    case 'RACK':
      const rackWarehouse = getRackTraceWarehouse(d);
      const rackStatus = preferredLifecycleStatus(d.status, rackWarehouse ? 'IN_STOCK' : undefined);
      return [
        { label: 'Rack Serial', value: displayRackSerial(d.serialNumber) },
        { label: 'Rack QR Code', value: fmt(d.qrCode || d.qr_code) },
        { label: 'Status', value: formatTraceStatus(rackStatus) },
        { label: 'Location', value: rackWarehouse || fmt(d.location) },
        { label: 'Batteries Connected', value: fmt(d.requiredPackCount ?? d.required_pack_count) },
        { label: 'Date', value: fmtDateShort(d.createdAt || d.created_at) },
      ];
    case 'BMS':
    case 'BMU':
      return [
        { label: 'Serial', value: fmt(d.serialNumber) },
        { label: 'Type', value: node.type },
        { label: 'Manufacturer', value: fmt(d.manufacturer || d.manufacturerName) },
        { label: 'Status', value: fmt(d.status) },
      ];
    case 'SUPPLIER':
      return [
        { label: 'Name', value: fmt(d.name) },
        { label: 'Date Added', value: fmtDateOnly(d.importedAt || d.imported_at || d.createdAt || d.created_at) },
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
  collapseModuleCells?: boolean;
  expandedKeys?: Set<string>;
  onToggle?: (key: string) => void;
}> = ({ node, selectedKey, onSelect, depth, collapseModuleCells = false, expandedKeys = new Set(), onToggle }) => {
  const Icon = NODE_ICON[node.type] || GitMerge;
  const hasChildren = node.children && node.children.length > 0;
  const collapsible = collapseModuleCells && node.type === 'MODULE' && hasChildren;
  const expanded = expandedKeys.has(node.key);
  const copyValue = node.type === 'CELL'
    ? String(node.data?.supplierBarcode || node.data?.supplier_barcode || node.title || '')
    : String(node.data?.serialNumber || node.data?.serial_number || node.title || '');
  const canCopy = node.type === 'CELL' || node.type === 'MODULE';
  return (
    <div>
      <div className="flex items-center" style={{ marginLeft: depth * 14 }}>
        <button
          onClick={() => onSelect(node.key)}
          className={`min-w-0 flex-1 flex items-center space-x-2 px-3 py-2 rounded-lg text-left transition-all ${
            selectedKey === node.key
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'hover:bg-slate-50 border border-transparent text-slate-700'
          }`}
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
        {canCopy && <CopyToClipboardButton value={copyValue} label={`Copy ${node.type.toLowerCase()} identifier`} />}
        {collapsible && (
          <button
            type="button"
            onClick={() => onToggle?.(node.key)}
            className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={`${expanded ? 'Hide' : 'Show'} cells for ${node.title}`}
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {hasChildren && (!collapsible || expanded) &&
        node.children!.map(child => (
          <TreeNode key={child.key} node={child} selectedKey={selectedKey} onSelect={onSelect} depth={depth + 1} collapseModuleCells={collapseModuleCells} expandedKeys={expandedKeys} onToggle={onToggle} />
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
  const [expandedModuleKeys, setExpandedModuleKeys] = useState<Set<string>>(new Set());
  const searchRequestRef = useRef(0);

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
    const requestId = ++searchRequestRef.current;
    setLoading(true);
    setError(null);
    setSelectedKey('');
    setExpandedModuleKeys(new Set());
    try {
      const result = await api.universalTrace(q);
      if (requestId !== searchRequestRef.current) return;
      setTrace(result);
      setError(null);
    } catch (err: any) {
      if (requestId !== searchRequestRef.current) return;
      setTrace(null);
      setError({ message: err.message || 'Traceability record not found.' });
    } finally {
      if (requestId === searchRequestRef.current) setLoading(false);
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
  const collapseRackModuleCells = trace?.entityType === 'RACK';
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

      {loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-xs text-emerald-900" role="status" aria-live="polite">
          <Clock className="h-4 w-4 animate-pulse text-emerald-600" />
          <div>
            <p className="font-bold">Building genealogy</p>
            <p className="mt-0.5 text-[11px] text-emerald-700">Searching registered records and assembling the production chain...</p>
          </div>
        </div>
      )}

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
                <p className="inline-flex items-center gap-1"><span className="text-slate-400">Identifier:</span> <strong className="font-mono text-emerald-300">{trace.entityType === 'BATTERY' ? displayBatterySerial(trace.identifier) : trace.entityType === 'CELL' ? (trace.entity?.supplierBarcode || trace.entity?.supplier_barcode || trace.identifier) : trace.identifier}</strong><CopyToClipboardButton value={String(trace.entityType === 'CELL' ? (trace.entity?.supplierBarcode || trace.entity?.supplier_barcode || trace.identifier) : trace.identifier || '')} label="Copy trace identifier" /></p>
                <p><span className="text-slate-400">Status:</span> <strong className="text-white">{formatTraceStatus(trace.status)}</strong></p>
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
          {trace.traceabilityWarning && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{trace.traceabilityWarning}</span>
            </div>
          )}

          {/* Tree + Detail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Traceability Map */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2 mb-2">
                <GitMerge className="w-4 h-4 text-slate-400" />
                <span>Traceability Map</span>
              </h3>
              {tree.map(node => (
                <TreeNode
                  key={node.key}
                  node={node}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  depth={0}
                  collapseModuleCells={collapseRackModuleCells}
                  expandedKeys={expandedModuleKeys}
                  onToggle={key => setExpandedModuleKeys(previous => {
                    const next = new Set(previous);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })}
                />
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
                    <dd className="inline-flex max-w-[60%] items-center justify-end gap-1 text-right"><span className="truncate font-mono font-semibold text-slate-900">{f.value}</span>{/serial|barcode|identifier/i.test(f.label) && <CopyToClipboardButton value={f.value} label={`Copy ${f.label}`} />}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

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

