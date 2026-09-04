import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { MachineStation } from '../../types';
import {
  Cpu,
  Activity,
  Power,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Zap,
  Radio,
  Server,
} from 'lucide-react';

export const MachineGatewayView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser, hasPermission } = useAuth();

  const [machines, setMachines] = useState<MachineStation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMachines();
  }, [refreshKey]);

  const loadMachines = async () => {
    setLoading(true);
    try {
      const res = await api.getMachines();
      setMachines(res);
    } catch (err) {
      console.error('Failed to load machines', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusToggle = async (machineId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    try {
      await api.toggleMachineStatus(machineId, nextStatus as any);
      addNotification('info', 'Machine State Updated', `${machineId} is now ${nextStatus}`);
      triggerRefresh();
    } catch (err: any) {
      addNotification('error', 'Update Failed', err.message);
    }
  };

  const getMachineIcon = (type: string) => {
    switch (type) {
      case 'LASER_WELDER':
        return <Flame className="w-6 h-6 text-slate-500" />;
      case 'OCV_IR_TESTER':
        return <Zap className="w-6 h-6 text-emerald-500" />;
      case 'BMS_TESTER':
        return <Cpu className="w-6 h-6 text-emerald-500" />;
      case 'FINAL_DYN_TESTER':
        return <Activity className="w-6 h-6 text-slate-500" />;
      default:
        return <Server className="w-6 h-6 text-slate-500" />;
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
              <Cpu className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Factory IoT & Machine Gateway Adapters
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Industrial hardware interfaces (Modbus TCP, SECS/GEM, CAN 2.0B, OPC-UA). Automatically captures telemetry and test measurements directly into MES twins.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadMachines}
          className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center space-x-2 transition-colors shadow-xs"
        >
          <RefreshCw className="w-4 h-4 text-slate-500" />
          <span>Refresh Hardware Status</span>
        </button>
      </div>

      {/* Machines Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {machines.map(m => {
          const isOnline = m.status === 'ONLINE';
          const isBusy = m.status === 'BUSY';

          return (
            <div
              key={m.id}
              className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5 relative overflow-hidden"
            >
              {/* Top Row */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    {getMachineIcon(m.type)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{m.name}</h3>
                    <p className="text-[11px] font-mono text-slate-500">{m.id} • {m.type}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center space-x-1.5 border ${
                      isOnline
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : isBusy
                        ? 'bg-slate-50 text-slate-700 border-slate-200 animate-pulse'
                        : 'bg-slate-100 text-black border-slate-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : isBusy ? 'bg-slate-500' : 'bg-slate-1000'}`}></span>
                    <span>{m.status}</span>
                  </span>

                  <button
                    onClick={() => handleStatusToggle(m.id, m.status)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    title="Toggle Machine Power / Online State"
                  >
                    <Power className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Protocol & IP Settings */}
              <div className="grid grid-cols-2 gap-3 text-[11px] font-mono bg-slate-50/70 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">EQUIPMENT MODEL</span>
                  <strong className="text-slate-800">{m.model}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">IP / ENDPOINT</span>
                  <strong className="text-slate-800">{m.ipAddress || '192.168.1.100'}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">TOTAL RUNS</span>
                  <strong className="text-slate-800">{m.totalRuns} cycles</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-sans">SUCCESS RATE</span>
                  <strong className="text-emerald-700">{m.successRate}%</strong>
                </div>
              </div>

              {/* Hardware Calibration & Parameters */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Last Heartbeat Ping</span>
                  <span className="font-semibold text-slate-700 font-mono">
                    {new Date(m.lastPing).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
