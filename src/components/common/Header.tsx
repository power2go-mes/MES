import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { Search, Bell, ChevronDown, LogOut, Menu, ArrowLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

type HeaderProps = {
  onOpenNavigation: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
};

export const Header: React.FC<HeaderProps> = ({ onOpenNavigation, onToggleSidebar, isSidebarOpen }) => {
  const { currentUser, profile, logout } = useAuth();
  const { activeView, setActiveView, goBack, canGoBack, quickSearchQuery, setQuickSearchQuery, notifications } = useApp();

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-slate-50 text-slate-700 border-slate-200';
      case 'production_manager':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'engineering':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'operator':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'qc_inspector':
        return 'bg-slate-50 text-slate-700 border-slate-200';
      case 'supervisor':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'maintenance':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'warehouse':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const currentProfile = profile ?? currentUser;

  useEffect(() => {
    setShowRoleMenu(false);
    setShowNotifMenu(false);
  }, [activeView]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-header-menu="true"]')) {
        setShowRoleMenu(false);
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleSwitchRole = (_role: string) => {
    setShowRoleMenu(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearchQuery.trim()) {
      setActiveView('traceability');
    }
  };

  return (
    <header className="app-header min-h-16 bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs px-4 sm:px-6">
      <div className="mx-auto flex min-h-16 w-full max-w-[1600px] flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={isSidebarOpen ? onToggleSidebar : onOpenNavigation}
          aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={goBack}
          disabled={!canGoBack}
          aria-label="Go back to the previous page"
          title="Go back to the previous page"
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-xs font-semibold">Back</span>
        </button>
        <div className="order-last flex w-full min-w-0 flex-1 md:order-none md:max-w-xl">
          <form onSubmit={handleSearch} className="relative w-full">
          <input
            type="text"
            value={quickSearchQuery}
            onChange={e => setQuickSearchQuery(e.target.value)}
            placeholder="Scan / Search Cell, Module, Battery Serial..."
            className="h-10 w-full pl-9 pr-20 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 placeholder-slate-400 font-sans"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
          <button
            type="submit"
            className="absolute right-1.5 top-1.5 h-7 px-2.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded transition-colors"
          >
            Trace ↵
          </button>
          </form>
        </div>

        <div className="ml-auto hidden h-10 items-center gap-3 sm:gap-5 md:flex">
          {/* Notifications */}
          <div className="relative" data-header-menu="true">
            <button
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              aria-label="Open notifications"
              className="relative flex h-10 w-10 items-center justify-center p-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg transition-colors"
            >
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-600 rounded-full"></span>
              )}
            </button>

            {showNotifMenu && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-fade-in">
                <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Production Notifications</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{notifications.length}</span>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-400 p-4 text-center">No new notifications</p>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className="p-3 hover:bg-slate-50 text-xs">
                        <p className="font-bold text-slate-800">{n.title}</p>
                        <p className="text-slate-500 text-[11px] mt-0.5">{n.message}</p>
                        <span className="text-[10px] text-slate-400 mt-1 block font-mono">{n.timestamp}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Operator Profile / Role Switcher */}
          <div className="flex h-10 items-center gap-2">
            <div className="relative" data-header-menu="true">
              <button
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                aria-label="Open profile menu"
                className="flex h-10 items-center space-x-2 pl-2 pr-3 rounded-xl border border-slate-200 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white transition-all text-left"
              >
                <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
                  {profile?.name?.charAt(0) || '—'}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-slate-900 leading-tight">{currentUser?.name || '—'}</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{currentUser?.role?.replace('_', ' ') || '—'}</p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
              {showRoleMenu && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-fade-in">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Switch Operator Role</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Role-Based Access Control (RBAC)</p>
                  </div>
                  <div className="py-1">
                    {currentProfile && currentProfile.roleId ? (
                      <button
                        key={currentProfile.roleId}
                        onClick={() => handleSwitchRole(currentProfile.roleId)}
                        className="w-full px-4 py-2.5 text-left text-xs flex items-center justify-between hover:bg-slate-50 transition-colors"
                      >
                        <div>
                          <p className="font-semibold">{currentUser?.name || '—'}</p>
                          <span className="text-[10px] text-slate-400 font-mono">{currentUser?.badgeId || '—'}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${getRoleBadgeColor(currentProfile.roleId)}`}>
                          {String(currentProfile.roleId).replace('_', ' ')}
                        </span>
                      </button>
                    ) : (
                      <p className="text-xs text-slate-500 p-2">Loading role information...</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => void logout()}
              aria-label="Logout"
              className="flex h-10 w-10 items-center justify-center p-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};