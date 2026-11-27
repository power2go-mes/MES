import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FatFourPageReportData } from '../types/rackFat';

/**
 * Draws crisp mathematical symbols directly via PDF vector commands.
 * This completely avoids jsPDF font encoding artifacts.
 */
function drawMathSymbol(doc: jsPDF, type: 'leq' | 'geq' | 'omega' | 'degree' | 'checkbox_empty' | 'checkbox_checked', x: number, y: number, size = 5.5) {
  doc.saveGraphicsState();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);

  if (type === 'leq') {
    // Less than or equal to: ≤
    doc.line(x + size, y - size, x, y - size / 2);
    doc.line(x, y - size / 2, x + size, y);
    doc.line(x, y + 2, x + size, y + 2);
  } else if (type === 'geq') {
    // Greater than or equal to: ≥
    doc.line(x, y - size, x + size, y - size / 2);
    doc.line(x + size, y - size / 2, x, y);
    doc.line(x, y + 2, x + size, y + 2);
  } else if (type === 'omega') {
    // Greek capital Omega: Ω
    doc.setFont('symbol');
    doc.setFontSize(10);
    doc.text('W', x, y);
  } else if (type === 'degree') {
    // Degree symbol: °
    doc.circle(x, y - 5, 1.2);
  } else if (type === 'checkbox_empty') {
    // Empty square checkbox: ☐
    doc.rect(x, y - 7, 7, 7);
  } else if (type === 'checkbox_checked') {
    // Checked square checkbox: ☑
    doc.rect(x, y - 7, 7, 7);
    doc.line(x + 1.5, y - 3.5, x + 3, y - 1.5);
    doc.line(x + 3, y - 1.5, x + 5.5, y - 5.5);
  }

  doc.restoreGraphicsState();
}

/**
 * Generates an empty printable FAT Test Sheet template for factory floor testing.
 * - Auto-fills ONLY MES system data:
 *   - Customer / Project
 *   - Report No.
 *   - Battery System
 *   - Configuration
 *   - Inverter
 *   - Serial / Cabinet ID
 *   - Inspection Date / Location
 *   - Pack serial numbers in Section 2.3 (e.g. PACK-01 .. PACK-06)
 * - Leaves all Checkboxes UNCHECKED (empty boxes ☐) for technicians to tick by pen.
 * - Leaves all Recorded Values (voltages, current, temperature, cycles, IR) BLANK with clean fill-in lines.
 * - Leaves Overall Result, Remarks, Signatures BLANK.
 */
export function generateBlankFatTemplatePdf(data?: Partial<FatFourPageReportData> | null): jsPDF {
  const blankData: Partial<FatFourPageReportData> = {
    // Customer name MUST be left blank on the printed template for technicians to write
    customerProject: '',
    reportNo: data?.reportNo || '',
    batterySystem: data?.batterySystem || 'Power2Go HV Battery | 45 kWh nominal',
    configuration: data?.configuration || '6 x 7.5 kWh HV packs',
    inverter: data?.inverter || 'Solis 50kW HV 3-Phase Hybrid Inverter',
    cabinetSerial: data?.cabinetSerial || '',
    // Inspection date defaults to provided date (production date) when printing blank report
    inspectionDate: data?.inspectionDate || '',
    location: data?.location || 'Karachi Warehouse',
    // Checkboxes completely empty (neither Pass nor Fail checked)
    checklist: {},
    // Measurements blank
    basicMeasurements: {
      totalBatteryVoltage: undefined,
      packVoltageSpread: undefined,
      insulationResistance: undefined,
      chargeCurrent: undefined,
      dischargeCurrent: undefined,
      peakPackTemperature: undefined,
      solisCommStatus: '',
    },
    cycleMeasurements: {
      cycle1ChargeKw: undefined,
      cycle1DischargeKw: undefined,
      cycle2ChargeKw: undefined,
      cycle2DischargeKw: undefined,
    },
    irSection: {
      meterModel: 'Hioki BT3562 / Calibrated',
      calibrationDue: '2027-01-15',
      socAtTest: undefined,
      packTempAtTest: undefined,
      packs: (data?.irSection?.packs && data.irSection.packs.length > 0)
        ? data.irSection.packs.map(p => ({
            packIndex: p.packIndex,
            packSerial: p.packSerial,
            voltage: undefined,
            internalResistance: undefined,
            result: undefined,
          }))
        : [1, 2, 3, 4, 5, 6].map(i => ({
            packIndex: i,
            packSerial: `PACK-0${i}`,
            voltage: undefined,
            internalResistance: undefined,
            result: undefined,
          })),
      highestPackIr: undefined,
      irSpread: undefined,
    },
    approval: {
      overallResult: undefined,
      remarks: '',
      testedByName: '',
      testedByDate: '',
      reviewedByName: '',
      reviewedByDate: '',
      witnessName: '',
      witnessDate: '',
    },
  };

  return generateFourPageFatPdf(blankData);
}

/**
 * Generates the EXACT Factory Acceptance Test (FAT) 4-Page Report PDF
 * Matching 100% of formatting, dimensions, column widths, line positions, typography and wording
 * from 'FAT - 45kWh (1).pdf'.
 */
export function generateFourPageFatPdf(data?: Partial<FatFourPageReportData> | null): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter', // 612 x 792 pt
  });

  const d = data || {};
  const leftX = 66.5; // Exact left margin in original PDF
  const checklist = d.checklist || {};

  // Extract dynamic capacity and pack count to compute exact spec limit headers and voltage operating range
  // e.g. "Power2Go HV Battery | 45 kWh nominal" or "45 kWh"
  const capacityMatch = (d.batterySystem || '').match(/(\d+(?:\.\d+)?)\s*kWh/i) ||
                        (d.configuration || '').match(/(\d+(?:\.\d+)?)\s*kWh/i);
  const capacityKwh = capacityMatch ? capacityMatch[1] : '45';
  const specLimitHeader = `Spec limit for ${capacityKwh}\nkWh`;

  // Dynamic pack count: from packs list or configuration (e.g. "6 x 7.5 kWh HV packs")
  const configPackMatch = (d.configuration || '').match(/(\d+)\s*x/i);
  const packCount = d.irSection?.packs?.length || (configPackMatch ? parseInt(configPackMatch[1], 10) : 6);

  // Formula requested:
  // min voltage = 2.5 * 24 * number of battery packs
  // max voltage = 3.6 * 24 * number of battery packs
  const minVolts = (2.5 * 24 * packCount).toFixed(1).replace(/\.0$/, '');
  const maxVolts = (3.6 * 24 * packCount).toFixed(1).replace(/\.0$/, '');
  const voltageRangeSpec = `${minVolts} V – ${maxVolts} V`;

  // Standard font
  doc.setFont('helvetica', 'normal');

  // ==========================================
  // PAGE 1
  // ==========================================
  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('Power2Go HV Battery Cabinet – Factory Acceptance Test', leftX, 106);
  doc.text('Report', leftX, 126);

  // Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${capacityKwh} kWh High-Voltage Battery Cabinet | Customer Handover Inspection`, leftX, 155);

  // Table 1: Item / Details
  const specsRows = [
    ['Customer / Project', d.customerProject || ''],
    ['Report No.', d.reportNo || '[FAT-2026-      ]'],
    ['Battery system', d.batterySystem || `Power2Go HV Battery | ${capacityKwh} kWh nominal`],
    ['Configuration', d.configuration || `${packCount} x 7.5 kWh HV packs`],
    ['Inverter', d.inverter || 'Solis 50kW HV 3-Phase Hybrid Inverter'],
    ['Serial / Cabinet ID', d.cabinetSerial || ''],
    ['Inspection date / Location', `${d.inspectionDate ? `[${d.inspectionDate}]` : '[24-11-2026]'} / ${d.location || 'Karachi Warehouse'}`],
  ];

  autoTable(doc, {
    startY: 167.4,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Item', 'Details']],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4.5,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4.5,
    },
    columnStyles: {
      0: { cellWidth: 178, fontStyle: 'normal' },
      1: { cellWidth: 290, fontStyle: 'normal' },
    },
    body: specsRows,
  });

  // 1. Factory Test Checklist Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('1. Factory Test Checklist', leftX, 396);

  // Table 2: Checklist 01 to 05
  // Result cell string is kept empty so no '01', '02' text prints inside cell!
  const checklistPage1 = [
    ['01', 'Physical\ncondition &\nassembly', 'Check cabinet, all  packs, terminals, busbars,\nfasteners, cables and labels for damage or\nloose connections.', ''],
    ['02', 'Pack voltage &\nbalance', 'Measure each pack voltage and total HV stack\nvoltage; confirm readings are within approved\nlimits and balanced.', ''],
    ['03', 'Insulation &\nearthing', 'Verify protective earthing and HV insulation\nresistance using approved safe test\nprocedure.', ''],
    ['04', 'HV polarity &\npre-charge', 'Confirm correct DC polarity, safe pre-charge\noperation and contactor opening/closing.', ''],
    ['05', 'BMU & display', 'Check SOC, voltage, current, temperature,\nalarms and pack data on BMU/HMI.', ''],
  ];

  autoTable(doc, {
    startY: 406.1,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['No.', 'Test', 'What the factory team checks', 'Result']],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'normal' },
      1: { cellWidth: 95, fontStyle: 'normal' },
      2: { cellWidth: 246, fontStyle: 'normal' },
      3: { cellWidth: 91, fontStyle: 'normal' },
    },
    body: checklistPage1,
    didDrawCell: data => {
      if (data.section === 'body' && data.column.index === 3) {
        const id = `0${data.row.index + 1}`;
        const isPass = checklist[id] === 'Pass';
        const isFail = checklist[id] === 'Fail';
        const y = data.cell.y + data.cell.height / 2 + 3;
        const x1 = data.cell.x + 8;

        drawMathSymbol(doc, isPass ? 'checkbox_checked' : 'checkbox_empty', x1, y, 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('Pass', x1 + 10, y - 1);

        const x2 = x1 + 42;
        drawMathSymbol(doc, isFail ? 'checkbox_checked' : 'checkbox_empty', x2, y, 6);
        doc.text('Fail', x2 + 10, y - 1);
      }
    },
  });

  // ==========================================
  // PAGE 2
  // ==========================================
  doc.addPage('letter', 'portrait');

  const checklistPage2 = [
    ['06', 'Inverter\ncommunication', 'Confirm BMU-to-Solis 50kW HV\ncommunication, battery recognition and\ncorrect charge/discharge limits.', ''],
    ['07', 'Charging\nperformance', 'Charge under controlled conditions; record\nvoltage, current, SOC and temperature; verify\nno unexpected trips. Results in  Section 2', ''],
    ['08', 'Discharging\nperformance', 'Discharge at an approved load; verify stable\noutput, SOC tracking and current/temperature\nlimits. Results in Section 2', ''],
    ['09', 'Cycle & usable\ncapacity', 'Complete two controlled charge/discharge\ncycles; record delivered kWh and compare\nwith approved acceptance limits. Results\nrecorded in Section 2.', ''],
    ['10', 'Protection &\nalarms', 'Verify approved over/under-voltage,\nover-current, temperature and\nemergency-stop responses using safe\nsimulations.', ''],
    ['11', 'Final system\noperation', 'Verify stable inverter/battery operation,\nnormal shutdown/restart and absence of\nactive faults.', ''],
  ];

  autoTable(doc, {
    startY: 72.1,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['No.', 'Test', 'What the factory team checks', 'Result']],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'normal' },
      1: { cellWidth: 95, fontStyle: 'normal' },
      2: { cellWidth: 246, fontStyle: 'normal' },
      3: { cellWidth: 91, fontStyle: 'normal' },
    },
    body: checklistPage2,
    didDrawCell: data => {
      if (data.section === 'body' && data.column.index === 3) {
        const itemNum = data.row.index + 6;
        const id = itemNum < 10 ? `0${itemNum}` : `${itemNum}`;
        const isPass = checklist[id] === 'Pass';
        const isFail = checklist[id] === 'Fail';
        const y = data.cell.y + data.cell.height / 2 + 3;
        const x1 = data.cell.x + 8;

        drawMathSymbol(doc, isPass ? 'checkbox_checked' : 'checkbox_empty', x1, y, 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('Pass', x1 + 10, y - 1);

        const x2 = x1 + 42;
        drawMathSymbol(doc, isFail ? 'checkbox_checked' : 'checkbox_empty', x2, y, 6);
        doc.text('Fail', x2 + 10, y - 1);
      }
    },
  });

  // Section 2 Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('2. Key Recorded Results', leftX, 502);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2.1 Basic Measurements', leftX, 532);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(
    'Enter the numeric spec limit for this capacity in the last column before testing, so each\nreading is judged against a number, not a description.',
    leftX,
    554
  );

  const bm = d.basicMeasurements || {};
  const basicMeasurementsP2 = [
    [
      'Total battery voltage',
      bm.totalBatteryVoltage != null ? `${bm.totalBatteryVoltage} V` : '________\nV',
      'Approved HV operating\nrange',
      voltageRangeSpec,
    ],
    [
      'pack voltage spread',
      bm.packVoltageSpread != null ? `${bm.packVoltageSpread} V` : '________\nV',
      'Approved pack balance\nlimit',
      '', // rendered via didDrawCell cleanly
    ],
  ];

  autoTable(doc, {
    startY: 583.4,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Measurement', 'Recorded\nvalue', 'Acceptance / reference', specLimitHeader]],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'normal' },
      1: { cellWidth: 77, fontStyle: 'normal' },
      2: { cellWidth: 150, fontStyle: 'normal' },
      3: { cellWidth: 111, fontStyle: 'normal' },
    },
    body: basicMeasurementsP2,
    didDrawCell: data => {
      if (data.section === 'body' && data.column.index === 3 && data.row.index === 1) {
        // Draw '≤ 0.72 V'
        const x = data.cell.x + 6;
        const y = data.cell.y + data.cell.height / 2 + 4;
        drawMathSymbol(doc, 'leq', x, y - 2, 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text('0.72 V', x + 10, y);
      }
    },
  });

  // ==========================================
  // PAGE 3
  // ==========================================
  doc.addPage('letter', 'portrait');

  const basicMeasurementsP3 = [
    [
      'Insulation resistance',
      '', // custom drawn with exact MΩ
      'Approved HV safety\ncriterion',
      '', // custom drawn with exact ≥ 65 MΩ
    ],
    [
      'Charge / discharge\ncurrent',
      bm.chargeCurrent != null && bm.dischargeCurrent != null
        ? `${bm.chargeCurrent} A /\n${bm.dischargeCurrent} A`
        : '______ A /\n______ A',
      'BMU and inverter permitted\nlimits',
      '', // custom drawn with exact ≤   A / ≤   A
    ],
    [
      'Peak pack temperature',
      '', // custom drawn with exact °C
      'Approved thermal limit',
      '', // custom drawn with exact ≤ 35 °C
    ],
    [
      'Solis 50kW HV\ncommunication /\nalarms',
      bm.solisCommStatus ? bm.solisCommStatus : '________',
      'Stable link / no active faults',
      'Stable link / no\nactive faults',
    ],
  ];

  autoTable(doc, {
    startY: 72.1,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Measurement', 'Recorded\nvalue', 'Acceptance / reference', specLimitHeader]],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'normal' },
      1: { cellWidth: 77, fontStyle: 'normal' },
      2: { cellWidth: 150, fontStyle: 'normal' },
      3: { cellWidth: 111, fontStyle: 'normal' },
    },
    body: basicMeasurementsP3,
    didDrawCell: data => {
      if (data.section !== 'body') return;
      const x = data.cell.x + 6;
      const y = data.cell.y + data.cell.height / 2 + 4;

      // Row 0: Insulation resistance
      if (data.row.index === 0) {
        if (data.column.index === 1) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(0, 0, 0);
          if (bm.insulationResistance != null) {
            doc.text(`${bm.insulationResistance} M`, x, y);
            const w = doc.getTextWidth(`${bm.insulationResistance} M`);
            drawMathSymbol(doc, 'omega', x + w + 1, y);
          } else {
            doc.text('________', x, y - 6);
            doc.text('M', x, y + 8);
            drawMathSymbol(doc, 'omega', x + 11, y + 8);
          }
        } else if (data.column.index === 3) {
          drawMathSymbol(doc, 'geq', x, y - 2, 5.5);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(0, 0, 0);
          doc.text('65 M', x + 10, y);
          drawMathSymbol(doc, 'omega', x + 38, y);
        }
      }

      // Row 1: Charge/discharge limits: '≤   A / ≤   A'
      if (data.row.index === 1 && data.column.index === 3) {
        drawMathSymbol(doc, 'leq', x, y - 2, 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text('   A /', x + 9, y);
        drawMathSymbol(doc, 'leq', x + 38, y - 2, 5.5);
        doc.text('   A', x + 47, y);
      }

      // Row 2: Peak pack temperature
      if (data.row.index === 2) {
        if (data.column.index === 1) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(0, 0, 0);
          const tText = bm.peakPackTemperature != null ? `${bm.peakPackTemperature} ` : '_______ ';
          doc.text(tText, x, y);
          const tw = doc.getTextWidth(tText);
          drawMathSymbol(doc, 'degree', x + tw, y);
          doc.text('C', x + tw + 4, y);
        } else if (data.column.index === 3) {
          drawMathSymbol(doc, 'leq', x, y - 2, 5.5);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(0, 0, 0);
          doc.text('35 ', x + 10, y);
          drawMathSymbol(doc, 'degree', x + 25, y);
          doc.text('C', x + 29, y);
        }
      }
    },
  });

  // 2.2 Charge/Discharge Measurements Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('2.2 Charge/Discharge Measurements', leftX, 304);

  const cm = d.cycleMeasurements || {};
  const cycleRows = [
    [
      'Cycle 1 Charge\n(20%-100%)',
      cm.cycle1ChargeKw != null ? `${cm.cycle1ChargeKw} kW` : '________\nkW',
      '±5% of 80% SOC',
      '36 kW ± 2.2kW',
    ],
    [
      'Cycle 1 Discharge\n(100%-20%)',
      cm.cycle1DischargeKw != null ? `${cm.cycle1DischargeKw} kW` : '________\nkW',
      '±5% of 80% SOC',
      '36kW ± 2.2kW',
    ],
    [
      'Cycle 2 Charge\n(20%-100%)',
      cm.cycle2ChargeKw != null ? `${cm.cycle2ChargeKw} kW` : '________\nkW',
      '±5% of 80% SOC',
      '36kW ± 2.2kW',
    ],
    [
      'Cycle 2 Discharge\n(100%-20%)',
      cm.cycle2DischargeKw != null ? `${cm.cycle2DischargeKw} kW` : '________\nkW',
      '±5% of 80% SOC',
      '36kW ± 2.2kW',
    ],
  ];

  autoTable(doc, {
    startY: 338.2,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Measurement', 'Recorded\nvalue', 'Acceptance / reference', specLimitHeader]],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'normal' },
      1: { cellWidth: 77, fontStyle: 'normal' },
      2: { cellWidth: 150, fontStyle: 'normal' },
      3: { cellWidth: 111, fontStyle: 'normal' },
    },
    body: cycleRows,
  });

  // ==========================================
  // PAGE 4
  // ==========================================
  doc.addPage('letter', 'portrait');

  // Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('2.3 Pack Internal Resistance (IR)', leftX, 83);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Use one calibrated meter for all packs, at similar SOC and temperature.', leftX, 103);

  const ir = d.irSection || { packs: [] };
  const meterRows = [
    ['Meter / model', ir.meterModel || '', 'Calibration due', ir.calibrationDue || ''],
    [
      'SOC at test',
      ir.socAtTest != null ? `${ir.socAtTest} %` : '______ %',
      'Pack temp at test',
      '', // custom drawn with degree symbol
    ],
  ];

  autoTable(doc, {
    startY: 120.2,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 108.5, fontStyle: 'normal' },
      1: { cellWidth: 143.5, fontStyle: 'normal' },
      2: { cellWidth: 90.5, fontStyle: 'normal' },
      3: { cellWidth: 125.5, fontStyle: 'normal' },
    },
    body: meterRows,
    didDrawCell: data => {
      if (data.section === 'body' && data.row.index === 1 && data.column.index === 3) {
        const x = data.cell.x + 6;
        const y = data.cell.y + data.cell.height / 2 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        const tText = ir.packTempAtTest != null ? `${ir.packTempAtTest} ` : '______ ';
        doc.text(tText, x, y);
        const tw = doc.getTextWidth(tText);
        drawMathSymbol(doc, 'degree', x + tw, y);
        doc.text('C', x + tw + 4, y);
      }
    },
  });

  // Table 2: Packs 1 to 6 table
  const packRows = [1, 2, 3, 4, 5, 6].map(idx => {
    const p = (ir.packs || []).find(x => x.packIndex === idx);
    return [
      `Pack ${idx}`,
      p?.packSerial || '',
      p?.voltage != null ? `${p.voltage} V` : '______ V',
      '', // custom drawn with mΩ
      '', // custom drawn with checkboxes
    ];
  });

  autoTable(doc, {
    startY: 183.2,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Pack', 'Pack serial no.', 'Pack voltage', 'Internal resistance', 'Result']],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 60, fontStyle: 'normal' },
      1: { cellWidth: 130, fontStyle: 'normal' },
      2: { cellWidth: 85, fontStyle: 'normal' },
      3: { cellWidth: 109, fontStyle: 'normal' },
      4: { cellWidth: 84, fontStyle: 'normal' },
    },
    body: packRows,
    didDrawCell: data => {
      if (data.section !== 'body') return;
      const x = data.cell.x + 6;
      const y = data.cell.y + data.cell.height / 2 + 4;
      const idx = data.row.index + 1;
      const p = (ir.packs || []).find(item => item.packIndex === idx);

      // Col 3: Internal resistance (mΩ)
      if (data.column.index === 3) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        const rText = p?.internalResistance != null ? `${p.internalResistance} m` : '______ m';
        doc.text(rText, x, y);
        const rw = doc.getTextWidth(rText);
        drawMathSymbol(doc, 'omega', x + rw + 1, y);
      }

      // Col 4: Pass / Fail checkboxes
      if (data.column.index === 4) {
        const isPass = p?.result === 'Pass';
        const isFail = p?.result === 'Fail';

        const x1 = data.cell.x + 6;
        drawMathSymbol(doc, isPass ? 'checkbox_checked' : 'checkbox_empty', x1, y, 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('Pass', x1 + 9, y - 1);

        const x2 = x1 + 38;
        drawMathSymbol(doc, isFail ? 'checkbox_checked' : 'checkbox_empty', x2, y, 6);
        doc.text('Fail', x2 + 9, y - 1);
      }
    },
  });

  // Table 3: IR limits summary
  const irSummaryRows = [
    [
      'Highest pack IR',
      '', // custom drawn with mΩ
      'Approved max. pack IR',
      '', // custom drawn with ≤ ______ mΩ
    ],
    [
      'IR spread (max - min)',
      '', // custom drawn with mΩ
      'Approved pack-to-pack\nmatching',
      '', // custom drawn with ≤ ______ mΩ
    ],
  ];

  autoTable(doc, {
    startY: 368.7,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Measurement', 'Recorded\nvalue', 'Acceptance / reference', specLimitHeader]],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'normal' },
      1: { cellWidth: 77, fontStyle: 'normal' },
      2: { cellWidth: 150, fontStyle: 'normal' },
      3: { cellWidth: 111, fontStyle: 'normal' },
    },
    body: irSummaryRows,
    didDrawCell: data => {
      if (data.section !== 'body') return;
      const x = data.cell.x + 6;
      const y = data.cell.y + data.cell.height / 2 + 4;

      // Col 1: value + mΩ
      if (data.column.index === 1) {
        const val = data.row.index === 0 ? ir.highestPackIr : ir.irSpread;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        const vText = val != null ? `${val} m` : '______ m';
        doc.text(vText, x, y);
        const vw = doc.getTextWidth(vText);
        drawMathSymbol(doc, 'omega', x + vw + 1, y);
      }

      // Col 3: ≤ ______ mΩ
      if (data.column.index === 3) {
        drawMathSymbol(doc, 'leq', x, y - 2, 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text('______ m', x + 10, y);
        drawMathSymbol(doc, 'omega', x + 62, y);
      }
    },
  });

  // 3. Final Assessment & Approval Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('3. Final Assessment & Approval', leftX, 502);

  const approval = d.approval || {};
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Overall result:', leftX, 524);

  // Draw 3 checkboxes for PASS, FAIL, HOLD
  const passX = leftX + 85;
  drawMathSymbol(doc, approval.overallResult === 'PASS' ? 'checkbox_checked' : 'checkbox_empty', passX, 524, 7);
  doc.text('PASS', passX + 11, 524);

  const failX = passX + 65;
  drawMathSymbol(doc, approval.overallResult === 'FAIL' ? 'checkbox_checked' : 'checkbox_empty', failX, 524, 7);
  doc.text('FAIL', failX + 11, 524);

  const holdX = failX + 60;
  drawMathSymbol(doc, approval.overallResult === 'HOLD / RETEST' ? 'checkbox_checked' : 'checkbox_empty', holdX, 524, 7);
  doc.text('HOLD / RETEST', holdX + 11, 524);

  doc.text('Remarks / corrective actions:', leftX, 548);
  doc.setFont('helvetica', 'normal');
  doc.text(
    approval.remarks ||
      '______________________________________________________________\n______________________________________________________________',
    leftX,
    566
  );

  // Table 4: Signatures table
  const sigRows = [
    ['Tested by', approval.testedByName || '', '', approval.testedByDate || ''],
    ['Reviewed by', approval.reviewedByName || '', '', approval.reviewedByDate || ''],
    ['Customer witness (optional)', approval.witnessName || '', '', approval.witnessDate || ''],
  ];

  autoTable(doc, {
    startY: 582.3,
    margin: { left: leftX },
    tableWidth: 468,
    theme: 'grid',
    head: [['Role', 'Name', 'Signature', 'Date']],
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 11,
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4,
    },
    styles: {
      fontSize: 11,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.75,
      cellPadding: 4.5,
    },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'normal' },
      1: { cellWidth: 103.5, fontStyle: 'normal' },
      2: { cellWidth: 123.5, fontStyle: 'normal' },
      3: { cellWidth: 111, fontStyle: 'normal' },
    },
    body: sigRows,
  });

  // Footer: POWER2GO | Quality Assurance
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('POWER2GO | Quality Assurance', 71.2, 715);

  return doc;
}
