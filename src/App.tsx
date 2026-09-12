/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import LoginPage from './components/auth/LoginPage';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const DashboardView = lazy(() => import('./components/dashboard/DashboardView').then(module => ({ default: module.DashboardView })));
const ProductionFlowView = lazy(() => import('./components/production/ProductionFlowView').then(module => ({ default: module.ProductionFlowView })));
const VisualBatteryBuilder = lazy(() => import('./components/production/VisualBatteryBuilder').then(module => ({ default: module.VisualBatteryBuilder })));
const CellWorkflowView = lazy(() => import('./components/production/CellWorkflowView').then(module => ({ default: module.CellWorkflowView })));
const ModuleWorkflowView = lazy(() => import('./components/production/ModuleWorkflowView').then(module => ({ default: module.ModuleWorkflowView })));
const BatteryPackWorkflowView = lazy(() => import('./components/production/BatteryPackWorkflowView').then(module => ({ default: module.BatteryPackWorkflowView })));
const RackAssemblyView = lazy(() => import('./components/production/RackAssemblyView').then(module => ({ default: module.RackAssemblyView })));
const ContainerFloorView = lazy(() => import('./components/production/ContainerFloorView').then(module => ({ default: module.ContainerFloorView })));
const ProductionPlanningView = lazy(() => import('./components/planning/ProductionPlanningView').then(module => ({ default: module.ProductionPlanningView })));
const SupplierImportView = lazy(() => import('./components/supplier/SupplierImportView').then(module => ({ default: module.SupplierImportView })));
const InventoryView = lazy(() => import('./components/inventory/InventoryView').then(module => ({ default: module.InventoryView })));
const TraceabilityView = lazy(() => import('./components/traceability/TraceabilityView').then(module => ({ default: module.TraceabilityView })));
const QuarantineView = lazy(() => import('./components/quarantine/QuarantineView').then(module => ({ default: module.QuarantineView })));
const ProductConfiguratorView = lazy(() => import('./components/products/ProductConfiguratorView').then(module => ({ default: module.ProductConfiguratorView })));
const AuditTrailView = lazy(() => import('./components/audit/AuditTrailView').then(module => ({ default: module.AuditTrailView })));
const ReportsView = lazy(() => import('./components/reports/ReportsView').then(module => ({ default: module.ReportsView })));
const SecurityView = lazy(() => import('./components/security/SecurityView').then(module => ({ default: module.SecurityView })));
const WarehouseView = lazy(() => import('./components/warehouse/WarehouseView').then(module => ({ default: module.WarehouseView })));
const SoldView = lazy(() => import('./components/sold/SoldView').then(module => ({ default: module.SoldView })));

const AppContent: React.FC = () => {
  const { activeView, notifications, dismissNotification } = useApp();
  const { isAuthenticated, authLoading, currentUser } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const canManageUsers = currentUser?.roleId === 'role-admin' || currentUser?.role === 'admin';

  // If auth is still loading (initial check in progress), show nothing
  if (authLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="bg-slate-900 text-white p-8 rounded-xl text-center">
          <h1 className="text-2xl font-bold">Power2Go MES</h1>
          <p className="mt-4 text-slate-400">Initializing authentication...</p>
        </div>
      </div>
    );
  }

  // If NOT authenticated — show LOGIN page (the auth gate)
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Authenticated — render the MES application
  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'production-flow':
        return <ProductionFlowView />;
      case 'container-floor':
        return <ContainerFloorView />;
      case 'production':
        return <VisualBatteryBuilder />;
      case 'workflow-cell':
        return <CellWorkflowView />;
      case 'workflow-module':
        return <ModuleWorkflowView />;
      case 'workflow-pack':
        return <BatteryPackWorkflowView />;
      case 'rack-assembly':
        return <RackAssemblyView />;
      case 'planning':
        return <ProductionPlanningView />;
      case 'supplier':
        return <SupplierImportView />;
      case 'inventory':
        return <InventoryView />;
      case 'traceability':
        return <TraceabilityView />;
      case 'quarantine':
        return <QuarantineView />;
      case 'scrap':
        return <QuarantineView />;
      case 'products':
        return <ProductConfiguratorView />;
      case 'audit':
        return <AuditTrailView />;
      case 'reports':
        return <ReportsView />;
      case 'security':
        return canManageUsers ? <SecurityView /> : <DashboardView />;
      case 'warehouse':
        return <WarehouseView />;
      case 'sold':
        return <SoldView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="app-shell flex flex-col h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900 antialiased select-none">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="mobile-nav-backdrop fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden relative bg-slate-50">
          <Header onOpenNavigation={() => setMobileNavOpen(true)} />
          <Suspense fallback={<div className="grid flex-1 place-items-center bg-slate-50 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Loading workspace</div>}>
            {renderActiveView()}
          </Suspense>
        </main>
      </div>

      {/* Toast Notifications Overlay */}
      {notifications.length > 0 && (
        <div className="fixed bottom-12 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`p-4 rounded-xl shadow-lg border pointer-events-auto flex items-start space-x-3 text-xs transition-all animate-slide-up ${
                n.type === 'success'
                  ? 'bg-slate-900 text-white border-emerald-500/50'
                  : n.type === 'error'
                  ? 'bg-red-950 text-white border-black'
                  : n.type === 'warning'
                  ? 'bg-slate-950 text-white border-slate-700'
                  : 'bg-slate-900 text-white border-slate-700'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {n.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                {n.type === 'error' && <AlertTriangle className="w-4 h-4 text-slate-500" />}
                {n.type === 'warning' && <AlertTriangle className="w-4 h-4 text-slate-400" />}
                {n.type === 'info' && <Info className="w-4 h-4 text-emerald-400" />}
              </div>
              <div className="flex-1">
                <p className="font-bold">{n.title}</p>
                <p className="text-[11px] text-slate-300 mt-0.5">{n.message}</p>
              </div>
              <button
                onClick={() => dismissNotification(n.id)}
                className="text-slate-400 hover:text-white p-0.5 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Analytics />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
}