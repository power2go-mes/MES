import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BatteryUnit, RackUnit, RackShellTemplate } from '../../types';
import {
  ArrowRight,
  ArrowLeft,
  PackageCheck,
  QrCode,
  RefreshCw,
  Truck,
  Zap,
  Server,
  Layers,
  Boxes,
  CheckCircle2,
  Info,
  Sliders,
  Check
} from 'lucide-react';
import { QRCodeModal } from '../common/QRCodeModal';
import { ScannerModal } from '../common/ScannerModal';
import { normalizeRackSerial } from '../../lib/rackNaming';

const displayRackSerial = normalizeRackSerial;

export const RackAssemblyView: React.FC = () => {
  const { addNotification, setActiveView, refreshKey, triggerRefresh } = useApp();

  // Step state: 1 = Choose Voltage, 2 = Choose Shell, 3 = Flexible 2D Pack Builder
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedVoltage, setSelectedVoltage] = useState<'LV' | 'HV'>('LV');
  const [selectedShell, setSelectedShell] = useState<RackShellTemplate | null>(null);
  const [shellTemplates, setShellTemplates] = useState<RackShellTemplate[]>([]);

  // Pack selection & Inventory state
  const [batteries, setBatteries] = useState<BatteryUnit[]>([]);
  const [batteryPage, setBatteryPage] = useState(0);
  const [hasMoreBatteries, setHasMoreBatteries] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [racks, setRacks] = useState<RackUnit[]>([]);
  const [location, setLocation] = useState('RACK_ASSEMBLY');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrRack, setQrRack] = useState<RackUnit | null>(null);
  const [physicalQc, setPhysicalQc] = useState(false);
  const [voltageQc, setVoltageQc] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [batterySearch, setBatterySearch] = useState('');

  // Pack specs based on voltage tier
  const packKwh = selectedVoltage === 'LV' ? 5.0 : 7.5;
  const maxSlots = selectedShell?.maxSlots || 5;
  const currentActualKwh = Number((selected.length * packKwh).toFixed(1));
  const isCabinet = selectedShell?.shellType === 'CABINET';

  const loadData = async (page = 0) => {
    setLoading(true);
    try {
      const pageSize = 50;
      const [allBatteries, allRacks, shells] = await Promise.all([
        api.getBatterySummaries({ limit: pageSize, offset: page * pageSize, statuses: ['RELEASED', 'FINISHED', 'WAREHOUSE'] }),
        api.getRacks(),
        api.getRackShellTemplates(false),
      ]);

      const assignedBatteryIds = new Set(allRacks.flatMap(rack => rack.batteryIds || []));
      const availableBatteries = allBatteries.filter(item => (
        ['RELEASED', 'FINISHED', 'WAREHOUSE'].includes(item.status)
        && !assignedBatteryIds.has(item.id)
      )) as BatteryUnit[];

      setBatteries(current => page > 0 ? [...current, ...availableBatteries] : availableBatteries);
      setBatteryPage(page);
      setHasMoreBatteries(allBatteries.length === pageSize);
      setRacks(allRacks);
      setShellTemplates(shells);

      if (page === 0) setSelected(current => current.filter(id => !assignedBatteryIds.has(id)));
    } catch (error: any) {
      addNotification('error', 'Rack Load Failed', error.message || 'Could not load rack data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [refreshKey]);

  // Filter shells by voltage tier
  const availableShells = shellTemplates.filter(s => s.voltageType === selectedVoltage);

  // Filter released battery packs by compatibility with voltage tier
  const compatibleBatteries = batteries.filter(item => {
    const cap = Number((item as any).capacityKwh ?? (item as any).capacity_kwh ?? (item as any).capacity ?? 0);
    const prodName = String(item.productName || (item as any).batteryName || '').toLowerCase();
    const packCode = String(item.packTemplateCode || '').toUpperCase();

    if (selectedVoltage === 'LV') {
      if (packCode === 'PACK_5KWH') return true;
      if (packCode === 'PACK_7_5KWH') return false;
      if (cap > 0) return cap < 7.0;
      return !prodName.includes('7.5') && !prodName.includes('75');
    } else {
      if (packCode === 'PACK_7_5KWH') return true;
      if (packCode === 'PACK_5KWH') return false;
      if (cap > 0) return cap >= 7.0;
      return prodName.includes('7.5') || prodName.includes('75');
    }
  });

  const filteredBatteries = compatibleBatteries.filter(item => {
    const query = batterySearch.trim().toLowerCase();
    if (!query) return true;
    const serial = String(item.serialNumber || '').toLowerCase();
    return serial.slice(-4) === query || serial.includes(query);
  });

  const handleVoltageSelect = (v: 'LV' | 'HV') => {
    setSelectedVoltage(v);
    setSelectedShell(null);
    setSelected([]);
    setStep(2);
  };

  const handleShellSelect = (shell: RackShellTemplate) => {
    setSelectedShell(shell);
    setSelected([]);
    setPhysicalQc(false);
    setVoltageQc(false);
    setStep(3);
  };

  const toggleBattery = (id: string) => {
    setSelected(current => {
      if (current.includes(id)) {
        return current.filter(item => item !== id);
      }
      if (current.length < maxSlots) {
        return [...current, id];
      }
      return current;
    });
  };

  const loadMoreBatteries = () => {
    if (!loading && hasMoreBatteries) void loadData(batteryPage + 1);
  };

  const handleBatteryScan = async (barcode: string) => {
    const normalized = barcode.trim().toLowerCase().replace(/\s+/g, '');
    const payload = normalized.split('|')[0];
    const battery = compatibleBatteries.find(item => [item.id, item.serialNumber, item.qrCode]
      .filter(Boolean)
      .map(value => String(value).toLowerCase().replace(/\s+/g, ''))
      .some(value => value === normalized || value === payload || value.split('|')[0] === payload));

    if (!battery) {
      throw new Error(`Compatible ${selectedVoltage} pack with barcode '${barcode}' was not found in released inventory.`);
    }
    if (selected.includes(battery.id)) {
      throw new Error(`${battery.serialNumber} is already selected for this rack.`);
    }
    if (selected.length >= maxSlots) {
      throw new Error(`This shell accepts at most ${maxSlots} packs.`);
    }

    setSelected(current => [...current, battery.id]);
    setScannerOpen(false);
    addNotification('success', 'Battery Scanned', `${battery.serialNumber} assigned to slot ${selected.length + 1}.`);
  };

  const assemble = async () => {
    if (selected.length < 1 || selected.length > maxSlots || !physicalQc || !voltageQc || !selectedShell) return;
    setSaving(true);
    try {
      const templateCode = `${selectedShell.shellType}_${currentActualKwh}KWH`;
      const result = await api.assembleRack({
        templateCode,
        batteryIds: selected,
        location,
        shellTemplateId: selectedShell.id,
      });

      addNotification(
        'success',
        'Rack/Cabinet Assembled',
        `${result.serialNumber} (${currentActualKwh} kWh) assembled with ${selected.length} packs.`
      );

      setSelected([]);
      setSelectedShell(null);
      setStep(1);
      triggerRefresh();
      setActiveView('production-flow');
    } catch (error: any) {
      addNotification('error', 'Assembly Failed', error.message || 'Could not assemble rack.');
    } finally {
      setSaving(false);
    }
  };

  const sell = async (rack: RackUnit) => {
    if (!destination.trim() || !reference.trim()) return;
    setSaving(true);
    try {
      await api.sellRack(rack.id, destination.trim(), reference.trim());
      addNotification('success', 'Rack Sold', `${rack.serialNumber} was marked SOLD.`);
      setDestination('');
      setReference('');
      triggerRefresh();
    } catch (error: any) {
      addNotification('error', 'Sale Failed', error.message || 'Could not sell rack.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Wizard Header Bar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700">
              <PackageCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Rack & Cabinet Assembly Studio</h1>
              <p className="text-xs text-slate-500">
                Configure LV/HV voltage tiers, select imported shell bodies, and install flexible battery packs
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveView('rack-shells')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
            >
              <Boxes className="w-3.5 h-3.5 text-slate-500" />
              <span>Manage Shell Bodies</span>
            </button>
            <button
              onClick={() => void loadData()}
              className="flex items-center space-x-1 px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* 3-Step Breadcrumb Progress Indicator */}
        <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
          <button
            onClick={() => { setStep(1); setSelectedShell(null); setSelected([]); }}
            className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              step === 1
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              step === 1 ? 'bg-white text-emerald-700' : 'bg-slate-200 text-slate-700'
            }`}>
              1
            </span>
            <span>1. Voltage Tier ({selectedVoltage})</span>
          </button>

          <button
            onClick={() => { if (step === 3) { setStep(2); setSelected([]); } }}
            disabled={step < 2}
            className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              step === 2
                ? 'bg-emerald-600 text-white shadow-xs'
                : step > 2
                ? 'text-slate-900 hover:bg-slate-100'
                : 'text-slate-400 opacity-60 cursor-not-allowed'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              step === 2 ? 'bg-white text-emerald-700' : step > 2 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'
            }`}>
              2
            </span>
            <span>2. Shell Body {selectedShell ? `(${selectedShell.name.slice(0, 15)}...)` : ''}</span>
          </button>

          <div
            className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              step === 3
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-400 opacity-60'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
              step === 3 ? 'bg-white text-emerald-700' : 'bg-slate-200 text-slate-500'
            }`}>
              3
            </span>
            <span>3. Dynamic Pack Builder ({selected.length} Packs)</span>
          </div>
        </div>

        {/* STEP 1: SELECT VOLTAGE TIER */}
        {step === 1 && (
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                Step 1 of 3
              </span>
              <h2 className="text-2xl font-black text-slate-900 mt-3">Select System Voltage Tier</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
                Choose the electrical architecture for this assembly. LV uses 5 kWh packs, while HV uses 7.5 kWh packs.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* LV Tier */}
              <button
                type="button"
                onClick={() => handleVoltageSelect('LV')}
                className="p-6 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 bg-gradient-to-b from-white to-slate-50/50 hover:to-emerald-50/20 text-left transition-all group flex flex-col justify-between shadow-xs hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-700 group-hover:scale-105 transition-transform">
                      <Zap className="w-6 h-6" />
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                      5.0 kWh Packs
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                    Low Voltage (LV)
                  </h3>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    Designed for residential and light-commercial systems. Compatible exclusively with <strong>5 kWh</strong> battery pack modules.
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-emerald-700">
                  <span>Select LV Architecture</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* HV Tier */}
              <button
                type="button"
                onClick={() => handleVoltageSelect('HV')}
                className="p-6 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 bg-gradient-to-b from-white to-slate-50/50 hover:to-emerald-50/20 text-left transition-all group flex flex-col justify-between shadow-xs hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-700 group-hover:scale-105 transition-transform">
                      <Zap className="w-6 h-6" />
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">
                      7.5 kWh Packs
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                    High Voltage (HV)
                  </h3>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    Designed for industrial, commercial, and high-capacity storage. Compatible exclusively with <strong>7.5 kWh</strong> battery pack modules.
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-emerald-700">
                  <span>Select HV Architecture</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: SELECT SHELL BODY TEMPLATE */}
        {step === 2 && (
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  Step 2 of 3 · {selectedVoltage} Tier
                </span>
                <h2 className="text-2xl font-black text-slate-900 mt-2">Select Imported Outer Shell Body</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose an imported open rack frame or enclosed cabinet enclosure configured for {selectedVoltage} ({packKwh} kWh packs).
                </p>
              </div>

              <button
                onClick={() => setStep(1)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change Voltage</span>
              </button>
            </div>

            {availableShells.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                <Boxes className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-bold text-slate-700">No {selectedVoltage} shell templates found.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Create a new shell template in the Shell Configurator.
                </p>
                <button
                  onClick={() => setActiveView('rack-shells')}
                  className="mt-4 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl"
                >
                  Configure Shell Templates
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {availableShells.map(shell => {
                  const isCab = shell.shellType === 'CABINET';

                  return (
                    <button
                      key={shell.id}
                      type="button"
                      onClick={() => handleShellSelect(shell)}
                      className="p-5 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/20 text-left transition-all group flex flex-col justify-between shadow-xs hover:shadow-md"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className={`p-2.5 rounded-xl border ${
                            isCab ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}>
                            {isCab ? <Server className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isCab ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {shell.shellType}
                          </span>
                        </div>

                        <h3 className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition-colors">
                          {shell.name}
                        </h3>
                        <p className="text-xs font-mono text-slate-400 mt-0.5">{shell.shellCode}</p>

                        {shell.description && (
                          <p className="text-xs text-slate-500 mt-2 line-clamp-2">{shell.description}</p>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl text-center">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Max Slots</p>
                            <p className="text-sm font-black text-slate-900">{shell.maxSlots} Packs</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Max Rating</p>
                            <p className="text-sm font-black text-emerald-700">{shell.nominalCapacityKwh} kWh</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-emerald-700">
                        <span>Select this Shell Body</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: FLEXIBLE 2D PACK BUILDER */}
        {step === 3 && selectedShell && (
          <div className="space-y-6">
            {/* Shell & Dynamic Spec Header */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-start space-x-3">
                <div className={`p-3 rounded-xl border mt-0.5 ${
                  isCabinet ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}>
                  {isCabinet ? <Server className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                      {selectedVoltage} Tier ({packKwh} kWh Packs)
                    </span>
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                      {selectedShell.shellType}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 mt-1">{selectedShell.name}</h2>
                  <p className="text-xs text-slate-500">
                    Physical Shell Capacity: Up to <strong>{maxSlots}</strong> slots · Prefix:{' '}
                    <strong className="font-mono text-slate-800">{isCabinet ? 'P2G-CAB-' : 'P2G-RACK-'}</strong>
                  </p>
                </div>
              </div>

              {/* Dynamic Live Capacity Badge */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="bg-emerald-50/80 border border-emerald-200 px-5 py-3 rounded-2xl text-center">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                    Calculated Live Capacity
                  </p>
                  <p className="text-2xl font-black text-emerald-900">
                    {currentActualKwh} <span className="text-sm font-bold text-emerald-700">kWh</span>
                  </p>
                  <p className="text-[11px] font-mono text-emerald-700 mt-0.5">
                    {selected.length} / {maxSlots} packs × {packKwh} kWh
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <input
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="Assembly Location"
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold focus:outline-hidden focus:border-emerald-600"
                  />
                  <button
                    onClick={() => { setStep(2); setSelected([]); }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Change Shell</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 2D Physical Layout Slot Matrix */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Physical Slots</p>
                  <h3 className="text-base font-bold text-slate-900">Installed Battery Pack Modules</h3>
                  <p className="text-xs text-slate-500">
                    Minimum 1 pack required. You can leave remaining slots empty.
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-black ${
                    selected.length > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {selected.length} of {maxSlots} Slots Filled
                  </span>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    disabled={selected.length >= maxSlots}
                    className="flex items-center space-x-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Scan Pack Barcode</span>
                  </button>
                </div>
              </div>

              {/* Slot Grid Representation */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 mb-6">
                {Array.from({ length: maxSlots }).map((_, slotIdx) => {
                  const assignedBatteryId = selected[slotIdx];
                  const assignedBattery = assignedBatteryId ? batteries.find(b => b.id === assignedBatteryId) : null;

                  return (
                    <div
                      key={slotIdx}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        assignedBattery
                          ? 'bg-white border-emerald-500 shadow-xs'
                          : 'bg-slate-100/60 border-dashed border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Slot #{slotIdx + 1}
                        </span>
                        {assignedBattery ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            {packKwh} kWh
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400">Empty</span>
                        )}
                      </div>

                      {assignedBattery ? (
                        <div>
                          <p className="font-mono text-xs font-black text-slate-900 truncate">
                            {assignedBattery.serialNumber}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {assignedBattery.productName || 'Released Pack'}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleBattery(assignedBattery.id)}
                            className="mt-2 text-[10px] font-bold text-red-600 hover:text-red-700 underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic py-2">
                          Click available pack below or scan barcode
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pack Search & Selector */}
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase">Available Released Packs ({filteredBatteries.length})</h4>
                  <p className="text-[11px] text-slate-500">Only compatible {packKwh} kWh released packs are shown</p>
                </div>

                <input
                  type="text"
                  value={batterySearch}
                  onChange={e => setBatterySearch(e.target.value.replace(/\D/g, '').slice(-4))}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Filter by last 4 digits..."
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono w-48 focus:outline-hidden focus:border-emerald-600"
                />
              </div>

              {loading && batteries.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">Loading released pack inventory...</p>
              ) : filteredBatteries.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  <p className="text-xs font-semibold text-slate-600">No compatible {packKwh} kWh released packs available.</p>
                  <p className="text-[11px] text-slate-400 mt-1">Produce or release more packs in pack production flow.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 max-h-72 overflow-y-auto p-1 custom-scrollbar">
                  {filteredBatteries.map(item => {
                    const isSelected = selected.includes(item.id);
                    const slotIndex = isSelected ? selected.indexOf(item.id) + 1 : null;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleBattery(item.id)}
                        disabled={!isSelected && selected.length >= maxSlots}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-200'
                            : selected.length >= maxSlots
                            ? 'bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed'
                            : 'bg-white border-slate-200 hover:border-emerald-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
                            {isSelected ? `Slot #${slotIndex}` : 'Available'}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">{packKwh} kWh</span>
                        </div>
                        <p className="font-mono text-xs font-bold text-slate-900 truncate">
                          {item.serialNumber}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {item.productName || (item as any).batteryName || 'Released'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              {hasMoreBatteries && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={loadMoreBatteries}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                  >
                    Load More Battery Packs
                  </button>
                </div>
              )}

              {/* Quality Control Checklists */}
              <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center space-x-3 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition-colors">
                  <input
                    type="checkbox"
                    checked={physicalQc}
                    onChange={e => setPhysicalQc(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                  />
                  <span className="text-xs font-bold text-slate-800">
                    Physical Shell & Mechanical Torquing Verified
                  </span>
                </label>

                <label className="flex items-center space-x-3 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition-colors">
                  <input
                    type="checkbox"
                    checked={voltageQc}
                    onChange={e => setVoltageQc(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                  />
                  <span className="text-xs font-bold text-slate-800">
                    High-Voltage / Low-Voltage Polarity & QC Verified
                  </span>
                </label>
              </div>

              {/* Assembly Action Button */}
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => void assemble()}
                  disabled={saving || selected.length < 1 || selected.length > maxSlots || !physicalQc || !voltageQc}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {saving ? (
                    <span>Assembling System...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>
                        Assemble {isCabinet ? 'Cabinet' : 'Rack'} ({currentActualKwh} kWh · {selected.length} Packs)
                      </span>
                    </>
                  )}
                </button>
                {selected.length === 0 && (
                  <p className="text-center text-xs text-slate-400 mt-2">
                    Please select at least 1 battery pack module to assemble.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* COMPLETED RACKS & CABINETS TABLE */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Register & History</p>
              <h2 className="text-base font-black text-slate-900">Completed Racks & Cabinets ({racks.length})</h2>
            </div>
            <p className="text-xs text-slate-500">
              Shows all assembled systems with dynamic live capacity and shell specifications
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                <tr>
                  <th className="p-3">Serial Number</th>
                  <th className="p-3">Shell Type</th>
                  <th className="p-3">Voltage</th>
                  <th className="p-3">Capacity</th>
                  <th className="p-3">Packs Installed</th>
                  <th className="p-3">QR Code</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Sale Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {racks.map(rack => {
                  const isCab = rack.shellType === 'CABINET' || rack.rackTemplateCode?.includes('CAB') || ['RACK_45KWH', 'RACK_60KWH', 'RACK_70KWH', 'RACK_75KWH'].includes(rack.rackTemplateCode);
                  const isHv = rack.voltageType === 'HV' || ['RACK_45KWH', 'RACK_60KWH', 'RACK_70KWH', 'RACK_75KWH'].includes(rack.rackTemplateCode);
                  const installedPacks = rack.installedPackCount || rack.batteryIds?.length || rack.requiredPackCount || 5;
                  const maxSlotsTotal = rack.maxPackCapacity || rack.requiredPackCount || 5;
                  const capacityDisplay = rack.actualCapacityKwh
                    ? `${rack.actualCapacityKwh} kWh`
                    : rack.rackTemplateCode === 'RACK_25KWH'
                    ? '25.0 kWh'
                    : rack.rackTemplateCode === 'RACK_45KWH'
                    ? '45.0 kWh'
                    : rack.rackTemplateCode === 'RACK_60KWH'
                    ? '60.0 kWh'
                    : rack.rackTemplateCode === 'RACK_70KWH'
                    ? '67.5 kWh'
                    : '25.0 kWh';

                  return (
                    <tr key={rack.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {displayRackSerial(rack.serialNumber)}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isCab ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {isCab ? 'CABINET' : 'RACK'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          isHv ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {isHv ? 'HV' : 'LV'}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-emerald-800">
                        {capacityDisplay}
                      </td>
                      <td className="p-3 text-slate-600">
                        <span className="font-semibold">{installedPacks}</span> / {maxSlotsTotal} packs
                      </td>
                      <td className="p-3 font-mono">
                        <button
                          type="button"
                          onClick={() => setQrRack(rack)}
                          className="text-emerald-700 hover:underline flex items-center space-x-1"
                        >
                          <QrCode className="w-3.5 h-3.5 inline" />
                          <span>{rack.qrCode}</span>
                        </button>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rack.status === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {rack.status}
                        </span>
                      </td>
                      <td className="p-3">
                        {rack.status === 'IN_STOCK' && (
                          <div className="flex items-center space-x-1.5">
                            <input
                              value={reference}
                              onChange={e => setReference(e.target.value)}
                              placeholder="Invoice #"
                              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                            />
                            <input
                              value={destination}
                              onChange={e => setDestination(e.target.value)}
                              placeholder="Customer"
                              className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={saving || !reference || !destination}
                              onClick={() => void sell(rack)}
                              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 p-1.5 font-bold text-white disabled:opacity-40 transition-colors"
                              title="Mark Sold"
                            >
                              <Truck className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Modals */}
        <ScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={handleBatteryScan}
          title={`Scan ${selectedVoltage} Battery Pack`}
          subtitle={`Scan the QR code or serial number of a released ${packKwh} kWh pack`}
        />

        <QRCodeModal
          isOpen={Boolean(qrRack)}
          onClose={() => setQrRack(null)}
          title="Rack & Cabinet Traceability QR"
          qrPayload={qrRack?.qrCode || `${qrRack?.serialNumber}|RACK:${qrRack?.id}` || ''}
          serialNumber={qrRack?.serialNumber || 'RACK'}
          itemType="RACK"
          metadata={{
            template: qrRack?.rackTemplateCode || '-',
            capacity: qrRack?.actualCapacityKwh ? `${qrRack.actualCapacityKwh} kWh` : '-',
            status: qrRack?.status || '-'
          }}
        />
      </div>
    </div>
  );
};
