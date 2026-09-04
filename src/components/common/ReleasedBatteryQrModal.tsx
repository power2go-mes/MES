import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, QrCode, X } from 'lucide-react';
import type { BatteryUnit, ModuleItem, BMSItem, BMUItem } from '../../types';

interface ReleasedBatteryQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  battery: BatteryUnit;
}

const QrLabel: React.FC<{
  title: string;
  itemType: 'BATTERY' | 'MODULE' | 'BMS' | 'BMU';
  serialNumber: string;
  payload: string;
}> = ({ title, itemType, serialNumber, payload }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, payload, {
      width: 180,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(() => setDataUrl(canvasRef.current?.toDataURL() || '')).catch(() => setDataUrl(''));
  }, [payload]);

  const download = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${serialNumber}_QR.png`;
    link.click();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center">
      <div className="w-full flex items-center justify-between mb-3">
        <span className="text-xs font-black uppercase text-slate-700">{title}</span>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">{itemType}</span>
      </div>
      <div className="p-2 bg-white border border-slate-200 rounded-lg">
        <canvas ref={canvasRef} className="w-[180px] h-[180px]" />
      </div>
      <p className="mt-3 text-xs font-mono font-bold text-slate-900 break-all">{serialNumber}</p>
      <button
        type="button"
        onClick={download}
        className="mt-3 px-3 py-1.5 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
      >
        <Download className="w-3.5 h-3.5" />
        Download QR
      </button>
    </div>
  );
};

export const ReleasedBatteryQrModal: React.FC<ReleasedBatteryQrModalProps> = ({ isOpen, onClose, battery }) => {
  if (!isOpen) return null;

  const modules: ModuleItem[] = Array.isArray(battery.modules) ? battery.modules : [];
  const bms: BMSItem | undefined = battery.bms;
  const bmu: BMUItem | undefined = battery.bmu;
  const controller = bmu || bms;
  const controllerType = bmu ? 'BMU' : 'BMS';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-slate-50 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden border border-slate-200">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
              <QrCode className="w-4 h-4 text-emerald-400" />
              Released Battery QR Passport
            </h3>
            <p className="text-[11px] text-slate-400">Battery and module traceability labels</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-132px)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <QrLabel
              title="Battery Pack"
              itemType="BATTERY"
              serialNumber={battery.serialNumber}
              payload={battery.serialNumber}
            />
            {controller && (
              <QrLabel
                title={controllerType === 'BMU' ? 'Battery Management Unit' : 'Battery Management System'}
                itemType={controllerType}
                serialNumber={controller.serialNumber}
                payload={controller.serialNumber}
              />
            )}
            {modules.map((module, index) => (
              <QrLabel
                key={module.id}
                title={`Module ${(index + 1).toString().padStart(2, '0')}`}
                itemType="MODULE"
                serialNumber={module.serialNumber}
                payload={module.serialNumber}
              />
            ))}
          </div>
        </div>

        <div className="px-6 py-4 bg-white border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Print QR Passport
          </button>
        </div>
      </div>
    </div>
  );
};
