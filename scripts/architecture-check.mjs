import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const schemaPath = join(root, 'supabase/power2go_mes.sql');
const upSql = readFileSync(schemaPath, 'utf8');
const requiredObjects = [
  'module_cells', 'cell_tests', 'module_tests', 'controller_tests', 'battery_tests',
  'release_records', 'warehouse_movements', 'dispatches', 'qr_registry',
  'supplier_imports', 'supplier_import_rows', 'import_supplier_cells_bulk',
  'pallets', 'racks', 'rack_packs', 'lifecycle_events',
  'move_pallet_to_floor_transaction', 'assemble_rack_transaction',
  'sell_rack_transaction', 'scrap_entity_transaction',
];

for (const object of requiredObjects) {
  if (!upSql.includes(object)) throw new Error(`Missing authoritative SQL object: ${object}`);
}

const sourceRoots = ['src', 'server'];
for (const sourceRoot of sourceRoots) {
  const directory = join(root, sourceRoot);
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory, { recursive: true })) {
    if (!String(entry).match(/\.(ts|tsx|js|mjs)$/)) continue;
    const file = join(directory, entry);
    const content = readFileSync(file, 'utf8');
    if (/mes_memory/.test(content)) throw new Error(`Legacy mes_memory reference: ${file}`);
  }
}

console.log(`Architecture checks passed: ${requiredObjects.length} authoritative objects verified, no active mes_memory references.`);

