import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { ProductTemplate } from '../../types';
import {
  Sliders,
  Plus,
  CheckCircle2,
  Layers,
  Zap,
  Flame,
  ShieldCheck,
  X,
  FileCheck,
  Trash2,
} from 'lucide-react';

export const ProductConfiguratorView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser, hasPermission } = useAuth();

  const [products, setProducts] = useState<ProductTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [name, setName] = useState('Power2Go 10.0 kWh LFP Standard');
  const [productModel, setProductModel] = useState('LV25');
  const [batteryName, setBatteryName] = useState('10kWh');
  const [voltageType, setVoltageType] = useState<'LV' | 'HV'>('LV');
  const [capacityKwh, setCapacityKwh] = useState(10.0);
  const [nominalVoltageV, setNominalVoltageV] = useState(51.2);
  const [totalCapacityAh, setTotalCapacityAh] = useState(200);
  const [numModules, setNumModules] = useState(2);
  const [cellsPerModule, setCellsPerModule] = useState(8);

  useEffect(() => {
    loadProducts();
  }, [refreshKey]);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await api.getProducts();
      setProducts(res);
    } catch (err) {
      console.error('Failed to load products', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newProduct = await api.createProduct({
        name,
        productModel,
        batteryName,
        voltageType,
        capacityKwh,
        nominalVoltageV,
        totalCapacityAh,
        numModules,
        cellsPerModule,
        totalCells: numModules * cellsPerModule,
        bmuConfig: {
          required: false,
        },
        gradingRules: {
          minCapacityAh: 100,
          maxCapacityAh: 115,
          minOcvV: 3.28,
          maxOcvV: 3.34,
          maxIrMilliOhm: 0.35,
          maxDeltaCapacityPercent: 0.5,
          maxDeltaOcvMv: 3,
          maxDeltaIrMilliOhm: 0.05,
        },
        qcStages: ['CELL_TESTING', 'GRADING', 'MATCHING', 'WELDING', 'BMS_TEST', 'FINAL_PACK'],
        serialPrefix: 'P2G',
        active: true,
      });

      addNotification('success', 'Product Created', `Configured ${newProduct.sku} as dynamic source of truth`);
      setShowModal(false);
      loadProducts();
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Creation Failed', err.message);
    }
  };

  const handleDeleteProduct = async (id: string, prodName: string) => {
    if (!confirm(`Are you sure you want to remove product template "${prodName}"?`)) return;
    try {
      await api.deleteProduct(id);
      addNotification('success', 'Template Removed', `Successfully deleted ${prodName}`);
      loadProducts();
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Delete Failed', err.message);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <Sliders className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Product Configurations (Single Source of Truth)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Manufacturing BOM specifications, cell grouping counts, laser welding limits, and BMS protocols define how all battery packs and 2D views are dynamically rendered.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center space-x-2 shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Product Template</span>
        </button>
      </div>

      {/* Products Grid or Empty State */}
      {products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs space-y-4">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
            <Sliders className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">No product templates configured</h3>
            <p className="text-xs text-slate-500">
              Define master BOM specifications, cell grouping counts, and module structures to power your manufacturing line.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              + Create First Product Template
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {products.map(p => (
            <div
              key={p.id}
              className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-4 hover:border-slate-300 transition-colors relative group"
            >
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-base font-bold text-slate-900">{p.name}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {p.capacityKwh} kWh • {p.nominalVoltageV} VDC • {p.totalCapacityAh} Ah Nominal
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
                    ACTIVE
                  </span>
                  <button
                    onClick={() => handleDeleteProduct(p.id, p.name)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                    title="Delete Product Template"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Architecture Grid */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono bg-slate-50/70 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">MODULES</span>
                  <strong className="text-slate-900">{p.numModules} Units</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">CELLS / MOD</span>
                  <strong className="text-slate-900">{p.cellsPerModule} Series</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">TOTAL CELLS</span>
                  <strong className="text-emerald-700 font-bold">{p.totalCells} Cells</strong>
                </div>
              </div>

              {/* Engineering Specifications */}
              <div className="space-y-2.5 text-xs pt-1">
                <div className="flex justify-between items-center text-slate-600">
                  <span className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Matching Delta Limits:</span>
                  </span>
                  <span className="font-mono text-slate-800 text-[11px]">
                    ΔCap ≤ {p.gradingRules?.maxDeltaCapacityPercent || 0.5}% • ΔIR ≤ {p.gradingRules?.maxDeltaIrMilliOhm || 0.05}mΩ • ΔOCV ≤ {p.gradingRules?.maxDeltaOcvMv || 3}mV
                  </span>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                  <span className="flex items-center space-x-1.5">
                    <Flame className="w-3.5 h-3.5 text-slate-500" />
                    <span>Laser Weld Spec:</span>
                  </span>
                  <span className="font-mono text-slate-800 text-[11px]">
                    Trumpf Laser 2400W @ 35mm/s (Min 15.0kg pull)
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Product Template Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Create New Battery Pack Template</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Product Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Battery Name / Size</label>
                  <input
                    type="text"
                    value={batteryName}
                    onChange={e => setBatteryName(e.target.value)}
                    placeholder="5kWh or 7.5kWh"
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Product Model</label>
                  <input
                    type="text"
                    value={productModel}
                    onChange={e => setProductModel(e.target.value)}
                    placeholder="LV25"
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Battery Voltage Type</label>
                  <select
                    value={voltageType}
                    onChange={e => setVoltageType(e.target.value as 'LV' | 'HV')}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    required
                  >
                    <option value="LV">LV - Low Voltage</option>
                    <option value="HV">HV - High Voltage</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Energy (kWh)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={capacityKwh}
                    onChange={e => setCapacityKwh(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nominal VDC</label>
                  <input
                    type="number"
                    step="0.1"
                    value={nominalVoltageV}
                    onChange={e => setNominalVoltageV(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Capacity (Ah)</label>
                  <input
                    type="number"
                    value={totalCapacityAh}
                    onChange={e => setTotalCapacityAh(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Number of Modules</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={numModules}
                    onChange={e => setNumModules(parseInt(e.target.value) || 1)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cells Per Module</label>
                  <input
                    type="number"
                    min="4"
                    max="32"
                    value={cellsPerModule}
                    onChange={e => setCellsPerModule(parseInt(e.target.value) || 4)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div className="col-span-2 text-center text-slate-600 font-mono text-[11px]">
                  Total Calculated Cells: <strong>{numModules * cellsPerModule} cells</strong>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs transition-colors"
                >
                  Save Product Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
