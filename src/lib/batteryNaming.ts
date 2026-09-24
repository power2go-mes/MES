export function normalizeBatterySerial(value: unknown): string {
  return String(value || '').trim().replace(/8\s*KWH/gi, '7.5KWH');
}

export function normalizeBatteryName(value: unknown): string {
  return String(value || '').trim().replace(/\b8\s*KWH\b/gi, '7.5 kWh');
}