import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, Download, X, CheckCircle, ShieldCheck, Zap } from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  qrPayload: string;
  serialNumber: string;
  itemType: 'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'BMU' | 'ORDER';
  metadata?: Record<string, any>;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  title,
  qrPayload,
  serialNumber,
  itemType,
  metadata = {},
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrPayload, {
        width: 220,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      }, (error) => {
        if (!error && canvasRef.current) {
          setDataUrl(canvasRef.current.toDataURL());
        }
      });
    }
  }, [isOpen, qrPayload]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${serialNumber}_QR_Label.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
            <p className="text-[11px] text-slate-400">Industrial 2D Barcode & Compliance Label</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Label Preview Card (Thermal Label Design) */}
        <div className="p-6 flex flex-col items-center justify-center bg-slate-50">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs w-full text-center flex flex-col items-center">
            {/* Label Header */}
            <div className="w-full flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
              <div className="flex items-center space-x-1.5 text-left">
                <div className="p-1 bg-emerald-600 rounded text-white">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-900 block leading-tight">POWER2GO ENERGY</span>
                  <span className="text-[9px] text-slate-500 block">MANUFACTURING TRACEABILITY</span>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 uppercase font-mono">
                {itemType}
              </span>
            </div>

            {/* QR Code Canvas */}
            <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs mb-3">
              <canvas ref={canvasRef} className="max-w-full h-auto rounded" />
            </div>

            {/* Label Serial & Metadata */}
            <div className="w-full text-center">
              <p className="text-xs font-mono font-bold text-slate-900 tracking-wider">
                {serialNumber}
              </p>
              <p className="text-[10px] font-mono text-slate-500 break-all px-2 mt-1">
                {qrPayload}
              </p>
            </div>

            {/* Key Specs Box */}
            {Object.keys(metadata).length > 0 && (
              <div className="w-full mt-3 pt-2.5 border-t border-slate-200 grid grid-cols-2 gap-2 text-[10px] font-mono text-left bg-slate-50/70 p-2.5 rounded-lg border border-slate-200">
                {Object.entries(metadata).map(([key, val]) => (
                  <div key={key}>
                    <span className="text-slate-400 uppercase text-[9px] block">{key}</span>
                    <strong className="text-slate-800">{String(val)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex justify-between items-center">
          <button
            onClick={handleDownload}
            className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download PNG</span>
          </button>
          <div className="flex space-x-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print Thermal Label</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
