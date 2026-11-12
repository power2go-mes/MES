import React from 'react';
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
} from 'lucide-react';
import type { RackUnit, RackInspectionReport } from '../../types';

interface RackInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rack: RackUnit | null;
}

export const RackInspectionModal: React.FC<RackInspectionModalProps> = ({
  isOpen,
  onClose,
  rack,
}) => {
  if (!isOpen || !rack) return null;

  const report: RackInspectionReport | null = rack.inspectionReport || null;
  const serial = rack.serialNumber || rack.id;
  const packCount = rack.installedPackCount || rack.batteryIds?.length || 5;

  const packSocs = report?.packSocs || {};
  const packVoltages = report?.packVoltages || {};
  const packCurrents = report?.packCurrents || {};

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
          {!report ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-800">No Factory Inspection Report Found</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                This unit was assembled prior to the inspection logging system or without an attached PDF test report.
              </p>
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
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3.5 flex justify-end">
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

