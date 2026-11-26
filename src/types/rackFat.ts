// Type definitions for the complete 4-page Factory Acceptance Test (FAT) Report

export interface FatChecklistItem {
  id: string;
  name: string;
  description: string;
  status: 'Pass' | 'Fail' | 'Pending';
  notes?: string;
}

export interface FatBasicMeasurements {
  totalBatteryVoltage?: number | null; // e.g. 360V - 518.4V
  packVoltageSpread?: number | null;   // e.g. <= 0.72V
  insulationResistance?: number | null; // e.g. >= 65 MΩ
  chargeCurrent?: number | null;       // A
  dischargeCurrent?: number | null;    // A
  peakPackTemperature?: number | null; // e.g. <= 35 °C
  solisCommStatus?: string | null;     // 'Stable link / no active faults' | 'Fault observed'
}

export interface FatCycleMeasurements {
  cycle1ChargeKw?: number | null;      // 36 kW ± 2.2kW
  cycle1DischargeKw?: number | null;   // 36 kW ± 2.2kW
  cycle2ChargeKw?: number | null;      // 36 kW ± 2.2kW
  cycle2DischargeKw?: number | null;   // 36 kW ± 2.2kW
}

export interface FatPackIrReading {
  packIndex: number;
  packSerial: string;
  voltage?: number | null;
  internalResistance?: number | null; // mΩ
  result: 'Pass' | 'Fail';
}

export interface FatIrSection {
  meterModel?: string;
  calibrationDue?: string;
  socAtTest?: number | null;
  packTempAtTest?: number | null;
  packs: FatPackIrReading[];
  highestPackIr?: number | null;
  irSpread?: number | null;
}

export interface FatApprovalSignatures {
  overallResult: 'PASS' | 'FAIL' | 'HOLD / RETEST';
  remarks?: string;
  testedByName?: string;
  testedByDate?: string;
  reviewedByName?: string;
  reviewedByDate?: string;
  witnessName?: string;
  witnessDate?: string;
}

export interface FatFourPageReportData {
  // Page 1 Header (Auto-filled by MES or editable)
  customerProject: string;
  reportNo: string;
  batterySystem: string;
  configuration: string;
  inverter: string;
  cabinetSerial: string;
  inspectionDate: string;
  location: string;

  // Page 1 & 2 Checklist
  checklist: Record<string, 'Pass' | 'Fail' | 'Pending'>;

  // Page 2 & 3 Measurements
  basicMeasurements: FatBasicMeasurements;
  cycleMeasurements: FatCycleMeasurements;

  // Page 4 IR & Signoff
  irSection: FatIrSection;
  approval: FatApprovalSignatures;

  // Attached Scanned Documents / Photos
  uploadedScanUrls?: string[];
}
