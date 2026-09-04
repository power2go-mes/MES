import React, { createContext, useContext, useState } from 'react';

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
  | 'machines'
  | 'products'
  | 'quarantine'
  | 'scrap'
  | 'audit'
  | 'reports'
  | 'security'
  | 'warehouse';

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
  activeOrderId: string | null;
  setActiveOrderId: (id: string | null) => void;
  inventoryTab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES';
  setInventoryTab: (tab: 'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES') => void;
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
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  };

  return [storedValue, setValue];
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeView, setActiveView] = useLocalStorage<NavView>('p2g_activeView', 'production-flow');
  const [activeBatteryId, setActiveBatteryId] = useLocalStorage<string | null>('p2g_activeBatteryId', null);
  const [activeOrderId, setActiveOrderId] = useLocalStorage<string | null>('p2g_activeOrderId', null);
  const [inventoryTab, setInventoryTab] = useState<'CELLS' | 'BMS' | 'BMU' | 'MODULES' | 'BATTERIES'>('CELLS');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');

  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

  const addNotification = (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    const newNotif: AppNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      title,
      message,
      timestamp: new Date().toLocaleTimeString(),
    };
    setNotifications(prev => [newNotif, ...prev.slice(0, 9)]);
    window.setTimeout(() => {
      dismissNotification(newNotif.id);
    }, 5000);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <AppContext.Provider
      value={{
        activeView,
        setActiveView,
        activeBatteryId,
        setActiveBatteryId,
        activeOrderId,
        setActiveOrderId,
        inventoryTab,
        setInventoryTab,
        notifications,
        addNotification,
        dismissNotification,
        refreshKey,
        triggerRefresh,
        quickSearchQuery,
        setQuickSearchQuery,
      }}
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
