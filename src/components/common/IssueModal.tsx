import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  RotateCcw,
  UserCheck,
  Building2,
  User,
  Clock,
  AlertCircle,
  FileDown,
  Upload,
  CheckCircle2,
  FileText,
  Eye,
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { IssueEntityType, IssuanceDetails, User as UserType } from '../../types';
import { downloadHandoverSlipPdf } from '../../lib/handoverSlipExport';

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

  // Handover state
  const [step, setStep] = useState<'FORM' | 'HANDOVER_PENDING'>('FORM');
  const [signedSlipFile, setSignedSlipFile] = useState<{
    fileName: string;
    fileSize: string;
    dataUrl: string;
  } | null>(null);
  const [uploadingSlip, setUploadingSlip] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCurrentlyIssued = Boolean(currentIssuance?.issuedToPerson?.trim());
  const isPendingSignature = isCurrentlyIssued && currentIssuance?.handoverStatus === 'PENDING_SIGNATURE';
  const hasCompletedSlip = isCurrentlyIssued && Boolean(currentIssuance?.signedSlipUrl);

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setPerson(currentIssuance?.issuedToPerson || '');
    setDepartment(currentIssuance?.issuedToDepartment || '');
    setNotes('');
    setSignedSlipFile(
      currentIssuance?.signedSlipUrl
        ? {
          fileName: currentIssuance.signedSlipFileName || 'signed_slip.pdf',
          fileSize: 'Uploaded',
          dataUrl: currentIssuance.signedSlipUrl,
        }
        : null
    );

    // If currently issued but pending signature, open in handover mode
    if (isPendingSignature) {
      setStep('HANDOVER_PENDING');
    } else {
      setStep('FORM');
    }

    // Fetch registered accounts for the "Issued By" dropdown
    void api
      .getUsers()
      .then(users => {
        setAccounts(users);
        if (currentIssuance?.issuedBy) {
          setIssuedBy(currentIssuance.issuedBy);
        } else if (users.length > 0) {
          const activeName = currentUser?.name || currentUser?.username || '';
          const match = users.find(u => u.name === activeName || u.username === activeName);
          setIssuedBy(match ? match.name : users[0].name || users[0].username);
        }
      })
      .catch(err => {
        console.warn('Could not load accounts list', err);
        setIssuedBy(currentUser?.name || currentUser?.username || 'Administrator');
      });
  }, [isOpen, currentIssuance, currentUser, isPendingSignature]);

  if (!isOpen) return null;

  const handleDownloadSlip = async () => {
    try {
      await downloadHandoverSlipPdf({
        entityType,
        serialNumber,
        barcode,
        issuedToPerson: person.trim() || currentIssuance?.issuedToPerson || 'Recipient',
        issuedToDepartment: department.trim() || currentIssuance?.issuedToDepartment || undefined,
        issuedBy: issuedBy.trim() || currentIssuance?.issuedBy || currentUser?.name || 'Administrator',
        issuedAt: currentIssuance?.issuedAt || new Date().toISOString(),
        notes: notes.trim() || undefined,
      });
      addNotification(
        'info',
        'Handover Slip Downloaded',
        'Print or sign the downloaded PDF slip, then upload the photo/scan to complete issuance.'
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to generate handover PDF.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSignedSlipFile({
        fileName: file.name,
        fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        dataUrl: String(reader.result || ''),
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person.trim()) {
      setError('Person name is compulsory and required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Issue with PENDING_SIGNATURE status
      await api.issueEntity({
        entityType,
        entityId,
        serialNumber,
        person: person.trim(),
        department: department.trim() || undefined,
        issuedBy: issuedBy.trim() || currentUser?.name || 'Administrator',
        notes: notes.trim() || undefined,
        handoverStatus: 'PENDING_SIGNATURE',
      });

      // Automatically trigger PDF slip download
      handleDownloadSlip();

      addNotification(
        'info',
        'Handover Slip Issued',
        `${serialNumber} marked as Pending Signature for ${person.trim()}. Please obtain physical signature and upload.`
      );

      // Transition to HANDOVER_PENDING screen inside modal
      setStep('HANDOVER_PENDING');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to issue item. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadSignedSlipSubmit = async () => {
    if (!signedSlipFile?.dataUrl) {
      setError('Please select or capture a photo/scan of the signed slip.');
      return;
    }

    setUploadingSlip(true);
    setError(null);

    try {
      await api.completeHandoverSlip({
        entityType,
        entityId,
        serialNumber,
        signedSlipUrl: signedSlipFile.dataUrl,
        signedSlipFileName: signedSlipFile.fileName,
        actor: currentUser?.name || currentUser?.username || 'Operator',
      });

      addNotification(
        'success',
        'Issuance Complete',
        `Signed handover slip verified and attached to ${serialNumber}. Custody is now complete.`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to upload signed slip.');
    } finally {
      setUploadingSlip(false);
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
            <div
              className={`p-2 rounded-xl ${isPendingSignature
                  ? 'bg-amber-100 text-amber-800'
                  : isCurrentlyIssued
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
            >
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {step === 'HANDOVER_PENDING'
                  ? 'Custody Handover & Verification'
                  : isCurrentlyIssued
                    ? 'Manage Issuance / Return'
                    : `Issue ${entityType}`}
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
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP: HANDOVER PENDING (Download slip + Upload photo) */}
          {step === 'HANDOVER_PENDING' ? (
            <div className="space-y-4">
              {/* Status Banner */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between font-bold text-amber-900">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    Status: Pending Signatures
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-200/80 text-amber-950">
                    Locked to {person || currentIssuance?.issuedToPerson}
                  </span>
                </div>
                <p className="text-amber-800 text-[11px] leading-relaxed">
                  Hardware is reserved and cannot be issued to anyone else. To complete custody transfer, download the
                  formal handover slip, obtain physical signatures, and upload a photo/scan of the signed slip.
                </p>
              </div>

              {/* Step 1: Download Handover Report */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileDown className="w-4 h-4 text-emerald-600" />
                      1. Download Handover Slip (PDF)
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Contains serial details, recipient info, and signature blocks.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadSlip}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs transition-all"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                </div>
              </div>

              {/* Step 2: Upload Signed Document / Photo */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-emerald-600" />
                    2. Upload Signed Slip / Photo
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Take a photo with your mobile or upload a scanned image/PDF (max 5MB).
                  </p>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {signedSlipFile ? (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-200 bg-emerald-50/60 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="overflow-hidden">
                        <span className="font-bold text-emerald-950 block truncate max-w-[220px]">
                          {signedSlipFile.fileName}
                        </span>
                        <span className="text-[10px] text-emerald-700">{signedSlipFile.fileSize}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {signedSlipFile.dataUrl.startsWith('data:image') && (
                        <a
                          href={signedSlipFile.dataUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-emerald-700 hover:bg-emerald-100"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] font-bold text-emerald-800 hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded-xl bg-slate-50/50 hover:bg-emerald-50/20 cursor-pointer transition-colors text-center"
                  >
                    <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    <span className="text-xs font-bold text-slate-700">Click to select photo or scanned document</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Supports JPG, PNG, WEBP, or PDF</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep('FORM')}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  &larr; Edit Details
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Keep as Pending
                  </button>
                  <button
                    type="button"
                    disabled={uploadingSlip || !signedSlipFile}
                    onClick={handleUploadSignedSlipSubmit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-all disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {uploadingSlip ? 'Completing...' : 'Verify & Complete Issuance'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* STEP: FORM (Original Issuance / Reassignment Screen) */
            <>
              {/* If already issued, show details banner */}
              {isCurrentlyIssued && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-semibold text-emerald-900">
                    <span className="flex items-center gap-1.5">
                      <User className="w-4 h-4 text-emerald-600" />
                      Currently Issued To:
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wide text-[10px] ${isPendingSignature ? 'bg-amber-200 text-amber-950' : 'bg-emerald-200/80 text-emerald-900'
                        }`}
                    >
                      {isPendingSignature ? 'Pending Signature' : 'Issued'}
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

                  {/* If has signed slip attached */}
                  {hasCompletedSlip && (
                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between">
                      <span className="text-slate-600 font-medium flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-emerald-600" />
                        Signed Slip Attached
                      </span>
                      {currentIssuance?.signedSlipUrl && (
                        <a
                          href={currentIssuance.signedSlipUrl}
                          download={currentIssuance.signedSlipFileName || 'signed_slip.pdf'}
                          className="text-[11px] font-bold text-emerald-800 hover:underline"
                        >
                          View / Download Slip
                        </a>
                      )}
                    </div>
                  )}

                  {/* Switch to pending screen if pending */}
                  {isPendingSignature && (
                    <div className="pt-2 border-t border-amber-200 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setStep('HANDOVER_PENDING')}
                        className="text-[11px] font-bold text-amber-900 underline hover:text-amber-950"
                      >
                        Proceed to Signatures / Upload &rarr;
                      </button>
                    </div>
                  )}
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
                      placeholder="Enter full name of recipient (e.g. Baqir)"
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
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${department === dept
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
                              {displayName}
                              {roleDisplay}
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
                  <p className="text-[11px] text-slate-400 mt-1">Select verified account name releasing this hardware.</p>
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
                    placeholder="Add purpose, trial duration, or custody reason..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium"
                  />
                </div>

                {/* Workflow Guidance info */}
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                  <div className="font-bold text-slate-800">Custody Handover Flow:</div>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>Confirming will mark status as <b>Pending Signature</b> and download the slip.</li>
                    <li>Hardware stays locked so it cannot be issued elsewhere.</li>
                    <li>Upload signed photo to finalize custody transfer.</li>
                  </ol>
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
                      <FileDown className="w-3.5 h-3.5" />
                      {submitting ? 'Generating Slip...' : 'Issue & Download Slip'}
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
