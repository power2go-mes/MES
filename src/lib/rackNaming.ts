export function normalizeRackSerial(value: unknown): string {
  return String(value || '').trim().replace(/(?:69\.7|70)\s*KWH/gi, '67.5KWH');
}

export function normalizeRackCapacity(value: unknown): string {
  const normalized = String(value || '').trim();
  return normalized === '70' || normalized === '69.7' ? '67.5' : normalized;
}