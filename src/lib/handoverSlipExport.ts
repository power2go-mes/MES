import { jsPDF } from 'jspdf';
import { IssueEntityType } from '../types';

export interface HandoverSlipData {
  entityType: IssueEntityType;
  serialNumber: string;
  barcode?: string | null;
  issuedToPerson: string;
  issuedToDepartment?: string | null;
  issuedBy: string;
  issuedAt?: string | null;
  notes?: string | null;
  slipNumber?: string;
}

export function generateHandoverSlipPdf(data: HandoverSlipData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const slipId = data.slipNumber || `HO-${Date.now().toString().slice(-6)}`;
  const dateStr = data.issuedAt ? new Date(data.issuedAt).toLocaleString() : new Date().toLocaleString();

  // Top Accent Bar (Power2Go Emerald)
  doc.setFillColor(16, 185, 129); // #10b981
  doc.rect(0, 0, pageWidth, 5, 'F');

  // Header Box
  let y = 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('POWER2GO ENERGY SYSTEM', margin, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(16, 185, 129);
  doc.text('MATERIAL / COMPONENT HANDOVER SLIP', margin, y + 6);

  // Slip Reference on the right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Slip No: ${slipId}`, pageWidth - margin, y, { align: 'right' });
  doc.text(`Date & Time: ${dateStr}`, pageWidth - margin, y + 5, { align: 'right' });
  doc.text(`Status: PENDING SIGNATURE`, pageWidth - margin, y + 10, { align: 'right' });

  // Divider line
  y += 14;
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  // Section 1: Item Details
  y += 7;
  doc.setFillColor(241, 245, 249); // slate-100
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('1. HARDWARE / COMPONENT IDENTIFICATION', margin + 3, y + 5.5);

  y += 11;
  const drawRow = (label: string, val: string, startY: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(label, margin + 4, startY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(val || '—', margin + 55, startY);
  };

  doc.setDrawColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 34);

  drawRow('Hardware Type:', `${data.entityType} MODULE / UNIT`, y + 6);
  drawRow('Internal Serial Number:', data.serialNumber, y + 13);
  drawRow('Physical / Supplier Barcode:', data.barcode || 'N/A (Identical to Serial)', y + 20);
  drawRow('Dispatch Purpose / Notes:', data.notes || 'Internal Issuance for R&D / Testing / Assembly', y + 27);

  // Section 2: Custody Transfer
  y += 40;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('2. CUSTODY & RECIPIENT INFORMATION', margin + 3, y + 5.5);

  y += 11;
  doc.rect(margin, y, contentWidth, 27);
  drawRow('Issued To (Recipient):', data.issuedToPerson, y + 6);
  drawRow('Assigned Department:', data.issuedToDepartment || 'Unspecified / Operations', y + 13);
  drawRow('Authorized By (Issuer):', data.issuedBy, y + 20);

  // Section 3: Terms & Responsibility Notice
  y += 33;
  doc.setFillColor(254, 243, 199); // amber-100
  doc.setDrawColor(251, 191, 36); // amber-400
  doc.roundedRect(margin, y, contentWidth, 22, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(146, 64, 14); // amber-800
  doc.text('CUSTODY RESPONSIBILITY NOTICE:', margin + 4, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(180, 83, 9);
  const termsText =
    'By signing below, the receiver acknowledges safe physical receipt and custody of the listed hardware. ' +
    'The receiver agrees to exercise proper handling protocols (ESD protection, cell voltage/short-circuit safety). ' +
    'After signing, this physical slip must be photographed or scanned and uploaded into the MES system to complete issuance.';
  const splitTerms = doc.splitTextToSize(termsText, contentWidth - 8);
  doc.text(splitTerms, margin + 4, y + 10);

  // Section 4: Dual Signatures Box
  y += 28;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('3. AUTHORIZED SIGNATURES & VERIFICATION', margin + 3, y + 5.5);

  y += 12;
  const colWidth = (contentWidth - 6) / 2;

  // Box Left: Handed Over By (Issuer)
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.rect(margin, y, colWidth, 48);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('HANDED OVER BY (ISSUER):', margin + 4, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Name: ${data.issuedBy}`, margin + 4, y + 13);
  doc.text('Date: ________________________', margin + 4, y + 20);
  doc.text('Signature:', margin + 4, y + 28);
  doc.setDrawColor(148, 163, 184);
  doc.line(margin + 4, y + 42, margin + colWidth - 6, y + 42);

  // Box Right: Received By (Recipient)
  const rightX = margin + colWidth + 6;
  doc.rect(rightX, y, colWidth, 48);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('RECEIVED BY (RECIPIENT):', rightX + 4, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Name: ${data.issuedToPerson}`, rightX + 4, y + 13);
  doc.text('Date: ________________________', rightX + 4, y + 20);
  doc.text('Signature:', rightX + 4, y + 28);
  doc.setDrawColor(148, 163, 184);
  doc.line(rightX + 4, y + 42, rightX + colWidth - 6, y + 42);

  // Instructions footer for physical scanning
  y += 54;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Next step: Print this document -> Obtain physical signatures -> Take photo/scan -> Click "Upload Signed Slip" in MES.',
    margin,
    y
  );

  // Bottom footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Power2Go MES Manufacturing Execution System • Hardware Custody Protocol', margin, pageHeight - 6);
  doc.text(`Slip Reference: ${slipId}`, pageWidth - margin, pageHeight - 6, { align: 'right' });

  return doc;
}

export function downloadHandoverSlipPdf(data: HandoverSlipData): void {
  const doc = generateHandoverSlipPdf(data);
  const cleanSerial = data.serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Handover_Slip_${data.entityType}_${cleanSerial}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
