import { createWorker } from 'tesseract.js';
import type { FatFourPageReportData } from '../types/rackFat';

export interface OcrProgress {
  status: string;
  progress: number;
}

/**
 * Run client-side OCR on one or more scanned pages (image data URLs or image elements)
 */
export async function runFatDocumentOcr(
  imageUrls: string[],
  onProgress?: (info: OcrProgress) => void
): Promise<{ text: string; parsedData: Partial<FatFourPageReportData> }> {
  let combinedText = '';

  const worker = await createWorker('eng');

  try {
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      if (onProgress) {
        onProgress({ status: `Processing Page ${i + 1} of ${imageUrls.length}...`, progress: (i / imageUrls.length) * 0.9 });
      }

      const ret = await worker.recognize(url);
      combinedText += `\n--- PAGE ${i + 1} OCR ---\n` + ret.data.text;
    }
  } finally {
    await worker.terminate();
  }

  if (onProgress) {
    onProgress({ status: 'Parsing and structuring test measurements...', progress: 1.0 });
  }

  const parsedData = parseFatOcrText(combinedText);
  return { text: combinedText, parsedData };
}

/**
 * Intelligent regex and keyword extraction from raw OCR text
 */
export function parseFatOcrText(rawText: string): Partial<FatFourPageReportData> {
  const text = rawText.replace(/\r\n/g, '\n');
  const result: Partial<FatFourPageReportData> = {
    checklist: {},
    basicMeasurements: {},
    cycleMeasurements: {},
    irSection: { packs: [] },
    approval: { overallResult: 'PASS' },
  };

  // 1. Inverter Extraction
  const inverterMatch = text.match(/Inverter[:\s]+([^\n\r]+)/i) || text.match(/Solis\s*[0-9]+k?W?[^\n\r]*/i);
  if (inverterMatch) {
    result.inverter = inverterMatch[1] ? inverterMatch[1].trim() : inverterMatch[0].trim();
  }

  // 2. Checklist items 01 to 11
  // Look for 01, 02.. 11 followed by words, then pass/fail
  for (let i = 1; i <= 11; i++) {
    const numStr = i < 10 ? `0${i}` : `${i}`;
    const itemRegex = new RegExp(`(?:${numStr}|${i})[\\s.:-]+([^\\n]+)`, 'gi');
    let m = itemRegex.exec(text);
    if (m) {
      const line = m[1].toLowerCase();
      if (line.includes('fail') && !line.includes('pass fail') && !line.includes('☐ pass')) {
        result.checklist![numStr] = 'Fail';
      } else {
        result.checklist![numStr] = 'Pass';
      }
    } else {
      // Default to Pass if scanned document exists
      result.checklist![numStr] = 'Pass';
    }
  }

  // 3. Basic Measurements
  // Total battery voltage: e.g. "Total battery voltage 442 V" or "442.5"
  const totalVoltMatch = text.match(/(?:Total\s*battery\s*voltage|battery\s*voltage)[^\d]*([3-5]\d{2}(?:\.\d+)?)\s*V?/i);
  if (totalVoltMatch) {
    result.basicMeasurements!.totalBatteryVoltage = parseFloat(totalVoltMatch[1]);
  }

  // Voltage spread: e.g. "pack voltage spread 0.25 V"
  const spreadMatch = text.match(/(?:voltage\s*spread|pack\s*balance)[^\d]*(0?\.\d+)\s*V?/i);
  if (spreadMatch) {
    result.basicMeasurements!.packVoltageSpread = parseFloat(spreadMatch[1]);
  }

  // Insulation resistance: e.g. "Insulation resistance 120 M" or "65 M"
  const insulMatch = text.match(/(?:Insulation\s*resistance)[^\d]*(\d+(?:\.\d+)?)\s*M/i);
  if (insulMatch) {
    result.basicMeasurements!.insulationResistance = parseFloat(insulMatch[1]);
  }

  // Charge / discharge current: e.g. "25 A / 30 A" or "Charge / discharge current 50 A"
  const currentMatch = text.match(/(?:Charge\s*\/\s*discharge\s*current)[^\d]*(\d+(?:\.\d+)?)\s*A?\s*(?:\/|\s)\s*(\d+(?:\.\d+)?)\s*A?/i);
  if (currentMatch) {
    result.basicMeasurements!.chargeCurrent = parseFloat(currentMatch[1]);
    result.basicMeasurements!.dischargeCurrent = parseFloat(currentMatch[2]);
  }

  // Peak pack temperature: e.g. "28 °C" or "28 C"
  const tempMatch = text.match(/(?:Peak\s*pack\s*temp|pack\s*temperature)[^\d]*(\d+(?:\.\d+)?)\s*(?:°C|C)/i);
  if (tempMatch) {
    result.basicMeasurements!.peakPackTemperature = parseFloat(tempMatch[1]);
  }

  // Solis communication
  if (/solis.*(?:fault|error|alarm active)/i.test(text)) {
    result.basicMeasurements!.solisCommStatus = 'Fault observed';
  } else if (/solis.*(?:stable|pass|ok|no active faults)/i.test(text)) {
    result.basicMeasurements!.solisCommStatus = 'Stable link / no active faults';
  }

  // 4. Charge / Discharge Measurements
  // Cycle 1 Charge
  const c1cMatch = text.match(/Cycle\s*1\s*Charge[^\d]*(\d+(?:\.\d+)?)\s*k?W?/i);
  if (c1cMatch) result.cycleMeasurements!.cycle1ChargeKw = parseFloat(c1cMatch[1]);

  // Cycle 1 Discharge
  const c1dMatch = text.match(/Cycle\s*1\s*Discharge[^\d]*(\d+(?:\.\d+)?)\s*k?W?/i);
  if (c1dMatch) result.cycleMeasurements!.cycle1DischargeKw = parseFloat(c1dMatch[1]);

  // Cycle 2 Charge
  const c2cMatch = text.match(/Cycle\s*2\s*Charge[^\d]*(\d+(?:\.\d+)?)\s*k?W?/i);
  if (c2cMatch) result.cycleMeasurements!.cycle2ChargeKw = parseFloat(c2cMatch[1]);

  // Cycle 2 Discharge
  const c2dMatch = text.match(/Cycle\s*2\s*Discharge[^\d]*(\d+(?:\.\d+)?)\s*k?W?/i);
  if (c2dMatch) result.cycleMeasurements!.cycle2DischargeKw = parseFloat(c2dMatch[1]);

  // 5. Pack IR Table
  const packMatches = [...text.matchAll(/Pack\s*([1-9])\s*([A-Za-z0-9_-]+)?\s*(\d{2,3}(?:\.\d+)?)\s*V?\s*(\d+(?:\.\d+)?)\s*m?Ω?/gi)];
  if (packMatches.length > 0) {
    const packs: any[] = [];
    for (const pm of packMatches) {
      packs.push({
        packIndex: parseInt(pm[1], 10),
        packSerial: pm[2] || `PACK-0${pm[1]}`,
        voltage: pm[3] ? parseFloat(pm[3]) : null,
        internalResistance: pm[4] ? parseFloat(pm[4]) : null,
        result: 'Pass',
      });
    }
    result.irSection!.packs = packs;
  }

  // IR spread & highest pack IR
  const highestIrMatch = text.match(/Highest\s*pack\s*IR[^\d]*(\d+(?:\.\d+)?)/i);
  if (highestIrMatch) result.irSection!.highestPackIr = parseFloat(highestIrMatch[1]);

  const irSpreadMatch = text.match(/IR\s*spread[^\d]*(\d+(?:\.\d+)?)/i);
  if (irSpreadMatch) result.irSection!.irSpread = parseFloat(irSpreadMatch[1]);

  // 6. Final Assessment
  if (/Overall\s*result[:\s]*(?:FAIL|HOLD)/i.test(text)) {
    result.approval!.overallResult = text.toUpperCase().includes('HOLD') ? 'HOLD / RETEST' : 'FAIL';
  } else {
    result.approval!.overallResult = 'PASS';
  }

  // Signatures / names
  const testedByMatch = text.match(/Tested\s*by[:\s]*([^\n\r]+)/i);
  if (testedByMatch) result.approval!.testedByName = testedByMatch[1].trim();

  const reviewedByMatch = text.match(/Reviewed\s*by[:\s]*([^\n\r]+)/i);
  if (reviewedByMatch) result.approval!.reviewedByName = reviewedByMatch[1].trim();

  return result;
}
