export function normalizeBatterySerial(value: unknown): string {
  return String(value || '').trim().replace(/8\s*KWH/gi, '7.5KWH');
}

export function batterySerialCapacityToken(value: unknown): '5KWH' | '7.5KWH' {
  const capacity = Number(value);
  if (Number.isFinite(capacity) && capacity > 0) return capacity <= 5.5 ? '5KWH' : '7.5KWH';
  return /(?:^|[^0-9.])5(?:\.0)?\s*KWH\b/i.test(normalizeBatterySerial(value)) ? '5KWH' : '7.5KWH';
}

export function normalizeBatteryName(value: unknown): string {
  return String(value || '').trim().replace(/\b8\s*KWH\b/gi, '7.5 kWh');
}

export function legacyBatterySerialLookup(value: unknown): string {
  return String(value || '').trim().replace(/7\.5\s*KWH/gi, '8KWH');
}