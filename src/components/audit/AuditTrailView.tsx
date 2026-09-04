import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { AuditLog } from '../../types';
import {
  FileText,
  Search,
  Filter,
  ShieldCheck,
  Download,
  Clock,
  User,
  Layers,
} from 'lucide-react';

export const AuditTrailView: React.FC = () => {
  const { refreshKey } = useApp();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    loadAuditLogs();
  }, [refreshKey]);

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs({ limit: 200 });
      setLogs(res);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      !search ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.entityId.toLowerCase().includes(search.toLowerCase()) ||
      log.userName.toLowerCase().includes(search.toLowerCase()) ||
      (log.reason && log.reason.toLowerCase().includes(search.toLowerCase()));
    const matchesAction = !actionFilter || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const exportCsv = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      ['Timestamp,Action,Entity Type,Entity ID,User,Role,Reason,New Value']
        .concat(
          filteredLogs.map(l =>
            `"${l.timestamp}","${l.action}","${l.entityType}","${l.entityId}","${l.userName}","${l.userRole}","${l.reason || ''}","${l.newValue || ''}"`
          )
        )
        .join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `MES_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Immutable MES Production Audit Trail
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                21 CFR Part 11 & ISO 9001 compliant event logs. Records operator IDs, timestamped actions, parameters, manual entries, and supervisor bypass authorizations.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={exportCsv}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center space-x-2 shadow-xs transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Export Audit CSV</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by action, user, serial ID, or reason..."
            className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="px-3.5 py-2.5 text-xs font-semibold bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-700"
          >
            <option value="">All Actions</option>
            {uniqueActions.map(act => (
              <option key={act} value={act}>{act}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 font-sans">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Entity Type & ID</th>
                <th className="px-5 py-3">User & Role</th>
                <th className="px-5 py-3">Justification / Details</th>
                <th className="px-5 py-3">Parameter Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400 font-sans">
                    No matching audit records.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 font-bold font-sans text-slate-900">
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-[10px] border border-slate-200">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-semibold">
                      <span className="text-[10px] text-slate-400 block font-sans">{log.entityType}</span>
                      {log.entityId}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <div className="font-semibold text-slate-900">{log.userName}</div>
                      <span className="text-[10px] text-slate-500">{log.userRole}</span>
                    </td>
                    <td className="px-5 py-3.5 font-sans text-slate-600 text-[11px]">
                      {log.reason ? (
                        <span className="text-slate-700 font-medium bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 block">
                          Reason: {log.reason}
                        </span>
                      ) : (
                        <span className="text-slate-400">Standard automated verification</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-[11px] truncate max-w-xs">
                      {log.newValue || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
