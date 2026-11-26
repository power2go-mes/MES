import { jsPDF } from 'jspdf';
import logoAsset from '../assets/power2go-logo.png';
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

const BODY_FONT_SIZE = 9;
const SECTION_FONT_SIZE = 11;
const TEXT_COLOR: [number, number, number] = [31, 41, 55];
const MUTED_COLOR: [number, number, number] = [75, 85, 99];
const RULE_COLOR: [number, number, number] = [203, 213, 225];

async function loadMonochromeLogo(): Promise<string> {
  const response = await fetch(logoAsset);
  if (!response.ok) {
    throw new Error('The Power2Go logo could not be loaded for the handover slip.');
  }

  const image = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) {
    image.close();
    throw new Error('The Power2Go logo could not be prepared for the handover slip.');
  }

  context.drawImage(image, 0, 0);
  image.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(
      pixels.data[index] * 0.2126 +
      pixels.data[index + 1] * 0.7152 +
      pixels.data[index + 2] * 0.0722
    );
    pixels.data[index] = gray;
    pixels.data[index + 1] = gray;
    pixels.data[index + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

function drawSectionHeading(doc: jsPDF, title: string, x: number, right: number, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_FONT_SIZE);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(title, x, y);
  doc.setDrawColor(...RULE_COLOR);
  doc.setLineWidth(0.25);
  doc.line(x, y + 2, right, y + 2);
  return y + 8;
}

function drawInfoRows(
  doc: jsPDF,
  rows: Array<{ label: string; value: string }>,
  x: number,
  valueX: number,
  right: number,
  startY: number
): number {
  let y = startY;
  const valueWidth = right - valueX;

  for (const row of rows) {
    const value = row.value.trim() || '—';
    const lines = doc.splitTextToSize(value, valueWidth);
    const rowHeight = Math.max(9, lines.length * 4.4 + 3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(...MUTED_COLOR);
    doc.text(row.label, x, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(...TEXT_COLOR);
    doc.text(lines, valueX, y + 5);

    y += rowHeight;
    doc.setDrawColor(...RULE_COLOR);
    doc.setLineWidth(0.2);
    doc.line(x, y, right, y);
  }

  return y;
}

export async function generateHandoverSlipPdf(data: HandoverSlipData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const right = pageWidth - margin;
  const contentWidth = right - margin;
  const logoData = await loadMonochromeLogo();
  const logoProperties = doc.getImageProperties(logoData);
  const logoWidth = 47;
  const logoHeight = logoWidth * (logoProperties.height / logoProperties.width);
  const slipId = data.slipNumber || `HO-${Date.now().toString().slice(-6)}`;
  const rawDate = data.issuedAt ? new Date(data.issuedAt) : new Date();
  const dateStr = Number.isNaN(rawDate.getTime()) ? 'Not specified' : rawDate.toLocaleString();
  const valueX = margin + 59;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  doc.addImage(logoData, 'PNG', margin, 12, logoWidth, logoHeight, undefined, 'FAST');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(...MUTED_COLOR);
  const metadata = [
    ['Slip No:', slipId],
    ['Date & Time:', dateStr],
  ];
  metadata.forEach(([label, value], index) => {
    const lineY = 13 + index * 5;
    doc.text(label, pageWidth - margin - 66, lineY);
    doc.setFont('helvetica', 'bold');
    doc.text(value, right, lineY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(...TEXT_COLOR);
  doc.text('POWER2GO ENERGY SYSTEM', margin, 28);
  doc.setFontSize(15);
  doc.text('MATERIAL / COMPONENT HANDOVER SLIP', margin, 38);

  doc.setDrawColor(...RULE_COLOR);
  doc.setLineWidth(0.35);
  doc.line(margin, 44, right, 44);

  let y = drawSectionHeading(doc, '1. HARDWARE / COMPONENT IDENTIFICATION', margin, right, 54);
  y = drawInfoRows(
    doc,
    [
      { label: 'Hardware Type:', value: `${data.entityType} MODULE / UNIT` },
      { label: 'Internal Serial Number:', value: data.serialNumber },
      { label: 'Physical / Supplier Barcode:', value: data.barcode || 'N/A (Identical to Serial)' },
      { label: 'Dispatch Purpose / Notes:', value: data.notes || 'Internal Issuance for R&D / Testing / Assembly' },
    ],
    margin + 3,
    valueX,
    right - 3,
    y
  );

  y = drawSectionHeading(doc, '2. CUSTODY & RECIPIENT INFORMATION', margin, right, y + 8);
  y = drawInfoRows(
    doc,
    [
      { label: 'Issued To (Recipient):', value: data.issuedToPerson },
      { label: 'Assigned Department:', value: data.issuedToDepartment || 'Unspecified / Operations' },
      { label: 'Authorized By (Issuer):', value: data.issuedBy },
    ],
    margin + 3,
    valueX,
    right - 3,
    y
  );

  y = drawSectionHeading(doc, 'CUSTODY RESPONSIBILITY NOTICE', margin, right, y + 8);
  const termsText =
    'By signing below, the receiver acknowledges safe physical receipt and custody of the listed hardware. ' +
    'The receiver agrees to exercise proper handling protocols (ESD protection, cell voltage/short-circuit safety). ' +
    'After signing, this physical slip must be photographed or scanned and uploaded into the MES system to complete issuance.';
  const termsLines = doc.splitTextToSize(termsText, contentWidth - 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(termsLines, margin + 3, y + 1);
  y += termsLines.length * 4.4 + 7;

  y = drawSectionHeading(doc, '3. AUTHORIZED SIGNATURES & VERIFICATION', margin, right, y + 2);
  const columnGap = 8;
  const columnWidth = (contentWidth - columnGap) / 2;
  const signatureTop = y;
  const signatureHeight = 50;
  const signatureColumns = [
    { x: margin, title: 'HANDED OVER BY (ISSUER):', name: data.issuedBy },
    { x: margin + columnWidth + columnGap, title: 'RECEIVED BY (RECIPIENT):', name: data.issuedToPerson },
  ];

  for (const column of signatureColumns) {
    doc.setDrawColor(...RULE_COLOR);
    doc.setLineWidth(0.3);
    doc.rect(column.x, signatureTop, columnWidth, signatureHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(...TEXT_COLOR);
    doc.text(column.title, column.x + 4, signatureTop + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.text(doc.splitTextToSize(`Name: ${column.name}`, columnWidth - 8), column.x + 4, signatureTop + 15);
    doc.text('Date: ____________________', column.x + 4, signatureTop + 24);
    doc.text('Signature:', column.x + 4, signatureTop + 33);
    doc.setDrawColor(...MUTED_COLOR);
    doc.line(column.x + 4, signatureTop + 43, column.x + columnWidth - 4, signatureTop + 43);
  }

  const instruction =
    'Next step: Print this document -> Obtain physical signatures -> Take photo/scan -> Click "Upload Signed Slip" in MES.';
  const instructionLines = doc.splitTextToSize(instruction, contentWidth);
  const instructionY = signatureTop + signatureHeight + 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(instructionLines, margin, instructionY);

  const footerRuleY = pageHeight - 17;
  doc.setDrawColor(...RULE_COLOR);
  doc.setLineWidth(0.25);
  doc.line(margin, footerRuleY, right, footerRuleY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(...MUTED_COLOR);
  doc.text('Power2Go MES Manufacturing Execution System • Hardware Custody Protocol', margin, pageHeight - 10);
  doc.text(`Slip Reference: ${slipId}`, right, pageHeight - 10, { align: 'right' });

  return doc;
}

export async function downloadHandoverSlipPdf(data: HandoverSlipData): Promise<void> {
  const doc = await generateHandoverSlipPdf(data);
  const cleanSerial = data.serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Handover_Slip_${data.entityType}_${cleanSerial}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
