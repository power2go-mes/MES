import React, { useState, useEffect } from 'react';
import { X, Send, RotateCcw, UserCheck, Building2, User, Clock, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { IssueEntityType, IssuanceDetails, User as UserType } from '../../types';

interface IssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: IssueEntityType;
  entityId: string;
  serialNumber: string;
  barcode?: string | null;
  currentIssuance?: IssuanceDetails;
  onSuccess: () => void;
}

const COMMON_DEPARTMENTS = [
  'R&D',
  'Testing & QA',
  'Production Floor',
  'Field Trial',
  'Maintenance',
  'Engineering',
  'Sales Demo',
];

export const IssueModal: React.FC<IssueModalProps> = ({
  isOpen,
  onClose,
  entityType,
  entityId,
  serialNumber,
  barcode,
  currentIssuance,
  onSuccess,
}) => {
  const { currentUser } = useAuth();
  const { addNotification } = useApp();

  const [person, setPerson] = useState('');
  const [department, setDepartment] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [accounts, setAccounts] = useState<UserType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrentlyIssued = Boolean(currentIssuance?.issuedToPerson?.trim());

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setPerson(currentIssuance?.issuedToPerson || '');
    setDepartment(currentIssuance?.issuedToDepartment || '');
    setNotes('');

    // Fetch registered accounts for the "Issued By" dropdown
    void api.getUsers().then(users => {
      setAccounts(users);
      if (currentIssuance?.issuedBy) {
        setIssuedBy(currentIssuance.issuedBy);
      } else if (users.length > 0) {
        const activeName = currentUser?.name || currentUser?.username || '';
        const match = users.find(u => u.name === activeName || u.username === activeName);
        setIssuedBy(match ? match.name : users[0].name || users[0].username);
      }
    }).catch(err => {
      console.warn('Could not load accounts list', err);
      setIssuedBy(currentUser?.name || currentUser?.username || 'Administrator');
    });
  }, [isOpen, currentIssuance, currentUser]);

  if (!isOpen) return null;

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person.trim()) {
      setError('Person name is compulsory and required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.issueEntity({
        entityType,
        entityId,
        serialNumber,
        person: person.trim(),
        department: department.trim() || undefined,
        issuedBy: issuedBy.trim() || currentUser?.name || 'Administrator',
        notes: notes.trim() || undefined,
      });

      addNotification(
        'success',
        `${entityType} Issued`,
        `Successfully issued ${serialNumber} to ${person.trim()}${department.trim() ? ` (${department.trim()})` : ''}.`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to issue item. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnSubmit = async () => {
    if (!window.confirm(`Are you sure you want to return ${serialNumber} back to standard stock?`)) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.returnEntity({
        entityType,
        entityId,
        serialNumber,
        returnedBy: currentUser?.name || currentUser?.username || 'Administrator',
      });

      addNotification(
        'success',
        `${entityType} Returned`,
        `${serialNumber} has been returned to stock and is no longer issued.`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to return item. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isCurrentlyIssued ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isCurrentlyIssued ? 'Manage Issuance / Return' : `Issue ${entityType}`}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono font-semibold text-slate-500 mt-0.5">
                <span>SN: {serialNumber}</span>
                {barcode && barcode !== serialNumber && (
                  <span className="text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded font-sans text-[11px]">
                    Barcode: <span className="font-mono font-bold text-slate-800">{barcode}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* If already issued, show details banner */}
          {isCurrentlyIssued && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-emerald-900">
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4 text-emerald-600" />
                  Currently Issued To:
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-200/80 text-emerald-900 font-bold uppercase tracking-wide text-[10px]">
                  Issued
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-700 pt-1">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Person</span>
                  <span className="font-bold text-slate-900">{currentIssuance?.issuedToPerson}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Department</span>
                  <span className="font-bold text-slate-900">{currentIssuance?.issuedToDepartment || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Issued By</span>
                  <span className="font-medium text-slate-900">{currentIssuance?.issuedBy || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Issued Date</span>
                  <span className="font-medium text-slate-900">
                    {currentIssuance?.issuedAt ? new Date(currentIssuance.issuedAt).toLocaleDateString() : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleIssueSubmit} className="space-y-4">
            {/* Person (Compulsory) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Issued To (Person) <span className="text-red-500 font-bold">* Required</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={person}
                  onChange={e => setPerson(e.target.value)}
                  placeholder="Enter full name of recipient (e.g. John Doe)"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium"
                />
              </div>
            </div>

            {/* Department (Optional) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  Department <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
              </div>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  placeholder="e.g. R&D, Testing, Field Trial"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium"
                />
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {COMMON_DEPARTMENTS.map(dept => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setDepartment(dept)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      department === dept
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>
            </div>

            {/* Issued By (Dropdown of user accounts) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Issued By (Account) <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <select
                  value={issuedBy}
                  onChange={e => setIssuedBy(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium cursor-pointer"
                >
                  {accounts.length > 0 ? (
                    accounts.map(acc => {
                      const displayName = acc.name || acc.username;
                      const roleDisplay = acc.role ? ` - ${acc.role.replace(/_/g, ' ')}` : '';
                      return (
                        <option key={acc.id} value={displayName}>
                          {displayName}{roleDisplay}
                        </option>
                      );
                    })
                  ) : (
                    <option value={currentUser?.name || 'Administrator'}>
                      {currentUser?.name || 'Administrator'}
                    </option>
                  )}
                </select>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Select the verified account name releasing this hardware.</p>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Issuance Notes <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add trial duration, ticket #, or reason for checkout..."
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              {isCurrentlyIssued ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleReturnSubmit}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Return to Stock
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-all disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Saving...' : isCurrentlyIssued ? 'Update Issuance' : 'Confirm & Issue'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

