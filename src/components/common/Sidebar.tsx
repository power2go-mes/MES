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
  ChevronRight,
  PanelLeftClose,
  Bell,
  ChevronUp,
  LogOut
} from 'lucide-react';

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { activeView, setActiveView, setActiveBatteryId, setBatteryBuilderEditRequested, inventoryTab, setInventoryTab, notifications } = useApp();
  const { currentUser, profile, logout } = useAuth();
  const canManageUsers = currentUser?.roleId === 'role-admin' || currentUser?.role === 'admin';
  const isCeo = currentUser?.roleId === 'role-ceo' || currentUser?.role === 'ceo';
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const currentProfile = profile ?? currentUser;

  const getRoleBadgeColor = (role: string) => {
    if (role === 'admin' || role === 'qc_inspector' || role === 'maintenance' || role === 'warehouse') {
      return 'bg-slate-50 text-slate-700 border-slate-200';
    }
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const toggleSection = (section: string) => {
    setOpenSections(previous => ({ ...previous, [section]: !previous[section] }));
  };

  const handleInventoryClick = (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS') => {
    setInventoryTab(tab);
    setActiveView('inventory');
  };

  const isInventoryActive = (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS') => {
    return activeView === 'inventory' && inventoryTab === tab;
  };

  return (
    <aside
      className={`app-sidebar w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 select-none overflow-hidden ${isOpen ? 'is-open' : ''}`}
    >
      <div className="shrink-0 p-4 border-b border-slate-100 bg-slate-50/60">
        <div className="flex min-h-8 items-center justify-between gap-2 mb-3">
          <Logo size="sm" className="max-w-[106px]" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Nav List */}
      <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-4 space-y-5">
        
        {/* QUICK ACCESS */}
        <div className="space-y-1">
          <div className="mb-1.5 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Quick Access</div>
          {!isCeo && <button
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
          <button
            onClick={() => setActiveView('ceo-monitoring')}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'ceo-monitoring'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>CEO Monitoring</span>
          </button>
          {!isCeo && <button
            onClick={() => setActiveView('production-flow')}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === 'production-flow' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Production Flow</span>
          </button>}
        </div>

        {/* FOUR-STAGE PRODUCTION */}
        <div className={isCeo ? 'hidden' : undefined}>
          <div className="mb-1.5 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Production workflow</div>
          <div className="space-y-0.5">
            {[
              ['container-floor', 'Container to Floor', Truck],
              ['workflow-module', 'Module Assembly', Layers],
              ['workflow-pack', 'Pack Assembly', Boxes],
              ['rack-assembly', 'Rack Assembly', PackageCheck],
            ].map(([view, label, Icon]) => <button key={String(view)} onClick={() => { if (view === 'workflow-pack') { setActiveBatteryId(null); setBatteryBuilderEditRequested(false); } setActiveView(view as any); }} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${activeView === view ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon className="w-3.5 h-3.5" /><span>{String(label)}</span></button>)}
          </div>
        </div>

        {/* INVENTORY */}
        <div>
          {isCeo ? (
            <div className="space-y-0.5">
              <div className="mb-1.5 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Inventory</div>
              <button onClick={() => handleInventoryClick('CELLS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('CELLS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Cell Inventory</span></button>
              <button onClick={() => handleInventoryClick('BMS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BMS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>BMS Inventory</span></button>
              <button onClick={() => handleInventoryClick('BMU')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BMU') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>BMU Inventory</span></button>
              <button onClick={() => handleInventoryClick('MODULES')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('MODULES') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Module Inventory</span></button>
              <button onClick={() => handleInventoryClick('BATTERIES')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BATTERIES') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Battery Inventory</span></button>
              <button onClick={() => handleInventoryClick('RACKS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('RACKS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Rack Inventory</span></button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => toggleSection('inventory')} aria-expanded={Boolean(openSections.inventory)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Inventory</span>
                {openSections.inventory ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              {openSections.inventory && <div className="space-y-0.5">
                <button onClick={() => handleInventoryClick('CELLS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('CELLS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Cell Inventory</span></button>
                <button onClick={() => handleInventoryClick('BMS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BMS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>BMS Inventory</span></button>
                <button onClick={() => handleInventoryClick('BMU')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BMU') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>BMU Inventory</span></button>
                <button onClick={() => handleInventoryClick('MODULES')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('MODULES') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Module Inventory</span></button>
                <button onClick={() => handleInventoryClick('BATTERIES')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('BATTERIES') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Battery Inventory</span></button>
                <button onClick={() => handleInventoryClick('RACKS')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${isInventoryActive('RACKS') ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Rack Inventory</span></button>
                {!isCeo && <button onClick={() => setActiveView('warehouse')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${activeView === 'warehouse' ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Warehouse</span></button>}
                {!isCeo && <button onClick={() => setActiveView('sold')} className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs transition-all ${activeView === 'sold' ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><PackageCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span>Sold</span></button>}
              </div>}
            </>
          )}
        </div>

        {/* IMPORT & TRACE */}
        <div>
          {isCeo ? (
            <div className="space-y-0.5">
              <div className="mb-1.5 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Import &amp; Trace</div>
              <button onClick={() => setActiveView('traceability')} className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeView === 'traceability' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><GitMerge className="w-3.5 h-3.5 text-slate-400" /><span>Genealogy</span></button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => toggleSection('reports')} aria-expanded={Boolean(openSections.reports)} className="w-full flex items-center justify-between px-3 mb-1.5 text-left">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Import &amp; Trace</span>
                {openSections.reports ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              {openSections.reports && <div className="space-y-0.5">
                <button onClick={() => setActiveView('supplier')} className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeView === 'supplier' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Truck className="w-3.5 h-3.5 text-slate-400" /><span>Supplier Import</span></button>
                <button onClick={() => setActiveView('traceability')} className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeView === 'traceability' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><GitMerge className="w-3.5 h-3.5 text-slate-400" /><span>Genealogy</span></button>
                <button onClick={() => setActiveView('scrap')} className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeView === 'scrap' ? 'bg-red-700 text-white shadow-xs' : 'text-slate-600 hover:bg-red-50 hover:text-red-800'}`}><Flame className="w-3.5 h-3.5 text-red-500" /><span>Damage</span></button>
              </div>}
            </>
          )}
        </div>

        {/* SETUPS */}
        <div className={isCeo ? 'hidden' : undefined}>
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

      <div className="mobile-sidebar-actions flex border-t border-slate-100 p-3 md:hidden">
        <div className="relative flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNotifications(previous => !previous)}
            aria-label="Open notifications"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <Bell className="h-4 w-4" />
            {notifications.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-600" />}
          </button>
          <button
            type="button"
            onClick={() => setShowProfile(previous => !previous)}
            aria-expanded={showProfile}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
              {profile?.name?.charAt(0) || '—'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-slate-900">{currentUser?.name || '—'}</span>
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{currentUser?.role?.replace('_', ' ') || '—'}</span>
            </span>
            {showProfile ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          </button>
          {showNotifications && (
            <div className="absolute bottom-12 left-0 z-50 w-full rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notifications</span>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{notifications.length}</span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {notifications.length === 0 ? <p className="p-3 text-center text-xs text-slate-400">No new notifications</p> : notifications.map(notification => (
                  <div key={notification.id} className="border-b border-slate-50 p-3 text-xs last:border-0">
                    <p className="font-bold text-slate-800">{notification.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{notification.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showProfile && (
            <div className="absolute bottom-12 left-0 z-50 w-full rounded-xl border border-slate-200 bg-white py-2 shadow-lg">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operator Profile</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{currentUser?.badgeId || '—'}</p>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="font-semibold">Role</span>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getRoleBadgeColor(currentProfile?.roleId || '')}`}>
                  {String(currentProfile?.roleId || '—').replace('role-', '').replace('_', ' ')}
                </span>
              </div>
              <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <LogOut className="h-3.5 w-3.5" />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};



