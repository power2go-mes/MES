import fs from 'fs';
import path from 'path';

// This is a lightweight schema validator to ensure the final output file
// has the necessary components as requested by the user requirements.

const schemaPath = path.join(process.cwd(), 'supabase/power2go_mes.sql');

if (!fs.existsSync(schemaPath)) {
  console.error('ERROR: supabase/power2go_mes.sql not found.');
  process.exit(1);
}

const content = fs.readFileSync(schemaPath, 'utf8').toLowerCase();

let errors = 0;

function check(name: string, keyword: string, description: string) {
  if (content.includes(keyword.toLowerCase())) {
    console.log(`[PASS] ${name} (${description})`);
  } else {
    console.error(`[FAIL] ${name} missing! Expected: ${keyword}`);
    errors++;
  }
}

console.log('--- VALIDATING ARCHITECTURE ---');

// 1. Auth / RLS
check('RLS enabled', 'enable row level security', 'Ensure RLS is enabled');
check('has_permission helper', 'function public.has_permission', 'Unified RBAC helper');

// 2. Master Data
check('product_templates', 'create table if not exists public.product_templates', 'Product specs');
check('suppliers', 'create table if not exists public.suppliers', 'Suppliers');

// 3. Manufacturing Relational Integrity
check('cells table', 'create table if not exists public.cells', 'Cells inventory');
check('batteries table', 'create table if not exists public.batteries', 'Batteries');
check('modules table', 'create table if not exists public.modules', 'Modules');
check('module_cells table', 'create table if not exists public.module_cells', 'Cell-to-module relational link');
check('module_cells FK', 'references public.modules(id)', 'Relational integrity for modules');
check('module_cells unique slot', 'unique (module_id, cell_slot_index)', 'Ensure no slot is double booked');

// 4. Controllers
check('bms_units', 'create table if not exists public.bms_units', 'BMS Inventory');
check('bmu_units', 'create table if not exists public.bmu_units', 'BMU Inventory');
check('BMS 1:1 validation', 'unique index idx_bms_active_battery', 'BMS cannot be in multiple batteries');

// 5. Audit & Genealogy
check('audit_logs', 'create table if not exists public.audit_logs', 'Audit table');
check('audit_logs append only', 'raise exception \'audit_logs is append-only\'', 'Append only trigger');
check('genealogy_records', 'create table if not exists public.genealogy_records', 'Traceability');

// 6. QR Registry
check('qr_registry', 'create table if not exists public.qr_registry', 'Unified identifiers');

// 7. Bulk Operations & RPCs
check('bulk import rpc', 'function public.import_supplier_cells_bulk', 'Set-based bulk import');
check('dashboard rpc', 'function public.get_dashboard_summary', 'Set-based dashboard aggregate');
check('assign_cell rpc', 'function public.assign_cell_transaction', 'Atomic cell assignment');
check('auto_match rpc', 'function public.auto_match_cells_transaction', 'Atomic cell auto matching');
check('delete_module rpc', 'function public.delete_module_transaction', 'Atomic module deletion');
check('cancel_order rpc', 'function public.cancel_production_order_transaction', 'Atomic order cancellation');
check('delete_battery rpc', 'function public.delete_battery_cascade', 'Atomic battery deletion cascade');
check('assign_controller rpc', 'function public.assign_controller_transaction', 'Atomic controller assignment');
check('move_cell rpc', 'function public.move_cell_transaction', 'Atomic cell movement');
check('record_cell_tests rpc', 'function public.record_cell_tests_bulk', 'Atomic cell testing');
check('record_module_workflow rpc', 'function public.record_module_workflow_bulk', 'Atomic module workflow');
check('record_controller_test rpc', 'function public.record_controller_test_transaction', 'Atomic controller testing');
check('record_battery_test rpc', 'function public.record_battery_test_transaction', 'Atomic battery testing');
check('quarantine_item rpc', 'function public.quarantine_item_transaction', 'Atomic quarantine');
check('release_battery rpc', 'function public.release_battery_transaction', 'Atomic battery release');
check('resolve_quarantine rpc', 'function public.resolve_quarantine_transaction', 'Atomic quarantine resolution');
check('dispatch_battery rpc', 'function public.dispatch_battery_transaction', 'Atomic battery dispatch');
check('receive_battery rpc', 'function public.receive_battery_transaction', 'Atomic battery receive');


// 8. 100k+ Indexes
check('index cells internal serial', 'index idx_cells_internal_serial', 'Quick serial lookup');
check('index cells status', 'index idx_cells_status', 'Status filtering');

console.log('-------------------------------');
if (errors === 0) {
  console.log('SUCCESS: All critical architecture validations passed.');
  process.exit(0);
} else {
  console.error(`FAILED: ${errors} validations failed.`);
  process.exit(1);
}
