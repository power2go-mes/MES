import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { ProductTemplate, ProductionOrder, CellItem, BMSItem } from '../../types';
import {
  CalendarCheck,
  Plus,
  Boxes,
  AlertTriangle,
  CheckCircle2,
  Lock,
  RotateCcw,
  ArrowRight,
  ShieldAlert,
  Play,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';

export const ProductionPlanningView: React.FC = () => {
  const { setActiveView, setActiveBatteryId, addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser, hasPermission } = useAuth();
  const { isAuthenticated } = useAuth();

  const [products, setProducts] = useState<ProductTemplate[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [availableCellsCount, setAvailableCellsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // New Order Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [batterySerialBase, setBatterySerialBase] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [bulkImportRows, setBulkImportRows] = useState<Array<{ batterySerialNumber?: string; bmuSerialNumber?: string }>>([]);
  const [bulkImportFileName, setBulkImportFileName] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);

  // Cancel Confirmation Modal State
  const [cancelTarget, setCancelTarget] = useState<{ id: string; orderNumber: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [refreshKey, isAuthenticated]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prods, ords, cellCounts] = await Promise.all([
        api.getProducts(),
        api.getProductionOrders(),
        api.getCellCounts(),
      ]);

      setProducts(prods);
      setOrders(ords);
      setAvailableCellsCount(cellCounts.available);

      if (prods.length > 0 && !selectedProductId) {
        setSelectedProductId(prods[0].id);
      }
    } catch (err) {
      console.error('Failed to load planning data', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = products.find(p => p.id === selectedProductId);
  const defaultBatterySerialBase = (product?: ProductTemplate) => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const productModel = (product?.productModel || product?.batteryName || product?.name || 'P2G')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toUpperCase();
    return `P2G-${productModel}-${day}${month}-000001`;
  };
  const requiredCells = selectedProduct ? selectedProduct.totalCells * quantity : 0;
  const cellShortage = Math.max(0, requiredCells - availableCellsCount);
  const hasShortage = cellShortage > 0;

  useEffect(() => {
    if (selectedProduct) {
      setBatterySerialBase(defaultBatterySerialBase(selectedProduct));
    }
  }, [selectedProductId, selectedProduct]);

  const handleBulkBatteryFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = reader.result;
        if (!data) throw new Error('No spreadsheet content was loaded.');

        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];

        const normalizedRows = rows
          .map(row => {
            const candidates = [
              row.batterySerialNumber,
              row.battery_serial_number,
              row.batterySerial,
              row['Battery Serial Number'],
              row['Battery Serial'],
              row.serial_number,
              row.serial,
              row.battery,
            ];
            const bmuCandidates = [
              row.bmuSerialNumber,
              row.bmu_serial_number,
              row.bmuSerial,
              row['BMU Serial Number'],
              row['BMU Serial'],
              row.bmu,
            ];
            const batterySerialNumber = candidates.find(value => value !== undefined && value !== null && String(value).trim()) || '';
            const bmuSerialNumber = bmuCandidates.find(value => value !== undefined && value !== null && String(value).trim()) || '';
            return {
              batterySerialNumber: String(batterySerialNumber).trim(),
              bmuSerialNumber: String(bmuSerialNumber).trim(),
            };
          })
          .filter(row => row.batterySerialNumber || row.bmuSerialNumber);

        if (normalizedRows.length === 0) {
          throw new Error('No battery rows were found in the uploaded file. Expected battery serial and optional BMU serial columns.');
        }

        setBulkImportRows(normalizedRows);
        setBulkImportFileName(file.name);
        addNotification('success', 'Excel Parsed', `Loaded ${normalizedRows.length} battery rows for validation.`);
      } catch (err: any) {
        addNotification('error', 'Bulk Excel Parse Failed', err.message);
      } finally {
        if (event.target) event.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleBulkBatteryInitialize = async () => {
    if (bulkImportRows.length === 0) {
      addNotification('error', 'No rows to initialize', 'Upload a spreadsheet with battery serials first.');
      return;
    }

    setBulkImporting(true);
    try {
      const result = await api.bulkInitializeBatteryBatch({
        rows: bulkImportRows,
        productId: selectedProductId,
        userId: currentUser.id,
      });

      addNotification('success', 'Bulk Initialization Ready', `Validated ${result.batchSize} batteries using ${result.template.name}. Required ${result.order.requiredCells} cells and ${result.order.requiredBmUs} BMUs.`);
      setBulkImportRows([]);
      setBulkImportFileName('');
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Bulk Initialization Failed', err.message);
    } finally {
      setBulkImporting(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || quantity <= 0) return;

    if (hasShortage) {
      addNotification('error', 'Material Shortage', 'Cannot start production order: insufficient available cell inventory');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createProductionOrder({
        productId: selectedProductId,
        quantity,
        batterySerialBase: batterySerialBase.trim() || undefined,
        userId: currentUser.id,
      });

      addNotification('success', 'Production Started & Cells Reserved', `Created battery serials based on ${batterySerialBase.trim() || 'the generated default'}. Reserved ${requiredCells} cells.`);
      setModalOpen(false);
      triggerRefresh();

      if (res.batteryIds.length > 0) {
        setActiveBatteryId(res.batteryIds[0]);
        setActiveView('production');
      }
    } catch (err: any) {
      addNotification('error', 'Order Creation Failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelTarget) return;

    setCancelling(true);
    try {
      await api.cancelProductionOrder(cancelTarget.id, 'Cancelled by production manager', currentUser.id);
      addNotification('warning', 'Order Cancelled', `Released cell reservations for ${cancelTarget.orderNumber}`);
      setCancelTarget(null);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Cancellation Failed', err.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <CalendarCheck className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Production Planning & Cell Reservation
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Validate required cell inventory before creating production orders. No BMS/BMU selection required.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setBatterySerialBase(defaultBatterySerialBase(selectedProduct || products[0]));
            setModalOpen(true);
          }}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center space-x-2 shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Production Order</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Bulk Battery Initialization</h2>
            <p className="text-xs text-slate-500 mt-1">Upload an Excel file containing battery serials and optional BMU serials to validate stock and prepare the batch.</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold">
              <Plus className="w-3.5 h-3.5" />
              Upload Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBulkBatteryFileUpload} />
            </label>
            {bulkImportRows.length > 0 && (
              <button
                onClick={handleBulkBatteryInitialize}
                disabled={bulkImporting}
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-60"
              >
                {bulkImporting ? 'Validating...' : `Initialize ${bulkImportRows.length} Batteries`}
              </button>
            )}
          </div>
        </div>

        {bulkImportFileName && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>{bulkImportFileName}</span>
            <span>{bulkImportRows.length} rows loaded</span>
          </div>
        )}
      </div>

      {/* Inventory Health Summary Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Available Cells</span>
            <p className="text-2xl font-black font-mono text-emerald-600 mt-1">{availableCellsCount} <span className="text-xs font-normal text-slate-400 font-sans">units</span></p>
            <span className="text-[10px] text-slate-400 font-medium">Ready for allocation</span>
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600">
            <Boxes className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Production Orders</span>
            <p className="text-2xl font-black font-mono text-slate-900 mt-1">
              {orders.filter(o => o.status === 'IN_PROCESS').length} <span className="text-xs font-normal text-slate-400 font-sans">WIP</span>
            </p>
            <span className="text-[10px] text-slate-400 font-medium">{orders.filter(o => o.status === 'COMPLETED').length} completed</span>
          </div>
          <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-700">
            <Play className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Orders List Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-sm font-bold text-slate-900">All Production Orders</h2>
            <p className="text-xs text-slate-500">Tracking material allocations and manufacturing execution states</p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200">{orders.length} total orders</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Order Number</th>
                <th className="px-5 py-3">Product Model</th>
                <th className="px-5 py-3">Quantity</th>
                <th className="px-5 py-3">Material Reserved</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                    No production orders found. Create your first order to reserve inventory.
                  </td>
                </tr>
              ) : (
                orders.map(ord => (
                  <tr key={ord.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-slate-900">{ord.orderNumber}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans">
                      <div className="font-semibold">{ord.productName}</div>
                      <span className="text-[10px] text-slate-400 font-mono">{ord.productSku}</span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-sans">
                      <strong className="text-slate-900">{ord.quantityCompleted}</strong> / {ord.quantityPlanned} units
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 text-[11px]">
                      <div>{ord.requiredCells} Cells ({ord.reservedCells} locked)</div>
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          ord.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : ord.status === 'IN_PROCESS'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-[11px]">
                      {new Date(ord.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2 font-sans">
                      {ord.batteryIds && ord.batteryIds.length > 0 && (
                        <button
                          onClick={() => {
                            setActiveBatteryId(ord.batteryIds[0]);
                            setActiveView('production');
                          }}
                          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 transition-colors shadow-2xs"
                        >
                          Open in MES
                        </button>
                      )}
                      {ord.status === 'IN_PROCESS' && (
                        <button
                          onClick={() => setCancelTarget({ id: ord.id, orderNumber: ord.orderNumber })}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-black text-xs font-semibold rounded-xl border border-slate-300 transition-colors"
                        >
                          Cancel & Release
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Order Modal with Material Availability Validator */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
              <div>
                <h3 className="text-sm font-black tracking-tight">Create New Production Order</h3>
                <p className="text-xs text-slate-400 mt-0.5">Dynamically allocates modular battery structure & reserves raw materials</p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="p-6 space-y-4">
              {/* Product Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Product Template (Source of Truth)
                </label>
                <select
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-semibold"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — {p.numModules} Modules × {p.cellsPerModule} Cells ({p.totalCells} total)
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity & Battery Serial Number */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Batch Quantity (Units)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={quantity}
                    onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Battery Serial Number</label>
                  <input
                    type="text"
                    value={batterySerialBase}
                    onChange={e => setBatterySerialBase(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    placeholder="P2G-HV5-250829"
                  />
                </div>
              </div>

              <div>
                <p className="text-[10px] text-slate-500 mt-1">Auto-generated by the system, but you can edit the serial before starting production. Each battery will get a sequential suffix such as -000001.</p>
              </div>

              {/* Real-time Material Availability Validator Card */}
              <div className={`p-4 rounded-xl border ${hasShortage ? 'bg-slate-100 border-slate-300' : 'bg-emerald-50/70 border-emerald-200'} space-y-2`}>
                <div className="flex items-center justify-between text-xs font-bold">
                  <div className="flex items-center space-x-1.5">
                    {hasShortage ? (
                      <AlertTriangle className="w-4 h-4 text-slate-900" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                    <span className={hasShortage ? 'text-black' : 'text-emerald-900'}>
                      {hasShortage ? 'Material Shortage Warning' : 'Material Availability Confirmed'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium">Pre-Production Feasibility Check</span>
                </div>

                <div className="bg-white/90 p-3 rounded-xl border border-slate-200 text-[11px] font-mono">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-slate-400 block text-[9px] font-sans font-bold uppercase tracking-wider">CELLS REQUIRED FOR BATCH</span>
                      <strong className="text-slate-900 text-sm">{requiredCells} Cells</strong>
                      <span className="text-slate-500 block text-[10px]">Available Inventory: {availableCellsCount} cells</span>
                    </div>
                    {cellShortage > 0 ? (
                      <span className="text-slate-900 font-bold text-xs bg-slate-100 px-2 py-1 rounded border border-slate-300">
                        Shortage: -{cellShortage}
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-bold text-xs bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                        Sufficient Stock ✓
                      </span>
                    )}
                  </div>
                </div>

                {hasShortage && (
                  <p className="text-xs text-black">
                    Cannot start production order: Import supplier cell manifest to replenish available cells before proceeding.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || hasShortage}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Reserving...' : 'Reserve Cells & Start Production'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Order Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center space-x-3 text-slate-900">
              <span className="p-2.5 bg-slate-100 rounded-xl border border-slate-200">
                <AlertTriangle className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-black text-slate-900">Cancel Production Order</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{cancelTarget.orderNumber}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to cancel this order? All allocated and reserved Grade-A cells and BMS controllers will be released immediately back into the available manufacturing inventory.
            </p>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-1000 disabled:bg-slate-300 rounded-xl shadow-xs transition-colors flex items-center space-x-1.5"
              >
                <span>{cancelling ? 'Releasing...' : 'Confirm Cancellation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
