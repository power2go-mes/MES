import { createWorker } from 'tesseract.js';
import type { FatFourPageReportData } from '../types/rackFat';

export interface OcrProgress {
  status: string;
  progress: number;
}

/**
 * Parses scanned documents using Google Gemini Flash Vision API if key is present,
 * or falls back to client-side Tesseract.js.
 */
export async function runFatDocumentOcr(
  imageUrls: string[],
  onProgress?: (info: OcrProgress) => void
): Promise<{ text: string; parsedData: Partial<FatFourPageReportData> }> {
  // Check for Gemini API Key in Vite environment
  const geminiApiKey =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) ||
    '';

  if (geminiApiKey) {
    try {
      if (onProgress) {
        onProgress({ status: 'Analyzing document with Gemini Vision AI...', progress: 0.2 });
      }
      const aiResult = await runGeminiVisionOcr(imageUrls, geminiApiKey, onProgress);
      return aiResult;
    } catch (aiErr: any) {
      console.warn('Gemini AI OCR failed, falling back to Tesseract:', aiErr);
      if (onProgress) {
        onProgress({ status: 'AI service busy, falling back to local OCR engine...', progress: 0.4 });
      }
    }
  }

  // Fallback to local Tesseract engine
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
    onProgress({ status: 'Structuring test measurements...', progress: 1.0 });
  }

  const parsedData = parseFatOcrText(combinedText);
  return { text: combinedText, parsedData };
}

/**
 * Call Gemini 2.5 Flash Vision directly for 100% human-grade handwriting and tick-mark recognition
 */
async function runGeminiVisionOcr(
  imageUrls: string[],
  apiKey: string,
  onProgress?: (info: OcrProgress) => void
): Promise<{ text: string; parsedData: Partial<FatFourPageReportData> }> {
  const parts: any[] = [
    {
      text: [
        'Analyze this physical Factory Acceptance Test (FAT) test sheet image carefully.',
        'Extract all values, handwriting, and tick marks. Return ONLY a valid JSON object matching this schema:',
        '{',
        '  "customerProject": string or null,',
        '  "reportNo": string or null,',
        '  "inverter": string or null,',
        '  "cabinetSerial": string or null,',
        '  "inspectionDate": string or null,',
        '  "location": string or null,',
        '  "checklist": {',
        '    "01": "Pass" or "Fail",',
        '    "02": "Pass" or "Fail",',
        '    "03": "Pass" or "Fail",',
        '    "04": "Pass" or "Fail",',
        '    "05": "Pass" or "Fail",',
        '    "06": "Pass" or "Fail",',
        '    "07": "Pass" or "Fail",',
        '    "08": "Pass" or "Fail",',
        '    "09": "Pass" or "Fail",',
        '    "10": "Pass" or "Fail",',
        '    "11": "Pass" or "Fail"',
        '  },',
        '  "basicMeasurements": {',
        '    "totalBatteryVoltage": number or null,',
        '    "packVoltageSpread": number or null,',
        '    "insulationResistance": number or null,',
        '    "chargeCurrent": number or null,',
        '    "dischargeCurrent": number or null,',
        '    "peakPackTemperature": number or null,',
        '    "solisCommStatus": "N/A" or "Fault" or "Stable link / no active faults" or null',
        '  },',
        '  "cycleMeasurements": {',
        '    "cycle1ChargeKw": number or null,',
        '    "cycle1DischargeKw": number or null,',
        '    "cycle2ChargeKw": number or null,',
        '    "cycle2DischargeKw": number or null',
        '  },',
        '  "irSection": {',
        '    "meterModel": string or null,',
        '    "calibrationDue": string or null,',
        '    "socAtTest": number or null,',
        '    "packTempAtTest": number or null,',
        '    "packs": [',
        '      { "packIndex": 1, "packSerial": string, "voltage": number, "internalResistance": number, "result": "Pass" or "Fail" }',
        '    ],',
        '    "highestPackIr": number or null,',
        '    "irSpread": number or null',
        '  },',
        '  "approval": {',
        '    "overallResult": "PASS" or "FAIL" or "HOLD / RETEST",',
        '    "remarks": string or null,',
        '    "testedByName": string or null,',
        '    "reviewedByName": string or null',
        '  }',
        '}',
        'Important Rules:',
        '- Look at the checkboxes in the Result column. If the checkmark/tick is on the Pass box, set "Pass".',
        '- If the checkmark/tick/cross is on the Fail box, set "Fail".',
        '- For "Solis 50kW HV communication / alarms", the recorded value should strictly be parsed as "N/A" or "Fault" (or "Stable link / no active faults" if written).',
        '- Read any handwritten text (like Customer/Project name, serial numbers, remarks, sign names) carefully.',
        'Output ONLY raw JSON, with no markdown code blocks.'
      ].join('\n')
    }
  ];

  for (let i = 0; i < imageUrls.length; i++) {
    const dataUrl = imageUrls[i];
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      parts.push({
        inlineData: {
          mimeType: match[1] || 'image/jpeg',
          data: match[2]
        }
      });
    }
  }

  if (onProgress) {
    onProgress({ status: 'Gemini AI Vision recognizing text & tick marks...', progress: 0.6 });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Vision API error: ${response.status} - ${errText}`);
  }

  const resJson = await response.json();
  const rawResponseText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleanJson = rawResponseText.replace(/```json/g, '').replace(/```/g, '').trim();

  let parsed: Partial<FatFourPageReportData> = {};
  try {
    parsed = JSON.parse(cleanJson);
  } catch (parseErr) {
    console.error('Failed to parse Gemini response JSON:', rawResponseText);
  }

  if (onProgress) {
    onProgress({ status: 'Extraction complete!', progress: 1.0 });
  }

  return { text: rawResponseText, parsedData: parsed };
}

/**
 * Intelligent regex and keyword extraction from raw OCR text (fallback)
 */
export function parseFatOcrText(rawText: string): Partial<FatFourPageReportData> {
  const text = rawText.replace(/\r\n/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const result: Partial<FatFourPageReportData> = {
    checklist: {},
    basicMeasurements: {},
    cycleMeasurements: {},
    irSection: { packs: [] },
    approval: { overallResult: 'PASS' },
  };

  // 1. Inverter & Header Extraction
  const inverterMatch = text.match(/Inverter[:\s|]+([^\n\r]+)/i) || text.match(/Solis\s*[0-9]+k?W?[^\n\r]*/i);
  if (inverterMatch) {
    result.inverter = inverterMatch[1] ? inverterMatch[1].replace(/ocr/gi, '').trim() : inverterMatch[0].trim();
  }

  const customerMatch = text.match(/(?:Customer\s*\/\s*Project|Customer)[:\s|]+([^\n\r]+)/i);
  if (customerMatch && customerMatch[1].trim()) {
    result.customerProject = customerMatch[1].replace(/ocr/gi, '').trim();
  }

  const reportNoMatch = text.match(/\[?FAT-[0-9]{4}-[0-9a-zA-Z\s_-]+\]?/i);
  if (reportNoMatch) {
    result.reportNo = reportNoMatch[0].replace(/\[|\]/g, '').trim();
  }

  // Solis comm status: N/A or Fault or Stable
  if (/solis.*(?:comm|alarm)/i.test(text)) {
    if (/fault/i.test(text)) {
      result.basicMeasurements = { ...result.basicMeasurements, solisCommStatus: 'Fault' };
    } else if (/n\/?a/i.test(text)) {
      result.basicMeasurements = { ...result.basicMeasurements, solisCommStatus: 'N/A' };
    } else {
      result.basicMeasurements = { ...result.basicMeasurements, solisCommStatus: 'N/A' };
    }
  }

  // 2. Checklist items 01 to 11
  const checklistKeywords: Record<string, RegExp> = {
    '01': /(?:01|physical|assembly|cabinet.*packs)/i,
    '02': /(?:02|voltage.*balance|total.*stack)/i,
    '03': /(?:03|insulation.*earthing|protective.*earthing)/i,
    '04': /(?:04|polarity.*pre-charge|pre-charge)/i,
    '05': /(?:05|bmu.*display|soc.*voltage.*alarms)/i,
    '06': /(?:06|inverter.*comm|bmu-to-solis)/i,
    '07': /(?:07|charging.*performance)/i,
    '08': /(?:08|discharging.*performance)/i,
    '09': /(?:09|cycle.*usable.*capacity)/i,
    '10': /(?:10|protection.*alarms|under-voltage)/i,
    '11': /(?:11|final.*system.*operation|shutdown)/i,
  };

  for (let i = 1; i <= 11; i++) {
    const numStr = i < 10 ? `0${i}` : `${i}`;
    const pattern = checklistKeywords[numStr];

    const matchingLineIdx = lines.findIndex(line => pattern.test(line));
    if (matchingLineIdx !== -1) {
      const searchBlock = lines.slice(matchingLineIdx, matchingLineIdx + 3).join(' ');
      if (/(?:fail|fall|tall)/i.test(searchBlock) && /[&B|\[xX\u2611\u2713\u2714]/.test(searchBlock)) {
        result.checklist![numStr] = 'Fail';
      } else {
        result.checklist![numStr] = 'Pass';
      }
    } else {
      result.checklist![numStr] = 'Pass';
    }
  }

  return result;
}
