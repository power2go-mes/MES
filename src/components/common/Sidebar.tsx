import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Logo } from './Logo';
import {
  LayoutDashboard,
  Layers,
  Cpu,
  Boxes,
  Truck,
  GitMerge,
  BarChart3,
  Sliders,
  Shield,
  CalendarCheck,
  PackageCheck,
  CheckSquare,
  Activity,
  Flame,
  FileSpreadsheet,
  Settings,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { activeView, setActiveView, inventoryTab, setInventoryTab } = useApp();
  const { currentUser } = useAuth();
  const canManageUsers = currentUser?.roleId === 'role-admin' || currentUser?.role === 'admin';
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setOpenSections(previous => ({ ...previous, [section]: !previous[section] }));
  };

  const handleInventoryClick = (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES') => {
    setInventoryTab(tab);
    setActiveView('inventory');
  };

  const isInventoryActive = (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES') => {
    return activeView === 'inventory' && inventoryTab === tab;
  };

  return (
    <aside
      onClick={event => {
        const button = (event.target as HTMLElement).closest('button');
        if (button && !button.hasAttribute('aria-expanded')) onClose();
      }}
      className={`app-sidebar w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 select-none overflow-hidden ${isOpen ? 'is-open' : ''}`}
    >
      <div className="shrink-0 p-4 border-b border-slate-100 bg-slate-50/60">
        <div className="flex min-h-8 items-center justify-between gap-2 mb-3">
          <Logo size="sm" className="max-w-[106px]" />
          <span className="font-mono text-emerald-600 font-bold text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
            LINE-01-MES
          </span>
        </div>
        <div className="flex items-center space-x-2 text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-slate-700 font-medium">Mode: <strong className="text-slate-900">OPERATOR MES</strong></span>
        </div>
      </div>

      {/* Nav List */}
      <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-4 space-y-5">
        
        {/* QUICK ACCESS */}
        <div>
          <button type="button" onClick={() => toggleSection('quick-access')} aria-expanded={Boolean(openSections['quick-access'])} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Quick Access</span>
            {openSections['quick-access'] ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections['quick-access'] && <button
            onClick={() => setActiveView('dashboard')}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'dashboard'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>}
          {openSections['quick-access'] && <button
            onClick={() => setActiveView('ceo-monitoring')}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'ceo-monitoring'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>CEO Monitoring</span>
          </button>}
          {openSections['quick-access'] && <button
            onClick={() => setActiveView('production-flow')}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'production-flow' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Production Flow</span>
          </button>}
        </div>

        {/* PRODUCTION */}
        <div>
          <button type="button" onClick={() => toggleSection('production')} aria-expanded={Boolean(openSections.production)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Production</span>
            {openSections.production ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.production && <div className="space-y-0.5">
            <button
              onClick={() => setActiveView('container-floor')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'container-floor' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Container to Floor</span>
            </button>
            <button
              onClick={() => setActiveView('planning')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'planning'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              <span>New Production</span>
            </button>

            <button
              onClick={() => setActiveView('production')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'production'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Active Production</span>
            </button>
          </div>}
        </div>

        {/* CELLS */}
        <div>
          <button type="button" onClick={() => toggleSection('cells')} aria-expanded={Boolean(openSections.cells)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cells</span>
            {openSections.cells ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.cells && <div className="space-y-0.5">
            {['Acknowledgment', 'OCV', 'Grading', 'Damage History'].map((step, idx) => (
              <button
                key={idx}
                onClick={() => setActiveView('workflow-cell')}
                className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeView === 'workflow-cell'
                    ? 'text-emerald-700 bg-emerald-50/50 font-semibold'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${activeView === 'workflow-cell' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                <span>{step}</span>
              </button>
            ))}
          </div>}
        </div>

        {/* MODULES */}
        <div>
          <button type="button" onClick={() => toggleSection('modules')} aria-expanded={Boolean(openSections.modules)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Modules</span>
            {openSections.modules ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.modules && <div className="space-y-0.5">
            {['Assembly', 'Laser Welding', 'QC Physical', 'QC Voltage'].map((step, idx) => (
              <button
                key={idx}
                onClick={() => setActiveView('workflow-module')}
                className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeView === 'workflow-module'
                    ? 'text-emerald-700 bg-emerald-50/50 font-semibold'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${activeView === 'workflow-module' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                <span>{step}</span>
              </button>
            ))}
          </div>}
        </div>

        {/* BATTERY PACK */}
        <div>
          <button type="button" onClick={() => toggleSection('battery-pack')} aria-expanded={Boolean(openSections['battery-pack'])} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Battery Pack</span>
            {openSections['battery-pack'] ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections['battery-pack'] && <div className="space-y-0.5">
            {['Assembly', 'IR Testing', 'Final QC'].map((step, idx) => (
              <button
                key={idx}
                onClick={() => setActiveView('workflow-pack')}
                className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  activeView === 'workflow-pack'
                    ? 'text-emerald-700 bg-emerald-50/50 font-semibold'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${activeView === 'workflow-pack' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                <span>{step}</span>
              </button>
            ))}
          </div>}
        </div>

        {/* INVENTORY */}
        <div>
          <button type="button" onClick={() => toggleSection('inventory')} aria-expanded={Boolean(openSections.inventory)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Inventory</span>
            {openSections.inventory ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.inventory && <div className="space-y-0.5">
            <button
              onClick={() => handleInventoryClick('CELLS')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                isInventoryActive('CELLS')
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Cell Inventory</span>
            </button>

            <button
              onClick={() => handleInventoryClick('BMS')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                isInventoryActive('BMS')
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>BMS Inventory</span>
            </button>

            <button
              onClick={() => handleInventoryClick('BMU')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                isInventoryActive('BMU')
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>BMU Inventory</span>
            </button>

            <button
              onClick={() => handleInventoryClick('MODULES')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                isInventoryActive('MODULES')
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Module Inventory</span>
            </button>

            <button
              onClick={() => handleInventoryClick('BATTERIES')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                isInventoryActive('BATTERIES')
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Battery Inventory</span>
            </button>
            <button
              onClick={() => setActiveView('warehouse')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                activeView === 'warehouse'
                  ? 'bg-slate-100 text-slate-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Warehouse &amp; Dispatch</span>
            </button>
            <button
              onClick={() => setActiveView('rack-assembly')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                activeView === 'rack-assembly' ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Rack Assembly</span>
            </button>
          </div>}
        </div>

        {/* REPORTS & SUPP */}
        <div>
          <button type="button" onClick={() => toggleSection('reports')} aria-expanded={Boolean(openSections.reports)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reports &amp; Import</span>
            {openSections.reports ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.reports && <div className="space-y-0.5">
            <button
              onClick={() => setActiveView('supplier')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'supplier'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-slate-400" />
              <span>Supplier Import</span>
            </button>

            <button
              onClick={() => setActiveView('reports')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'reports'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
              <span>Reports</span>
            </button>

            <button
              onClick={() => setActiveView('traceability')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'traceability'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <GitMerge className="w-3.5 h-3.5 text-slate-400" />
              <span>Genealogy</span>
            </button>

            <button
              onClick={() => setActiveView('scrap')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'scrap' ? 'bg-red-700 text-white shadow-xs' : 'text-slate-600 hover:bg-red-50 hover:text-red-800'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-red-500" />
              <span>Scrap</span>
            </button>
          </div>}
        </div>

        {/* SETUPS */}
        <div>
          <button type="button" onClick={() => toggleSection('setups')} aria-expanded={Boolean(openSections.setups)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Setups</span>
            {openSections.setups ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          {openSections.setups && <div className="space-y-0.5">
            <button
              onClick={() => setActiveView('products')}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'products'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Product Types</span>
            </button>

            {canManageUsers && (
              <button
                onClick={() => setActiveView('security')}
                className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeView === 'security'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-slate-400" />
                <span>Security</span>
              </button>
            )}
          </div>}
        </div>

      </nav>
    </aside>
  );
};



