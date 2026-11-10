import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { getIssuedDisplayStatus } from '../../lib/issuance';
import { IssueModal } from '../common/IssueModal';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';
import { CopyToClipboardButton } from '../common/CopyToClipboardButton';
import { IssueEntityType, IssuanceDetails } from '../../types';
import {
  UserCheck,
  Search,
  Filter,
  RotateCcw,
  Eye,
  QrCode,
  ScanLine,
  Download,
  Plus,
  RefreshCw,
  Cpu,
  Layers,
  Zap,
  Package,
  Boxes,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface IssuedItem {
  id: string;
  entityType: IssueEntityType;
  serialNumber: string;
  barcode?: string | null;
  issuedToPerson: string;
  issuedToDepartment: string | null;
  issuedBy: string;
  issuedAt: string;
  status: string;
}

const TYPE_CONFIG: Record<
  IssueEntityType,
  { label: string; icon: React.FC<{ className?: string }>; color: string; badge: string }
> = {
  CELL: {
    label: 'Cell',
    icon: Cpu,
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    badge: 'bg-blue-100 text-blue-800',
  },
  BMS: {
    label: 'BMS',
    icon: Cpu,
    color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    badge: 'bg-indigo-100 text-indigo-800',
  },
  BMU: {
    label: 'BMU',
    icon: Cpu,
    color: 'text-cyan-600 bg-cyan-50 border-cyan-200',
    badge: 'bg-cyan-100 text-cyan-800',
  },
  MODULE: {
    label: 'Module',
    icon: Layers,
    color: 'text-amber-600 bg-amber-50 border-amber-200',
    badge: 'bg-amber-100 text-amber-800',
  },
  BATTERY: {
    label: 'Battery Pack',
    icon: Zap,
    color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  RACK: {
    label: 'Rack',
    icon: Package,
    color: 'text-slate-800 bg-slate-100 border-slate-200',
    badge: 'bg-slate-200 text-slate-800',
  },
};

export const IssuedView: React.FC = () => {
  const { setActiveView, setQuickSearchQuery, refreshKey, triggerRefresh, addNotification } = useApp();

  const [items, setItems] = useState<IssuedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  // Modal states
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<{
    entityType: IssueEntityType;
    entityId: string;
    serialNumber: string;
    barcode?: string | null;
    currentIssuance?: IssuanceDetails;
  } | null>(null);

  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrData, setQrData] = useState<any | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);

  useEffect(() => {
    void loadIssuedData();
  }, [refreshKey]);

  const loadIssuedData = async () => {
    setLoading(true);
    try {
      const data = await api.getIssuedItems();
      setItems(data as IssuedItem[]);
    } catch (err: any) {
      console.error('Failed to load issued items', err);
      addNotification('error', 'Load Failed', err.message || 'Could not load issued items.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanToIssue = async (scannedCode: string) => {
    const code = scannedCode.trim();
    if (!code) return;
    setScanProcessing(true);
    try {
      const res = await api.lookupHardware(code);
      if (res.found && res.item) {
        setScannerOpen(false);
        setModalTarget({
          entityType: res.item.entityType,
          entityId: res.item.entityId,
          serialNumber: res.item.serialNumber,
          barcode: res.item.barcode || null,
          currentIssuance: res.item.currentIssuance,
        });
        setIssueModalOpen(true);
        addNotification(
          'info',
          'Hardware Identified',
          `Scanned ${res.item.entityType} ${res.item.serialNumber}. Ready to issue or manage custody.`
        );
      } else {
        addNotification(
          'error',
          'Hardware Not Found',
          res.message || `No component matching "${code}" found in Cells, BMS, BMU, Modules, Packs, or Racks.`
        );
      }
    } catch (err: any) {
      addNotification(
        'error',
        'Scan Lookup Failed',
        err?.message || 'Failed to query database for scanned barcode.'
      );
    } finally {
      setScanProcessing(false);
    }
  };

  const handleReturnItem = async (item: IssuedItem) => {
    if (!window.confirm(`Return ${item.entityType} ${item.serialNumber} back to stock?`)) return;
    try {
      await api.returnEntity({
        entityType: item.entityType,
        entityId: item.id,
        serialNumber: item.serialNumber,
      });
      addNotification('success', 'Hardware Returned', `${item.serialNumber} was returned to active stock.`);
      triggerRefresh();
      void loadIssuedData();
    } catch (err: any) {
      addNotification('error', 'Return Failed', err.message || 'Could not return hardware.');
    }
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.issuedToDepartment?.trim()) set.add(i.issuedToDepartment.trim());
    });
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      const matchesType = typeFilter === 'ALL' || item.entityType === typeFilter;
      const matchesDept = deptFilter === 'ALL' || (item.issuedToDepartment || 'Unspecified') === deptFilter;
      const matchesSearch =
        !q ||
        item.serialNumber.toLowerCase().includes(q) ||
        (item.barcode || '').toLowerCase().includes(q) ||
        item.issuedToPerson.toLowerCase().includes(q) ||
        (item.issuedToDepartment || '').toLowerCase().includes(q) ||
        item.issuedBy.toLowerCase().includes(q) ||
        item.entityType.toLowerCase().includes(q);
      return matchesType && matchesDept && matchesSearch;
    });
  }, [items, search, typeFilter, deptFilter]);

  // Statistics
  const counts = useMemo(() => {
    return {
      total: items.length,
      cells: items.filter(i => i.entityType === 'CELL').length,
      controllers: items.filter(i => i.entityType === 'BMS' || i.entityType === 'BMU').length,
      modules: items.filter(i => i.entityType === 'MODULE').length,
      batteries: items.filter(i => i.entityType === 'BATTERY').length,
      racks: items.filter(i => i.entityType === 'RACK').length,
    };
  }, [items]);

  const exportIssuedCsv = () => {
    if (filteredItems.length === 0) {
      addNotification('warning', 'Export Skipped', 'No issued items to export.');
      return;
    }
    const headers = ['Type', 'Serial Number', 'Issued To (Person)', 'Department', 'Issued By', 'Issued At', 'Status'];
    const rows = filteredItems.map(i => [
      i.entityType,
      i.serialNumber,
      i.issuedToPerson,
      i.issuedToDepartment || '—',
      i.issuedBy,
      i.issuedAt ? new Date(i.issuedAt).toLocaleString() : '—',
      getIssuedDisplayStatus(i) || 'ISSUED',
    ]);
    const csvContent = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Power2Go_Issued_Hardware_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addNotification('success', 'Report Exported', `Exported ${filteredItems.length} issued items.`);
  };

  return (
    <div className="issued-page flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
            <UserCheck className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              Issued Hardware &amp; Custody
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {items.length} Active
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Live custody and custody assignment for Cells, BMS, BMU, Modules, Battery Packs, and Racks.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadIssuedData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            title="Refresh issued hardware list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={exportIssuedCsv}
            disabled={filteredItems.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50"
            title="Export CSV report"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-xs transition-colors"
            title="Scan physical barcode, QR code, or serial label to issue hardware"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Scan to Issue</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView('inventory');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl shadow-xs transition-colors"
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>View in Inventory</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Issued</div>
          <div className="mt-1 text-2xl font-black text-slate-900">{counts.total}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Across all types</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cells</div>
          <div className="mt-1 text-2xl font-black text-blue-700">{counts.cells}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">In trial / R&amp;D</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Controllers</div>
          <div className="mt-1 text-2xl font-black text-indigo-700">{counts.controllers}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">BMS &amp; BMU units</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Modules</div>
          <div className="mt-1 text-2xl font-black text-amber-700">{counts.modules}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Assigned sub-packs</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Battery Packs</div>
          <div className="mt-1 text-2xl font-black text-emerald-700">{counts.batteries}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Demos / Testing</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Racks</div>
          <div className="mt-1 text-2xl font-black text-slate-800">{counts.racks}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Site installations</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search issued hardware by serial, physical barcode, person, department, or issuer..."
            className="w-full pl-9 pr-10 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="absolute right-2.5 top-2 p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Scan barcode with camera or scanner"
          >
            <ScanLine className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Department Filter */}
          <div className="flex items-center space-x-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Departments</option>
              {departments.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Type Filter strip */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold border border-slate-200">
            {(['ALL', 'CELL', 'BMS', 'BMU', 'MODULE', 'BATTERY', 'RACK'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  typeFilter === t
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t === 'ALL' ? 'All' : t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
              <tr>
                <th className="px-5 py-3">Hardware Type</th>
                <th className="px-5 py-3">Serial / Barcode</th>
                <th className="px-5 py-3">Issued To (Person)</th>
                <th className="px-5 py-3">Department</th>
                <th className="px-5 py-3">Issued By</th>
                <th className="px-5 py-3">Issued Date</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right font-sans">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map(item => {
                const conf = TYPE_CONFIG[item.entityType] || TYPE_CONFIG.CELL;
                const Icon = conf.icon;
                const displayStatus = getIssuedDisplayStatus(item) || 'ISSUED';

                return (
                  <tr key={`${item.entityType}-${item.id}`} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-sans">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${conf.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                        <span>{conf.label}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                          {item.serialNumber}
                          <CopyToClipboardButton value={item.serialNumber} label="Copy serial number" />
                        </span>
                        {item.barcode && (
                          <div className="inline-flex items-center gap-1.5 text-[11px] font-sans">
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                              Barcode
                            </span>
                            <span className="font-mono text-slate-600 font-medium">{item.barcode}</span>
                            <CopyToClipboardButton value={item.barcode} label="Copy barcode" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-sans font-bold text-slate-900">
                      {item.issuedToPerson}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      {item.issuedToDepartment ? (
                        <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {item.issuedToDepartment}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-sans text-slate-600">
                      {item.issuedBy || '—'}
                    </td>
                    <td className="px-5 py-3.5 font-sans text-slate-500 text-[11px]">
                      {item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                        {displayStatus}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1 font-sans">
                      <button
                        type="button"
                        onClick={() => {
                          setModalTarget({
                            entityType: item.entityType,
                            entityId: item.id,
                            serialNumber: item.serialNumber,
                            barcode: item.barcode || null,
                            currentIssuance: {
                              issuedToPerson: item.issuedToPerson,
                              issuedToDepartment: item.issuedToDepartment || undefined,
                              issuedBy: item.issuedBy,
                              issuedAt: item.issuedAt,
                            },
                          });
                          setIssueModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Edit / reassign issuance"
                      >
                        <UserCheck className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReturnItem(item)}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Return to stock"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickSearchQuery(item.serialNumber);
                          setActiveView('traceability');
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Trace Genealogy"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQrData({
                            title: `Issued ${conf.label} QR / Barcode: ${item.serialNumber}`,
                            qrPayload: item.barcode || item.serialNumber,
                            serial: item.serialNumber,
                            itemType: item.entityType,
                            metadata: {
                              TYPE: item.entityType,
                              SERIAL: item.serialNumber,
                              BARCODE: item.barcode || item.serialNumber,
                              ISSUED_TO: item.issuedToPerson,
                              DEPARTMENT: item.issuedToDepartment || 'Unspecified',
                              ISSUED_BY: item.issuedBy,
                              ISSUED_AT: item.issuedAt ? new Date(item.issuedAt).toLocaleString() : '—',
                              STATUS: displayStatus,
                            },
                          });
                          setQrModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Print QR"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-xs text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <UserCheck className="w-8 h-8 text-slate-300" />
                      <p className="font-semibold text-slate-600">No issued hardware found</p>
                      <p className="text-[11px] text-slate-400 max-w-sm">
                        {search || typeFilter !== 'ALL' || deptFilter !== 'ALL'
                          ? 'No issued items match the selected search and filter criteria.'
                          : 'No hardware is currently issued out. You can issue items from the Inventory tab or right-hand action buttons.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveView('inventory')}
                        className="mt-2 px-3 py-1.5 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 rounded-lg text-xs font-bold transition-colors"
                      >
                        Open Inventory to Issue Hardware
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reusable Issue Modal */}
      {modalTarget && (
        <IssueModal
          isOpen={issueModalOpen}
          onClose={() => {
            setIssueModalOpen(false);
            setModalTarget(null);
          }}
          entityType={modalTarget.entityType}
          entityId={modalTarget.entityId}
          serialNumber={modalTarget.serialNumber}
          barcode={modalTarget.barcode}
          currentIssuance={modalTarget.currentIssuance}
          onSuccess={() => {
            triggerRefresh();
            void loadIssuedData();
          }}
        />
      )}

      {/* QR Modal */}
      {qrData && (
        <QRCodeModal
          isOpen={qrModalOpen}
          onClose={() => setQrModalOpen(false)}
          title={qrData.title}
          qrPayload={qrData.qrPayload}
          serialNumber={qrData.serial}
          itemType={qrData.itemType}
          metadata={qrData.metadata}
        />
      )}

      {/* Auto Scan to Issue Modal */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanToIssue}
        title="Scan Hardware to Issue"
        subtitle="Point camera at physical barcode or QR code, or type serial number to automatically identify hardware and issue"
      />
    </div>
  );
};

