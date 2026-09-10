import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type NavView =
  | 'dashboard'
  | 'ceo-monitoring'
  | 'production-flow'
  | 'container-floor'
  | 'production'
  | 'workflow-cell'
  | 'workflow-module'
  | 'workflow-pack'
  | 'rack-assembly'
  | 'planning'
  | 'inventory'
  | 'traceability'
  | 'supplier'
  | 'products'
  | 'quarantine'
  | 'scrap'
  | 'audit'
  | 'reports'
  | 'security'
  | 'warehouse'
  | 'sold';

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
}

interface AppContextType {
  activeView: NavView;
  setActiveView: (view: NavView) => void;
  activeBatteryId: string | null;
  setActiveBatteryId: (id: string | null) => void;
  batteryBuilderEditRequested: boolean;
  setBatteryBuilderEditRequested: (requested: boolean) => void;
  activeOrderId: string | null;
  setActiveOrderId: (id: string | null) => void;
  activeModuleId: string | null;
  setActiveModuleId: (id: string | null) => void;
  inventoryTab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS';
  setInventoryTab: (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS') => void;
  notifications: AppNotification[];
  addNotification: (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => void;
  dismissNotification: (id: string) => void;
  refreshKey: number;
  triggerRefresh: () => void;
  quickSearchQuery: string;
  setQuickSearchQuery: (q: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') return initialValue;
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn('Error reading localStorage', error);
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  };

  return [storedValue, setValue];
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeView, setActiveView] = useLocalStorage<NavView>('p2g_activeView', 'production-flow');
  const [activeBatteryId, setActiveBatteryId] = useLocalStorage<string | null>('p2g_activeBatteryId', null);
  const [batteryBuilderEditRequested, setBatteryBuilderEditRequested] = useState(false);
  const [activeOrderId, setActiveOrderId] = useLocalStorage<string | null>('p2g_activeOrderId', null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [inventoryTab, setInventoryTab] = useState<'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES' | 'RACKS'>('CELLS');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const notificationTimers = useRef<Set<number>>(new Set());
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');

  const triggerRefresh = useCallback(() => setRefreshKey(prev => prev + 1), []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const addNotification = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    const newNotif: AppNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      title,
      message,
      timestamp: new Date().toLocaleTimeString(),
    };
    setNotifications(prev => [newNotif, ...prev.slice(0, 9)]);
    const timer = window.setTimeout(() => {
      notificationTimers.current.delete(timer);
      dismissNotification(newNotif.id);
    }, 5000);
    notificationTimers.current.add(timer);
  }, [dismissNotification]);

  useEffect(() => () => {
    notificationTimers.current.forEach(timer => window.clearTimeout(timer));
    notificationTimers.current.clear();
  }, []);

  const contextValue = useMemo(() => ({
    activeView,
    setActiveView,
    activeBatteryId,
    setActiveBatteryId,
    batteryBuilderEditRequested,
    setBatteryBuilderEditRequested,
    activeOrderId,
    setActiveOrderId,
    activeModuleId,
    setActiveModuleId,
    inventoryTab,
    setInventoryTab,
    notifications,
    addNotification,
    dismissNotification,
    refreshKey,
    triggerRefresh,
    quickSearchQuery,
    setQuickSearchQuery,
  }), [
    activeView,
    activeBatteryId,
    batteryBuilderEditRequested,
    activeOrderId,
    activeModuleId,
    inventoryTab,
    notifications,
    addNotification,
    dismissNotification,
    refreshKey,
    triggerRefresh,
    quickSearchQuery,
  ]);

  return (
    <AppContext.Provider
      value={contextValue}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
