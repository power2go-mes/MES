import React, { useEffect, useState } from 'react';
import {
  FileText,
  Download,
  X,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Save,
  Upload,
  ScanLine,
  Loader2,
  Check,
  Layers,
  ChevronRight,
} from 'lucide-react';
import type { RackUnit, RackInspectionReport } from '../../types';
import type { FatFourPageReportData } from '../../types/rackFat';
import { runFatDocumentOcr, type OcrProgress } from '../../lib/fatOcrEngine';
import { generateFourPageFatPdf } from '../../lib/rackFatReportPdf';

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
  const [activeTab, setActiveTab] = useState<'p1' | 'p2' | 'p3' | 'p4'>('p1');
  const [saving, setSaving] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrProgress | null>(null);
  const [error, setError] = useState('');
  
  // 4-page comprehensive report state
  const [fatData, setFatData] = useState<FatFourPageReportData>({
    customerProject: '',
    reportNo: '',
    batterySystem: 'Power2Go HV Battery | 45 kWh nominal',
    configuration: '6 x 7.5 kWh HV packs',
    inverter: 'Solis 50kW HV 3-Phase Hybrid Inverter',
    cabinetSerial: '',
    inspectionDate: new Date().toISOString().split('T')[0],
    location: 'Karachi Plant',
    checklist: {
      '01': 'Pass', '02': 'Pass', '03': 'Pass', '04': 'Pass', '05': 'Pass',
      '06': 'Pass', '07': 'Pass', '08': 'Pass', '09': 'Pass', '10': 'Pass', '11': 'Pass'
    },
    basicMeasurements: {
      totalBatteryVoltage: 442.0,
      packVoltageSpread: 0.25,
      insulationResistance: 120.0,
      chargeCurrent: 30.0,
      dischargeCurrent: 30.0,
      peakPackTemperature: 28.0,
      solisCommStatus: 'Stable link / no active faults'
    },
    cycleMeasurements: {
      cycle1ChargeKw: 36.2,
      cycle1DischargeKw: 35.8,
      cycle2ChargeKw: 36.0,
      cycle2DischargeKw: 35.9
    },
    irSection: {
      meterModel: 'Hioki BT3562 / Calibrated',
      calibrationDue: '2027-01-15',
      socAtTest: 50,
      packTempAtTest: 25,
      packs: [
        { packIndex: 1, packSerial: 'PACK-01', voltage: 73.6, internalResistance: 18.2, result: 'Pass' },
        { packIndex: 2, packSerial: 'PACK-02', voltage: 73.7, internalResistance: 18.5, result: 'Pass' },
        { packIndex: 3, packSerial: 'PACK-03', voltage: 73.6, internalResistance: 18.1, result: 'Pass' },
        { packIndex: 4, packSerial: 'PACK-04', voltage: 73.8, internalResistance: 18.4, result: 'Pass' },
        { packIndex: 5, packSerial: 'PACK-05', voltage: 73.7, internalResistance: 18.3, result: 'Pass' },
        { packIndex: 6, packSerial: 'PACK-06', voltage: 73.6, internalResistance: 18.2, result: 'Pass' }
      ],
      highestPackIr: 18.5,
      irSpread: 0.4
    },
    approval: {
      overallResult: 'PASS',
      remarks: 'All electrical, communication and insulation checks successfully passed factory standards.',
      testedByName: 'Quality Engineer',
      testedByDate: new Date().toISOString().split('T')[0],
      reviewedByName: 'Plant QC Lead',
      reviewedByDate: new Date().toISOString().split('T')[0]
    }
  });

  const [attachedPdf, setAttachedPdf] = useState<{ fileName: string; fileSize: string; dataUrl: string } | null>(null);

  const report: RackInspectionReport | null = rack?.inspectionReport || null;
  const serial = rack?.serialNumber || rack?.id || '';
  const packCount = rack?.installedPackCount || rack?.batteryIds?.length || 6;

  // Initialize data from rack + existing inspection report
  useEffect(() => {
    if (!isOpen || !rack) return;
    const current = rack.inspectionReport;

    const initialSerial = rack.serialNumber || rack.id || '';
    const initialReportNo = `FAT-${new Date().getFullYear()}-${initialSerial.slice(-4) || '0001'}`;

    // Try parsing existing extended report from packSocs if stored
    let extended: Partial<FatFourPageReportData> = {};
    if (current?.packSocs && (current.packSocs as any)._fatExtended) {
      extended = (current.packSocs as any)._fatExtended;
    }

    setFatData(prev => ({
      ...prev,
      cabinetSerial: initialSerial,
      reportNo: extended.reportNo || initialReportNo,
      customerProject: extended.customerProject || rack.issuedToDepartment || rack.issuedToPerson || 'Power2Go Standard',
      batterySystem: extended.batterySystem || (rack.maxPackCapacity ? `${rack.maxPackCapacity} kWh HV Cabinet` : 'Power2Go HV Battery | 45 kWh nominal'),
      configuration: extended.configuration || `${packCount} x 7.5 kWh HV packs`,
      inverter: extended.inverter || 'Solis 50kW HV 3-Phase Hybrid Inverter',
      inspectionDate: extended.inspectionDate || (current?.createdAt ? new Date(current.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
      checklist: extended.checklist || prev.checklist,
      basicMeasurements: {
        ...prev.basicMeasurements,
        ...(extended.basicMeasurements || {}),
        solisCommStatus: current?.solisBmsComm || extended.basicMeasurements?.solisCommStatus || 'Stable link / no active faults'
      },
      cycleMeasurements: {
        cycle1ChargeKw: current?.cycle1ChargedKwh ?? extended.cycleMeasurements?.cycle1ChargeKw ?? 36.0,
        cycle1DischargeKw: current?.cycle1DischargedKwh ?? extended.cycleMeasurements?.cycle1DischargeKw ?? 35.8,
        cycle2ChargeKw: current?.cycle2ChargedKwh ?? extended.cycleMeasurements?.cycle2ChargeKw ?? 36.0,
        cycle2DischargeKw: current?.cycle2DischargedKwh ?? extended.cycleMeasurements?.cycle2DischargeKw ?? 35.9,
      },
      irSection: extended.irSection || {
        ...prev.irSection,
        packs: Array.from({ length: packCount }, (_, i) => ({
          packIndex: i + 1,
          packSerial: `PACK-0${i + 1}`,
          voltage: current?.packVoltages?.[i + 1] ? Number(current.packVoltages[i + 1]) : 73.6,
          internalResistance: 18.2,
          result: 'Pass'
        }))
      },
      approval: extended.approval || prev.approval
    }));

    if (current?.pdfDataUrl) {
      setAttachedPdf({
        fileName: current.pdfFileName || 'Factory-Inspection.pdf',
        fileSize: current.pdfFileSize || 'PDF',
        dataUrl: current.pdfDataUrl
      });
    } else {
      setAttachedPdf(null);
    }

    setEditing(false);
    setError('');
    setActiveTab('p1');
  }, [isOpen, rack?.id, rack?.inspectionReport]);

  if (!isOpen || !rack) return null;

  // Handle OCR Document Upload (Image or PDF page)
  const handleOcrUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setOcrScanning(true);
    setOcrStatus({ status: 'Reading uploaded test report images...', progress: 0.1 });
    setError('');

    try {
      const imageUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        imageUrls.push(dataUrl);
      }

      const { parsedData } = await runFatDocumentOcr(imageUrls, setOcrStatus);

      // Merge OCR extracted data into state
      setFatData(prev => ({
        ...prev,
        inverter: parsedData.inverter || prev.inverter,
        checklist: { ...prev.checklist, ...(parsedData.checklist || {}) },
        basicMeasurements: { ...prev.basicMeasurements, ...(parsedData.basicMeasurements || {}) },
        cycleMeasurements: { ...prev.cycleMeasurements, ...(parsedData.cycleMeasurements || {}) },
        irSection: {
          ...prev.irSection,
          ...(parsedData.irSection || {}),
          packs: (parsedData.irSection?.packs && parsedData.irSection.packs.length > 0)
            ? parsedData.irSection.packs
            : prev.irSection.packs
        },
        approval: { ...prev.approval, ...(parsedData.approval || {}) }
      }));

      setEditing(true);
    } catch (ocrErr: any) {
      setError(ocrErr?.message || 'OCR scanning could not parse the document.');
    } finally {
      setOcrScanning(false);
      setOcrStatus(null);
    }
  };

  // Save report into MES Database
  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    setError('');
    try {
      // Build standard MES inspection report payload + pack extended 4-page data
      const packSocsPayload: any = { _fatExtended: fatData };
      const packVoltagesPayload: any = {};
      const packCurrentsPayload: any = {};

      fatData.irSection.packs.forEach(p => {
        packVoltagesPayload[p.packIndex] = p.voltage || 0;
        packCurrentsPayload[p.packIndex] = fatData.basicMeasurements.dischargeCurrent || 30;
      });

      const payload: Partial<RackInspectionReport> = {
        rackSerial: serial,
        packSocs: packSocsPayload,
        packVoltages: packVoltagesPayload,
        packCurrents: packCurrentsPayload,
        cycle1ChargedKwh: fatData.cycleMeasurements.cycle1ChargeKw,
        cycle1DischargedKwh: fatData.cycleMeasurements.cycle1DischargeKw,
        cycle2ChargedKwh: fatData.cycleMeasurements.cycle2ChargeKw,
        cycle2DischargedKwh: fatData.cycleMeasurements.cycle2DischargeKw,
        solisBmsComm: fatData.basicMeasurements.solisCommStatus?.includes('Fault') ? 'Fault observed' : 'Stable',
        pdfFileName: attachedPdf?.fileName || `${serial}-FAT-Report.pdf`,
        pdfFileSize: attachedPdf?.fileSize || 'Generated PDF',
        pdfDataUrl: attachedPdf?.dataUrl || undefined,
      };

      await onSave(payload);
      setEditing(false);
    } catch (saveErr: any) {
      setError(saveErr?.message || 'Could not save report.');
    } finally {
      setSaving(false);
    }
  };

  // Download 4-Page Official PDF (works even if completely un-filled or empty)
  const handleDownloadOfficialPdf = () => {
    try {
      const doc = generateFourPageFatPdf(fatData || {});
      const fileName = `${serial || 'Rack'}-FAT-45kWh-Report.pdf`;
      
      // Direct blob download to ensure cross-browser download triggers reliably
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (exportErr: any) {
      console.error('Failed to export 4-page FAT PDF:', exportErr);
      setError(exportErr?.message || 'Could not export FAT PDF report.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6 flex flex-col max-h-[92vh]">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-6 py-4 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full">
                  FAT Verification &amp; Calibration
                </span>
                <span className="font-mono text-xs text-slate-500 font-bold">
                  {fatData.reportNo}
                </span>
              </div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2 mt-0.5">
                <span>Cabinet FAT Report</span>
                <span className="font-mono text-sm text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200/50">
                  {serial}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* OCR Upload Button */}
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-bold transition-colors">
              {ocrScanning ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              ) : (
                <ScanLine className="w-4 h-4 text-sky-600" />
              )}
              <span>{ocrScanning ? 'Scanning...' : 'OCR Scan Sheet'}</span>
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                disabled={ocrScanning}
                onChange={handleOcrUpload}
              />
            </label>

            {/* Official 4-Page PDF Export Button */}
            <button
              type="button"
              onClick={handleDownloadOfficialPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs"
              title="Download Official 4-Page FAT Report PDF"
            >
              <Download className="w-4 h-4" />
              <span>Export 4-Page PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* OCR Status Banner if active */}
        {ocrScanning && ocrStatus && (
          <div className="bg-sky-50 border-b border-sky-100 px-6 py-2.5 flex items-center justify-between text-xs text-sky-900 animate-pulse">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              {ocrStatus.status}
            </span>
            <span className="font-bold font-mono">{Math.round(ocrStatus.progress * 100)}%</span>
          </div>
        )}

        {/* Navigation Tabs (Pages 1 to 4) */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-6 shrink-0 gap-1 overflow-x-auto">
          {[
            { id: 'p1', label: 'Page 1: Checklist 01-05 & Specs' },
            { id: 'p2', label: 'Page 2: Checklist 06-11 & Voltages' },
            { id: 'p3', label: 'Page 3: Insulation & Cycles' },
            { id: 'p4', label: 'Page 4: Pack IR & Sign-off' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 1: Page 1 Specs & Checklist 01 - 05 */}
          {/* ======================================================== */}
          {activeTab === 'p1' && (
            <div className="space-y-6">
              {/* Header Details (MES Auto-Calculated) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between mb-3 border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Header Details (Auto-Calculated by MES)
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60">
                    30% MES Data
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Customer / Project</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.customerProject}
                      onChange={e => setFatData(prev => ({ ...prev, customerProject: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Report No.</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.reportNo}
                      onChange={e => setFatData(prev => ({ ...prev, reportNo: e.target.value }))}
                      className="mt-1 w-full text-xs font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Battery System</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.batterySystem}
                      onChange={e => setFatData(prev => ({ ...prev, batterySystem: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Configuration</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.configuration}
                      onChange={e => setFatData(prev => ({ ...prev, configuration: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Inverter</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.inverter}
                      onChange={e => setFatData(prev => ({ ...prev, inverter: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Cabinet ID</label>
                    <input
                      type="text"
                      disabled
                      value={fatData.cabinetSerial}
                      className="mt-1 w-full text-xs font-mono font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg p-2"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Inspection Date</label>
                    <input
                      type="date"
                      disabled={!editing}
                      value={fatData.inspectionDate}
                      onChange={e => setFatData(prev => ({ ...prev, inspectionDate: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Location</label>
                    <input
                      type="text"
                      disabled={!editing}
                      value={fatData.location}
                      onChange={e => setFatData(prev => ({ ...prev, location: e.target.value }))}
                      className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Checklist 01 to 05 */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  1. Factory Test Checklist (Part 1 - Checkboxes)
                </span>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white overflow-hidden shadow-xs">
                  {[
                    { id: '01', title: 'Physical condition & assembly', desc: 'Check cabinet, all packs, terminals, busbars, fasteners, cables and labels for damage or loose connections.' },
                    { id: '02', title: 'Pack voltage & balance', desc: 'Measure each pack voltage and total HV stack voltage; confirm readings are within approved limits and balanced.' },
                    { id: '03', title: 'Insulation & earthing', desc: 'Verify protective earthing and HV insulation resistance using approved safe test procedure.' },
                    { id: '04', title: 'HV polarity & pre-charge', desc: 'Confirm correct DC polarity, safe pre-charge operation and contactor opening/closing.' },
                    { id: '05', title: 'BMU & display', desc: 'Check SOC, voltage, current, temperature, alarms and pack data on BMU/HMI.' },
                  ].map(item => (
                    <div key={item.id} className="p-3.5 flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {item.id}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{item.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={!editing}
                          onClick={() => setFatData(prev => ({ ...prev, checklist: { ...prev.checklist, [item.id]: 'Pass' } }))}
                          className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                            fatData.checklist[item.id] === 'Pass'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          disabled={!editing}
                          onClick={() => setFatData(prev => ({ ...prev, checklist: { ...prev.checklist, [item.id]: 'Fail' } }))}
                          className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                            fatData.checklist[item.id] === 'Fail'
                              ? 'bg-red-600 text-white border-red-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          Fail
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: Page 2 Checklist 06-11 & Basic Measurements Part 1 */}
          {/* ======================================================== */}
          {activeTab === 'p2' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  1. Factory Test Checklist (Part 2: 06 - 11)
                </span>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white overflow-hidden shadow-xs">
                  {[
                    { id: '06', title: 'Inverter communication', desc: 'Confirm BMU-to-Solis 50kW HV communication, battery recognition and correct charge/discharge limits.' },
                    { id: '07', title: 'Charging performance', desc: 'Charge under controlled conditions; record voltage, current, SOC and temperature; verify no unexpected trips. Results in Section 2' },
                    { id: '08', title: 'Discharging performance', desc: 'Discharge at an approved load; verify stable output, SOC tracking and current/temperature limits. Results in Section 2' },
                    { id: '09', title: 'Cycle & usable capacity', desc: 'Complete two controlled charge/discharge cycles; record delivered kWh and compare with approved acceptance limits. Results recorded in Section 2.' },
                    { id: '10', title: 'Protection & alarms', desc: 'Verify approved over/under-voltage, over-current, temperature and emergency-stop responses using safe simulations.' },
                    { id: '11', title: 'Final system operation', desc: 'Verify stable inverter/battery operation, normal shutdown/restart and absence of active faults.' },
                  ].map(item => (
                    <div key={item.id} className="p-3.5 flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {item.id}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{item.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={!editing}
                          onClick={() => setFatData(prev => ({ ...prev, checklist: { ...prev.checklist, [item.id]: 'Pass' } }))}
                          className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                            fatData.checklist[item.id] === 'Pass'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          disabled={!editing}
                          onClick={() => setFatData(prev => ({ ...prev, checklist: { ...prev.checklist, [item.id]: 'Fail' } }))}
                          className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                            fatData.checklist[item.id] === 'Fail'
                              ? 'bg-red-600 text-white border-red-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          Fail
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2.1 Basic Measurements (Voltages) */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  2.1 Basic Measurements (Stack Voltage &amp; Spread)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Total Battery Voltage</span>
                      <span className="text-[10px] text-slate-400 font-mono">Spec: 360 V – 518.4 V</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        step="0.1"
                        disabled={!editing}
                        value={fatData.basicMeasurements.totalBatteryVoltage ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, totalBatteryVoltage: parseFloat(e.target.value) || null }
                        }))}
                        className="w-full text-base font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                      <span className="text-sm font-bold text-slate-500">V</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Pack Voltage Spread</span>
                      <span className="text-[10px] text-slate-400 font-mono">Spec: ≤ 0.72 V</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        step="0.01"
                        disabled={!editing}
                        value={fatData.basicMeasurements.packVoltageSpread ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, packVoltageSpread: parseFloat(e.target.value) || null }
                        }))}
                        className="w-full text-base font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                      <span className="text-sm font-bold text-slate-500">V</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: Page 3 Insulation, Current & Cycles 2.2 */}
          {/* ======================================================== */}
          {activeTab === 'p3' && (
            <div className="space-y-6">
              {/* Section 2.1 Contd */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  2.1 Basic Measurements (Insulation, Current, Temp &amp; Comm)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Insulation Resistance</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block font-mono">Spec: ≥ 65 MΩ</span>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        step="0.1"
                        disabled={!editing}
                        value={fatData.basicMeasurements.insulationResistance ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, insulationResistance: parseFloat(e.target.value) || null }
                        }))}
                        className="w-full text-sm font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                      <span className="text-xs font-bold text-slate-500">MΩ</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Charge / Disch. Current</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block font-mono">Spec: ≤ 50 A</span>
                    <div className="flex items-center gap-1.5 mt-2">
                      <input
                        type="number"
                        step="1"
                        placeholder="Chg"
                        disabled={!editing}
                        value={fatData.basicMeasurements.chargeCurrent ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, chargeCurrent: parseFloat(e.target.value) || null }
                        }))}
                        className="w-1/2 text-xs font-bold font-mono text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                      <span className="text-xs text-slate-400">/</span>
                      <input
                        type="number"
                        step="1"
                        placeholder="Dis"
                        disabled={!editing}
                        value={fatData.basicMeasurements.dischargeCurrent ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, dischargeCurrent: parseFloat(e.target.value) || null }
                        }))}
                        className="w-1/2 text-xs font-bold font-mono text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Peak Pack Temp</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block font-mono">Spec: ≤ 35 °C</span>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        step="0.5"
                        disabled={!editing}
                        value={fatData.basicMeasurements.peakPackTemperature ?? ''}
                        onChange={e => setFatData(prev => ({
                          ...prev,
                          basicMeasurements: { ...prev.basicMeasurements, peakPackTemperature: parseFloat(e.target.value) || null }
                        }))}
                        className="w-full text-sm font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                      />
                      <span className="text-xs font-bold text-slate-500">°C</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700">Solis Comm Status</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block font-mono">Link integrity</span>
                    <select
                      disabled={!editing}
                      value={fatData.basicMeasurements.solisCommStatus || 'Stable link / no active faults'}
                      onChange={e => setFatData(prev => ({
                        ...prev,
                        basicMeasurements: { ...prev.basicMeasurements, solisCommStatus: e.target.value }
                      }))}
                      className="mt-2 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                    >
                      <option>Stable link / no active faults</option>
                      <option>Fault observed</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2.2 Charge/Discharge Measurements */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                    2.2 Charge / Discharge Measurements (kWh / kW)
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">Spec: 36 kW ± 2.2 kW (80% SOC)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Cycle 1 */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider block border-b border-slate-100 pb-2">
                      Cycle 01
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Charge (20%-100%)</label>
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            step="0.1"
                            disabled={!editing}
                            value={fatData.cycleMeasurements.cycle1ChargeKw ?? ''}
                            onChange={e => setFatData(prev => ({
                              ...prev,
                              cycleMeasurements: { ...prev.cycleMeasurements, cycle1ChargeKw: parseFloat(e.target.value) || null }
                            }))}
                            className="w-full text-xs font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                          />
                          <span className="text-[10px] font-bold text-slate-400">kW</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Discharge (100%-20%)</label>
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            step="0.1"
                            disabled={!editing}
                            value={fatData.cycleMeasurements.cycle1DischargeKw ?? ''}
                            onChange={e => setFatData(prev => ({
                              ...prev,
                              cycleMeasurements: { ...prev.cycleMeasurements, cycle1DischargeKw: parseFloat(e.target.value) || null }
                            }))}
                            className="w-full text-xs font-bold font-mono text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                          />
                          <span className="text-[10px] font-bold text-slate-400">kW</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Cycle 2 */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider block border-b border-slate-100 pb-2">
                      Cycle 02
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Charge (20%-100%)</label>
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            step="0.1"
                            disabled={!editing}
                            value={fatData.cycleMeasurements.cycle2ChargeKw ?? ''}
                            onChange={e => setFatData(prev => ({
                              ...prev,
                              cycleMeasurements: { ...prev.cycleMeasurements, cycle2ChargeKw: parseFloat(e.target.value) || null }
                            }))}
                            className="w-full text-xs font-bold font-mono text-emerald-700 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                          />
                          <span className="text-[10px] font-bold text-slate-400">kW</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Discharge (100%-20%)</label>
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            step="0.1"
                            disabled={!editing}
                            value={fatData.cycleMeasurements.cycle2DischargeKw ?? ''}
                            onChange={e => setFatData(prev => ({
                              ...prev,
                              cycleMeasurements: { ...prev.cycleMeasurements, cycle2DischargeKw: parseFloat(e.target.value) || null }
                            }))}
                            className="w-full text-xs font-bold font-mono text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-50"
                          />
                          <span className="text-[10px] font-bold text-slate-400">kW</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: Page 4 Pack IR & Final Approvals */}
          {/* ======================================================== */}
          {activeTab === 'p4' && (
            <div className="space-y-6">
              {/* Pack IR Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                      2.3 Pack Internal Resistance (IR)
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Meter: {fatData.irSection.meterModel || 'Hioki BT3562'} | Calibration Due: {fatData.irSection.calibrationDue || '2027-01-15'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-600 block">Spec: IR Spread ≤ 2.5 mΩ</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                      <tr>
                        <th className="p-3 text-center">Pack</th>
                        <th className="p-3">Pack Serial</th>
                        <th className="p-3 text-center">Voltage (V)</th>
                        <th className="p-3 text-center">IR (mΩ)</th>
                        <th className="p-3 text-center">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fatData.irSection.packs.map((pack, idx) => (
                        <tr key={pack.packIndex} className="hover:bg-slate-50/50">
                          <td className="p-3 text-center font-bold text-slate-700">Pack {pack.packIndex}</td>
                          <td className="p-3">
                            <input
                              type="text"
                              disabled={!editing}
                              value={pack.packSerial}
                              onChange={e => {
                                const newPacks = [...fatData.irSection.packs];
                                newPacks[idx] = { ...newPacks[idx], packSerial: e.target.value };
                                setFatData(prev => ({ ...prev, irSection: { ...prev.irSection, packs: newPacks } }));
                              }}
                              className="w-full text-xs font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded p-1.5 disabled:bg-transparent disabled:border-transparent"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              step="0.1"
                              disabled={!editing}
                              value={pack.voltage ?? ''}
                              onChange={e => {
                                const newPacks = [...fatData.irSection.packs];
                                newPacks[idx] = { ...newPacks[idx], voltage: parseFloat(e.target.value) || null };
                                setFatData(prev => ({ ...prev, irSection: { ...prev.irSection, packs: newPacks } }));
                              }}
                              className="w-24 mx-auto text-xs font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded p-1.5 text-center disabled:bg-transparent disabled:border-transparent"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              step="0.1"
                              disabled={!editing}
                              value={pack.internalResistance ?? ''}
                              onChange={e => {
                                const newPacks = [...fatData.irSection.packs];
                                newPacks[idx] = { ...newPacks[idx], internalResistance: parseFloat(e.target.value) || null };
                                setFatData(prev => ({ ...prev, irSection: { ...prev.irSection, packs: newPacks } }));
                              }}
                              className="w-24 mx-auto text-xs font-mono font-bold text-emerald-700 bg-white border border-slate-200 rounded p-1.5 text-center disabled:bg-transparent disabled:border-transparent"
                            />
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              disabled={!editing}
                              onClick={() => {
                                const newPacks = [...fatData.irSection.packs];
                                newPacks[idx] = { ...newPacks[idx], result: newPacks[idx].result === 'Pass' ? 'Fail' : 'Pass' };
                                setFatData(prev => ({ ...prev, irSection: { ...prev.irSection, packs: newPacks } }));
                              }}
                              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                                pack.result === 'Pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {pack.result}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 3: Final Assessment & Approvals */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  3. Final Assessment &amp; Quality Approvals
                </span>
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-slate-800">Overall Result:</span>
                    <div className="flex items-center gap-2">
                      {(['PASS', 'FAIL', 'HOLD / RETEST'] as const).map(res => (
                        <button
                          key={res}
                          type="button"
                          disabled={!editing}
                          onClick={() => setFatData(prev => ({ ...prev, approval: { ...prev.approval, overallResult: res } }))}
                          className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                            fatData.approval.overallResult === res
                              ? res === 'PASS'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Remarks &amp; Corrective Actions</label>
                    <textarea
                      rows={2}
                      disabled={!editing}
                      value={fatData.approval.remarks || ''}
                      onChange={e => setFatData(prev => ({ ...prev, approval: { ...prev.approval, remarks: e.target.value } }))}
                      className="mt-1 w-full text-xs text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 disabled:bg-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Tested By</label>
                      <input
                        type="text"
                        disabled={!editing}
                        value={fatData.approval.testedByName || ''}
                        onChange={e => setFatData(prev => ({ ...prev, approval: { ...prev.approval, testedByName: e.target.value } }))}
                        className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Reviewed By</label>
                      <input
                        type="text"
                        disabled={!editing}
                        value={fatData.approval.reviewedByName || ''}
                        onChange={e => setFatData(prev => ({ ...prev, approval: { ...prev.approval, reviewedByName: e.target.value } }))}
                        className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Customer Witness (Optional)</label>
                      <input
                        type="text"
                        disabled={!editing}
                        value={fatData.approval.witnessName || ''}
                        onChange={e => setFatData(prev => ({ ...prev, approval: { ...prev.approval, witnessName: e.target.value } }))}
                        className="mt-1 w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg p-2 disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-xs font-bold hover:bg-emerald-50 transition-colors shadow-xs"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit / Adjust Values</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Report to MES'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors shadow-xs"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
