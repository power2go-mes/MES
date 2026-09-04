import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BatteryUnit, ProductTemplate, ProductionOrder } from '../../types';
import { ScannerModal } from '../common/ScannerModal';
import { Layers, Zap, Cpu, RefreshCw, ArrowRight, ScanLine, Pencil, Move, Edit3 } from 'lucide-react';

export const VisualBatteryBuilder: React.FC = () => {
  const { activeBatteryId, setActiveBatteryId, setActiveView, addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser } = useAuth();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<{ battery: BatteryUnit; product: ProductTemplate; order: ProductionOrder } | null>(null);
  const [allBatteries, setAllBatteries] = useState<BatteryUnit[]>([]);

  const [batteryScannerOpen, setBatteryScannerOpen] = useState(false);
  
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'camera' | 'manual'>('camera');
  const [scannerTarget, setScannerTarget] = useState<{ slotType: 'CELL' | 'BMS' | 'BMU'; moduleIndex?: number; cellSlotIndex?: number }>({ slotType: 'CELL' });
  const [componentMetadata, setComponentMetadata] = useState<{ manufacturer?: string; batchNumber?: string }>({});
  const [componentFormOpen, setComponentFormOpen] = useState(false);
  const [componentType, setComponentType] = useState<'BMS' | 'BMU'>('BMS');
  const [manufacturer, setManufacturer] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [draggedCell, setDraggedCell] = useState<{ moduleIndex: number; cellSlotIndex: number; cellId: string } | null>(null);

  useEffect(() => {
    loadBatteries();
  }, [refreshKey]);

  useEffect(() => {
    if (activeBatteryId) {
      loadBatteryDetails(activeBatteryId);
    } else {
      setData(null);
    }
  }, [activeBatteryId, refreshKey]);

  const loadBatteries = async () => {
    try {
      const bats = await api.getBatteries();
      setAllBatteries(bats);
    } catch (err) {
      console.error('Failed to load battery list', err);
    }
  };

  const loadBatteryDetails = async (id: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getBattery(id);
      if (!res?.battery || !res?.product) {
        throw new Error('Battery or product data is missing from Supabase.');
      }
      setData(res);
    } catch (err: any) {
      setData(null);
      setLoadError(err.message || 'Failed to load battery');
      addNotification('error', 'Load Failed', err.message || 'Failed to load battery');
    } finally {
      setLoading(false);
    }
  };

  const handleBatteryScan = (code: string) => {
    setBatteryScannerOpen(false);
    const found = allBatteries.find(b => b.qrCode === code || b.serialNumber === code || b.id === code);
    if (found) {
      setActiveBatteryId(found.id);
      addNotification('success', 'Battery Found', `Loaded battery ${found.serialNumber}`);
    } else {
      addNotification('error', 'BATTERY NOT FOUND', 'This battery barcode does not exist in the supplier data.');
    }
  };

  const openScannerForSlot = (slotType: 'CELL' | 'BMS' | 'BMU', moduleIndex?: number, cellSlotIndex?: number) => {
    setScannerTarget({ slotType, moduleIndex, cellSlotIndex });
    setScannerOpen(true);
  };

  const editAssignedController = () => {
    if (!assignedController) return;
    openScannerForSlot(assignedControllerType as 'BMS' | 'BMU');
  };

  const getNextEmptyCell = (battery: BatteryUnit, product: ProductTemplate) => {
    for (let moduleIndex = 0; moduleIndex < product.numModules; moduleIndex += 1) {
      const module = battery.modules.find(item => item.moduleIndex === moduleIndex);
      const cellSlotIndex = Array.from({ length: product.cellsPerModule }).findIndex((_, index) => (
        !(module?.cells.some(cell => cell.moduleSlotIndex === index) ?? false)
      ));
      if (cellSlotIndex >= 0) return { moduleIndex, cellSlotIndex };
    }
    return null;
  };

  const openUniversalScanner = (mode: 'camera' | 'manual') => {
    if (!data) return;

    const { battery, product } = data;
    if (!battery.bms && product.bmsConfig?.required) {
      setScannerMode(mode);
      setComponentType('BMS');
      setManufacturer('');
      setBatchNumber('');
      setComponentFormOpen(true);
      return;
    }

    const nextSlot = getNextEmptyCell(battery, product);
    if (nextSlot) {
      setScannerMode(mode);
      openScannerForSlot('CELL', nextSlot.moduleIndex, nextSlot.cellSlotIndex);
      return;
    }

    addNotification('info', 'Battery Complete', 'All BMS/BMU and cell slots are already assigned.');
  };

  const handleComponentScan = async (code: string) => {
    const userId = currentUser?.id;
    const slotType = scannerTarget.slotType;
    if (!data || !userId) return;
    setActionLoading(true);
    try {
      const normalizedCode = code.trim();
      const scanPayload = {
        barcode: normalizedCode,
        slotType,
        moduleIndex: scannerTarget.moduleIndex,
        cellSlotIndex: scannerTarget.cellSlotIndex,
        userId,
        manufacturer: componentMetadata.manufacturer,
        batchNumber: componentMetadata.batchNumber,
      } as const;
      if (assignedController && (slotType === 'BMS' || slotType === 'BMU')) {
        await api.replaceController(data.battery.id, slotType, normalizedCode, userId);
      } else {
        await api.scanComponent(data.battery.id, scanPayload);
      }
      addNotification('success', 'Component Assigned', `${scannerTarget.slotType} scanned and assigned successfully.`);
      triggerRefresh();

      if (scannerTarget.slotType === 'CELL') {
        const cellsPerModule = data.product.cellsPerModule;
        const totalModules = data.product.numModules;
        const currentModuleIndex = scannerTarget.moduleIndex ?? 0;
        const currentCellSlotIndex = scannerTarget.cellSlotIndex ?? -1;
        let nextSlot: { moduleIndex: number; cellSlotIndex: number } | null = null;

        for (let offset = 1; offset <= totalModules * cellsPerModule; offset += 1) {
          const slotNumber = currentModuleIndex * cellsPerModule + currentCellSlotIndex + offset;
          if (slotNumber >= totalModules * cellsPerModule) break;

          const moduleIndex = Math.floor(slotNumber / cellsPerModule);
          const cellSlotIndex = slotNumber % cellsPerModule;
          const module = data.battery.modules.find(item => item.moduleIndex === moduleIndex);
          const occupied = module?.cells.some(cell => cell.moduleSlotIndex === cellSlotIndex) ?? false;

          if (!occupied) {
            nextSlot = { moduleIndex, cellSlotIndex };
            break;
          }
        }

        setScannerOpen(false);
        if (nextSlot) {
          window.setTimeout(() => {
            setScannerMode(scannerMode);
            openScannerForSlot('CELL', nextSlot.moduleIndex, nextSlot.cellSlotIndex);
          }, 300);
        }
      } else {
        setScannerOpen(false);
        const nextSlot = getNextEmptyCell(data.battery, data.product);
        if (nextSlot) {
          window.setTimeout(() => {
            openScannerForSlot('CELL', nextSlot.moduleIndex, nextSlot.cellSlotIndex);
          }, 300);
        }
      }
      await loadBatteryDetails(data.battery.id);
    } catch (err: any) {
      addNotification('error', 'Assignment Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleComponentFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setComponentMetadata({});
    setComponentFormOpen(false);
    openScannerForSlot(componentType);
  };

  const handleMoveCell = async (moduleIndex: number, cellSlotIndex: number, targetModuleIndex?: number, targetCellSlotIndex?: number, cellId?: string) => {
    if (!data) return;

    const resolvedTargetModuleIndex = targetModuleIndex ?? moduleIndex;
    const resolvedTargetCellSlotIndex = targetCellSlotIndex ?? cellSlotIndex;

    if (resolvedTargetModuleIndex === moduleIndex && resolvedTargetCellSlotIndex === cellSlotIndex) {
      return;
    }

    if (resolvedTargetModuleIndex < 0 || resolvedTargetModuleIndex >= data.product.numModules || resolvedTargetCellSlotIndex < 0 || resolvedTargetCellSlotIndex >= data.product.cellsPerModule) {
      addNotification('error', 'Invalid Destination', 'Choose an empty slot within the battery layout.');
      return;
    }

    setActionLoading(true);
    try {
      await api.moveCell(data.battery.id, moduleIndex, cellSlotIndex, resolvedTargetModuleIndex, resolvedTargetCellSlotIndex, cellId);
      addNotification('success', 'Cell Moved', `Cell moved to Module ${resolvedTargetModuleIndex + 1}, Slot ${resolvedTargetCellSlotIndex + 1}.`);
      setDraggedCell(null);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Move Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (!activeBatteryId || !data?.battery || !data?.product) {
    return (
      <div className="flex-1 p-8 bg-slate-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          {loading ? (
            <>
              <RefreshCw className="w-10 h-10 text-emerald-500 mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-black text-slate-800 mb-2">Loading Battery</h2>
              <p className="text-slate-600">Reading battery and product data.</p>
            </>
          ) : loadError ? (
            <>
              <h2 className="text-xl font-black text-slate-800 mb-2">Battery Could Not Load</h2>
              <p className="text-slate-600 mb-6">{loadError}</p>
              <button
                onClick={() => {
                  const batteryId = activeBatteryId;
                  if (batteryId) void loadBatteryDetails(batteryId);
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <ScanLine className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-2xl font-black text-slate-800 mb-2">2D BATTERY BUILDER</h2>
              <p className="text-slate-600 mb-8">Scan a battery QR code to begin the assembly process.</p>
              <button
                onClick={() => setBatteryScannerOpen(true)}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center space-x-2"
              >
                <ScanLine className="w-5 h-5" />
                <span>SCAN BATTERY QR / BARCODE</span>
              </button>
            </>
          )}
        </div>

        <ScannerModal
          isOpen={batteryScannerOpen}
          onClose={() => setBatteryScannerOpen(false)}
          onScan={handleBatteryScan}
          title="Scan Battery Barcode"
        />
      </div>
    );
  }

  const { battery, product } = data;
  
  // Check completion
  const bmsRequired = product.bmsConfig?.required ?? false;
  const assignedController = battery.bms ?? battery.bmu;
  const assignedControllerType = battery.bms ? 'BMS' : battery.bmu ? 'BMU' : 'BMS/BMU';
  const bmsScanned = !!assignedController;
  const allCellsScanned = (battery.modules || []).every((m) => {
    const assignedCellCount = (m.cells || []).filter((cell: any) => Number.isInteger(cell?.moduleSlotIndex) && cell.moduleSlotIndex >= 0).length;
    return assignedCellCount === product.cellsPerModule;
  });
  const isComplete = (!bmsRequired || bmsScanned) && allCellsScanned;

  const handleContinue = async () => {
    try {
      if (battery.currentStep === 'CELL_IDENTIFICATION') {
        await api.executeStep(battery.id, 'CELL_IDENTIFICATION', { mode: 'AUTO', userId: currentUser?.id });
      }
      setActiveView('workflow-cell');
    } catch (err: any) {
      addNotification('error', 'Transition Failed', err.message);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">2D Battery Builder</h1>
            <p className="text-slate-500">Scan components to assign them to physical slots.</p>
          </div>
          <button
            onClick={() => setActiveBatteryId(null)}
            className="text-xs font-bold text-slate-500 hover:text-slate-700"
          >
            Change Battery
          </button>
        </div>

        {/* Info */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-400">Battery Serial</span>
            <span className="font-mono font-bold text-slate-800">{battery.serialNumber}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-400">Product</span>
            <span className="font-bold text-slate-800">{product.name}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-400">Total Modules</span>
            <span className="font-bold text-slate-800">{product.numModules}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-slate-400">Cells per Module</span>
            <span className="font-bold text-slate-800">{product.cellsPerModule}</span>
          </div>
        </div>

        {/* 2D Structure */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center">
              <Layers className="w-4 h-4 mr-2 text-emerald-500" />
              Physical Layout
            </h2>
          </div>
          
          <div className="p-6 space-y-8">
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-800">Universal Component Scanner</p>
                <p className="mt-1 text-[11px] text-slate-500">Scans the next required BMS/BMU or cell slot automatically.</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => openUniversalScanner('camera')}
                  className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  <ScanLine className="h-4 w-4" />
                  <span>Camera Scan</span>
                </button>
                <button
                  type="button"
                  onClick={() => openUniversalScanner('manual')}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Manual Entry</span>
                </button>
              </div>
            </div>

            {/* BMS / BMU */}
            {(product.bmsConfig.required || battery.bms || battery.bmu) && (
              <div className="p-4 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50/30">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider">Controller</h3>
                  {assignedController ? (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">{assignedControllerType} ATTACHED ✓</span>
                        <button type="button" onClick={editAssignedController} className="rounded-md border border-blue-200 bg-white p-1.5 text-blue-700 hover:bg-blue-50" title="Edit controller" aria-label="Edit controller">
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                  ) : (
                    <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded">PENDING SCAN</span>
                  )}
                </div>
                <div
                  className={`relative p-4 rounded-lg border-2 ${assignedController ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-blue-200 border-dashed text-blue-400'} transition-colors flex items-center justify-center`}
                >
                  {assignedController ? (
                    <div className="text-center">
                      <Cpu className="w-6 h-6 mx-auto mb-1 opacity-80" />
                      <div className="text-xs font-bold">Serial: {assignedController.serialNumber}</div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <ScanLine className="w-6 h-6 mx-auto mb-1" />
                      <div className="text-xs font-bold">Scan BMS/BMU QR</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Modules */}
            {Array.from({ length: product.numModules }).map((_, mIdx) => {
              const mod = battery.modules.find(m => m.moduleIndex === mIdx);
              
              return (
                <div key={mIdx} className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mr-2" />
                    Module {(mIdx + 1).toString().padStart(2, '0')}
                  </h3>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                    {Array.from({ length: product.cellsPerModule }).map((_, cIdx) => {
                      const cell = mod?.cells.find(c => c.moduleSlotIndex === cIdx);
                      
                      return (
                        <div
                          key={cIdx}
                          draggable={Boolean(cell)}
                          onDragStart={(event) => {
                            if (!cell) return;
                            setDraggedCell({ moduleIndex: mIdx, cellSlotIndex: cIdx, cellId: cell.id });
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', `${mIdx}:${cIdx}:${cell.id}`);
                          }}
                          onDragEnd={() => setDraggedCell(null)}
                          onDragOver={(event) => {
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (!draggedCell) return;
                            void handleMoveCell(draggedCell.moduleIndex, draggedCell.cellSlotIndex, mIdx, cIdx, draggedCell.cellId);
                          }}
                          className={`relative aspect-square rounded-lg border-2 flex flex-col items-center justify-center p-1 transition-all ${
                            cell
                              ? 'bg-emerald-50 border-emerald-500 cursor-grab active:cursor-grabbing'
                              : 'bg-slate-50 border-slate-200 border-dashed'
                          } ${draggedCell ? 'ring-2 ring-emerald-300' : ''}`}
                        >
                          {cell ? (
                            <>
                              <Zap className="w-4 h-4 text-emerald-500 mb-1" />
                              <span className="text-[9px] font-mono font-bold text-slate-700 truncate w-full text-center">
                                {cell.internalSerial.slice(-6)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400">SLOT {cIdx + 1}</span>
                          )}
                          <div className="absolute right-1 top-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => openScannerForSlot('CELL', mIdx, cIdx)}
                              className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50"
                              title="Edit cell slot"
                              aria-label={`Edit cell slot ${cIdx + 1}`}
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {isComplete && (
          <div className="flex justify-end pt-2">
            <button
              onClick={() => void handleContinue()}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center space-x-2"
            >
              <span>CONTINUE TO OCV / IR</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}

      </div>

      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleComponentScan}
        title={`Scan ${scannerTarget.slotType} Barcode`}
        initialMode={scannerMode}
      />

      {componentFormOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <form onSubmit={handleComponentFormSubmit} className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-black text-slate-900">Component Details</h2>
                <p className="mt-1 text-xs text-slate-500">Choose the controller type before scanning its serial number.</p>
              </div>
              <button type="button" onClick={() => setComponentFormOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close component details">
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="component-type" className="block text-xs font-bold text-slate-700">Controller Type</label>
              <select id="component-type" value={componentType} onChange={event => setComponentType(event.target.value as 'BMS' | 'BMU')} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="BMS">BMS</option>
                <option value="BMU">BMU</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setComponentFormOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">Continue to Scan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
