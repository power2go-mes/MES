import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, QrCode, Search, AlertTriangle, X, ArrowRight, CheckCircle2, RefreshCw, Flashlight, FlashlightOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => Promise<void> | void;
  title?: string;
  subtitle?: string;
  initialMode?: 'camera' | 'manual';
}

const normalizeScanValue = (value: string) => value
  .replace(/\uFEFF/g, '')
  .trim()
  .replace(/\s+/g, '');

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan Component',
  subtitle = 'One-Time Physical Identification & Digital Twin Linkage',
  initialMode = 'camera',
}) => {
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<'camera' | 'manual'>(initialMode);
  const [compactDevice, setCompactDevice] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Camera scanner ready');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraOptions, setCameraOptions] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLockRef = useRef(false);
  const nativeScanTimerRef = useRef<number | null>(null);
  const nativeScanInFlightRef = useRef(false);

  const cleanupCamera = async () => {
    scanLockRef.current = false;
    if (nativeScanTimerRef.current !== null) {
      window.clearInterval(nativeScanTimerRef.current);
      nativeScanTimerRef.current = null;
    }
    nativeScanInFlightRef.current = false;
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // no-op
      }
      controlsRef.current = null;
    }
    if (readerRef.current) {
      try {
        readerRef.current = null;
      } catch {
        // no-op
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }
    setTorchSupported(false);
    setTorchOn(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  };

  const enumerateCameras = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameraOptions(videoDevices);

      if (videoDevices.length > 0 && !selectedCameraId) {
        const preferred = videoDevices.find(device => /rear|back|environment|external/i.test(device.label)) ?? videoDevices[0];
        setSelectedCameraId(preferred.deviceId);
      }
    } catch (err) {
      console.warn('Unable to enumerate cameras', err);
    }
  };

  const startCamera = async (deviceId?: string) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Unsupported browser. Use Manual Entry instead.');
      setStatus('Camera unavailable — use Manual Entry');
      return;
    }

    setCameraError(null);
    setIsCameraLoading(true);
    setStatus('Requesting camera access...');

    try {
      await cleanupCamera();

      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const capabilities = videoTrack?.getCapabilities?.();
      setTorchSupported(Boolean(capabilities && 'torch' in capabilities && capabilities.torch));
      setTorchOn(false);
      if (videoTrack && capabilities) {
        const advanced: MediaTrackConstraintSet[] = [];
        if ('focusMode' in capabilities && capabilities.focusMode?.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' });
        }
        if ('zoom' in capabilities && capabilities.zoom) {
          const zoom = capabilities.zoom;
          advanced.push({ zoom: Math.min(zoom.max, Math.max(zoom.min, 2)) });
        }
        if (advanced.length > 0) await videoTrack.applyConstraints({ advanced });
      }

      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.autoplay = true;
        videoRef.current.srcObject = stream;
        if (videoRef.current.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>(resolve => {
            const video = videoRef.current;
            if (!video) return resolve();
            video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          });
        }
        await videoRef.current.play().catch(() => undefined);
      }

      const BarcodeDetector = (window as any).BarcodeDetector;
      if (BarcodeDetector && videoRef.current) {
        try {
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          nativeScanTimerRef.current = window.setInterval(() => {
            const video = videoRef.current;
            if (nativeScanInFlightRef.current || scanLockRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
            nativeScanInFlightRef.current = true;
            void detector.detect(video)
              .then((codes: Array<{ rawValue?: string }>) => {
                const value = codes[0]?.rawValue;
                if (value && !scanLockRef.current) {
                  scanLockRef.current = true;
                  setBarcode(value);
                  setStatus('QR code detected — identifying component');
                  void handleScanValue(value);
                }
              })
              .catch(() => undefined)
              .finally(() => {
                nativeScanInFlightRef.current = false;
              });
          }, 180);
        } catch {
          // Continue with ZXing when BarcodeDetector is unavailable or unsupported.
        }
      }

      const hints = new Map<DecodeHintType, any>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]],
        [DecodeHintType.TRY_HARDER, true],
      ]);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 80,
        delayBetweenScanSuccess: 500,
      });
      readerRef.current = reader;

      const controls = await reader.decodeFromStream(
        stream,
        videoRef.current || undefined,
        (result, error) => {
          if (scanLockRef.current || !result) {
            if (error && error.name !== 'NotFoundException') {
              console.warn('Barcode decode warning', error);
            }
            return;
          }

          const decoded = result.getText();
          scanLockRef.current = true;
          setBarcode(decoded);
          setStatus('Barcode detected — identifying component');
          void handleScanValue(decoded);
        }
      );
      controlsRef.current = controls;

      setStatus('Camera scanner ready');
      setIsCameraLoading(false);
    } catch (err: any) {
      console.error('Camera initialization failed', err);
      const message = err?.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow access to continue.'
        : err?.name === 'NotFoundError'
          ? 'No camera detected on this device.'
          : err?.name === 'NotReadableError'
            ? 'Camera is currently in use by another app or tab.'
            : 'Camera unavailable. Please use Manual Entry.';

      setCameraError(message);
      setStatus('Camera unavailable — use Manual Entry');
    } finally {
      setIsCameraLoading(false);
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;

    const nextTorchState = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: nextTorchState }] });
      setTorchOn(nextTorchState);
    } catch (err) {
      console.warn('Unable to toggle camera flash', err);
      setStatus('Flash unavailable on this camera');
    }
  };

  useEffect(() => {
    const isCompact = window.matchMedia('(max-width: 1024px)').matches;
    if (!isOpen) {
      void cleanupCamera();
      setError(null);
      setBarcode('');
      setStatus('Camera scanner ready');
      setCameraError(null);
      setMode(isCompact ? 'camera' : initialMode);
      return;
    }

    setError(null);
    setBarcode('');
    setMode(isCompact ? 'camera' : initialMode);
    setStatus('Camera scanner ready');
    setCameraError(null);
    setIsSubmitting(false);
    setTimeout(() => inputRef.current?.focus(), 120);
    void enumerateCameras();
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen || mode !== 'camera') {
      void cleanupCamera();
      return;
    }

    void startCamera(selectedCameraId || undefined);

    return () => {
      void cleanupCamera();
    };
  }, [isOpen, mode, selectedCameraId]);

  const handleScanValue = async (value: string) => {
    const normalized = normalizeScanValue(value);
    if (!normalized) {
      setError('Invalid barcode or serial number.');
      setStatus('No scan value received');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await onScan(normalized);
      setBarcode('');
      setStatus('Scan complete');
      scanLockRef.current = false;
      if (mode === 'camera') {
        setTimeout(() => {
          if (isOpen) { void startCamera(selectedCameraId || undefined); }
        }, 250);
      }
    } catch (err: any) {
      const message = err?.message || 'Unable to identify component.';
      setError(message);
      setStatus('Identification failed');
      setBarcode(value);
      scanLockRef.current = false;
      if (mode === 'camera') {
        setTimeout(() => {
          if (isOpen) { void startCamera(selectedCameraId || undefined); }
        }, 350);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async () => {
    const targetCode = normalizeScanValue(barcode);
    if (!targetCode) {
      setError('Please enter a barcode or serial number.');
      return;
    }
    await handleScanValue(targetCode);
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await handleManualSubmit();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        <div className="px-4 sm:px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-tight truncate">{title}</h3>
              <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors shrink-0"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('camera')}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                mode === 'camera' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Camera Scan
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                mode === 'manual' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Manual Entry
            </button>
          </div>

          {mode === 'camera' ? (
            <div className="space-y-3">
              {cameraOptions.length > 1 && (
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-700">Camera</label>
                  <select
                    value={selectedCameraId}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedCameraId(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none"
                  >
                    {cameraOptions.map((device: MediaDeviceInfo) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${cameraOptions.indexOf(device) + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 h-52 sm:h-56">
                <div className="absolute inset-x-10 inset-y-6 border-2 border-dashed border-emerald-500/70 rounded-xl pointer-events-none" />
                <button
                  type="button"
                  onClick={() => void toggleTorch()}
                  disabled={!torchSupported}
                  aria-label={torchSupported ? (torchOn ? 'Turn flash off' : 'Turn flash on') : 'Flash unavailable'}
                  aria-pressed={torchOn}
                  title={torchSupported ? (torchOn ? 'Turn flash off' : 'Turn flash on') : 'Flash unavailable on this camera'}
                  className={`absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-white/30 text-white ${
                    torchSupported ? 'bg-black/60 hover:bg-black/80' : 'cursor-not-allowed bg-black/30 opacity-60'
                  }`}
                >
                  {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                </button>
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
                {isCameraLoading && (
                  <div className="absolute inset-0 flex h-full items-center justify-center flex-col bg-slate-950/60 text-white gap-3">
                    <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
                    <p className="text-xs font-semibold">Opening camera...</p>
                  </div>
                )}
                {cameraError && !isCameraLoading && (
                  <div className="absolute inset-0 flex h-full items-center justify-center flex-col bg-slate-950/85 text-center px-6 text-white gap-3">
                    <Camera className="w-8 h-8 text-amber-400" />
                    <p className="text-xs font-semibold">{cameraError}</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                {status}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">Barcode / Serial Number</label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={barcode}
                    onChange={event => setBarcode(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. CELL-000001 or BMS-000123"
                    className="w-full pl-10 pr-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleManualSubmit()}
                disabled={!barcode.trim() || isSubmitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold py-3 transition-colors"
              >
                {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                <span>{isSubmitting ? 'Identifying...' : 'Identify'}</span>
              </button>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 flex items-start space-x-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Identification Failed</p>
                <p className="text-[11px] mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {!error && !cameraError && mode === 'camera' && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>Ready for QR or barcode scanning.</span>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500 gap-3">
          <span>Operator: <strong className="text-slate-700">{currentUser?.name || 'Administrator'}</strong></span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-xl font-medium text-slate-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
