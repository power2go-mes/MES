import React, { useEffect, useState } from 'react';
import {
  FileText,
  Download,
  X,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  Zap,
  Activity,
  Layers,
  ShieldCheck,
  Pencil,
  Save,
  Upload,
} from 'lucide-react';
import type { RackUnit, RackInspectionReport } from '../../types';

interface RackInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rack: RackUnit | null;
  onSave?: (report: Partial<RackInspectionReport>) => Promise<void>;
}

export const RackInspectionModal: React.FC<RackInspectionModalProps> = ({
  isOpen,
  onClose,
  rack,
  onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>({});
  const report: RackInspectionReport | null = rack?.inspectionReport || null;
  const serial = rack?.serialNumber || rack?.id || '';
  const packCount = rack?.installedPackCount || rack?.batteryIds?.length || 5;

  const packSocs = report?.packSocs || {};
  const packVoltages = report?.packVoltages || {};
  const packCurrents = report?.packCurrents || {};

  useEffect(() => {
    if (!isOpen || !rack) return;
    const current = rack.inspectionReport;
    setForm({
      packSocs: current?.packSocs || {}, packVoltages: current?.packVoltages || {}, packCurrents: current?.packCurrents || {},
      cycle1ChargedKwh: current?.cycle1ChargedKwh ?? '', cycle1DischargedKwh: current?.cycle1DischargedKwh ?? '',
      cycle2ChargedKwh: current?.cycle2ChargedKwh ?? '', cycle2DischargedKwh: current?.cycle2DischargedKwh ?? '',
      solisBmsComm: current?.solisBmsComm || 'Stable', pdfFileName: current?.pdfFileName || '',
      pdfFileSize: current?.pdfFileSize || '', pdfDataUrl: current?.pdfDataUrl || '',
    });
    setEditing(false);
    setError('');
  }, [isOpen, rack?.id, rack?.inspectionReport]);

  if (!isOpen || !rack) return null;

  const updateForm = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const updatePackValue = (key: 'packSocs' | 'packVoltages' | 'packCurrents', pack: number, value: string) => {
    setForm((current: any) => ({ ...current, [key]: { ...(current[key] || {}), [pack]: value } }));
  };
  const saveReport = async () => {
    if (!onSave) return;
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      setEditing(false);
    } catch (saveError: any) {
      setError(saveError?.message || 'Could not save the report.');
    } finally {
      setSaving(false);
    }
  };

  const editor = (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
        <p className="text-xs font-bold text-slate-800">Factory test results</p>
        <p className="mt-1 text-[11px] text-slate-500">Enter the inspection values for this rack. Existing values are prefilled when editing.</p>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-800">Pack readings</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: packCount }, (_, i) => i + 1).map(num => (
            <div key={num} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <p className="text-[11px] font-black text-emerald-700">Pack {String(num).padStart(2, '0')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['packSocs', 'packVoltages', 'packCurrents'] as const).map((key, index) => (
                  <label key={key} className="text-[10px] text-slate-500">{['SOC %', 'Voltage V', 'Current A'][index]}
                    <input type="number" step="any" value={form[key]?.[num] ?? ''} onChange={event => updatePackValue(key, num, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800" />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          ['cycle1ChargedKwh', 'Cycle 1 charged (kWh)'], ['cycle1DischargedKwh', 'Cycle 1 discharged (kWh)'],
          ['cycle2ChargedKwh', 'Cycle 2 charged (kWh)'], ['cycle2DischargedKwh', 'Cycle 2 discharged (kWh)'],
        ].map(([key, label]) => (
          <label key={key} className="text-xs font-semibold text-slate-600">{label}
            <input type="number" step="any" value={form[key] ?? ''} onChange={event => updateForm(key, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900" />
          </label>
        ))}
      </div>
      <label className="block text-xs font-semibold text-slate-600">Solis-BMS communication
        <select value={form.solisBmsComm || 'Stable'} onChange={event => updateForm('solisBmsComm', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900">
          <option>Stable</option><option>Fault observed</option>
        </select>
      </label>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-xs font-bold text-slate-600 hover:border-emerald-400 hover:bg-emerald-50">
        <Upload className="h-4 w-4" /> {form.pdfFileName || 'Attach or replace inspection PDF'}
        <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Please select a PDF file.'); return; }
          const reader = new FileReader();
          reader.onload = () => { updateForm('pdfFileName', file.name); updateForm('pdfFileSize', `${(file.size / (1024 * 1024)).toFixed(2)} MB`); updateForm('pdfDataUrl', String(reader.result || '')); setError(''); };
          reader.onerror = () => setError('Could not read the selected PDF.');
          reader.readAsDataURL(file);
        }} />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setEditing(false); setError(''); }} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Cancel</button>
        <button type="button" disabled={saving} onClick={() => void saveReport()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save report'}</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8 animate-card-enter">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full mb-0.5">
                Factory Test &amp; Calibration
              </div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>Inspection Report</span>
                <span className="font-mono text-sm text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/50">
                  {serial}
                </span>
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[calc(85vh-140px)] overflow-y-auto custom-scrollbar">
          {editing ? editor : !report ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Factory Inspection Report Found</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                This unit was assembled prior to the inspection logging system or without an attached PDF test report.
              </p>
              <button type="button" onClick={() => setEditing(true)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white"><Pencil className="h-3.5 w-3.5" />Add Inspection Report</button>
            </div>
          ) : (
            <>
              {/* PDF Document Attachment Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                  Attached Test Report Document
                </span>
                {report.pdfFileName ? (
                  <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{report.pdfFileName}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{report.pdfFileSize || 'PDF Report'}</p>
                      </div>
                    </div>
                    {report.pdfDataUrl && (
                      <a
                        href={report.pdfDataUrl}
                        download={report.pdfFileName || `${serial}-test-report.pdf`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download PDF</span>
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-white rounded-lg border border-dashed border-slate-200 text-center text-xs text-slate-400">
                    No PDF file was uploaded during assembly for this rack.
                  </div>
                )}
              </div>

              {/* Question 1: Pack SOC Values */}
              <div className="space-y-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-bold">1</span>
                  <span>Pack State of Charge (SOC %)</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {Array.from({ length: packCount }, (_, i) => i + 1).map(num => (
                    <div key={num} className="rounded-lg border border-slate-200 bg-white p-2.5 text-center">
                      <span className="text-[10px] font-bold text-slate-400 block uppercase">Pack 0{num}</span>
                      <span className="text-sm font-black font-mono text-emerald-700">
                        {packSocs[num] ? `${packSocs[num]}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Question 2: Pack Voltage & Peak Current */}
              <div className="space-y-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-bold">2</span>
                  <span>Battery Voltage &amp; Peak Current (V / A)</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {Array.from({ length: packCount }, (_, i) => i + 1).map(num => (
                    <div key={num} className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
                      <span className="text-[10px] font-black text-emerald-700 block uppercase tracking-wider border-b border-slate-100 pb-1">
                        Pack 0{num}
                      </span>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Voltage:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {packVoltages[num] ? `${packVoltages[num]} V` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium">Peak Current:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {packCurrents[num] ? `${packCurrents[num]} A` : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Questions 3 & 4: Cycle Energy (Charged / Discharged) */}
              <div className="space-y-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-bold">3</span>
                  <span>Cycle Energy (kWh)</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Cycle 01 */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <span className="text-[11px] font-black text-slate-800 block uppercase tracking-wider border-b border-slate-100 pb-1">
                      Cycle 01
                    </span>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Charged:</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {report.cycle1ChargedKwh != null ? `${report.cycle1ChargedKwh} kWh` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Discharged:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {report.cycle1DischargedKwh != null ? `${report.cycle1DischargedKwh} kWh` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Cycle 02 */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <span className="text-[11px] font-black text-slate-800 block uppercase tracking-wider border-b border-slate-100 pb-1">
                      Cycle 02
                    </span>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Charged:</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {report.cycle2ChargedKwh != null ? `${report.cycle2ChargedKwh} kWh` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Discharged:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {report.cycle2DischargedKwh != null ? `${report.cycle2DischargedKwh} kWh` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Question 5: Solis-BMS Communication */}
              <div className="space-y-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-bold">4</span>
                  <span>Solis-BMS Communication</span>
                </span>
                <div className={`p-3 rounded-xl border flex items-center space-x-2.5 ${
                  report.solisBmsComm === 'Fault observed'
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900'
                }`}>
                  {report.solisBmsComm === 'Fault observed' ? (
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                  <span className="text-xs font-bold">
                    {report.solisBmsComm || 'Stable (Passed)'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 flex justify-between">
          {report && !editing ? <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-bold text-emerald-700"><Pencil className="h-3.5 w-3.5" />Edit Report</button> : <span />}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

