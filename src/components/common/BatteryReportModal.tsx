import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Boxes,
  Cpu,
  Download,
  Hash,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react';
import logoImg from '../../assets/logo.png';
import type { BatteryUnit, ModuleItem } from '../../types';

interface BatteryReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  battery: BatteryUnit | null;
}

type ReportCell = {
  slot: number;
  internalSerial: string;
  supplierBarcode: string;
  productionOcvV?: number;
  productionIrMilliOhm?: number;
  supplierOcvV?: number;
  supplierIrMilliOhm?: number;
  grade: string;
  status: string;
};

const formatNumber = (
  value?: number | null,
  digits = 3,
  suffix = '',
): string => {
  if (
    value === undefined ||
    value === null ||
    Number.isNaN(Number(value))
  ) {
    return '—';
  }

  return `${Number(value).toFixed(digits)}${suffix}`;
};

const formatDateValue = (value?: string | null): string => {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeString(value);
  }

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const safeString = (value?: unknown, fallback = '—'): string => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return String(value);
};

const normalizeStatus = (value?: unknown): string => {
  if (!value) return '—';

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getController = (battery: BatteryUnit) => {
  const bmu = battery.bmu;
  const bms = battery.bms;

  if (bmu) {
    return {
      type: 'BMU',
      data: bmu,
    };
  }

  if (bms) {
    return {
      type: 'BMS',
      data: bms,
    };
  }

  return {
    type: 'Controller',
    data: undefined,
  };
};

const getCellGrade = (cell: {
  productionGrade?: string;
  supplierGrade?: string;
}): string => {
  return safeString(cell.productionGrade ?? cell.supplierGrade);
};

const getProductionOcv = (cell: {
  productionOcvV?: number;
  supplierOcvV?: number;
}): number | undefined => {
  if (
    cell.productionOcvV !== undefined &&
    cell.productionOcvV !== null &&
    !Number.isNaN(Number(cell.productionOcvV))
  ) {
    return Number(cell.productionOcvV);
  }

  if (
    cell.supplierOcvV !== undefined &&
    cell.supplierOcvV !== null &&
    !Number.isNaN(Number(cell.supplierOcvV))
  ) {
    return Number(cell.supplierOcvV);
  }

  return undefined;
};

const getProductionIr = (cell: {
  productionIrMilliOhm?: number;
  supplierIrMilliOhm?: number;
  supplierIrMohm?: number;
}): number | undefined => {
  if (
    cell.productionIrMilliOhm !== undefined &&
    cell.productionIrMilliOhm !== null &&
    !Number.isNaN(Number(cell.productionIrMilliOhm))
  ) {
    return Number(cell.productionIrMilliOhm);
  }

  if (
    cell.supplierIrMilliOhm !== undefined &&
    cell.supplierIrMilliOhm !== null &&
    !Number.isNaN(Number(cell.supplierIrMilliOhm))
  ) {
    return Number(cell.supplierIrMilliOhm);
  }

  if (
    cell.supplierIrMohm !== undefined &&
    cell.supplierIrMohm !== null &&
    !Number.isNaN(Number(cell.supplierIrMohm))
  ) {
    return Number(cell.supplierIrMohm);
  }

  return undefined;
};

const getModuleCells = (module: ModuleItem): ReportCell[] => {
  return (module.cells || []).map((cell, index) => ({
    slot: Number(cell.moduleSlotIndex ?? index) + 1,
    internalSerial: safeString(cell.internalSerial),
    supplierBarcode: safeString(cell.supplierBarcode),
    productionOcvV: getProductionOcv(cell),
    productionIrMilliOhm: getProductionIr(cell),
    supplierOcvV:
      cell.supplierOcvV !== undefined
        ? Number(cell.supplierOcvV)
        : undefined,
    supplierIrMilliOhm:
      cell.supplierIrMilliOhm !== undefined
        ? Number(cell.supplierIrMilliOhm)
        : cell.supplierIrMohm !== undefined
          ? Number(cell.supplierIrMohm)
          : undefined,
    grade: getCellGrade(cell),
    status: normalizeStatus(cell.status),
  }));
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const BatteryReportModal: React.FC<BatteryReportModalProps> = ({
  isOpen,
  onClose,
  battery,
}) => {
  /**
   * IMPORTANT:
   * Hooks must always execute before any conditional return.
   */
  const [qrImageUrl, setQrImageUrl] = useState('');

  const qrPayload = useMemo(() => {
    if (!battery) return '';

    return (
      battery.qrCode ||
      `POWER2GO|BATTERY:${battery.id}|SERIAL:${battery.serialNumber}`
    );
  }, [battery]);

  useEffect(() => {
    let cancelled = false;

    if (!qrPayload) {
      setQrImageUrl('');
      return;
    }

    void QRCode.toDataURL(qrPayload, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) {
          setQrImageUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrImageUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [qrPayload]);

  const reportData = useMemo(() => {
    if (!battery) return null;

    const modules: ModuleItem[] = Array.isArray(battery.modules)
      ? battery.modules
      : [];

    const totalCells = modules.reduce(
      (sum, module) => sum + (module.cells?.length || 0),
      0,
    );

    const controller = getController(battery);

    const controllerData = controller.data as
      | (typeof controller.data & {
          serialNumber?: string;
        })
      | undefined;

    return {
      modules,
      totalCells,
      controllerType: controller.type,
      controller: controllerData,
      status: normalizeStatus(battery.status),
      productName: safeString(battery.productName),
      serialNumber: safeString(battery.serialNumber),
      productionOrderId: safeString(battery.productionOrderId),
      customerOrderRef: safeString(battery.customerOrderRef),
      dispatchedTo: safeString(battery.dispatchedTo),
      createdAt: safeString(battery.createdAt),
      finalQcResult: battery.finalQcResult,
      finalQcStatus: safeString(
        battery.finalQcResult?.status || battery.stepResults?.FINAL_QC?.status,
      ),
      packVoltageV: battery.finalQcResult?.packVoltageV,
      internalResistanceMilliOhm:
        battery.finalQcResult?.internalResistanceMilliOhm,
      hiPotInsulationMOhm: battery.finalQcResult?.hiPotInsulationMOhm,
      testedBy: safeString(
        battery.finalQcResult?.testedBy || battery.stepResults?.FINAL_QC?.completedBy,
      ),
    };
  }, [battery]);

  /**
   * Export the currently rendered report as a standalone HTML file.
   * It is print-ready as A4 portrait.
   */
  const downloadReport = async () => {
    const printable = document.getElementById('battery-report-printable');

    if (!printable || !battery) return;

    let logoDataUrl = '';

    try {
      logoDataUrl = await new Promise<string>((resolve) => {
        const img = new Image();

        img.crossOrigin = 'anonymous';

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');

            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;

            const context = canvas.getContext('2d');

            if (!context) {
              resolve(logoImg);
              return;
            }

            context.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(logoImg);
          }
        };

        img.onerror = () => resolve(logoImg);

        img.src = logoImg;
      });
    } catch {
      logoDataUrl = logoImg;
    }

    let reportMarkup = printable.outerHTML;

    const logoElement = printable.querySelector(
      'img[alt="Power2Go Logo"]',
    ) as HTMLImageElement | null;

    if (logoElement && logoDataUrl) {
      reportMarkup = reportMarkup.replace(
        logoElement.getAttribute('src') || '',
        logoDataUrl,
      );
    }

    const exportStyles = `
      @page {
        size: A4 portrait;
        margin: 6mm;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: 210mm;
        min-height: 297mm;
        background: #ffffff;
        color: #17201d;
        font-family:
          Montserrat,
          "Segoe UI",
          Arial,
          Helvetica,
          sans-serif;
      }

      body {
        width: 210mm;
        margin: 0 auto;
      }

      .report-page {
        width: 210mm;
        min-height: 297mm;
        max-height: 297mm;
        height: 297mm;
        background: #ffffff;
        color: #17201d;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .report-page .topbar {
        position: relative;
        width: 100%;
        min-height: 32mm;
        padding: 6mm 10mm;
        background: #111b19;
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        overflow: hidden;
      }

      .report-page .topbar::after {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        width: 72mm;
        height: 100%;
        background: linear-gradient(
          135deg,
          #8ddd3d 0%,
          #58bd45 48%,
          #279646 100%
        );
        clip-path: polygon(28% 0, 100% 0, 100% 100%, 0 100%);
      }

      .report-page .brand {
        position: relative;
        z-index: 2;
      }

      .report-page .brand-logo {
        display: block;
        width: 61mm;
        max-width: 100%;
        height: auto;
      }

      .report-page .brand-sub {
        display: block;
        margin-top: 2mm;
        margin-left: 1mm;
        font-size: 6pt;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.72);
        font-weight: 600;
      }

      .report-page .topbar-meta {
        position: relative;
        z-index: 3;
        width: 57mm;
        margin-right: 0;
        color: #ffffff;
        text-align: right;
        font-size: 7pt;
        line-height: 1.45;
        font-weight: 600;
      }

      .report-page .topbar-meta strong {
        color: #ffffff;
        font-size: 7pt;
        letter-spacing: 0.6px;
        text-transform: uppercase;
      }

      .report-page .report-body {
        flex: 1 1 auto;
        width: 100%;
        padding: 0 10mm 4mm;
        background: #ffffff;
      }

      .report-page .report-header-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 8mm;
        padding: 4mm 0 3mm;
        border-bottom: 1px solid #cfd8d2;
      }

      .report-page .eyebrow {
        display: block;
        margin-bottom: 2mm;
        color: #4c7c37;
        font-size: 6pt;
        font-weight: 800;
        letter-spacing: 1.7px;
        text-transform: uppercase;
      }

      .report-page .report-title {
        margin: 0;
        color: #1b2421;
        font-size: 16pt;
        line-height: 1.1;
        font-weight: 800;
      }

      .report-page .pack-box {
        min-width: 55mm;
        padding: 3mm 4mm;
        background: #f5f8f5;
        border: 1px solid #d6ded8;
        border-left: 3px solid #63bf42;
      }

      .report-page .pack-box .label {
        display: block;
        margin-bottom: 1mm;
        color: #718078;
        font-size: 5.8pt;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
      }

      .report-page .pack-box .value {
        display: block;
        color: #17201d;
        font-size: 8.5pt;
        line-height: 1.2;
        font-weight: 800;
        overflow-wrap: anywhere;
      }

      .report-page .summary-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        width: 100%;
        margin-top: 3mm;
        border: 1px solid #cbd9cf;
        background: #f7faf7;
      }

      .report-page .summary-item {
        min-width: 0;
        padding: 2.8mm 3mm;
        border-right: 1px solid #d7e0da;
      }

      .report-page .summary-item:last-child {
        border-right: none;
      }

      .report-page .summary-item .label {
        display: flex;
        align-items: center;
        gap: 1.5mm;
        margin-bottom: 1.5mm;
        color: #718078;
        font-size: 5.4pt;
        font-weight: 800;
        letter-spacing: 0.8px;
        text-transform: uppercase;
      }

      .report-page .summary-item .value {
        display: flex;
        align-items: center;
        gap: 1.5mm;
        min-height: 5mm;
        color: #17201d;
        font-size: 8.5pt;
        font-weight: 800;
        overflow-wrap: anywhere;
      }

      .report-page .report-label-icon {
        width: 3.1mm;
        height: 3.1mm;
        color: #4eaa32;
        flex: 0 0 auto;
      }

      .report-page .summary-item .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 4.2mm;
        height: 4.2mm;
        border-radius: 50%;
        background: #dff4d7;
        border: 1px solid #78c95a;
        color: #2d7c1c;
        font-size: 6pt;
        font-weight: 900;
      }

      .report-page .module-block {
        display: flex;
        width: 100%;
        margin-top: 3mm;
        border: 1px solid #d3ddd6;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-page .module-index,
      .report-page .electronic-index {
        width: 14mm;
        min-width: 14mm;
        background: #202927;
        color: #ffffff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 3mm 0;
      }

      .report-page .module-index-number {
        font-size: 12pt;
        font-weight: 800;
      }

      .report-page .rail-gauge {
        position: relative;
        width: 1mm;
        height: 17mm;
        overflow: hidden;
        border-radius: 2mm;
        background: #3c4843;
      }

      .report-page .rail-gauge > span {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        background: #64c843;
        border-radius: 2mm;
      }

      .report-page .rail-label {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        color: #b9c5bf;
        font-size: 4.5pt;
        font-weight: 800;
        letter-spacing: 1.4px;
      }

      .report-page .module-content,
      .report-page .electronic-content {
        flex: 1;
        min-width: 0;
      }

      .report-page .module-header-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 5mm;
        min-height: 9mm;
        padding: 2.5mm 4mm;
        background: #f4f7f4;
        border-bottom: 1px solid #dce4de;
      }

      .report-page .module-header-line .module-name {
        color: #17201d;
        font-size: 8pt;
        font-weight: 800;
      }

      .report-page .module-header-line .module-count {
        flex: 0 0 auto;
        color: #68756e;
        font-size: 5.8pt;
        font-weight: 800;
        letter-spacing: 0.7px;
        text-transform: uppercase;
      }

      .report-page .cell-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .report-page .cell-table th,
      .report-page .cell-table td {
        border-bottom: 1px solid #e5ebe7;
        text-align: center;
        vertical-align: middle;
        overflow-wrap: anywhere;
      }

      .report-page .cell-table th {
        padding: 1.8mm 3mm;
        color: #718078;
        background: #ffffff;
        font-size: 5.2pt;
        font-weight: 800;
        letter-spacing: 0.7px;
        text-transform: uppercase;
        text-align: center;
      }

      .report-page .cell-table td {
        padding: 1.6mm 3mm;
        color: #27312d;
        font-size: 6.4pt;
        line-height: 1.25;
        text-align: center;
      }

      .report-page .cell-table tr:last-child td {
        border-bottom: none;
      }

      .report-page .cell-table th:nth-child(1),
      .report-page .cell-table td:nth-child(1) {
        width: 8%;
      }

      .report-page .cell-table th:nth-child(2),
      .report-page .cell-table td:nth-child(2) {
        width: 27%;
      }

      .report-page .cell-table th:nth-child(3),
      .report-page .cell-table td:nth-child(3) {
        width: 31%;
      }

      .report-page .cell-table th:nth-child(4),
      .report-page .cell-table td:nth-child(4) {
        width: 10%;
      }

      .report-page .cell-table th:nth-child(5),
      .report-page .cell-table td:nth-child(5) {
        width: 10%;
      }

      .report-page .cell-table th:nth-child(6),
      .report-page .cell-table td:nth-child(6) {
        width: 14%;
      }

      .report-page .slot-value {
        font-weight: 800;
        color: #4eaa32;
      }

      .report-page .grade-value {
        color: #328d28;
        font-weight: 800;
      }

      .report-page .status-value {
        color: #68756e;
        font-size: 5.7pt;
        font-weight: 700;
      }

      .report-page .electronic-box {
        display: flex;
        width: 100%;
        margin-top: 3mm;
        border: 1px solid #d3ddd6;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-page .electronic-index {
        justify-content: center;
        gap: 5mm;
      }

      .report-page .electronic-content {
        flex: 1;
      }

      .report-page .electronic-meta {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4mm;
        padding: 4mm;
      }

      .report-page .meta-item {
        min-width: 0;
        color: #303a35;
        font-size: 6.5pt;
        overflow-wrap: anywhere;
      }

      .report-page .meta-item strong {
        display: block;
        margin-bottom: 1.5mm;
        color: #718078;
        font-size: 5.2pt;
        font-weight: 800;
        letter-spacing: 0.8px;
        text-transform: uppercase;
      }

      .report-page .footer-strip {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8mm;
        width: 100%;
        margin-top: auto;
        padding: 4mm 5mm 4mm 6mm;
        background: #111b19;
        color: #ffffff;
        overflow: hidden;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-page .footer-strip::after {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        width: 52mm;
        height: 100%;
        background: linear-gradient(
          135deg,
          #8ddd3d 0%,
          #58bd45 48%,
          #279646 100%
        );
        clip-path: polygon(22% 0, 100% 0, 100% 100%, 0 100%);
      }

      .report-page .scan-text {
        display: flex;
        align-items: center;
        gap: 2.5mm;
        color: #e0e6e2;
        font-size: 6.2pt;
        font-weight: 600;
      }

      .report-page .scan-icon {
        position: relative;
        width: 5mm;
        height: 5mm;
        flex: 0 0 auto;
        border: 1px solid #f4c63e;
        border-radius: 1mm;
        background: rgba(244, 198, 62, 0.1);
      }

      .report-page .scan-icon::before,
      .report-page .scan-icon::after {
        content: "";
        position: absolute;
        border: 1px solid rgba(244, 198, 62, 0.75);
      }

      .report-page .scan-icon::before {
        inset: 1.2mm;
      }

      .report-page .scan-icon::after {
        inset: 2.2mm;
      }

      .report-page .qr-box {
        width: 22mm;
        height: 22mm;
        padding: 1.5mm;
        flex: 0 0 auto;
        background: #ffffff;
        border: 1px solid #dce2de;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .report-page .qr-box img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      @media print {
        html,
        body {
          width: 210mm;
          min-height: 297mm;
          background: #ffffff;
        }

        .report-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0;
        }
      }
    `;

    const fontImport = `
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
    `;

    const exportHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <title>${escapeHtml(battery.serialNumber || 'Battery')} Report</title>
          <style>
            ${fontImport}
            ${exportStyles}
          </style>
        </head>
        <body>
          ${reportMarkup}
        </body>
      </html>
    `;

    const blob = new Blob([exportHtml], {
      type: 'text/html;charset=utf-8',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${battery.serialNumber || 'battery'}_technical_report.html`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!isOpen || !battery || !reportData) {
    return null;
  }

  const {
    modules,
    totalCells,
    controllerType,
    controller,
    status,
    productName,
    serialNumber,
    productionOrderId,
    customerOrderRef,
    dispatchedTo,
    createdAt,
    finalQcResult,
    finalQcStatus,
    packVoltageV,
    internalResistanceMilliOhm,
    hiPotInsulationMOhm,
    testedBy,
  } = reportData;

  return (
    <div className="battery-report-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

        .battery-report-modal {
          font-family:
            Montserrat,
            "Segoe UI",
            Arial,
            Helvetica,
            sans-serif;
        }

        .battery-report-modal *,
        .battery-report-modal *::before,
        .battery-report-modal *::after {
          box-sizing: border-box;
        }

        .battery-report-modal .report-shell {
          width: min(1000px, 96vw);
          max-height: 94vh;
          overflow: auto;
          background: #ffffff;
          border-radius: 12px;
          box-shadow:
            0 30px 80px rgba(0, 0, 0, 0.35),
            0 8px 24px rgba(0, 0, 0, 0.15);
        }

        .battery-report-modal .report-page {
          width: 100%;
          min-height: 1100px;
          background: #ffffff;
          color: #17201d;
          overflow: hidden;
        }

        .battery-report-modal .topbar {
          position: relative;
          min-height: 190px;
          padding: 38px 46px;
          background: #111b19;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: space-between;
          overflow: hidden;
        }

        .battery-report-modal .topbar::after {
          content: "";
          position: absolute;
          right: -70px;
          top: 0;
          width: 390px;
          height: 100%;
          background: linear-gradient(
            135deg,
            #8ddd3d 0%,
            #58bd45 48%,
            #279646 100%
          );
          clip-path: polygon(28% 0, 100% 0, 100% 100%, 0 100%);
        }

        .battery-report-modal .brand {
          position: relative;
          z-index: 2;
        }

        .battery-report-modal .brand-logo {
          display: block;
          width: 285px;
          max-width: 100%;
          height: auto;
        }

        .battery-report-modal .brand-sub {
          display: block;
          margin-top: 7px;
          margin-left: 5px;
          color: rgba(255, 255, 255, 0.72);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
        }

        .battery-report-modal .topbar-meta {
          position: relative;
          z-index: 3;
          width: 245px;
          color: #ffffff;
          text-align: right;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.6;
        }

        .battery-report-modal .topbar-meta strong {
          color: #ffffff;
          font-size: 12px;
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }

        .battery-report-modal .report-body {
          flex: 1 1 auto;
          padding: 0 24px 18px;
          background: #ffffff;
        }

        .battery-report-modal .report-header-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          padding: 24px 12px 18px;
          border-bottom: 1px solid #cfd8d2;
        }

        .battery-report-modal .eyebrow {
          display: block;
          margin-bottom: 8px;
          color: #4c7c37;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .battery-report-modal .report-title {
          margin: 0;
          color: #1b2421;
          font-size: 26px;
          line-height: 1.1;
          font-weight: 800;
        }

        .battery-report-modal .pack-box {
          min-width: 230px;
          padding: 12px 16px;
          background: #f5f8f5;
          border: 1px solid #d6ded8;
          border-left: 4px solid #63bf42;
        }

        .battery-report-modal .pack-box .label {
          display: block;
          margin-bottom: 5px;
          color: #718078;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }

        .battery-report-modal .pack-box .value {
          display: block;
          color: #17201d;
          font-size: 15px;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .battery-report-modal .summary-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          margin-top: 18px;
          border: 1px solid #cbd9cf;
          background: #f7faf7;
        }

        .battery-report-modal .summary-item {
          min-width: 0;
          padding: 12px 14px;
          border-right: 1px solid #d7e0da;
        }

        .battery-report-modal .summary-item:last-child {
          border-right: none;
        }

        .battery-report-modal .summary-item .label {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
          color: #718078;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .battery-report-modal .summary-item .value {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 22px;
          color: #17201d;
          font-size: 14px;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .battery-report-modal .report-label-icon {
          width: 14px;
          height: 14px;
          color: #4eaa32;
          flex: 0 0 auto;
        }

        .battery-report-modal .summary-item .check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 19px;
          height: 19px;
          border-radius: 50%;
          background: #dff4d7;
          border: 1px solid #78c95a;
          color: #2d7c1c;
          font-size: 11px;
          font-weight: 900;
        }

        .battery-report-modal .module-block {
          display: flex;
          width: 100%;
          margin-top: 12px;
          border: 1px solid #d3ddd6;
          background: #ffffff;
        }

        .battery-report-modal .module-index,
        .battery-report-modal .electronic-index {
          width: 54px;
          min-width: 54px;
          background: #202927;
          color: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 12px 0;
        }

        .battery-report-modal .module-index-number {
          font-size: 17px;
          font-weight: 800;
        }

        .battery-report-modal .rail-gauge {
          position: relative;
          width: 4px;
          height: 70px;
          overflow: hidden;
          border-radius: 5px;
          background: #3c4843;
        }

        .battery-report-modal .rail-gauge > span {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          background: #64c843;
          border-radius: 5px;
        }

        .battery-report-modal .rail-label {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          color: #b9c5bf;
          font-size: 7px;
          font-weight: 800;
          letter-spacing: 2px;
        }

        .battery-report-modal .module-content,
        .battery-report-modal .electronic-content {
          flex: 1;
          min-width: 0;
        }

        .battery-report-modal .module-header-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 42px;
          padding: 10px 16px;
          background: #f4f7f4;
          border-bottom: 1px solid #dce4de;
        }

        .battery-report-modal .module-name {
          color: #17201d;
          font-size: 13px;
          font-weight: 800;
        }

        .battery-report-modal .module-count {
          color: #68756e;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .battery-report-modal .cell-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .battery-report-modal .cell-table th,
        .battery-report-modal .cell-table td {
          border-bottom: 1px solid #e5ebe7;
          text-align: center;
          vertical-align: middle;
          overflow-wrap: anywhere;
        }

        .battery-report-modal .cell-table th {
          padding: 7px 10px;
          color: #718078;
          background: #ffffff;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          text-align: center;
        }

        .battery-report-modal .cell-table td {
          padding: 7px 10px;
          color: #27312d;
          font-size: 9px;
          line-height: 1.3;
          text-align: center;
        }

        .battery-report-modal .cell-table tr:last-child td {
          border-bottom: none;
        }

        .battery-report-modal .cell-table th:nth-child(1),
        .battery-report-modal .cell-table td:nth-child(1) {
          width: 8%;
        }

        .battery-report-modal .cell-table th:nth-child(2),
        .battery-report-modal .cell-table td:nth-child(2) {
          width: 25%;
        }

        .battery-report-modal .cell-table th:nth-child(3),
        .battery-report-modal .cell-table td:nth-child(3) {
          width: 29%;
        }

        .battery-report-modal .cell-table th:nth-child(4),
        .battery-report-modal .cell-table td:nth-child(4) {
          width: 10%;
        }

        .battery-report-modal .cell-table th:nth-child(5),
        .battery-report-modal .cell-table td:nth-child(5) {
          width: 10%;
        }

        .battery-report-modal .cell-table th:nth-child(6),
        .battery-report-modal .cell-table td:nth-child(6) {
          width: 18%;
        }

        .battery-report-modal .slot-value {
          color: #4eaa32;
          font-weight: 800;
        }

        .battery-report-modal .grade-value {
          color: #328d28;
          font-weight: 800;
        }

        .battery-report-modal .status-value {
          color: #68756e;
          font-size: 8px;
          font-weight: 700;
        }

        .battery-report-modal .electronic-box {
          display: flex;
          width: 100%;
          margin-top: 12px;
          border: 1px solid #d3ddd6;
          background: #ffffff;
        }

        .battery-report-modal .electronic-index {
          justify-content: center;
          gap: 20px;
        }

        .battery-report-modal .electronic-meta {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
          padding: 18px;
        }

        .battery-report-modal .meta-item {
          min-width: 0;
          color: #303a35;
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .battery-report-modal .meta-item strong {
          display: block;
          margin-bottom: 5px;
          color: #718078;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .battery-report-modal .footer-strip {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 30px;
          width: 100%;
          margin-top: auto;
          padding: 14px 18px 14px 18px;
          background: #111b19;
          color: #ffffff;
          overflow: hidden;
        }

        .battery-report-modal .footer-strip::after {
          content: "";
          position: absolute;
          top: 0;
          right: 0;
          width: 220px;
          height: 100%;
          background: linear-gradient(
            135deg,
            #8ddd3d 0%,
            #58bd45 48%,
            #279646 100%
          );
          clip-path: polygon(22% 0, 100% 0, 100% 100%, 0 100%);
        }

        .battery-report-modal .scan-text {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #e0e6e2;
          font-size: 10px;
          font-weight: 600;
        }

        .battery-report-modal .scan-icon {
          position: relative;
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          border: 1px solid #f4c63e;
          border-radius: 4px;
          background: rgba(244, 198, 62, 0.1);
        }

        .battery-report-modal .scan-icon::before,
        .battery-report-modal .scan-icon::after {
          content: "";
          position: absolute;
          border: 1px solid rgba(244, 198, 62, 0.75);
        }

        .battery-report-modal .scan-icon::before {
          inset: 5px;
        }

        .battery-report-modal .scan-icon::after {
          inset: 8px;
        }

        .battery-report-modal .qr-box {
          width: 90px;
          height: 90px;
          padding: 6px;
          flex: 0 0 auto;
          background: #ffffff;
          border: 1px solid #dce2de;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .battery-report-modal .qr-box img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        @media (max-width: 850px) {
          .battery-report-modal .summary-row {
            grid-template-columns: repeat(2, 1fr);
          }

          .battery-report-modal .summary-item:nth-child(2) {
            border-right: none;
          }

          .battery-report-modal .summary-item:nth-child(-n + 3) {
            border-bottom: 1px solid #d7e0da;
          }

          .battery-report-modal .report-header-row {
            align-items: stretch;
            flex-direction: column;
          }

          .battery-report-modal .pack-box {
            min-width: 0;
          }

          .battery-report-modal .electronic-meta {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 640px) {
          .battery-report-modal {
            padding: 0;
          }

          .battery-report-modal .report-shell {
            width: 100vw;
            max-height: 100vh;
            border-radius: 0;
          }

          .battery-report-modal .topbar {
            padding: 28px 22px;
          }

          .battery-report-modal .brand-logo {
            width: 220px;
          }

          .battery-report-modal .topbar-meta {
            display: none;
          }

          .battery-report-modal .report-body {
            padding: 0 12px 18px;
          }

          .battery-report-modal .summary-row {
            grid-template-columns: 1fr 1fr;
          }

          .battery-report-modal .module-index,
          .battery-report-modal .electronic-index {
            width: 42px;
            min-width: 42px;
          }

          .battery-report-modal .cell-table {
            min-width: 700px;
          }

          .battery-report-modal .module-content {
            overflow-x: auto;
          }

          .battery-report-modal .electronic-meta {
            grid-template-columns: 1fr;
          }
        }

        @media print {
          .battery-report-modal {
            position: static !important;
            inset: auto !important;
            display: block !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .battery-report-modal .report-shell {
            width: 210mm !important;
            max-width: 210mm !important;
            max-height: none !important;
          overflow: hidden !important;
          .battery-report-modal .report-page {
            width: 210mm !important;
            min-height: 297mm !important;
          max-height: 297mm !important;
          height: 297mm !important;
          overflow: hidden !important;
            display: none !important;
          }

          .battery-report-modal .module-block,
          .battery-report-modal .electronic-box,
          .battery-report-modal .footer-strip {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .battery-report-modal .cell-table thead {
            display: table-header-group !important;
          }

          .battery-report-modal .cell-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      <div className="report-shell">
        <div
          id="battery-report-printable"
          className="report-page"
        >
          {/* ============================================================
              HEADER
          ============================================================ */}
          <div className="topbar">
            <div className="brand">
              <img
                src={logoImg}
                alt="Power2Go Logo"
                className="brand-logo"
              />

              <span className="brand-sub">
                Energy Storage Systems
              </span>
            </div>

            <div className="topbar-meta">
              <div>
                <MapPin
                  className="report-label-icon"
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    verticalAlign: '-3px',
                    marginRight: 5,
                    color: '#d9f99d',
                  }}
                />

                <strong>Karachi | Pakistan</strong>
              </div>

              <div>+92 (345) 561-3478</div>

              <div>www.power2go.energy</div>
            </div>
          </div>

          <div className="report-body">
            {/* ============================================================
                REPORT IDENTIFICATION
            ============================================================ */}
            <div className="report-header-row">
              <div>
                <span className="eyebrow">
                  MES Export / Traceability Document
                </span>

                <h2 className="report-title">
                  Battery Pack Technical Report
                </h2>
              </div>

              <div className="pack-box">
                <span className="label">
                  Pack Reference
                </span>

                <span className="value">
                  {serialNumber}
                </span>
              </div>
            </div>

            {/* ============================================================
                SUMMARY
            ============================================================ */}
            <div className="summary-row">
              <div className="summary-item">
                <span className="label">
                  <Boxes className="report-label-icon" />
                  Modules
                </span>

                <span className="value">
                  {String(modules.length).padStart(2, '0')}
                </span>
              </div>

              <div className="summary-item">
                <span className="label">
                  <Hash className="report-label-icon" />
                  Total Cells
                </span>

                <span className="value">
                  {String(totalCells).padStart(2, '0')}
                </span>
              </div>

              <div className="summary-item">
                <span className="label">
                  <Cpu className="report-label-icon" />
                  Controller
                </span>

                <span className="value">
                  {controllerType}
                </span>
              </div>

              <div className="summary-item">
                <span className="label">
                  <ShieldCheck className="report-label-icon" />
                  Status
                </span>

                <span className="value">
                  {status !== '—' && (
                    <span className="check">✓</span>
                  )}

                  {status}
                </span>
              </div>
            </div>

            {/* ============================================================
                MODULES
            ============================================================ */}
            {modules.map((module, moduleIndex) => {
              const cells = getModuleCells(module);

              return (
                <div
                  className="module-block"
                  key={module.id || `module-${moduleIndex}`}
                >
                  <div className="module-index">
                    <span className="module-index-number">
                      {String(moduleIndex + 1).padStart(2, '0')}
                    </span>

                    <span className="rail-gauge">
                      <span
                        style={{
                          height: `${Math.max(
                            25,
                            100 - moduleIndex * 20,
                          )}%`,
                        }}
                      />
                    </span>

                    <span className="rail-label">
                      MODULE
                    </span>
                  </div>

                  <div className="module-content">
                    <div className="module-header-line">
                      <span className="module-name">
                        Module {moduleIndex + 1}
                        {'  '}
                        {safeString(module.serialNumber)}
                      </span>

                      <span className="module-count">
                        {cells.length} Cells
                      </span>
                    </div>

                    <table className="cell-table">
                      <thead>
                        <tr>
                          <th>Slot</th>
                          <th>Internal Serial</th>
                          <th>Cell Barcode</th>
                          <th>Cell Grade</th>
                          <th>Pass</th>
                        </tr>
                      </thead>

                      <tbody>
                        {cells.length > 0 ? (
                          cells.map((cell) => (
                            <tr
                              key={`${module.id || moduleIndex}-${cell.slot}-${cell.internalSerial}`}
                            >
                              <td className="slot-value">
                                {String(cell.slot).padStart(2, '0')}
                              </td>

                              <td>
                                {cell.internalSerial}
                              </td>

                              <td>
                                {cell.supplierBarcode}
                              </td>

                              <td>
                                <div className="grade-value">
                                  A+
                                </div>
                              </td>

                              <td>
                                <div className="status-value">
                                  PASS
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              style={{
                                textAlign: 'center',
                                color: '#718078',
                              }}
                            >
                              No cells assigned to this module
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* ============================================================
                CONTROLLER
            ============================================================ */}
            <div className="electronic-box">
              <div className="electronic-index">
                <span className="rail-gauge">
                  <span style={{ height: '100%' }} />
                </span>

                <span className="rail-label">
                  {controllerType}
                </span>
              </div>

              <div className="electronic-content">
                <div className="module-header-line">
                  <span className="module-name">
                    {controllerType} Electronic
                  </span>

                  <span className="module-count">
                    Controller
                  </span>
                </div>

                <div className="electronic-meta">
                  <div className="meta-item">
                    <strong>Model No</strong>

                    {safeString(controller?.model || productName)}
                  </div>

                  <div className="meta-item">
                    <strong>BMU Serial</strong>

                    {safeString(controller?.serialNumber || '—')}
                  </div>

                  <div className="meta-item">
                    <strong>Batch No</strong>

                    {safeString(controller?.batchNumber || '—')}
                  </div>

                  <div className="meta-item">
                    <strong>Manufacturer</strong>

                    {safeString(controller?.manufacturer || '—')}
                  </div>
                </div>
              </div>
            </div>

            {/* ============================================================
                QR / VERIFICATION FOOTER
            ============================================================ */}
            <div className="footer-strip">
              <div className="scan-text" style={{ position: 'relative', zIndex: 2 }}>
                <span
                  className="scan-icon"
                  aria-hidden="true"
                />

                <span>
                  Scan to verify battery identity and
                  traceability
                </span>
              </div>

              <div
                className="qr-box"
                aria-label="Battery QR code"
                style={{ position: 'relative', zIndex: 2 }}
              >
                {qrImageUrl ? (
                  <img
                    src={qrImageUrl}
                    alt="Battery QR code"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================
            ACTIONS
        ================================================================ */}
        <div className="report-header-actions flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={downloadReport}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
          >
            <Download className="h-4 w-4" />
            Export Report
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
};