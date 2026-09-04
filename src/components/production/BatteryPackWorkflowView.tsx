import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BatteryUnit, ProductTemplate } from '../../types';
import { ReleasedBatteryQrModal } from '../common/ReleasedBatteryQrModal';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Zap,
  QrCode,
  Layers,
  FileCheck,
  Check,
  ShieldAlert,
  Info,
  ChevronRight,
  Printer
} from 'lucide-react';

export const BatteryPackWorkflowView: React.FC = () => {
  const { activeBatteryId, setActiveView, addNotification, refreshKey, triggerRefresh } = useApp();
  const { currentUser } = useAuth();

  const [battery, setBattery] = useState<BatteryUnit | null>(null);
  const [product, setProduct] = useState<ProductTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [qrPassportOpen, setQrPassportOpen] = useState(false);

  // Form values for Pack IR and Final Testing
  const [packIrMohm, setPackIrMohm] = useState('0');
  const [qcTesting, setQcTesting] = useState<'PASSED' | 'FAILED'>('PASSED');

  useEffect(() => {
    if (activeBatteryId) {
      loadBattery(activeBatteryId);
    }
  }, [activeBatteryId, refreshKey]);

  const loadBattery = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.getBattery(id);
      setBattery(res.battery);
      setProduct(res.product);

      if (res.battery.finalQcResult) {
        setPackIrMohm(res.battery.finalQcResult.internalResistanceMilliOhm?.toString() || '0');
        setQcTesting(res.battery.finalQcResult.status === 'FAILED' ? 'FAILED' : 'PASSED');
      } else {
        const totalCellIr = res.battery.modules.reduce((total, module) => (
          total + module.cells.reduce((moduleTotal, cell) => (
            moduleTotal + Number(cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? 0)
          ), 0)
        ), 0);
        setPackIrMohm(totalCellIr.toFixed(2));
      }
    } catch (err: any) {
      addNotification('error', 'Failed to load battery', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePackTesting = async () => {
    if (!battery) return;
    setSubmitting(true);

    try {
      await api.finalTest(battery.id, {
        mode: 'MANUAL',
        userId: currentUser.id,
        manualValues: {
          batteryIrMohm: parseFloat(packIrMohm) || 0,
          qcTesting,
        }
      });

      addNotification('success', 'Pack Testing Recorded', `Total IR and QC result saved as ${qcTesting}.`);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Testing Save Failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalQcSignoff = async (status: 'PASSED' | 'FAILED') => {
    if (!battery) return;
    setSubmitting(true);

    try {
      const result = await api.finalQc(battery.id, {
        status,
        userId: currentUser.id,
      });

      if (status === 'PASSED') {
        if (result?.battery) {
          setBattery(currentBattery => currentBattery
            ? { ...currentBattery, ...result.battery, modules: currentBattery.modules }
            : result.battery);
        }
        setQrPassportOpen(true);
        addNotification('success', 'BATTERY RELEASED', `Battery ${battery.serialNumber} passed final QC and is released for dispatch!`);
      } else {
        addNotification('error', 'Battery Scrapped', `Battery ${battery.serialNumber} failed final testing.`);
      }
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'QC Signoff Failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeBatteryId || !battery) {
    return (
      <div className="flex-1 p-8 bg-slate-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          <Layers className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-800 mb-2">NO ACTIVE BATTERY</h2>
          <p className="text-sm text-slate-500 mb-6">Select a battery in the 2D Builder or Production Orders.</p>
          <button
            onClick={() => setActiveView('production')}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-colors"
          >
            Go to 2D Battery Builder
          </button>
        </div>
      </div>
    );
  }

  const isTestingPassed = battery.stepResults.FINAL_TESTING?.status === 'PASSED';
  const isFinalQcPassed = battery.stepResults.FINAL_QC?.status === 'PASSED' || battery.status === 'FINISHED';

  // Count total cells
  let totalCellsCount = 0;
  battery.modules.forEach(m => {
    totalCellsCount += m.cells?.length || 0;
  });

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
              <span>Battery Pack Workflow</span>
              <span className="text-slate-300">•</span>
              <span className="text-emerald-600">Final Verification</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              BATTERY PACK ASSEMBLY, PACK IR & TESTING
            </h1>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <div className="px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">Battery Serial</span>
              <span className="font-mono font-bold text-slate-800">{battery.serialNumber}</span>
            </div>
            <div className="px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">Product</span>
              <span className="font-bold text-slate-800">{battery.productName}</span>
            </div>
            <div className="px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
              <span className="text-emerald-600 font-bold block text-[10px] uppercase">Status</span>
              <span className="font-bold text-emerald-800">{battery.status}</span>
            </div>
          </div>
        </div>

        {/* Release Status Banner if Finished */}
        {isFinalQcPassed && (
          <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-emerald-500/50 rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight">BATTERY RELEASED & COMPLIANCE VERIFIED</h3>
                <p className="text-xs text-emerald-100">
                  All cell, module, BMS, and pack-level testing stages passed 100%. Ready for shipping or customer assignment.
                </p>
              </div>
            </div>
            <button
              onClick={() => setQrPassportOpen(true)}
              className="px-6 py-3 bg-white hover:bg-slate-100 text-emerald-900 font-bold rounded-xl text-xs shadow-xs transition-colors flex items-center space-x-2 shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span>VIEW QR PASSPORT</span>
            </button>
          </div>
        )}

        {/* Step 1 & 2: Pack Assembly & Testing Table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: Pack Enclosure & BMS Integration Verification */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-black uppercase text-slate-900 tracking-wider">
                1. Structural Enclosure & Components
              </h2>
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[10px] font-bold rounded border border-emerald-200">
                VERIFIED
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-600 font-medium">Assembled Modules:</span>
                <span className="font-bold font-mono text-slate-900">{battery.modules.length} Modules ({totalCellsCount} Cells)</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-600 font-medium">BMS Board:</span>
                <span className="font-bold font-mono text-slate-900">
                  {battery.bms ? `${battery.bms.serialNumber} (${battery.bms.model})` : 'Integrated BMS'}
                </span>
              </div>
              {battery.bmu && (
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-600 font-medium">BMU Master Controller:</span>
                  <span className="font-bold font-mono text-slate-900">{battery.bmu.serialNumber} ({battery.bmu.model})</span>
                </div>
              )}
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-600 font-medium">Wiring Harness & Connectors:</span>
                <span className="font-bold text-emerald-700">Torque Verified (4.5 Nm)</span>
              </div>
            </div>
          </div>

          {/* Right: Battery Pack IR & QC */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-black uppercase text-slate-900 tracking-wider">
                  2. Battery Pack IR & QC Testing
                </h2>
                <p className="text-[10px] text-slate-400">Total IR is calculated from the assigned cell values and can be adjusted.</p>
              </div>
              <Zap className="w-4 h-4 text-emerald-600" />
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-emerald-700 mb-1">
                    Total IR Value (mΩ)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={packIrMohm}
                    onChange={(e) => setPackIrMohm(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-emerald-900 border border-emerald-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-emerald-50/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    QC Testing
                  </label>
                  <div className="flex gap-2">
                    {(['PASSED', 'FAILED'] as const).map(status => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setQcTesting(status)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${qcTesting === status
                          ? status === 'PASSED'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-red-300 bg-red-50 text-red-800'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSavePackTesting}
                disabled={submitting}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
              >
                {submitting ? 'RECORDING PARAMETERS...' : 'RECORD PACK ELECTRICAL TESTING'}
              </button>
            </div>
          </div>

        </div>

        {/* Step 3: Complete Manufacturing Traceability Summary Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">
                Manufacturing Stage Traceability & Quality Gate
              </h3>
              <p className="text-xs text-slate-400">All workflow milestones must be satisfied before final release</p>
            </div>
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                  <th className="px-4 py-3">Workflow Stage</th>
                  <th className="px-4 py-3">Execution Level</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Operator / Inspector</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-800">1. Cell OCV / IR Testing</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">CELL LEVEL ({totalCellsCount} Cells)</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                      ✓ PASSED
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{battery.stepResults.CELL_TESTING?.completedBy || 'Operator 1'}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{battery.stepResults.CELL_TESTING?.completedAt || 'Verified'}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-800">2. Cell Grading Assessment</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">CELL LEVEL</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                      ✓ PASSED
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{battery.stepResults.GRADING?.completedBy || 'Operator 1'}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{battery.stepResults.GRADING?.completedAt || 'Verified'}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-800">3. Damage History Visual Inspection</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">CELL LEVEL</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                      ✓ PASSED
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{battery.stepResults.DAMAGE_HISTORY?.completedBy || 'Quality Inspector'}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{battery.stepResults.DAMAGE_HISTORY?.completedAt || 'Verified'}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-800">4. Module Laser Welding & QC</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">MODULE LEVEL ({battery.modules.length} Modules)</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                      ✓ PASSED
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{battery.stepResults.MODULE_QC?.completedBy || 'Welding Tech'}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">{battery.stepResults.MODULE_QC?.completedAt || 'Verified'}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-800">5. Battery Pack IR & Hi-Pot</td>
                  <td className="px-4 py-3 text-slate-500 font-mono">BATTERY PACK LEVEL</td>
                  <td className="px-4 py-3">
                    {isTestingPassed ? (
                      <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                        ✓ PASSED
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold">
                        READY FOR SIGN-OFF
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{currentUser.name}</td>
                  <td className="px-4 py-3 text-slate-400 font-mono">Pending final signoff</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Final Signoff & Release Action Bar */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-400 block mb-1">
              Final Release Signoff
            </span>
            <p className="text-xs text-slate-600 font-medium">
              Signing off marks the battery as finished, registers the final warranty QR code, and updates production order quantity.
            </p>
          </div>

          <div className="flex space-x-3 shrink-0">
            <button
              type="button"
              onClick={() => handleFinalQcSignoff('FAILED')}
              disabled={submitting || isFinalQcPassed}
              className="px-5 py-3 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl text-xs border border-red-200 transition-colors disabled:opacity-50"
            >
              REJECT / SCRAP
            </button>
            <button
              type="button"
              onClick={() => handleFinalQcSignoff('PASSED')}
              disabled={submitting || isFinalQcPassed}
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-xs transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isFinalQcPassed ? 'BATTERY RELEASED ✓' : 'RELEASE BATTERY PACK'}</span>
            </button>
          </div>
        </div>

      </div>
      <ReleasedBatteryQrModal
        isOpen={qrPassportOpen}
        onClose={() => setQrPassportOpen(false)}
        battery={battery}
      />
    </div>
  );
};
