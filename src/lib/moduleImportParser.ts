export type ModuleImportGroup = {
  moduleNumber: string;
  qrCodes: string[];
  isValid: boolean;
  errors: string[];
};

const normalizeHeader = (value: string) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const findHeaderIndex = (headers: string[], candidates: string[]) => {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const foundIndex = headers.findIndex(header => {
      const normalizedHeader = normalizeHeader(header);
      return normalizedHeader === normalizedCandidate
        || normalizedHeader.includes(normalizedCandidate)
        || normalizedCandidate.includes(normalizedHeader);
    });
    if (foundIndex >= 0) return foundIndex;
  }
  return -1;
};

export const findModuleImportColumns = (headers: string[]) => {
  const qrIndex = findHeaderIndex(headers, [
    'qr code', 'qrcode', 'qr', 'barcode', 'cell qr', 'cell_qr', 'cell barcode',
    'supplier barcode', 'supplier_barcode', 'serial number', 'cell serial',
  ]);
  const moduleIndex = findHeaderIndex(headers, [
    'module', 'module number', 'module_number', 'module no', 'module_no', 'module id',
    'module_id', 'module no.', 'module code', 'modul', 'group id', 'pack id',
  ]);
  return { qrIndex, moduleIndex };
};

export const parseModuleImportGroups = (rows: any[][], requiredCellCount = 8): ModuleImportGroup[] => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const normalizedRows = rows.map(row => Array.isArray(row) ? row : []);
  const headerRowIndex = normalizedRows.findIndex((row, index) => {
    if (index === 0 && row.length === 0) return false;
    const headers = row.map(value => String(value ?? '').trim());
    const { qrIndex, moduleIndex } = findModuleImportColumns(headers);
    return qrIndex >= 0 && moduleIndex >= 0;
  });

  if (headerRowIndex < 0) return [];

  const headerRow = normalizedRows[headerRowIndex];
  const { qrIndex, moduleIndex } = findModuleImportColumns(headerRow.map(value => String(value ?? '')));
  if (qrIndex < 0 || moduleIndex < 0) return [];

  const groups = new Map<string, string[]>();
  let currentModule = '';

  normalizedRows.slice(headerRowIndex + 1).forEach(row => {
    const moduleValue = String(row[moduleIndex] ?? '').trim();
    if (moduleValue) currentModule = moduleValue;
    const qrCode = String(row[qrIndex] ?? '').trim();
    if (!currentModule || !qrCode) return;

    const groupedCodes = groups.get(currentModule) || [];
    if (!groupedCodes.includes(qrCode)) groupedCodes.push(qrCode);
    groups.set(currentModule, groupedCodes);
  });

  return Array.from(groups.entries()).map(([moduleNumber, qrCodes]) => {
    const isValid = qrCodes.length === requiredCellCount;
    return {
      moduleNumber,
      qrCodes,
      isValid,
      errors: isValid ? [] : [`Module contains ${qrCodes.length} QR codes; this module requires exactly ${requiredCellCount}.`],
    };
  });
};
