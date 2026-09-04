import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BatteryUnit, ModuleItem } from '../../types';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Zap,
  Check,
  GripVertical,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  Info,
  Layers,
  ChevronRight
} from 'lucide-react';

interface ModuleRowState {
  moduleId: string;
  weldingStatus: 'PASSED' | 'FAILED' | 'BYPASSED';
  physicalVisualOk: boolean;
  voltageQcOk: boolean;
  laserPowerWatts: number;
  weldTimeMs: number;
  pullForceKg: number;
  busbarResistanceMilliOhm: number;
  packVoltageV: number;
  insulationResistanceMOhm: number;
  notes: string;
}

export const ModuleWorkflowView: React.FC = () => {
  const { activeBatteryId, setActiveView, addNotification, refreshKey, triggerRefresh } = useApp();
  const { currentUser } = useAuth();

  const [battery, setBattery] = useState<BatteryUnit | null>(null);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [moduleStates, setModuleStates] = useState<Record<string, ModuleRowState>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draggedCell, setDraggedCell] = useState<{ moduleIndex: number; cellSlotIndex: number; cellId: string } | null>(null);
  const [movingCell, setMovingCell] = useState(false);

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
      setModules(res.battery.modules || []);

      // Initialize state for each module
      const states: Record<string, ModuleRowState> = {};
      (res.battery.modules || []).forEach(mod => {
        states[mod.id] = {
          moduleId: mod.id,
          weldingStatus: mod.weldingResult?.status === 'FAILED' ? 'FAILED' : 'PASSED',
          physicalVisualOk: mod.qcResult?.physicalVisualOk ?? true,
          voltageQcOk: (mod.qcResult?.status === 'PASSED' || !mod.qcResult) ? true : false,
          laserPowerWatts: mod.weldingResult?.laserPowerWatts || 2800,
          weldTimeMs: mod.weldingResult?.weldTimeMs || 4200,
          pullForceKg: mod.weldingResult?.pullForceKg || 18.5,
          busbarResistanceMilliOhm: mod.qcResult?.busbarResistanceMilliOhm || 0.18,
          packVoltageV: mod.qcResult?.packVoltageV || 26.4,
          insulationResistanceMOhm: mod.qcResult?.insulationResistanceMOhm || 520,
          notes: mod.qcResult?.notes || '',
        };
      });
      setModuleStates(states);
    } catch (err: any) {
      addNotification('error', 'Failed to load battery', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePassAllModules = () => {
    const updated: Record<string, ModuleRowState> = {};
    modules.forEach(mod => {
      updated[mod.id] = {
        moduleId: mod.id,
        weldingStatus: 'PASSED',
        physicalVisualOk: true,
        voltageQcOk: true,
        laserPowerWatts: 2800,
        weldTimeMs: 4200,
        pullForceKg: 18.5,
        busbarResistanceMilliOhm: 0.18,
        packVoltageV: 26.4,
        insulationResistanceMOhm: 520,
        notes: 'Verified busbar weld & insulation parameters',
      };
    });
    setModuleStates(updated);
    addNotification('info', 'Module Presets Applied', 'All modules marked as PASSED with nominal welding & QC parameters.');
  };

  const handleContinueToPack = async () => {
    if (!battery) return;
    setSubmitting(true);

    try {
      const payload = modules.map(m => {
        const state = moduleStates[m.id];
        return state || {
          moduleId: m.id,
          weldingStatus: 'PASSED',
          physicalVisualOk: true,
          voltageQcOk: true,
        };
      });

      const res = await api.bulkSaveModuleWorkflow(battery.id, payload, currentUser.id);
      setBattery(res.battery);
      addNotification('success', 'Module Workflow Saved', 'Laser welding and module QC logged. Advancing to Battery Pack assembly.');
      triggerRefresh();
      setActiveView('workflow-pack');
    } catch (err: any) {
      addNotification('error', 'Save Failed', err.message || 'Failed to complete module workflow');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCellDrop = async (targetModuleIndex: number, targetCellSlotIndex: number) => {
    if (!battery || !draggedCell || movingCell) return;
    if (draggedCell.moduleIndex === targetModuleIndex && draggedCell.cellSlotIndex === targetCellSlotIndex) {
      setDraggedCell(null);
      return;
    }

    setMovingCell(true);
    try {
      await api.moveCell(
        battery.id,
        draggedCell.moduleIndex,
        draggedCell.cellSlotIndex,
        targetModuleIndex,
        targetCellSlotIndex,
        draggedCell.cellId,
      );
      await loadBattery(battery.id);
      addNotification('success', 'Cell Slot Updated', 'The cell was moved to the selected slot.');
    } catch (err: any) {
      addNotification('error', 'Cell Move Failed', err.message || 'Unable to update the cell slot.');
    } finally {
      setDraggedCell(null);
      setMovingCell(false);
    }
  };

  if (!activeBatteryId || !battery) {
    return (
      <div className="flex-1 p-8 bg-slate-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          <Layers className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-800 mb-2">NO ACTIVE BATTERY</h2>
          <p className="text-sm text-slate-500 mb-6">Select a battery from the 2D Builder or Production Orders.</p>
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

  const allModulesValid = modules.every(m => {
    const s = moduleStates[m.id];
    return s && s.weldingStatus === 'PASSED' && s.physicalVisualOk && s.voltageQcOk;
  });

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
              <span>Module Workflow Engine</span>
              <span className="text-slate-300">•</span>
              <span className="text-emerald-600">Welding & Inspection</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              MODULE ASSEMBLY & LASER WELDING QC
            </h1>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <div className="px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">Battery</span>
              <span className="font-mono font-bold text-slate-800">{battery.serialNumber}</span>
            </div>
            <div className="px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
              <span className="text-emerald-600 font-bold block text-[10px] uppercase">Total Modules</span>
              <span className="font-mono font-bold text-emerald-800">{modules.length} Modules</span>
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center space-x-2 text-xs text-slate-600">
            <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Verify laser busbar welding integrity, physical visual inspection, and inter-cell voltage metrics for each module.
            </span>
          </div>
          <button
            type="button"
            onClick={handlePassAllModules}
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg border border-emerald-200 transition-colors flex items-center space-x-1 shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Pass All Modules (Batch QC)</span>
          </button>
        </div>

        {/* Modules Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                  <th className="px-4 py-3.5 font-semibold text-center w-16">Mod</th>
                  <th className="px-4 py-3.5 font-semibold">Module Serial</th>
                  <th className="px-4 py-3.5 font-semibold text-center">Cells</th>
                  <th className="px-4 py-3.5 font-semibold">Laser Welding</th>
                  <th className="px-4 py-3.5 font-semibold text-center">Physical Busbar QC</th>
                  <th className="px-4 py-3.5 font-semibold text-center">Voltage & Insulation QC</th>
                  <th className="px-4 py-3.5 font-semibold text-center">Module Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {modules.map((mod, idx) => {
                  const s = moduleStates[mod.id] || {
                    moduleId: mod.id,
                    weldingStatus: 'PASSED',
                    physicalVisualOk: true,
                    voltageQcOk: true,
                    laserPowerWatts: 2800,
                    weldTimeMs: 4200,
                    pullForceKg: 18.5,
                    busbarResistanceMilliOhm: 0.18,
                    packVoltageV: 26.4,
                    insulationResistanceMOhm: 520,
                    notes: '',
                  };

                  const isWeldPass = s.weldingStatus === 'PASSED';
                  const isOverallPass = isWeldPass && s.physicalVisualOk && s.voltageQcOk;

                  return (
                    <tr key={mod.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-4 text-sm font-bold text-slate-800 text-center whitespace-nowrap bg-slate-50/50">
                        M{(idx + 1).toString().padStart(2, '0')}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-xs text-slate-800 block">
                          {mod.serialNumber}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          QR: {mod.qrCode || `QR-${mod.serialNumber}`}
                        </span>
                        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2">
                          <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">
                            Assigned Cells
                          </span>
                            {(mod.cells || []).length > 0 ? (
                              mod.cells.map((cell, cellIndex) => {
                                const cellSlotIndex = cell.moduleSlotIndex ?? cellIndex;
                                return (
                                  <div
                                    key={cell.id || `${mod.id}-cell-${cellIndex}`}
                                    draggable={!movingCell}
                                    onDragStart={(event) => {
                                      setDraggedCell({ moduleIndex: mod.moduleIndex ?? idx, cellSlotIndex, cellId: cell.id });
                                      event.dataTransfer.effectAllowed = 'move';
                                      event.dataTransfer.setData('text/plain', cell.id);
                                    }}
                                    onDragEnd={() => setDraggedCell(null)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      void handleCellDrop(mod.moduleIndex ?? idx, cellSlotIndex);
                                    }}
                                    className={`group rounded-md bg-slate-50 px-2 py-1.5 text-[10px] leading-tight border border-transparent hover:border-emerald-300 cursor-grab active:cursor-grabbing ${draggedCell?.cellId === cell.id ? 'opacity-50 ring-2 ring-emerald-300' : ''}`}
                                    title="Drag this cell onto another cell to swap slots, or onto an empty slot in the builder"
                                  >
                                    <span className="flex items-center gap-1 font-mono font-bold text-slate-700">
                                      <GripVertical className="w-3 h-3 text-slate-400 shrink-0" />
                                      Slot {cellSlotIndex + 1}: {cell.internalSerial}
                                    </span>
                                    <span className="block font-mono text-slate-400 pl-4">
                                      Barcode: {cell.supplierBarcode}
                                    </span>
                                  </div>
                                );
                              })
                          ) : (
                            <span className="text-[10px] text-slate-400">No cells assigned</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        <span className="px-2.5 py-1 bg-slate-100 rounded-md font-mono text-xs font-bold text-slate-700">
                          {mod.cells?.length || 8}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200">
                            <button
                              type="button"
                              onClick={() => {
                                setModuleStates(prev => ({
                                  ...prev,
                                  [mod.id]: { ...prev[mod.id], weldingStatus: 'PASSED' }
                                }));
                              }}
                              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                isWeldPass
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              PASS
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setModuleStates(prev => ({
                                  ...prev,
                                  [mod.id]: { ...prev[mod.id], weldingStatus: 'FAILED' }
                                }));
                              }}
                              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                !isWeldPass
                                  ? 'bg-red-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-red-700'
                              }`}
                            >
                              FAIL
                            </button>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {s.laserPowerWatts}W / {s.pullForceKg}kg
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setModuleStates(prev => ({
                              ...prev,
                              [mod.id]: { ...prev[mod.id], physicalVisualOk: !s.physicalVisualOk }
                            }));
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors inline-flex items-center space-x-1 ${
                            s.physicalVisualOk
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {s.physicalVisualOk ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{s.physicalVisualOk ? 'VISUAL OK' : 'DEFECT'}</span>
                        </button>
                      </td>
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setModuleStates(prev => ({
                              ...prev,
                              [mod.id]: { ...prev[mod.id], voltageQcOk: !s.voltageQcOk }
                            }));
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors inline-flex items-center space-x-1 ${
                            s.voltageQcOk
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {s.voltageQcOk ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{s.voltageQcOk ? '26.4V / >500MΩ' : 'VOLTAGE FAIL'}</span>
                        </button>
                      </td>
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        {isOverallPass ? (
                          <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-full">
                            <Check className="w-3 h-3" />
                            <span>READY</span>
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

        {/* Footer */}
        <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveView('workflow-cell')}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
          >
            ← Back to Cell Workflow
          </button>
          <button
            onClick={handleContinueToPack}
            disabled={submitting || modules.length === 0}
            className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center space-x-2 text-sm disabled:opacity-50"
          >
            <span>{submitting ? 'SAVING MODULE DATA...' : 'CONTINUE TO BATTERY PACK'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
