import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  Download,
  X,
  FileCheck,
  Building2,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  Layers,
  Zap,
  Printer,
} from 'lucide-react';
import logoImg from '../../assets/power2go-logo.png';
import type { RackUnit, RackInspectionReport } from '../../types';
import { normalizeRackSerial } from '../../lib/rackNaming';

interface RackFatReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rack: RackUnit | null;
}

export const RackFatReportModal: React.FC<RackFatReportModalProps> = ({
  isOpen,
  onClose,
  rack,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [downloading, setDownloading] = useState(false);

  // Pre-load and downscale logo image as Data URL for jsPDF to keep PDF size small (< 100 KB)
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // Scale logo to high-DPI compact target (~500px wide, ~100px high)
        const targetWidth = 500;
        const targetHeight = Math.round((img.height / img.width) * targetWidth) || 80;
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          if (!cancelled) setLogoDataUrl(canvas.toDataURL('image/png', 0.85));
        }
      } catch (e) {
        console.warn('Failed to convert logo to dataUrl', e);
      }
    };
    img.src = logoImg;
    return () => {
      cancelled = true;
    };
  }, []);

  const report: RackInspectionReport | null = rack?.inspectionReport || null;
  const rawSerial = rack?.serialNumber || rack?.id || 'P2G-RACK';
  const serial = normalizeRackSerial(rawSerial);

  // Derive model / type details
  const shellType = rack?.shellType || (serial.includes('CAB') ? 'CABINET' : 'RACK');
  const voltageType = rack?.voltageType || (serial.includes('HV') || Number(rack?.actualCapacityKwh || 0) > 30 ? 'HV' : 'LV');
  const cabinetModelName = shellType === 'CABINET'
    ? `Power2Go ${voltageType} Cabinet`
    : `Power2Go ${voltageType} Rack`;

  const installedPacks = rack?.installedPackCount || rack?.batteryIds?.length || 5;
  const packRating = voltageType === 'HV' ? 7.5 : 5.0;
  const totalCapacityKwh = rack?.actualCapacityKwh || Number((installedPacks * packRating).toFixed(1));
  const capacityFormatted = `${totalCapacityKwh} kWh (${installedPacks} × ${packRating} kWh)`;

  // Deterministic FAT Report identifier based on rack serial
  const fatReportNo = useMemo(() => {
    const digits = serial.replace(/\D/g, '');
    const suffix = digits.slice(-4) || '0101';
    const year = new Date(report?.createdAt || rack?.createdAt || Date.now()).getFullYear();
    return `FAT-${year}-${suffix}`;
  }, [serial, report, rack]);

  // Customer / Destination
  const customer = (rack as any)?.destination || (rack as any)?.client_name || (rack as any)?.issuedToPerson || 'Power2Go Customer';
  const projectSite = 'Karachi Warehouse';

  const testDateFormatted = useMemo(() => {
    const rawDate = report?.createdAt || rack?.createdAt;
    const d = rawDate ? new Date(rawDate) : new Date();
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [report, rack]);

  const approvedBy = 'QA Department';
  const hasDownloadableReport = Boolean(rack?.id && report?.pdfFileName && report?.pdfDataUrl);
  const reportDownloadUrl = rack?.id
    ? `https://mes-p2g.vercel.app/api/public/rack-reports/${encodeURIComponent(rack.id)}/pdf`
    : '';

  // Generate QR code for bottom card verification
  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !rack || !hasDownloadableReport || !reportDownloadUrl) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(reportDownloadUrl, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0b1f19',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate FAT QR Code', err);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, rack, hasDownloadableReport, reportDownloadUrl]);

  // Generate exact 70 x 100 mm vector PDF using jsPDF
  const exportPdf = () => {
    if (!rack) return;
    setDownloading(true);

    try {
      // 70mm width by 100mm height
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [70, 100],
      });

      // Background card
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 70, 100, 'F');

      // Top Header: Logo on left, "QUALITY ASSURANCE" on right
      if (logoDataUrl) {
        const logoProperties = doc.getImageProperties(logoDataUrl);
        const logoWidth = 22;
        const logoHeight = Math.min(6.5, logoWidth * (logoProperties.height / logoProperties.width));
        doc.addImage(logoDataUrl, 'PNG', 5, (9 - logoHeight) / 2, logoWidth, logoHeight, undefined, 'FAST');
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(15, 23, 42);
        doc.text('POWER2GO', 5, 6.5);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text('QUALITY ASSURANCE', 70 - 5, 6, { align: 'right' });

      // Deep green FAT banner
      doc.setFillColor(11, 31, 25); // #0b1f19
      doc.rect(0, 9, 70, 23, 'F');

      // Concentric watermark rings, clipped to the banner and drawn at 50% opacity.
      doc.setDrawColor(51, 75, 65);
      doc.setLineWidth(0.18);
      doc.setGState(new doc.GState({ 'stroke-opacity': 0.5 }));
      for (const radius of [5, 9, 13, 17, 21, 25, 29]) {
        let previousPoint: [number, number] | null = null;
        for (let step = 0; step <= 360; step += 1) {
          const angle = (step * Math.PI) / 180;
          const x = 70 + radius * Math.cos(angle);
          const y = 20.5 + radius * Math.sin(angle);
          const insideBanner = x >= 0 && x <= 70 && y >= 9 && y <= 32;
          if (insideBanner && previousPoint) {
            doc.line(previousPoint[0], previousPoint[1], x, y);
          }
          previousPoint = insideBanner ? [x, y] : null;
        }
      }
      doc.setGState(new doc.GState({ 'stroke-opacity': 1 }));

      // Green completion seal and check mark
      doc.setDrawColor(46, 185, 67);
      doc.setLineWidth(0.3);
      doc.circle(56, 20.5, 4.7, 'S');
      doc.setDrawColor(238, 248, 241);
      doc.setLineWidth(0.45);
      doc.line(53.8, 20.5, 55.3, 22.1);
      doc.line(55.3, 22.1, 58.4, 18.7);

      // Banner text: "FACTORY ACCEPTANCE TEST"
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(46, 185, 67); // #2eb943
      doc.text('FACTORY ACCEPTANCE TEST', 5, 15);

      // Banner title: "Testing Completed"
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text('Testing Completed', 5, 23);

      // Intro text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(71, 85, 105); // slate-600
      const intro = `This battery ${shellType === 'CABINET' ? 'cabinet' : 'rack'} has successfully completed factory acceptance testing and quality inspection prior to dispatch.`;
      const introLines = doc.splitTextToSize(intro, 60);
      doc.text(introLines, 5, 36);

      // 2-Column Specs Grid
      const startY = 44;
      const rowGap = 7.2;
      const col1X = 5;
      const col2X = 37;

      const drawGridField = (x: number, y: number, label: string, value: string) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(4.5);
        doc.setTextColor(116, 135, 153); // muted blue-gray
        doc.text(label.toUpperCase(), x, y);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.0);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.setFontSize(value.length > 21 ? 4.1 : 5.0);
        doc.text(value, x, y + 2.5, { maxWidth: 28 });
      };

      const fieldRows = [
        [
          [shellType === 'CABINET' ? 'BATTERY CABINET' : 'BATTERY RACK', cabinetModelName],
          ['CAPACITY', capacityFormatted],
        ],
        [
          [shellType === 'CABINET' ? 'CABINET SERIAL NO.' : 'RACK SERIAL NO.', serial],
          ['FAT REPORT NO.', fatReportNo],
        ],
        [
          ['CUSTOMER', customer],
          ['TEST DATE', testDateFormatted],
        ],
        [
          ['PROJECT / SITE', projectSite],
          ['APPROVED BY', approvedBy],
        ],
      ] as const;

      fieldRows.forEach((row, rowIndex) => {
        const rowY = startY + rowGap * rowIndex;
        drawGridField(col1X, rowY, row[0][0], row[0][1]);
        drawGridField(col2X, rowY, row[1][0], row[1][1]);

        if (rowIndex < fieldRows.length - 1) {
          doc.setDrawColor(218, 226, 222);
          doc.setLineWidth(0.12);
          doc.line(5, rowY + 4.7, 65, rowY + 4.7);
        }
      });

      // Divider line before QR
      doc.setDrawColor(183, 201, 190); // muted green-gray
      doc.setLineWidth(0.2);
      doc.line(5, 73, 65, 73);

      // Mint verification panel with QR code and report link
      doc.setFillColor(242, 249, 242);
      doc.roundedRect(5, 75, 60, 20, 1.5, 1.5, 'F');
      if (qrDataUrl) {
        doc.addImage(qrDataUrl, 'PNG', 7, 77, 16, 16);
      } else {
        doc.setFillColor(241, 245, 249);
        doc.rect(7, 77, 16, 16, 'F');
      }

      // QR Text details
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Scan for the full report', 25, 80);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.3);
      doc.setTextColor(100, 116, 139);
      const downloadNotice = hasDownloadableReport
        ? 'Scan to download the attached factory inspection PDF.'
        : 'No inspection PDF was attached during assembly.';
      const noticeLines = doc.splitTextToSize(downloadNotice, 37);
      doc.text(noticeLines, 25, 84);

      doc.save(`${serial}-FAT-Completion-Card-70x100mm.pdf`);
    } catch (err) {
      console.error('Failed to generate FAT PDF', err);
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen || !rack) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6 animate-card-enter">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-200/60">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-sky-700 bg-sky-100/60 px-2 py-0.5 rounded-full mb-0.5">
                FAT Completion Card (70 × 100 mm)
              </div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>Rack / Cabinet Quality Tag</span>
                <span className="font-mono text-sm text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200/50">
                  {serial}
                </span>
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Card Preview Area */}
        <div className="p-6 bg-slate-100/70 flex flex-col items-center justify-center border-b border-slate-200">
          <div className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Interactive 70 × 100 mm Live Card Preview</span>
          </div>

          {/* Actual 70x100mm Card Replica (scaled 1.25x for crisp readability on screens) */}
          <div
            id="fat-completion-card-preview"
            className="w-[280px] h-[400px] bg-white rounded-lg shadow-xl border border-slate-300 relative overflow-hidden select-none flex flex-col justify-between p-4"
            style={{
              boxShadow: '0 12px 30px -4px rgba(15, 23, 42, 0.25)',
            }}
          >
            {/* Top Quality Assurance label & Logo */}
            <div className="flex items-center justify-between pb-1">
              <img
                src={logoImg}
                alt="Power2Go"
                className="h-4 w-auto object-contain"
              />
              <div className="text-[8px] font-black uppercase tracking-wider text-slate-400 text-right">
                QUALITY ASSURANCE
              </div>
            </div>

            {/* Deep green hero banner */}
            <div className="absolute top-8 left-0 right-0 bg-[#0b1f19] px-4 py-2.5 text-white overflow-hidden">
              {/* Decorative Concentric Rings - clipped inside banner with 50% opacity */}
              <div className="absolute inset-0 z-0 overflow-hidden opacity-50 pointer-events-none" aria-hidden="true">
                {[38, 56, 74, 92, 110, 128, 146].map((diameter) => (
                  <span
                    key={diameter}
                    className="absolute rounded-full border border-emerald-100/50"
                    style={{
                      width: diameter,
                      height: diameter,
                      right: -(diameter / 2),
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  />
                ))}
              </div>
              <div className="absolute right-5 top-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#2eb943] text-white">
                <CheckCircle2 className="h-7 w-7 stroke-[1.5]" />
              </div>
              <div className="relative z-10">
                <span className="text-[8.5px] font-black tracking-widest text-[#39c653] uppercase block">
                  FACTORY ACCEPTANCE TEST
                </span>
                <span className="text-[15px] font-black tracking-tight text-white block mt-0.5">
                  Testing Completed
                </span>
              </div>
            </div>

            {/* Subheading Intro */}
            <div className="mt-16 text-[8.5px] text-slate-600 leading-tight">
              This battery {shellType === 'CABINET' ? 'cabinet' : 'rack'} has successfully completed factory acceptance testing and quality inspection prior to dispatch.
            </div>

            {/* 2-Column Specs Grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 mt-2">
              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  {shellType === 'CABINET' ? 'BATTERY CABINET' : 'BATTERY RACK'}
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {cabinetModelName}
                </span>
              </div>
              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  CAPACITY
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {capacityFormatted}
                </span>
              </div>

              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  {shellType === 'CABINET' ? 'CABINET SERIAL NO.' : 'RACK SERIAL NO.'}
                </span>
                <span className="font-mono text-[7.5px] font-black text-slate-900 truncate block mt-0.5">
                  {serial}
                </span>
              </div>
              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  FAT REPORT NO.
                </span>
                <span className="font-mono text-[7.5px] font-bold text-slate-900 truncate block mt-0.5">
                  {fatReportNo}
                </span>
              </div>

              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  CUSTOMER
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {customer}
                </span>
              </div>
              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  TEST DATE
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {testDateFormatted}
                </span>
              </div>

              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  PROJECT / SITE
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {projectSite}
                </span>
              </div>
              <div>
                <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-wider">
                  APPROVED BY
                </span>
                <span className="text-[7.5px] font-bold text-slate-800 truncate block mt-0.5">
                  {approvedBy}
                </span>
              </div>
            </div>

            {/* Mint verification panel and QR section */}
            <div className="border-t border-[#b7c9be] pt-3 pb-1 flex items-center gap-3 rounded-lg bg-[#f2f9f2] px-2">
              <div className="w-[62px] h-[62px] bg-white border border-emerald-100 rounded p-1 shrink-0 flex items-center justify-center">
        {qrDataUrl ? (
                  <img src={qrDataUrl} alt="FAT QR Code" className="w-full h-full object-contain" />
                ) : (
                  <div className="text-[7px] font-mono text-slate-400 text-center">No report PDF</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[9.5px] font-black text-slate-900 block truncate">
                  Scan for the full report
                </span>
                <span className="text-[7.5px] text-slate-500 leading-normal block mt-1">
                  {hasDownloadableReport
                    ? 'Scan to download the attached factory inspection PDF.'
                    : 'No inspection PDF was attached during assembly.'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 bg-white">
          <div className="text-xs text-slate-500">
            Form Factor: <strong className="text-slate-800">70 × 100 mm</strong> PDF Card
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={downloading || (hasDownloadableReport && !qrDataUrl)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-black transition-colors shadow-md shadow-sky-600/20 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{downloading ? 'Generating PDF...' : 'Download 70x100mm PDF'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
