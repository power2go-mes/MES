import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { RackShellTemplate } from '../../types';
import {
  Boxes,
  Plus,
  CheckCircle2,
  Zap,
  ShieldCheck,
  X,
  Trash2,
  Layers,
  Info,
  Server,
  PackageCheck
} from 'lucide-react';

export const RackShellConfiguratorView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();
  const { hasPermission } = useAuth();

  const [shells, setshells] = useState<RackShellTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterType, setFilterType] = useState<'ALL' | 'RACK' | 'CABINET'>('ALL');
  const [filterVoltage, setFilterVoltage] = useState<'ALL' | 'LV' | 'HV'>('ALL');

  // Form State
  const [name, setName] = useState('25 kWh LV Rack Frame');
  const [shellType, setShellType] = useState<'RACK' | 'CABINET'>('RACK');
  const [voltageType, setVoltageType] = useState<'LV' | 'HV'>('LV');
  const [maxSlots, setMaxSlots] = useState(5);
  const [nominalCapacityKwh, setNominalCapacityKwh] = useState(25.0);
  const [description, setDescription] = useState('Standard 5-slot Low-Voltage (LV) open battery rack frame for 5 kWh packs');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadShells();
  }, [refreshKey]);

  // Recalculate nominal capacity when maxSlots or voltageType changes if user hasn't overridden
  const handleVoltageChange = (newVoltage: 'LV' | 'HV') => {
    setVoltageType(newVoltage);
    const packKwh = newVoltage === 'LV' ? 5.0 : 7.5;
    setNominalCapacityKwh(Number((maxSlots * packKwh).toFixed(1)));
  };

  const handleSlotsChange = (slots: number) => {
    const s = Math.max(1, Math.min(20, slots));
    setMaxSlots(s);
    const packKwh = voltageType === 'LV' ? 5.0 : 7.5;
    setNominalCapacityKwh(Number((s * packKwh).toFixed(1)));
  };

  const loadShells = async () => {
    setLoading(true);
    try {
      const res = await api.getRackShellTemplates(true);
      setshells(res);
    } catch (err: any) {
      console.error('Failed to load rack shell templates', err);
      addNotification('error', 'Error Loading Shells', err.message || 'Could not load rack shell templates.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShell = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const generatedCode = `SHELL_${shellType}_${Math.round(nominalCapacityKwh)}KWH_${voltageType}`;
      await api.createRackShellTemplate({
        name,
        shellCode: generatedCode,
        shellType,
        voltageType,
        maxSlots,
        nominalCapacityKwh,
        description,
        active: true,
      });

      addNotification('success', 'Shell Template Created', `Template "${name}" created successfully.`);

      setShowModal(false);
      // Reset form
      setName('25 kWh LV Rack Frame');
      setShellType('RACK');
      setVoltageType('LV');
      setMaxSlots(5);
      setNominalCapacityKwh(25.0);
      setDescription('');
      triggerRefresh();
      loadShells();
    } catch (err: any) {
      console.error('Failed to create shell template', err);
      addNotification('error', 'Creation Failed', err.message || 'Could not create shell template.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteShell = async (id: string, shellName: string) => {
    if (!window.confirm(`Are you sure you want to deactivate template "${shellName}"?`)) return;
    try {
      await api.deleteRackShellTemplate(id);
      addNotification('info', 'Template Deactivated', `Shell template "${shellName}" was deactivated.`);
      triggerRefresh();
      loadShells();
    } catch (err: any) {
      addNotification('error', 'Deactivation Failed', err.message || 'Failed to deactivate template.');
    }
  };

  const filteredShells = shells.filter(s => {
    if (filterType !== 'ALL' && s.shellType !== filterType) return false;
    if (filterVoltage !== 'ALL' && s.voltageType !== filterVoltage) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-600">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Rack & Cabinet Shell Templates</h1>
              <p className="text-sm text-slate-500">
                Configure imported physical outer shell bodies for Low-Voltage (LV) racks and High-Voltage (HV) cabinets
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Shell Body</span>
        </button>
      </div>

      {/* Filters & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Form Factor:</span>
          {(['ALL', 'RACK', 'CABINET'] as const).map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === type
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {type === 'ALL' ? 'All Shells' : type === 'RACK' ? 'Open Racks' : 'Enclosed Cabinets'}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Voltage:</span>
          {(['ALL', 'LV', 'HV'] as const).map(v => (
            <button
              key={v}
              onClick={() => setFilterVoltage(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterVoltage === v
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {v === 'ALL' ? 'All Tiers' : v === 'LV' ? 'LV (5 kWh)' : 'HV (7.5 kWh)'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Shell Templates */}
      {loading ? (
        <div className="flex items-center justify-center p-12 bg-white rounded-2xl border border-slate-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>
      ) : filteredShells.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
          <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30 text-emerald-600" />
          <p className="font-semibold text-slate-600">No shell templates match current filter.</p>
          <p className="text-xs text-slate-400 mt-1">Click "New Shell Body" to create your first template.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredShells.map(shell => {
            const packKwh = shell.voltageType === 'LV' ? 5.0 : 7.5;
            const isCabinet = shell.shellType === 'CABINET';

            return (
              <div
                key={shell.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center space-x-2.5">
                      <div className={`p-2 rounded-xl border ${
                        isCabinet
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}>
                        {isCabinet ? <Server className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-base leading-snug">{shell.name}</h3>
                        <p className="text-xs text-slate-400 font-mono">{shell.shellCode}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        shell.voltageType === 'LV'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}>
                        {shell.voltageType} Tier
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isCabinet
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {shell.shellType}
                      </span>
                    </div>
                  </div>

                  {shell.description && (
                    <p className="text-xs text-slate-500 mb-4 line-clamp-2">{shell.description}</p>
                  )}

                  {/* Spec Strip */}
                  <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4 text-center">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Max Slots</p>
                      <p className="text-sm font-black text-slate-900">{shell.maxSlots} Packs</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Nominal</p>
                      <p className="text-sm font-black text-emerald-700">{shell.nominalCapacityKwh} kWh</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Pack Code</p>
                      <p className="text-sm font-black text-slate-800 font-mono">{packKwh} kWh</p>
                    </div>
                  </div>

                  {/* Visual Slot Layout */}
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center justify-between">
                      <span>Physical Slot Matrix</span>
                      <span>Min 1 to Max {shell.maxSlots}</span>
                    </p>
                    <div className="grid grid-cols-5 gap-1.5 p-2 bg-slate-100/70 rounded-xl border border-slate-200">
                      {Array.from({ length: shell.maxSlots }).map((_, idx) => (
                        <div
                          key={idx}
                          className="h-8 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-[10px] font-bold text-slate-600"
                          title={`Slot ${idx + 1}: ${packKwh} kWh`}
                        >
                          <span className="text-[9px] text-slate-400">S{idx + 1}</span>
                          <span className="text-[8px] font-mono text-emerald-700">{packKwh}k</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5 text-slate-400">
                    <Info className="w-3.5 h-3.5" />
                    <span>Prefix: <strong className="text-slate-700 font-mono">{isCabinet ? 'P2G-CAB-' : 'P2G-RACK-'}</strong></span>
                  </div>

                  {shell.active ? (
                    <button
                      onClick={() => handleDeleteShell(shell.id, shell.name)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded-md transition-colors"
                      title="Deactivate Shell"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <span className="text-[10px] text-amber-600 font-bold">Inactive</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Boxes className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-lg">New Rack / Cabinet Shell Template</h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShell} className="space-y-4 pt-4">
              {/* Shell Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Shell Body Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. 25 kWh LV Rack Frame, 60 kWh HV Cabinet"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:border-emerald-600"
                />
              </div>

              {/* Shell Type & Voltage Tier */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Shell Form Factor
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setShellType('RACK')}
                      className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                        shellType === 'RACK'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Open Rack
                    </button>
                    <button
                      type="button"
                      onClick={() => setShellType('CABINET')}
                      className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                        shellType === 'CABINET'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Cabinet
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Serial: {shellType === 'RACK' ? 'P2G-RACK-[kWh]KWH-...' : 'P2G-CAB-[kWh]KWH-...'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Voltage Tier
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => handleVoltageChange('LV')}
                      className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                        voltageType === 'LV'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      LV (5 kWh)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVoltageChange('HV')}
                      className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                        voltageType === 'HV'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      HV (7.5 kWh)
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {voltageType === 'LV' ? '5.0 kWh pack modules only' : '7.5 kWh pack modules only'}
                  </p>
                </div>
              </div>

              {/* Max Slots & Nominal Capacity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Max Pack Slots (1-20)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={maxSlots}
                    onChange={e => handleSlotsChange(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Nominal Rating (kWh)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    required
                    value={nominalCapacityKwh}
                    onChange={e => setNominalCapacityKwh(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:border-emerald-600"
                  />
                </div>
              </div>

              {/* Dynamic Capacity Calculation Helper */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-900">
                <p className="font-bold flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Dynamic Calculation Preview</span>
                </p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Operators can insert <strong>1 to {maxSlots}</strong> packs into this shell.
                  If an operator loads 3 packs, capacity becomes <strong>{(3 * (voltageType === 'LV' ? 5.0 : 7.5)).toFixed(1)} kWh</strong>.
                  Full capacity ({maxSlots} packs) is <strong>{nominalCapacityKwh} kWh</strong>.
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Description / Import Notes
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Imported 19-inch steel rack with integrated busbars and dual breaker slots"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:border-emerald-600 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center space-x-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? <span>Creating...</span> : <span>Create Shell Template</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
