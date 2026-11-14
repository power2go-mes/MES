import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { batterySerialCapacityToken } from "../../lib/batteryNaming";
import { BatteryUnit, ProductTemplate } from "../../types";
import { ReleasedBatteryQrModal } from "../common/ReleasedBatteryQrModal";
import { ScannerModal } from "../common/ScannerModal";
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
  Printer,
  Pencil,
  Cpu,
  ScanLine,
  FolderOpen,
  RotateCcw,
} from "lucide-react";

export const BatteryPackWorkflowView: React.FC = () => {
  const {
    activeBatteryId,
    setActiveBatteryId,
    setActiveView,
    batteryBuilderEditRequested,
    setBatteryBuilderEditRequested,
    addNotification,
    refreshKey,
    triggerRefresh,
  } = useApp();
  const { currentUser } = useAuth();

  const [battery, setBattery] = useState<BatteryUnit | null>(null);
  const [product, setProduct] = useState<ProductTemplate | null>(null);
  const [products, setProducts] = useState<ProductTemplate[]>([]);
  const [availableBatteries, setAvailableBatteries] = useState<
    Array<Pick<BatteryUnit, "id" | "serialNumber" | "productName" | "status">>
  >([]);
  const [selectedExistingBatteryId, setSelectedExistingBatteryId] =
    useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderEditMode, setBuilderEditMode] = useState(false);
  const [creatingBattery, setCreatingBattery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [qrPassportOpen, setQrPassportOpen] = useState(false);

  // Form values for Pack IR and Final Testing
  const [packIrMohm, setPackIrMohm] = useState("0");
  const [qcTesting, setQcTesting] = useState<"PASSED" | "FAILED">("PASSED");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<"BMS" | "BMU" | "MODULE">("BMS");
  const [scannedControllerType, setScannedControllerType] = useState<
    "BMS" | "BMU" | null
  >(null);
  const [scannedModuleIds, setScannedModuleIds] = useState<string[]>([]);
  const freshEntryRef = useRef(true);

  useEffect(() => {
    void api
      .getProducts()
      .then((productRows) => {
        setProducts(productRows);
      })
      .catch((err: any) =>
        addNotification(
          "error",
          "Pack Templates Unavailable",
          err.message || "Could not load product templates.",
        ),
      );
    void api
      .getBatteries()
      .then((batteryRows) => {
        const completedStatuses = new Set([
          "RELEASED",
          "FINISHED",
          "WAREHOUSE",
          "DISPATCHED",
          "SOLD",
        ]);
        setAvailableBatteries(
          batteryRows.filter(
            (row) =>
              !completedStatuses.has(String(row.status || "").toUpperCase()),
          ) as Array<
            Pick<BatteryUnit, "id" | "serialNumber" | "productName" | "status">
          >,
        );
      })
      .catch((err: any) =>
        addNotification(
          "error",
          "Pack Inventory Unavailable",
          err.message || "Could not load battery packs.",
        ),
      );
    if (
      freshEntryRef.current &&
      activeBatteryId &&
      !batteryBuilderEditRequested
    ) {
      freshEntryRef.current = false;
      setActiveBatteryId(null);
      return;
    }
    freshEntryRef.current = false;
    if (activeBatteryId) {
      if (batteryBuilderEditRequested) {
        setBuilderEditMode(true);
        setBatteryBuilderEditRequested(false);
      }
      loadBattery(activeBatteryId);
    }
  }, [activeBatteryId, batteryBuilderEditRequested, refreshKey]);

  const loadBattery = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.getBattery(id);
      const rawBattery = res.battery as BatteryUnit & { step_results_json?: any; final_qc_result_json?: any };
      const stepResults = rawBattery.stepResults ?? rawBattery.step_results_json ?? {};
      const finalQcResult = rawBattery.finalQcResult
        ?? rawBattery.final_qc_result_json
        ?? stepResults.FINAL_QC?.manualValues
        ?? stepResults.FINAL_TESTING?.manualValues;
      setBattery({ ...res.battery, stepResults, finalQcResult } as BatteryUnit);
      setProduct(res.product);
      setSelectedProductId(res.product?.id || "");
      setBuilderOpen(true);
      setScannedControllerType(
        res.battery.bms ? "BMS" : res.battery.bmu ? "BMU" : null,
      );
      setScannedModuleIds(
        (res.battery.modules || [])
          .filter((module) => module.cells?.length > 0)
          .map((module) => module.id),
      );

      if (finalQcResult) {
        setPackIrMohm(
          String(finalQcResult.internalResistanceMilliOhm ?? finalQcResult.batteryIrMohm ?? "0"),
        );
        setQcTesting(
          finalQcResult.status === "FAILED" ? "FAILED" : "PASSED",
        );
      } else {
        const totalCellIr = res.battery.modules.reduce(
          (total, module) =>
            total +
            module.cells.reduce(
              (moduleTotal, cell) =>
                moduleTotal +
                Number(
                  cell.productionIrMilliOhm ?? cell.supplierIrMilliOhm ?? 0,
                ),
              0,
            ),
          0,
        );
        setPackIrMohm(totalCellIr.toFixed(2));
      }
    } catch (err: any) {
      addNotification("error", "Failed to load battery", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePackTesting = async () => {
    if (!battery) return;
    setSubmitting(true);

    try {
      await api.finalTest(battery.id, {
        mode: "MANUAL",
        userId: currentUser.id,
        manualValues: {
          batteryIrMohm: parseFloat(packIrMohm) || 0,
          qcTesting,
        },
      });

      addNotification(
        "success",
        "Pack Testing Recorded",
        `Total IR and QC result saved as ${qcTesting}.`,
      );
      triggerRefresh();
    } catch (err: any) {
      addNotification("error", "Testing Save Failed", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalQcSignoff = async (status: "PASSED" | "FAILED") => {
    if (!battery) return;
    setSubmitting(true);

    try {
      const result = await api.finalQc(battery.id, {
        status,
        userId: currentUser.id,
      });

      if (status === "PASSED") {
        if (result?.battery) {
          setBattery((currentBattery) =>
            currentBattery
              ? {
                  ...currentBattery,
                  ...result.battery,
                  modules: currentBattery.modules,
                }
              : result.battery,
          );
        }
        addNotification(
          "success",
          "BATTERY RELEASED",
          `Battery ${battery.serialNumber} passed final QC and is released for dispatch!`,
        );
        setQrPassportOpen(false);
        setActiveBatteryId(null);
        setBatteryBuilderEditRequested(false);
        setActiveView("production-flow");
      } else {
        addNotification(
          "error",
          "Battery Scrapped",
          `Battery ${battery.serialNumber} failed final testing.`,
        );
      }
      triggerRefresh();
    } catch (err: any) {
      addNotification("error", "QC Signoff Failed", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePackScan = async (barcode: string) => {
    if (!battery || !barcode.trim()) return;
    try {
      if (scanTarget === "MODULE") {
        const normalizeScanValue = (value: string) =>
          value.trim().toLowerCase().replace(/\s+/g, "");
        const scannedValue = normalizeScanValue(barcode);
        const scannedPayload = scannedValue.split("|")[0];
        const targetModuleIndex =
          (battery.modules || []).find((module) => !module.cells?.length)
            ?.moduleIndex ?? (battery.modules || []).length;
        const result = await api.assignModuleToBattery(
          battery.id,
          barcode,
          targetModuleIndex,
        );
        const assignedModule = result?.module;
        await loadBattery(battery.id);
        if (assignedModule?.id)
          setScannedModuleIds((current) =>
            current.includes(assignedModule.id)
              ? current
              : [...current, assignedModule.id],
          );
        addNotification(
          "success",
          "Module Assigned",
          `${assignedModule?.serial_number || assignedModule?.serialNumber || barcode} was assigned to this battery pack.`,
        );
      } else {
        await api.scanComponent(battery.id, {
          barcode: barcode.trim(),
          slotType: scanTarget,
          userId: currentUser.id,
        });
        setScannedControllerType(scanTarget);
        await loadBattery(battery.id);
        addNotification(
          "success",
          `${scanTarget} Scanned`,
          `${scanTarget} was assigned to the battery pack.`,
        );
      }
      setScannerOpen(false);
    } catch (err: any) {
      addNotification(
        "error",
        "Pack Scan Failed",
        err.message || "Unable to verify this component.",
      );
      throw err;
    }
  };

  const handleTemplateSelection = async (productId: string) => {
    setSelectedProductId(productId);
    setBuilderOpen(false);
    setBuilderEditMode(false);
    setScannedControllerType(null);
    setScannedModuleIds([]);
    if (!productId) return;
    await createBatteryFromTemplateFor(productId);
  };

  const createBatteryFromTemplateFor = async (productId: string) => {
    setCreatingBattery(true);
    try {
      const result = await api.createPackBatteryShell(
        productId,
        `PO-PACK-${Date.now()}`,
      );
      const newBatteryId = result.batteryIds[0];
      if (!newBatteryId)
        throw new Error(
          "The new battery was not returned by production setup.",
        );
      setActiveBatteryId(newBatteryId);
      setBuilderOpen(true);
      addNotification(
        "success",
        "Battery Created",
        "The new battery is ready in the 2D Battery Builder.",
      );
    } catch (error: any) {
      addNotification(
        "error",
        "Battery Creation Failed",
        error.message || "Could not create the battery from this template.",
      );
    } finally {
      setCreatingBattery(false);
    }
  };

  const handleEditBatterySerial = async () => {
    if (!battery) return;
    const capacityToken = batterySerialCapacityToken(product?.capacityKwh ?? battery.serialNumber);
    const nextSerial = window.prompt(
      `Battery serial number (must contain ${capacityToken})`,
      battery.serialNumber,
    );
    if (nextSerial === null) return;
    const normalizedSerial = nextSerial.trim().toUpperCase();
    if (!normalizedSerial) {
      addNotification(
        "error",
        "Serial update failed",
        "Battery serial number cannot be empty.",
      );
      return;
    }
    if (!normalizedSerial.includes(capacityToken)) {
      addNotification(
        "error",
        "Serial update failed",
        `Battery serial must include ${capacityToken}.`,
      );
      return;
    }
    if (normalizedSerial === battery.serialNumber) return;

    setSubmitting(true);
    try {
      const updatedBattery = await api.updateBattery(battery.id, {
        serialNumber: normalizedSerial,
      });
      setBattery((current) =>
        current
          ? { ...current, ...updatedBattery, serialNumber: normalizedSerial }
          : current,
      );
      setAvailableBatteries((current) =>
        current.map((item) =>
          item.id === battery.id
            ? { ...item, serialNumber: normalizedSerial }
            : item,
        ),
      );
      triggerRefresh();
      addNotification(
        "success",
        "Battery serial updated",
        "The new battery serial number has been saved.",
      );
    } catch (error: any) {
      addNotification(
        "error",
        "Serial update failed",
        error?.message || "Could not update the battery serial number.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const requiredModuleCount = product?.numModules || 2;
  const controllerReady = scannedControllerType !== null;
  const setupReady = Boolean(
    battery &&
    product &&
    scannedModuleIds.length === requiredModuleCount &&
    controllerReady,
  );

  const isStep1 = !activeBatteryId || !battery || !product;
  const isStep2 = !isStep1 && (builderEditMode || !setupReady);
  const currentStepNum = isStep1 ? 1 : isStep2 ? 2 : 3;

  const isTestingPassed =
    battery?.stepResults.FINAL_TESTING?.status === "PASSED";
  const isFinalQcPassed =
    battery?.stepResults.FINAL_QC?.status === "PASSED" ||
    battery?.status === "FINISHED";

  let totalCellsCount = 0;
  battery?.modules.forEach((m) => {
    totalCellsCount += m.cells?.length || 0;
  });

  const handleResetToStep1 = () => {
    setActiveBatteryId(null);
    setBuilderOpen(false);
    setBuilderEditMode(false);
    setScannedControllerType(null);
    setScannedModuleIds([]);
  };

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Studio Header Card */}
        <header className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                Battery Pack Assembly
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Select a template or existing pack, map its BMS/BMU controller and modules in 2D, then record final IR & QC release.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {battery && (
              <>
                <div className="px-3 py-1.5 bg-slate-100 rounded-xl border border-slate-200 flex items-center gap-2">
                  <div>
                    <span className="text-slate-400 font-bold block text-[9px] uppercase">
                      Pack Serial
                    </span>
                    <span className="font-mono font-black text-slate-900">
                      {battery.serialNumber}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleEditBatterySerial()}
                    disabled={submitting}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                    title="Edit battery serial number"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200">
                  <span className="text-emerald-600 font-bold block text-[9px] uppercase">
                    Status
                  </span>
                  <span className="font-black text-emerald-800">
                    {battery.status}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetToStep1}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  Switch Pack
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveView("inventory")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Pack Inventory
            </button>
          </div>
        </header>

        {/* Unified 3-Step Studio Progress Bar */}
        <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isStep1) handleResetToStep1();
            }}
            className={`flex-1 min-w-[180px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              currentStepNum === 1
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                currentStepNum === 1
                  ? "bg-white text-emerald-700"
                  : "bg-emerald-600 text-white"
              }`}
            >
              1
            </span>
            Template / Open Pack
          </button>

          <button
            type="button"
            disabled={isStep1}
            onClick={() => {
              if (!isStep1) setBuilderEditMode(true);
            }}
            className={`flex-1 min-w-[210px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed ${
              currentStepNum === 2
                ? "bg-emerald-600 text-white shadow-xs"
                : setupReady && !isStep1
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-50 text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                currentStepNum === 2
                  ? "bg-white text-emerald-700"
                  : setupReady && !isStep1
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              2
            </span>
            2D Pack Builder ({scannedModuleIds.length}/{requiredModuleCount})
          </button>

          <button
            type="button"
            disabled={isStep1 || !setupReady}
            onClick={() => {
              if (setupReady) setBuilderEditMode(false);
            }}
            className={`flex-1 min-w-[190px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed ${
              currentStepNum === 3
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-50 text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                currentStepNum === 3
                  ? "bg-white text-emerald-700"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              3
            </span>
            Pack IR, QC & Release
          </button>
        </div>

        {/* STEP 1: SELECT TEMPLATE OR OPEN EXISTING PACK */}
        {isStep1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
              <div>
                <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      New Production Unit
                    </span>
                    <h2 className="text-base font-black text-slate-900 mt-0.5">
                      Select Battery Pack Template
                    </h2>
                  </div>
                  <span className="text-[11px] font-bold text-slate-400">
                    {products.length} templates
                  </span>
                </div>

                <div className="p-5 space-y-3">
                  {products.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                      No pack templates found. Create a pack template in Setups first.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {products.map((item) => {
                        const isSelected = selectedProductId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={creatingBattery}
                            onClick={() => setSelectedProductId(item.id)}
                            className={`p-4 rounded-2xl border-2 text-left transition-all ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-50/70 shadow-xs"
                                : "border-slate-200 bg-white hover:border-emerald-300"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-black text-slate-900">
                                {item.name}
                              </span>
                              {isSelected && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                                {item.numModules || 2} Modules
                              </span>
                              {item.capacityKwh && (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-[10px] font-bold text-emerald-800">
                                  {item.capacityKwh} kWh
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  Creates a fresh serialized unit and opens the 2D Pack Builder.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handleTemplateSelection(selectedProductId);
                  }}
                  disabled={!selectedProductId || creatingBattery}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {creatingBattery ? "Creating battery..." : "Create & Continue"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
              <div>
                <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Resume In-Progress
                    </span>
                    <h2 className="text-base font-black text-slate-900 mt-0.5">
                      Open Existing Pack ({availableBatteries.length})
                    </h2>
                  </div>
                  <FolderOpen className="w-5 h-5 text-slate-400" />
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                      In-Progress / Draft Packs
                    </label>
                    <select
                      value={selectedExistingBatteryId}
                      onChange={(event) =>
                        setSelectedExistingBatteryId(event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    >
                      <option value="">
                        Select battery pack ({availableBatteries.length})
                      </option>
                      {availableBatteries.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.serialNumber} ·{" "}
                          {item.productName || "Unknown product"} · {item.status}
                        </option>
                      ))}
                    </select>
                  </div>

                  {availableBatteries.length > 0 && (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                      {availableBatteries.slice(0, 6).map((item) => {
                        const active = selectedExistingBatteryId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedExistingBatteryId(item.id)}
                            className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
                              active
                                ? "border-emerald-500 bg-emerald-50/70"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-bold text-slate-900 truncate">
                                {item.serialNumber}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {item.productName || "Pack Unit"}
                              </p>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">
                              {item.status}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedExistingBatteryId) {
                      setActiveBatteryId(selectedExistingBatteryId);
                      setBuilderEditMode(true);
                    }
                  }}
                  disabled={!selectedExistingBatteryId || loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  Open Selected Pack
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: 2D PACK BUILDER (CONTROLLER + MODULES) */}
        {isStep2 && battery && (
          <div className="space-y-6">
            {/* Controller Selection Banner */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      controllerReady
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-amber-50 border-amber-200 text-amber-700"
                    }`}
                  >
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      Controller Pairing (BMS / BMU)
                    </p>
                    <h2 className="text-sm font-black text-slate-900 mt-0.5">
                      {scannedControllerType
                        ? `${scannedControllerType} Verified & Assigned`
                        : "Assign BMS or BMU Master Controller"}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Select an available BMS or BMU unit from inventory and scan its serial barcode.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={Boolean(battery?.bmu)}
                    onClick={() => {
                      setScanTarget("BMS");
                      setScannerOpen(true);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      scannedControllerType === "BMS"
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
                    }`}
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    {scannedControllerType === "BMS" ? "Rescan BMS" : "Scan BMS"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(battery?.bms)}
                    onClick={() => {
                      setScanTarget("BMU");
                      setScannerOpen(true);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      scannedControllerType === "BMU"
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
                    }`}
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    {scannedControllerType === "BMU" ? "Rescan BMU" : "Scan BMU"}
                  </button>
                </div>
              </div>
            </div>

            {/* 2D Pack Enclosure Matrix */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    2D Battery Builder
                  </p>
                  <h3 className="text-base font-black text-slate-900 mt-0.5">
                    Physical Component Layout · {product?.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Verify the controller and assign all {requiredModuleCount} completed sub-modules.
                  </p>
                </div>
                <span className="font-mono text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl">
                  {scannedModuleIds.length} / {requiredModuleCount} Modules
                </span>
              </div>

              <div className="p-5 grid gap-4 md:grid-cols-2">
                {Array.from({ length: requiredModuleCount }, (_, moduleIndex) => {
                  const module = battery.modules?.[moduleIndex];
                  const scanned = Boolean(
                    module && scannedModuleIds.includes(module.id),
                  );
                  return (
                    <div
                      key={moduleIndex}
                      className={`rounded-2xl border-2 p-4 transition-all ${
                        scanned
                          ? "border-emerald-500 bg-emerald-50/40"
                          : "border-dashed border-slate-300 bg-slate-50/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                              scanned
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            Module Slot {String(moduleIndex + 1).padStart(2, "0")}
                          </span>
                          <p className="mt-1.5 font-mono text-xs font-black text-slate-900">
                            {module?.serialNumber || "Unassigned Module Slot"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setScanTarget("MODULE");
                            setScannerOpen(true);
                          }}
                          disabled={scanned}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                            scanned
                              ? "bg-emerald-600 text-white cursor-default"
                              : "border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50"
                          }`}
                        >
                          {scanned ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Verified
                            </>
                          ) : (
                            <>
                              <ScanLine className="w-3.5 h-3.5" />
                              Scan Module
                            </>
                          )}
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {(module?.cells || []).map((cell, cellIndex) => (
                          <div
                            key={cell.id}
                            className="rounded-lg border border-emerald-200 bg-white p-2 text-center shadow-2xs"
                          >
                            <span className="block text-[9px] font-black text-emerald-700">
                              S{cellIndex + 1}
                            </span>
                            <span
                              className="mt-0.5 block break-all font-mono text-[8px] leading-tight text-slate-600"
                              title={
                                cell.supplierBarcode ||
                                (cell as any).supplier_barcode ||
                                cell.internalSerial ||
                                (cell as any).internal_serial ||
                                cell.id
                              }
                            >
                              {cell.supplierBarcode ||
                                (cell as any).supplier_barcode ||
                                cell.internalSerial ||
                                (cell as any).internal_serial ||
                                cell.id}
                            </span>
                          </div>
                        ))}
                        {!module?.cells?.length && (
                          <div className="col-span-4 rounded-xl border border-dashed border-slate-300 bg-white/80 p-5 text-center text-[11px] text-slate-400">
                            Cell matrix populates automatically after scanning an assembled module.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Readiness Footer Bar */}
              <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        controllerReady ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    Controller:{" "}
                    <span className="font-mono">
                      {controllerReady ? scannedControllerType : "Pending"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        scannedModuleIds.length === requiredModuleCount
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                      }`}
                    />
                    Modules:{" "}
                    <span className="font-mono">
                      {scannedModuleIds.length}/{requiredModuleCount}
                    </span>
                  </span>
                </div>

                <button
                  type="button"
                  disabled={!setupReady}
                  onClick={() => setBuilderEditMode(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  Continue to Pack Testing
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: FINAL VERIFICATION, PACK IR TESTING & RELEASE */}
        {!isStep1 && !isStep2 && battery && (
          <>
            {isFinalQcPassed && (
              <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-emerald-500/50 rounded-xl">
                    <CheckCircle2 className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black tracking-tight">
                      BATTERY RELEASED & COMPLIANCE VERIFIED
                    </h3>
                    <p className="text-xs text-emerald-100">
                      All cell, module, BMS, and pack-level testing stages passed
                      100%. Ready for shipping or customer assignment.
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Pack Enclosure & BMS Integration Verification */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      Hardware Verification
                    </span>
                    <h2 className="text-sm font-black uppercase text-slate-900 tracking-wider mt-0.5">
                      Structural Enclosure & Components
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 text-[10px] font-black rounded-lg border border-emerald-200">
                    VERIFIED
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-600 font-medium">
                      Assembled Modules:
                    </span>
                    <span className="font-bold font-mono text-slate-900">
                      {battery.modules.length} Modules ({totalCellsCount} Cells)
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-600 font-medium">
                      BMS Board:
                    </span>
                    <span className="font-bold font-mono text-slate-900">
                      {battery.bms
                        ? `${battery.bms.serialNumber} (${battery.bms.model})`
                        : "Integrated BMS"}
                    </span>
                  </div>
                  {battery.bmu && (
                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-600 font-medium">
                        BMU Master Controller:
                      </span>
                      <span className="font-bold font-mono text-slate-900">
                        {battery.bmu.serialNumber} ({battery.bmu.model})
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-slate-600 font-medium">
                      Wiring Harness & Connectors:
                    </span>
                    <span className="font-bold text-emerald-700">
                      Torque Verified (4.5 Nm)
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Battery Pack IR & QC */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      Electrical Parameters
                    </span>
                    <h2 className="text-sm font-black uppercase text-slate-900 tracking-wider mt-0.5">
                      Battery Pack IR & QC Testing
                    </h2>
                    <p className="text-[10px] text-slate-400">
                      Total IR is calculated from assigned cell values and can be adjusted.
                    </p>
                  </div>
                  <Zap className="w-5 h-5 text-emerald-600" />
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
                        className="w-full px-3 py-2 text-sm font-mono font-bold text-emerald-900 border border-emerald-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-emerald-50/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                        QC Testing
                      </label>
                      <div className="flex gap-2">
                        {(["PASSED", "FAILED"] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setQcTesting(status)}
                            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                              qcTesting === status
                                ? status === "PASSED"
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                  : "border-red-300 bg-red-50 text-red-800"
                                : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
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
                    className="w-full py-2.5 bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
                  >
                    {submitting
                      ? "RECORDING PARAMETERS..."
                      : "RECORD PACK ELECTRICAL TESTING"}
                  </button>
                </div>
              </div>
            </div>

            {/* Traceability Summary Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider">
                    Manufacturing Stage Traceability & Quality Gate
                  </h3>
                  <p className="text-xs text-slate-400">
                    All workflow milestones must be satisfied before final release
                  </p>
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
                      <td className="px-4 py-3 font-bold text-slate-800">
                        1. Cell OCV / IR Testing
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">
                        CELL LEVEL ({totalCellsCount} Cells)
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                          ✓ PASSED
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {battery.stepResults.CELL_TESTING?.completedBy ||
                          "Operator 1"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono">
                        {battery.stepResults.CELL_TESTING?.completedAt ||
                          "Verified"}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        2. Cell Grading Assessment
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">
                        CELL LEVEL
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                          ✓ PASSED
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {battery.stepResults.GRADING?.completedBy || "Operator 1"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono">
                        {battery.stepResults.GRADING?.completedAt || "Verified"}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        3. Damage History Visual Inspection
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">
                        CELL LEVEL
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                          ✓ PASSED
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {battery.stepResults.DAMAGE_HISTORY?.completedBy ||
                          "Quality Inspector"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono">
                        {battery.stepResults.DAMAGE_HISTORY?.completedAt ||
                          "Verified"}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        4. Module Laser Welding & QC
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">
                        MODULE LEVEL ({battery.modules.length} Modules)
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                          ✓ PASSED
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {battery.stepResults.MODULE_QC?.completedBy ||
                          "Welding Tech"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono">
                        {battery.stepResults.MODULE_QC?.completedAt || "Verified"}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        5. Battery Pack IR & Hi-Pot
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">
                        BATTERY PACK LEVEL
                      </td>
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
                      <td className="px-4 py-3 text-slate-600">
                        {currentUser.name}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono">
                        Pending final signoff
                      </td>
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
                  Signing off marks the battery as finished, registers the final
                  warranty QR code, and updates production order quantity.
                </p>
              </div>

              <div className="flex space-x-3 shrink-0">
                <button
                  type="button"
                  onClick={() => handleFinalQcSignoff("FAILED")}
                  disabled={submitting || isFinalQcPassed}
                  className="px-5 py-3 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl text-xs border border-red-200 transition-colors disabled:opacity-50"
                >
                  REJECT / SCRAP
                </button>
                <button
                  type="button"
                  onClick={() => handleFinalQcSignoff("PASSED")}
                  disabled={submitting || isFinalQcPassed}
                  className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-xs transition-colors flex items-center space-x-2 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isFinalQcPassed
                      ? "BATTERY RELEASED ✓"
                      : "RELEASE BATTERY PACK"}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ReleasedBatteryQrModal
        isOpen={qrPassportOpen}
        onClose={() => setQrPassportOpen(false)}
        battery={battery}
      />
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handlePackScan}
        title={`Scan ${scanTarget}`}
        subtitle="Scan or enter the component barcode for this battery pack"
      />
    </div>
  );
};
