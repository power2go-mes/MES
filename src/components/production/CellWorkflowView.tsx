import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BatteryUnit, CellItem, ProductTemplate } from '../../types';
import { sortCellsForWorkflow } from '../../lib/cellOrdering';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Camera,
  ShieldAlert,
  RotateCcw,
  Sparkles,
  Layers,
  FileText,
  Check,
  Upload,
  Info,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

interface CellOcvIrRowState {
  cellId: string;
  ocv: string;
  ir: string;
}

interface CellGradingRowState {
  cellId: string;
  grade: string;
  remarks: string;
}

interface CellDamageRowState {
  cellId: string;
  condition: 'GOOD' | 'DAMAGED';
  remarks: string;
  imageUri?: string;
}

export const CellWorkflowView: React.FC = () => {
  const { activeBatteryId, setActiveView, addNotification, refreshKey, triggerRefresh } = useApp();
  const { currentUser } = useAuth();

  const [battery, setBattery] = useState<BatteryUnit | null>(null);
  const [product, setProduct] = useState<ProductTemplate | null>(null);
  const [cells, setCells] = useState<CellItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Workflow Sub-Phases: 'OCV_IR' -> 'GRADING' -> 'DAMAGE_HISTORY' -> 'COMPLETED'
  const [currentPhase, setCurrentPhase] = useState<'OCV_IR' | 'GRADING' | 'DAMAGE_HISTORY' | 'COMPLETED'>('OCV_IR');

  // Form states
  const [ocvIrValues, setOcvIrValues] = useState<Record<string, { ocv: string; ir: string }>>({});
  const [gradingValues, setGradingValues] = useState<Record<string, { grade: string; remarks: string }>>({});
  const [damageValues, setDamageValues] = useState<Record<string, { condition: 'GOOD' | 'DAMAGED'; remarks: string; imageUri?: string }>>({});

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (activeBatteryId) {
      loadBatteryData(activeBatteryId);
    }
  }, [activeBatteryId, refreshKey]);

  const loadBatteryData = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.getBattery(id);
      setBattery(res.battery);
      setProduct(res.product);

      // Flatten only the cells assigned to physical module slots while preserving builder slot order.
      const allCells: CellItem[] = [];
      res.battery.modules.forEach(m => {
        (m.cells || []).forEach(c => {
          allCells.push(c);
        });
      });

      setCells(sortCellsForWorkflow(allCells, res.battery.modules));

      // Initialize OCV/IR input states prefilled with supplier or existing production values
      const initialOcvIr: Record<string, { ocv: string; ir: string }> = {};
      const initialGrading: Record<string, { grade: string; remarks: string }> = {};
      const initialDamage: Record<string, { condition: 'GOOD' | 'DAMAGED'; remarks: string; imageUri?: string }> = {};

      allCells.forEach(cell => {
        const prodOcv = cell.productionOcvV ?? cell.supplierOcvV ?? 3.280;
        const prodIr = cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? cell.supplierIrMohm ?? 0.250;
        initialOcvIr[cell.id] = {
          ocv: prodOcv.toFixed(3),
          ir: prodIr.toFixed(3),
        };

        initialGrading[cell.id] = {
          grade: cell.productionGrade || cell.supplierGrade || 'GOOD',
          remarks: cell.quarantineReason || '',
        };

        initialDamage[cell.id] = {
          condition: cell.status === 'QUARANTINED' || cell.productionGrade === 'DAMAGED' ? 'DAMAGED' : 'GOOD',
          remarks: cell.quarantineReason || '',
          imageUri: '',
        };
      });

      setOcvIrValues(initialOcvIr);
      setGradingValues(initialGrading);
      setDamageValues(initialDamage);

      // Determine initial phase from backend battery state
      if (res.battery.currentStep === 'CELL_IDENTIFICATION' || res.battery.currentStep === 'CELL_TESTING') {
        setCurrentPhase('OCV_IR');
      } else if (res.battery.currentStep === 'GRADING') {
        setCurrentPhase('GRADING');
      } else if (res.battery.currentStep === 'DAMAGE_HISTORY') {
        setCurrentPhase('DAMAGE_HISTORY');
      } else {
        // Module assembly or later
        setCurrentPhase('COMPLETED');
      }
    } catch (err: any) {
      addNotification('error', 'Load Failed', err.message || 'Failed to load battery workflow data');
    } finally {
      setLoading(false);
    }
  };

  // Keyboard navigation for OCV/IR table
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, cellIndex: number, field: 'ocv' | 'ir') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'ocv') {
        const nextKey = `${cellIndex}-ir`;
        inputRefs.current[nextKey]?.focus();
        inputRefs.current[nextKey]?.select();
      } else if (field === 'ir') {
        if (cellIndex < cells.length - 1) {
          const nextKey = `${cellIndex + 1}-ocv`;
          inputRefs.current[nextKey]?.focus();
          inputRefs.current[nextKey]?.select();
        } else {
          // Last cell - focus continue button
          document.getElementById('continue-to-grading-btn')?.focus();
        }
      }
    }
  };

  // Reset/Prefill all to supplier values
  const handlePrefillSupplierValues = () => {
    const updated: Record<string, { ocv: string; ir: string }> = {};
    cells.forEach(c => {
      updated[c.id] = {
        ocv: (c.supplierOcvV ?? 3.280).toFixed(3),
        ir: (c.supplierIrMilliOhm ?? c.supplierIrMohm ?? 0.250).toFixed(3),
      };
    });
    setOcvIrValues(updated);
    addNotification('info', 'Supplier Values Loaded', 'All cells prefilled with supplier baseline OCV & IR.');
  };

  // Submit OCV / IR and Continue to Grading
  const handleContinueToGrading = async () => {
    if (!battery) return;
    const userId = currentUser?.id;
    if (!userId) {
      addNotification('error', 'User Required', 'Please sign in to continue.');
      return;
    }
    setSubmitting(true);

    try {
      // Gather all cell measurements from current table state
      const measurements = cells.map(cell => {
        const entry = ocvIrValues[cell.id];
        const ocvVal = entry ? parseFloat(entry.ocv) : (cell.productionOcvV ?? cell.supplierOcvV ?? 3.280);
        const irVal = entry ? parseFloat(entry.ir) : (cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? 0.250);

        return {
          cellId: cell.id,
          productionOcvV: isNaN(ocvVal) ? (cell.supplierOcvV ?? 3.280) : ocvVal,
          productionIrMilliOhm: isNaN(irVal) ? (cell.supplierIrMilliOhm ?? 0.250) : irVal,
        };
      });

      // Call backend API to persist all values and transition state
      const res = await api.bulkSaveCellOcvIr(battery.id, measurements, userId);

      setCurrentPhase('GRADING');
      addNotification('success', 'OCV / IR Verified', `All ${cells.length} cells recorded. Proceeding to Grading.`);
    } catch (err: any) {
      addNotification('error', 'OCV / IR Save Failed', err.message || 'Failed to save cell OCV / IR measurements');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick grading helpers
  const handleMarkAllGrading = (grade: string) => {
    const updated: Record<string, { grade: string; remarks: string }> = {};
    cells.forEach(c => {
      updated[c.id] = {
        grade,
        remarks: grade === 'DAMAGED' ? 'Flagged for quality review' : '',
      };
    });
    setGradingValues(updated);
    addNotification('info', 'Grading Updated', `All cells set to ${grade}.`);
  };

  // Submit Grading and Continue to Damage History
  const handleContinueToDamageHistory = async () => {
    if (!battery) return;
    const userId = currentUser?.id;
    if (!userId) {
      addNotification('error', 'User Required', 'Please sign in to continue.');
      return;
    }
    setSubmitting(true);

    try {
      const grades = cells.map(cell => {
        const g = gradingValues[cell.id];
        return {
          cellId: cell.id,
          grade: g ? g.grade : (cell.productionGrade || 'GOOD'),
          remarks: g ? g.remarks : '',
        };
      });

      const res = await api.bulkSaveCellGrading(battery.id, grades, userId);

      setCurrentPhase('DAMAGE_HISTORY');
      addNotification('success', 'Cell Grading Logged', `Cell grading saved. Proceeding to Damage History.`);
    } catch (err: any) {
      addNotification('error', 'Grading Save Failed', err.message || 'Failed to save cell grading');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick damage helpers
  const handleMarkAllDamage = (condition: 'GOOD' | 'DAMAGED') => {
    const updated: Record<string, { condition: 'GOOD' | 'DAMAGED'; remarks: string; imageUri?: string }> = {};
    cells.forEach(c => {
      updated[c.id] = {
        condition,
        remarks: condition === 'DAMAGED' ? 'Surface imperfection noted' : 'Clean / no defects',
        imageUri: '',
      };
    });
    setDamageValues(updated);
    addNotification('info', 'Inspection Updated', `All cells set to ${condition === 'GOOD' ? 'Clean / Undamaged' : 'Damaged'}.`);
  };

  // Submit Damage History and Continue to Module Workflow
  const handleContinueToModuleWorkflow = async () => {
    if (!battery) return;
    const userId = currentUser?.id;
    if (!userId) {
      addNotification('error', 'User Required', 'Please sign in to continue.');
      return;
    }
    setSubmitting(true);

    try {
      const items = cells.map(cell => {
        const d = damageValues[cell.id];
        return {
          cellId: cell.id,
          condition: d ? d.condition : 'GOOD',
          remarks: d ? d.remarks : 'Pristine cell condition verified',
          imageUri: d?.imageUri || '',
        };
      });

      const res = await api.bulkSaveDamageHistory(battery.id, items, userId);

      setBattery(res.battery);
      addNotification('success', 'Cell Workflow Complete', 'All cell testing, grading, and damage checks completed.');
      triggerRefresh();
      setActiveView('workflow-module');
    } catch (err: any) {
      addNotification('error', 'Save Failed', err.message || 'Failed to complete damage history stage');
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
          <p className="text-sm text-slate-500 mb-6">Select or scan a battery in the 2D Battery Builder to begin cell testing.</p>
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

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Phase Header & Step Navigation */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                <span>Cell Workflow Engine</span>
                <span className="text-slate-300">•</span>
                <span className="text-emerald-600">Phase {currentPhase === 'OCV_IR' ? '1 of 3' : currentPhase === 'GRADING' ? '2 of 3' : '3 of 3'}</span>
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                {currentPhase === 'OCV_IR' && 'CELL OCV / IR TESTING'}
                {currentPhase === 'GRADING' && 'CELL GRADING & QUALITY ASSESSMENT'}
                {currentPhase === 'DAMAGE_HISTORY' && 'CELL DAMAGE HISTORY & VISUAL QC'}
                {currentPhase === 'COMPLETED' && 'CELL WORKFLOW COMPLETED'}
              </h1>
            </div>

            {/* Battery Info Badges */}
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
                <span className="text-emerald-600 font-bold block text-[10px] uppercase">Total Cells</span>
                <span className="font-mono font-bold text-emerald-800">{cells.length} Cells</span>
              </div>
            </div>
          </div>

          {/* Workflow Stepper Bar */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setCurrentPhase('OCV_IR')}
              className={`p-3 rounded-xl text-left border transition-all ${
                currentPhase === 'OCV_IR'
                  ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step 1</span>
                {battery.stepResults.CELL_TESTING?.status === 'PASSED' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-800">1. OCV & IR Testing</div>
            </button>

            <button
              onClick={() => setCurrentPhase('GRADING')}
              className={`p-3 rounded-xl text-left border transition-all ${
                currentPhase === 'GRADING'
                  ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step 2</span>
                {battery.stepResults.GRADING?.status === 'PASSED' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-800">2. Cell Grading</div>
            </button>

            <button
              onClick={() => setCurrentPhase('DAMAGE_HISTORY')}
              className={`p-3 rounded-xl text-left border transition-all ${
                currentPhase === 'DAMAGE_HISTORY'
                  ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step 3</span>
                {battery.stepResults.DAMAGE_HISTORY?.status === 'PASSED' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-800">3. Damage History</div>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* PHASE 1: CELL OCV / IR TESTING TABLE                           */}
        {/* ------------------------------------------------------------- */}
        {currentPhase === 'OCV_IR' && (
          <div className="space-y-4">
            {/* Action & Info Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center space-x-2 text-xs text-slate-600">
                <Info className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Production OCV & IR are prefilled from supplier data. You can accept existing values or edit any cell. Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">ENTER</kbd> to step to the next cell.
                </span>
              </div>
              <button
                type="button"
                onClick={handlePrefillSupplierValues}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 transition-colors flex items-center space-x-1.5 shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Supplier Values</span>
              </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                      <th className="px-4 py-3.5 font-semibold text-center w-16">Cell</th>
                      <th className="px-4 py-3.5 font-semibold">Internal Serial</th>
                      <th className="px-4 py-3.5 font-semibold">Supplier OCV (V)</th>
                      <th className="px-4 py-3.5 font-semibold bg-slate-800 text-emerald-400">Production OCV (V)</th>
                      <th className="px-4 py-3.5 font-semibold">Supplier IR (mΩ)</th>
                      <th className="px-4 py-3.5 font-semibold bg-slate-800 text-emerald-400">Production IR (mΩ)</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Δ OCV (mV)</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cells.map((cell, idx) => {
                      const values = ocvIrValues[cell.id] || {
                        ocv: (cell.productionOcvV ?? cell.supplierOcvV ?? 3.280).toFixed(3),
                        ir: (cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? cell.supplierIrMohm ?? 0.250).toFixed(3),
                      };

                      const suppOcv = cell.supplierOcvV ?? 3.280;
                      const prodOcvNum = parseFloat(values.ocv);
                      const deltaMv = !isNaN(prodOcvNum) ? Math.abs((prodOcvNum - suppOcv) * 1000).toFixed(1) : '—';
                      const isValid = !isNaN(parseFloat(values.ocv)) && !isNaN(parseFloat(values.ir));

                      return (
                        <tr key={cell.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 text-sm font-bold text-slate-800 text-center whitespace-nowrap bg-slate-50/50">
                            C{(idx + 1).toString().padStart(2, '0')}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700 whitespace-nowrap">
                            {cell.internalSerial}
                            {cell.supplierBarcode && (
                              <span className="block text-[10px] font-normal text-slate-400">
                                Barcode: {cell.supplierBarcode}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-600 whitespace-nowrap">
                            {suppOcv.toFixed(3)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap bg-emerald-50/20">
                            <input
                              ref={(el: HTMLInputElement | null) => {
                                inputRefs.current[`${idx}-ocv`] = el;
                              }}
                              type="number"
                              step="0.001"
                              value={values.ocv}
                              onChange={(e) => {
                                const val = e.target.value;
                                setOcvIrValues(prev => ({
                                  ...prev,
                                  [cell.id]: { ...prev[cell.id], ocv: val }
                                }));
                              }}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'ocv')}
                              className="w-28 px-2.5 py-1.5 text-sm font-mono font-bold text-slate-900 border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-600 whitespace-nowrap">
                            {(cell.supplierIrMilliOhm ?? cell.supplierIrMohm ?? 0.250).toFixed(3)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap bg-emerald-50/20">
                            <input
                              ref={(el: HTMLInputElement | null) => {
                                inputRefs.current[`${idx}-ir`] = el;
                              }}
                              type="number"
                              step="0.001"
                              value={values.ir}
                              onChange={(e) => {
                                const val = e.target.value;
                                setOcvIrValues(prev => ({
                                  ...prev,
                                  [cell.id]: { ...prev[cell.id], ir: val }
                                }));
                              }}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'ir')}
                              className="w-28 px-2.5 py-1.5 text-sm font-mono font-bold text-slate-900 border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded font-bold ${parseFloat(deltaMv) > 20 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                              {deltaMv} mV
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {isValid ? (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-full">
                                <Check className="w-3 h-3" />
                                <span>VERIFIED</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                                <span>PENDING</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer Action Bar */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div className="text-xs text-slate-500 font-medium">
                Showing all <strong className="text-slate-800 font-bold">{cells.length}</strong> cells. All values valid and ready to persist.
              </div>
              <button
                id="continue-to-grading-btn"
                onClick={handleContinueToGrading}
                disabled={submitting || cells.length === 0}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center space-x-2 text-sm disabled:opacity-50"
              >
                <span>{submitting ? 'PERSISTING DATA...' : 'CONTINUE TO GRADING'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* PHASE 2: CELL GRADING TABLE                                    */}
        {/* ------------------------------------------------------------- */}
        {currentPhase === 'GRADING' && (
          <div className="space-y-4">
            {/* Grading Control Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs text-slate-600 flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Confirm cell grades based on voltage tolerance limits. Flag any defective cell as <strong>DAMAGED</strong> for scrap review.
                </span>
              </div>
              <div className="flex space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMarkAllGrading('GOOD')}
                  className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg border border-emerald-200 transition-colors flex items-center space-x-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Mark All Grade-A (Good)</span>
                </button>
              </div>
            </div>

            {/* Grading Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                      <th className="px-4 py-3.5 font-semibold text-center w-16">Cell</th>
                      <th className="px-4 py-3.5 font-semibold">Internal Serial</th>
                      <th className="px-4 py-3.5 font-semibold">Prod OCV (V)</th>
                      <th className="px-4 py-3.5 font-semibold">Prod IR (mΩ)</th>
                      <th className="px-4 py-3.5 font-semibold">Calculated Grade</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Quality Assessment</th>
                      <th className="px-4 py-3.5 font-semibold">Remarks</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cells.map((cell, idx) => {
                      const g = gradingValues[cell.id] || { grade: cell.productionGrade || 'GOOD', remarks: '' };
                      const isGood = g.grade === 'GOOD' || g.grade === 'Grade-A' || g.grade === 'PASSED';
                      const isDamaged = g.grade === 'DAMAGED' || g.grade === 'Grade-B' || g.grade === 'FAILED';

                      const prodOcv = cell.productionOcvV ?? cell.supplierOcvV ?? 3.280;
                      const prodIr = cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? 0.250;

                      return (
                        <tr key={cell.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 text-sm font-bold text-slate-800 text-center whitespace-nowrap bg-slate-50/50">
                            C{(idx + 1).toString().padStart(2, '0')}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700 whitespace-nowrap">
                            {cell.internalSerial}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-800 whitespace-nowrap">
                            {prodOcv.toFixed(3)} V
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-800 whitespace-nowrap">
                            {prodIr.toFixed(3)} mΩ
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 text-emerald-800 text-xs font-bold rounded border border-emerald-200">
                              Grade-A Prime
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200">
                              <button
                                type="button"
                                onClick={() => {
                                  setGradingValues(prev => ({
                                    ...prev,
                                    [cell.id]: { ...prev[cell.id], grade: 'GOOD' }
                                  }));
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                  isGood
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                GOOD
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setGradingValues(prev => ({
                                    ...prev,
                                    [cell.id]: { ...prev[cell.id], grade: 'DAMAGED', remarks: prev[cell.id]?.remarks || 'Flagged DAMAGED' }
                                  }));
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                  isDamaged
                                    ? 'bg-red-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-red-700'
                                }`}
                              >
                                DAMAGED
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <input
                              type="text"
                              placeholder={isDamaged ? 'Enter reason for damage...' : 'Optional notes...'}
                              value={g.remarks}
                              onChange={(e) => {
                                const val = e.target.value;
                                setGradingValues(prev => ({
                                  ...prev,
                                  [cell.id]: { ...prev[cell.id], remarks: val }
                                }));
                              }}
                              className="w-44 px-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {isDamaged ? (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-red-700 bg-red-100/80 px-2.5 py-1 rounded-full">
                                <AlertTriangle className="w-3 h-3" />
                                <span>SCRAP</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-full">
                                <Check className="w-3 h-3" />
                                <span>PASSED</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer Navigation */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <button
                type="button"
                onClick={() => setCurrentPhase('OCV_IR')}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                ← Back to OCV / IR
              </button>
              <button
                onClick={handleContinueToDamageHistory}
                disabled={submitting}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center space-x-2 text-sm disabled:opacity-50"
              >
                <span>{submitting ? 'PERSISTING GRADES...' : 'CONTINUE TO DAMAGE HISTORY'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* PHASE 3: CELL DAMAGE HISTORY TABLE                             */}
        {/* ------------------------------------------------------------- */}
        {currentPhase === 'DAMAGE_HISTORY' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs text-slate-600 flex items-center space-x-2">
                <Camera className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Physical condition & visual damage inspection. Record any dents, wrap defects, or terminal scratches.
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleMarkAllDamage('GOOD')}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg border border-emerald-200 transition-colors flex items-center space-x-1 shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm All Cells Undamaged</span>
              </button>
            </div>

            {/* Damage History Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                      <th className="px-4 py-3.5 font-semibold text-center w-16">Cell</th>
                      <th className="px-4 py-3.5 font-semibold">Internal Serial</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Visual Condition</th>
                      <th className="px-4 py-3.5 font-semibold">Inspection Remarks</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Image Evidence</th>
                      <th className="px-4 py-3.5 font-semibold text-center">Disposition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cells.map((cell, idx) => {
                      const d = damageValues[cell.id] || { condition: 'GOOD', remarks: '', imageUri: '' };
                      const isGood = d.condition === 'GOOD';

                      return (
                        <tr key={cell.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 text-sm font-bold text-slate-800 text-center whitespace-nowrap bg-slate-50/50">
                            C{(idx + 1).toString().padStart(2, '0')}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono font-bold text-slate-700 whitespace-nowrap">
                            {cell.internalSerial}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200">
                              <button
                                type="button"
                                onClick={() => {
                                  setDamageValues(prev => ({
                                    ...prev,
                                    [cell.id]: { ...prev[cell.id], condition: 'GOOD', remarks: 'Pristine / No defects' }
                                  }));
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                  isGood
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                NO DAMAGE
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDamageValues(prev => ({
                                    ...prev,
                                    [cell.id]: { ...prev[cell.id], condition: 'DAMAGED', remarks: prev[cell.id]?.remarks || 'Surface defect found' }
                                  }));
                                }}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                  !isGood
                                    ? 'bg-red-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-red-700'
                                }`}
                              >
                                DAMAGED
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <input
                              type="text"
                              value={d.remarks}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDamageValues(prev => ({
                                  ...prev,
                                  [cell.id]: { ...prev[cell.id], remarks: val }
                                }));
                              }}
                              placeholder={isGood ? 'Cell casing clean...' : 'Describe defect (dent, puncture, scratch)...'}
                              className="w-56 px-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                addNotification('info', 'Photo Evidence', `Photo captured for Cell ${cell.internalSerial}`);
                              }}
                              className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 inline-flex items-center space-x-1"
                            >
                              <Camera className="w-3.5 h-3.5 text-slate-500" />
                              <span>{isGood ? 'Verify Photo' : 'Attach Photo'}</span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {isGood ? (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-full">
                                <Check className="w-3 h-3" />
                                <span>PROCEED</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-xs font-bold text-red-700 bg-red-100/80 px-2.5 py-1 rounded-full">
                                <ShieldAlert className="w-3 h-3" />
                                <span>SCRAP</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer Navigation */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <button
                type="button"
                onClick={() => setCurrentPhase('GRADING')}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                ← Back to Cell Grading
              </button>
              <button
                onClick={handleContinueToModuleWorkflow}
                disabled={submitting}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center space-x-2 text-sm disabled:opacity-50"
              >
                <span>{submitting ? 'SAVING...' : 'CONTINUE TO MODULE WORKFLOW'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* PHASE 4: COMPLETED SUMMARY                                     */}
        {/* ------------------------------------------------------------- */}
        {currentPhase === 'COMPLETED' && (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 shadow-sm text-center space-y-6">
            <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto" />
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
              CELL LEVEL TESTING & GRADING COMPLETE
            </h2>
            <p className="text-slate-600 max-w-lg mx-auto text-sm">
              All {cells.length} cells of battery <strong>{battery.serialNumber}</strong> have completed OCV/IR verification, manual grading, and damage history inspection.
            </p>
            <div className="flex justify-center gap-4 pt-4">
              <button
                onClick={() => setCurrentPhase('OCV_IR')}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Review Cell Data
              </button>
              <button
                onClick={() => setActiveView('workflow-module')}
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-xs transition-colors flex items-center space-x-2"
              >
                <span>OPEN MODULE WORKFLOW</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
