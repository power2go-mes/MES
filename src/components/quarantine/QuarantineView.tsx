import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { QuarantineRecord } from '../../types';
import {
  AlertOctagon,
  ShieldAlert,
  RotateCcw,
  Trash2,
  CheckCircle2,
  Lock,
  Plus,
  AlertTriangle,
  Sparkles,
  Search,
  Pencil,
} from 'lucide-react';

export const QuarantineView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();

  const [records, setRecords] = useState<QuarantineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'DAMAGE' | 'REUSABLE'>('DAMAGE');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Scrap modal state
  const [showQuarantineModal, setShowQuarantineModal] = useState(false);
  const [entityType, setEntityType] = useState<'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'BMU'>('CELL');
  const [entitySerial, setEntitySerial] = useState('');
  const [reason, setReason] = useState('');

  // Resolution Modal State
  const [resolveTarget, setResolveTarget] = useState<QuarantineRecord | null>(null);
  const [resolveDisposition, setResolveDisposition] = useState<'RELEASE_APPROVED' | 'SCRAP' | 'REWORK'>('RELEASE_APPROVED');
  const [resolveNotes, setResolveNotes] = useState('');

  useEffect(() => {
    loadQuarantine();
  }, [refreshKey]);

  const loadQuarantine = async () => {
    setLoading(true);
    try {
      const raw: any = await api.getQuarantineRecords();
      // Normalize API response: handle {records: [...]}, {data: [...]}, or [...]
      let normalized: QuarantineRecord[] = [];
      if (Array.isArray(raw)) {
        normalized = raw;
      } else if (raw && typeof raw === 'object') {
        normalized = raw.records || raw.data || [];
      }
      setRecords(normalized);
      setSelectedIds([]);
    } catch (err) {
      console.error('Failed to load scrap items', err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuarantine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entitySerial.trim() || !reason.trim()) return;

    setActionLoading(true);
    try {
      if (entityType === 'CELL') {
        const barcodes = entitySerial.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
        const result = await api.scrapCellsByBarcodes(barcodes, reason.trim());
        const missingText = result.missingCount > 0 ? ` ${result.missingCount} barcode(s) not found.` : '';
        addNotification('warning', 'Cells Scrapped', `${result.scrappedCount} cell(s) permanently removed from production.${missingText}`);
      } else {
        await api.quarantineItem({
          itemType: entityType,
          itemId: entitySerial.trim(),
          reason: reason.trim(),
        });
        addNotification('warning', 'Item Sent to Scrap Review', `${entityType} ${entitySerial} locked into scrap review`);
      }
      setShowQuarantineModal(false);
      setEntitySerial('');
      setReason('');
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Scrap Review Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openResolveDialog = (record: QuarantineRecord, disposition: 'RELEASE_APPROVED' | 'SCRAP') => {
    setResolveTarget(record);
    setResolveDisposition(disposition);
    setResolveNotes(disposition === 'RELEASE_APPROVED' ? 'Inspected and verified reusable within acceptable standard tolerance' : 'Damaged item sent to scrap due to irreversible defect');
  };

  const toggleSelected = (recordId: string) => {
    setSelectedIds(current => current.includes(recordId)
      ? current.filter(id => id !== recordId)
      : [...current, recordId]);
  };

  const applyBulkDisposition = async (disposition: 'RELEASE_APPROVED' | 'SCRAP') => {
    const selectedRecords = records.filter(record => selectedIds.includes(record.id));
    if (selectedRecords.length === 0) return;
    const label = disposition === 'RELEASE_APPROVED' ? 'reusable' : 'damaged';
    if (!window.confirm(`Mark ${selectedRecords.length} selected item(s) as ${label}?`)) return;

    setActionLoading(true);
    try {
      const dispositionNotes = disposition === 'RELEASE_APPROVED'
        ? 'Inspected and verified reusable within acceptable standard tolerance'
        : 'Damaged item sent to scrap due to irreversible defect';
      await Promise.all(selectedRecords.map(record => api.resolveQuarantine(record.id, {
        disposition,
        dispositionNotes,
      })));
      setSelectedIds([]);
      addNotification('success', 'Scrap Review Updated', `${selectedRecords.length} item(s) marked as ${label}`);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Bulk Update Failed', err.message || 'Could not update selected items.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveTarget) return;

    setActionLoading(true);
    try {
      await api.resolveQuarantine(resolveTarget.id, {
        disposition: resolveDisposition,
        dispositionNotes: resolveNotes.trim() || 'Signed off by quality manager',
      });

      setRecords(current => current.map(record => record.id === resolveTarget.id
        ? {
            ...record,
            status: 'RESOLVED',
            disposition: resolveDisposition,
            dispositionNotes: resolveNotes.trim() || 'Signed off by quality manager',
            resolvedAt: new Date().toISOString(),
          }
        : record));
      addNotification('success', 'Scrap Review Resolved', `${resolveTarget.entitySerial} marked as ${resolveDisposition}`);
      setResolveTarget(null);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Resolution Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const deleteScrapCell = async (record: QuarantineRecord) => {
    if (record.entityType !== 'CELL') return;
    if (!window.confirm(`Permanently delete scrap cell ${record.entitySerial}? This cannot be undone.`)) return;
    setActionLoading(true);
    try {
      await api.deleteScrapCell(record.entityId);
      addNotification('success', 'Scrap Cell Deleted', `${record.entitySerial} was permanently removed.`);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Delete Failed', err.message || 'Could not delete the scrap cell.');
    } finally {
      setActionLoading(false);
    }
  };

  const isReusableRecord = (record: QuarantineRecord) => ['RELEASE_APPROVED', 'REWORK'].includes(String(record.disposition || '').toUpperCase());
  const filtered = records.filter(record => filter === 'REUSABLE' ? isReusableRecord(record) : !isReusableRecord(record));
  const reusableCount = records.filter(isReusableRecord).length;
  const damageCount = records.length - reusableCount;
  const allVisibleSelected = filtered.length > 0 && filtered.every(record => selectedIds.includes(record.id));

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-slate-50 border border-slate-100 text-slate-600 rounded-xl">
              <AlertOctagon className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Scrap, Defect Isolation & Rework Management
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Strict isolation barrier prevents any defective or unverified cell from progressing down the manufacturing line.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowQuarantineModal(true)}
          className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white text-xs font-bold rounded-xl flex items-center space-x-2 shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Manual Scrap Isolation</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex bg-slate-100/80 p-1.5 rounded-xl text-xs font-semibold border border-slate-200">
          <button
            onClick={() => setFilter('DAMAGE')}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${filter === 'DAMAGE' ? 'bg-white text-slate-700 font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Damage ({damageCount})
          </button>
          <button
            onClick={() => setFilter('REUSABLE')}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${filter === 'REUSABLE' ? 'bg-white text-emerald-700 font-bold shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Reusable ({reusableCount})
          </button>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <span className="text-xs font-semibold text-slate-500">{selectedIds.length} selected</span>
              <button
                onClick={() => void applyBulkDisposition('RELEASE_APPROVED')}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-200"
              >
                Reusable
              </button>
              <button
                onClick={() => void applyBulkDisposition('SCRAP')}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300"
              >
                Damaged
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scrap Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
              <tr>
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => setSelectedIds(allVisibleSelected ? [] : filtered.map(record => record.id))}
                    aria-label="Select all visible scrap records"
                    className="h-4 w-4 accent-emerald-600"
                  />
                </th>
                <th className="px-5 py-3">Item Type</th>
                <th className="px-5 py-3">Serial / ID</th>
                <th className="px-5 py-3">Isolation Reason</th>
                <th className="px-5 py-3">Stage</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Scrap Review At</th>
                <th className="px-5 py-3 text-right font-sans">Damage / Reusable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400 font-sans">
                    No items in this scrap status view.
                  </td>
                </tr>
              ) : (
                filtered.map(rec => (
                  <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(rec.id)}
                        onChange={() => toggleSelected(rec.id)}
                        aria-label={`Select ${rec.entitySerial}`}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-bold font-sans text-slate-900">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] border border-slate-200">
                        {rec.entityType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{rec.entitySerial}</td>
                    <td className="px-5 py-3.5 text-black font-sans font-medium">{rec.reason}</td>
                    <td className="px-5 py-3.5 text-slate-500 font-sans">{rec.stage}</td>
                    <td className="px-5 py-3.5 font-sans">
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                          rec.status === 'OPEN'
                            ? 'bg-slate-100 text-black border-slate-300'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {rec.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-[11px]">
                      {new Date(rec.quarantinedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1.5 font-sans">
                      {rec.status === 'OPEN' ? (
                        <>
                          <button
                            onClick={() => openResolveDialog(rec, 'RELEASE_APPROVED')}
                            disabled={actionLoading}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-200 transition-colors"
                          >
                            Reusable
                          </button>
                          <button
                            onClick={() => openResolveDialog(rec, 'SCRAP')}
                            disabled={actionLoading}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-black text-xs font-semibold rounded-lg border border-slate-300 transition-colors"
                          >
                            Damaged
                          </button>
                          {rec.entityType === 'CELL' && (
                            <button
                              onClick={() => void deleteScrapCell(rec)}
                              disabled={actionLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg border border-red-200 transition-colors"
                              title="Permanently delete this scrap cell"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[11px] text-slate-500 font-mono">
                            {rec.disposition}: {rec.dispositionNotes}
                          </span>
                          <button
                            onClick={() => openResolveDialog(rec, isReusableRecord(rec) ? 'RELEASE_APPROVED' : 'SCRAP')}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition-colors"
                            title="Edit disposition"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disposition Resolution Modal */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div>
              <div className="flex items-center space-x-2 text-emerald-600 mb-1">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Quality Disposition Authority</span>
              </div>
              <h3 className="text-base font-black text-slate-900">
                Resolve Scrap Review: {resolveTarget.entitySerial}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Current Isolation Reason: <span className="font-semibold text-slate-900">{resolveTarget.reason}</span>
              </p>
            </div>

            <form onSubmit={submitResolve} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Disposition Decision</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setResolveDisposition('RELEASE_APPROVED')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border text-center transition-all ${
                      resolveDisposition === 'RELEASE_APPROVED'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-400/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Reusable
                  </button>
                  <button
                    type="button"
                    onClick={() => setResolveDisposition('SCRAP')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border text-center transition-all ${
                      resolveDisposition === 'SCRAP'
                        ? 'bg-slate-100 border-slate-1000 text-black ring-2 ring-slate-500/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Damaged / Scrap
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Disposition Engineering Notes</label>
                <textarea
                  value={resolveNotes}
                  onChange={e => setResolveNotes(e.target.value)}
                  placeholder="Explain why this unit is reusable or damaged and sent to scrap..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResolveTarget(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-xs transition-colors"
                >
                  Confirm Disposition Signoff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Scrap Modal */}
      {showQuarantineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div>
              <h3 className="text-base font-black text-slate-900">Scrap Item Isolation</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Immediately locks item from manufacturing progression across all production orders.
              </p>
            </div>

            <form onSubmit={handleCreateQuarantine} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Item Category</label>
                <select
                  value={entityType}
                  onChange={e => setEntityType(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="CELL">Single Cell</option>
                  <option value="MODULE">Module Unit</option>
                  <option value="BATTERY">Battery Pack</option>
                  <option value="BMS">BMS Controller</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{entityType === 'CELL' ? 'Cell Barcodes' : 'Serial / Barcode'}</label>
                {entityType === 'CELL' ? (
                  <textarea
                    value={entitySerial}
                    onChange={e => setEntitySerial(e.target.value)}
                    placeholder="Paste cell barcodes here, one per line, comma separated, or semicolon separated"
                    rows={4}
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 resize-y"
                    required
                  />
                ) : (
                  <input
                    type="text"
                    value={entitySerial}
                    onChange={e => setEntitySerial(e.target.value)}
                    placeholder="e.g. P2G-CL-000001 or Barcode"
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                    required
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Isolation Justification / Defect</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Visual weld porosity observed; OCV drift > 10mV during stabilization"
                  rows={3}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowQuarantineModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-600 hover:bg-slate-500 rounded-xl shadow-xs transition-colors"
                >
                  {entityType === 'CELL' ? 'Scrap Cells Now' : 'Lock for Scrap Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
