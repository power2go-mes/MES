#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const now = Date.now();
const iso = (daysAgo, hour = 12) => new Date(now - daysAgo * 86400000 + hour * 3600000).toISOString();
const ensure = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
};

async function main() {
  const suppliers = [
    { id: 'sup-demo-eve', name: 'EVE Energy Demo', contact_email: 'demo@eve.example', status: 'ACTIVE' },
    { id: 'sup-demo-catl', name: 'CATL Demo', contact_email: 'demo@catl.example', status: 'ACTIVE' },
  ];
  ensure(await supabase.from('suppliers').upsert(suppliers, { onConflict: 'id' }), 'suppliers');

  const products = [
    {
      id: 'prod-demo-5kwh', sku: 'DEMO-5KWH', name: '5 kWh Battery Pack', product_model: 'P2G-5K', battery_name: 'Demo 5 kWh',
      voltage_type: 'LV', nominal_voltage_v: 51.2, capacity_kwh: 5, total_capacity_ah: 100, num_modules: 2,
      cells_per_module: 8, total_cells: 16, bms_model: 'BMS-DEMO', bms_protocol: 'CAN', serial_prefix: 'D5K', active: true,
    },
    {
      id: 'prod-demo-75kwh', sku: 'DEMO-75KWH', name: '7.5 kWh Battery Pack', product_model: 'P2G-75K', battery_name: 'Demo 7.5 kWh',
      voltage_type: 'LV', nominal_voltage_v: 51.2, capacity_kwh: 7.5, total_capacity_ah: 150, num_modules: 2,
      cells_per_module: 12, total_cells: 24, bms_model: 'BMS-DEMO', bms_protocol: 'CAN', serial_prefix: 'D75', active: true,
    },
  ];
  ensure(await supabase.from('product_templates').upsert(products, { onConflict: 'id' }), 'product templates');

  const machines = [
    ['ONLINE', 'OCV Tester'], ['OFFLINE', 'Laser Welder'], ['MAINTENANCE', 'BMS Tester'],
    ['BUSY', 'EOL Tester'],
  ].map(([status, name], index) => ({
    id: `machine-demo-${index + 1}`,
    name: `${name} Demo`,
    type: ['OCV_TESTER', 'LASER_WELDER', 'BMS_TESTER', 'EOL_TESTER'][index],
    status,
    settings_json: { demo: true },
    last_ping_at: iso(index, 10),
  }));
  ensure(await supabase.from('machine_configurations').upsert(machines, { onConflict: 'id' }), 'machines');

  const controllers = ['AVAILABLE', 'ASSIGNED', 'QUARANTINED', 'ARCHIVED', 'FAILED', 'PASSED'];
  const bmsUnits = controllers.map((status, index) => ({
    id: `bms-demo-${index + 1}`, serial_number: `DEMO-BMS-${index + 1}`, model: 'BMS-DEMO',
    supplier: 'Power2Go Demo', manufacturer: 'Power2Go Demo', protocol: 'CAN', status,
  }));
  const bmuUnits = controllers.map((status, index) => ({
    id: `bmu-demo-${index + 1}`, serial_number: `DEMO-BMU-${index + 1}`, model: 'BMU-DEMO',
    manufacturer: 'Power2Go Demo', protocol: 'CAN', status,
  }));
  ensure(await supabase.from('bms_units').upsert(bmsUnits, { onConflict: 'id' }), 'BMS units');
  ensure(await supabase.from('bmu_units').upsert(bmuUnits, { onConflict: 'id' }), 'BMU units');

  const orders = [
    { id: 'order-demo-planned', order_number: 'DEMO-PO-PLANNED', product_id: products[0].id, target_quantity: 12, quantity_in_process: 0, quantity_completed: 0, status: 'PLANNED' },
    { id: 'order-demo-process', order_number: 'DEMO-PO-PROCESS', product_id: products[1].id, target_quantity: 20, quantity_in_process: 8, quantity_completed: 5, status: 'IN_PROCESS' },
    { id: 'order-demo-complete', order_number: 'DEMO-PO-COMPLETE', product_id: products[0].id, target_quantity: 10, quantity_in_process: 0, quantity_completed: 10, status: 'COMPLETED' },
    { id: 'order-demo-cancelled', order_number: 'DEMO-PO-CANCELLED', product_id: products[1].id, target_quantity: 4, quantity_in_process: 0, quantity_completed: 0, status: 'CANCELLED' },
  ];
  ensure(await supabase.from('production_orders').upsert(orders, { onConflict: 'id' }), 'production orders');

  const cellStatuses = ['IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED', 'AVAILABLE', 'RESERVED', 'MODULE_ASSIGNED', 'QUARANTINED', 'REJECTED', 'IN_PROCESS', 'ASSEMBLED', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED'];
  let cellSequence = 0;
  const cells = cellStatuses.flatMap((status) => Array.from({ length: status === 'AVAILABLE' ? 40 : 4 }, (_, offset) => {
    const index = ++cellSequence;
    const lifecycleStatus = status === 'QUARANTINED' || status === 'REJECTED' ? 'SCRAP' : ['IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED'].includes(status) ? 'FLOOR_STOCK' : status === 'AVAILABLE' ? 'IN_STOCK' : status === 'ASSEMBLED' ? 'IN_MODULE' : ['IN_PROCESS', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED'].includes(status) ? 'IN_PACK' : 'IN_STOCK';
    return {
      id: `cell-demo-${index}`,
      internal_serial: `DEMO-C-${String(index).padStart(5, '0')}`,
      supplier_barcode: `DEMO-S-${String(index).padStart(5, '0')}`,
      qr_code: `DEMO-C-QR-${String(index).padStart(5, '0')}`,
      supplier_id: index % 2 ? suppliers[0].id : suppliers[1].id,
      batch_number: `DEMO-BATCH-${(Math.floor(index / 20) % 3) + 1}`,
      pallet_number: `DEMO-PAL-${(offset % 4) + 1}`,
      box_number: `DEMO-BOX-${offset + 1}`,
      supplier_ocv_v: 3.3,
      supplier_ir_mohm: 0.18,
      production_ocv_v: 3.302 + ((offset % 4) * 0.001),
      production_ir_mohm: 0.16 + ((offset % 3) * 0.01),
      grade: status === 'REJECTED' ? 'C' : 'A',
      status,
      lifecycle_status: lifecycleStatus,
      reserved_for_order_id: status === 'RESERVED' ? orders[1].id : null,
      tested_at: ['OCV_TESTED', 'GRADED', 'VALIDATING', 'TESTING', 'PASSED'].includes(status) ? iso(1 + offset % 5, 10) : null,
      created_at: iso(30 + offset % 10, 8),
      updated_at: iso(offset % 5, 15),
    };
  }));
  ensure(await supabase.from('cells').upsert(cells, { onConflict: 'id' }), 'cells');

  const batteries = Array.from({ length: 20 }, (_, index) => {
    const isFive = index % 2 === 0;
    const status = ['CREATED', 'ASSEMBLY', 'TESTING', 'QC', 'RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED', 'IN_PROCESS', 'QUARANTINED'][index % 10];
    return {
      id: `battery-demo-${index + 1}`,
      serial_number: `DEMO-B-${String(index + 1).padStart(5, '0')}`,
      production_order_id: index % 3 === 0 ? orders[0].id : orders[1].id,
      product_id: isFive ? products[0].id : products[1].id,
      current_step: status === 'FINISHED' ? 'FINAL_QC' : 'PACK_ASSEMBLY',
      status,
      lifecycle_status: ['DISPATCHED', 'FINISHED'].includes(status) ? 'SOLD' : status === 'QUARANTINED' ? 'SCRAP' : index % 3 === 0 ? 'IN_RACK' : 'IN_PACK',
      progress_percent: status === 'FINISHED' || status === 'DISPATCHED' ? 100 : 20 + ((index * 7) % 70),
      step_results_json: { demo: true, status },
      created_at: iso(20 - (index % 12), 9),
      updated_at: iso(index % 5, 14),
    };
  });
  ensure(await supabase.from('batteries').upsert(batteries, { onConflict: 'id' }), 'batteries');

  const modules = Array.from({ length: 16 }, (_, index) => ({
    id: `module-demo-${index + 1}`,
    battery_id: batteries[index % batteries.length].id,
    production_order_id: orders[index % 2].id,
    module_index: index % 2,
    serial_number: `DEMO-M-${String(index + 1).padStart(5, '0')}`,
    status: ['CREATED', 'CELLS_ASSIGNED', 'ASSEMBLED', 'WELDED', 'QC', 'PASSED', 'FAILED', 'QUARANTINED'][index % 8],
    module_type: index % 2 === 0 ? '8S' : '12S',
    lifecycle_status: ['IN_MODULE', 'IN_PACK', 'IN_RACK', 'SOLD', 'SCRAP'][index % 5],
    matching_score: 92.5,
    matching_metrics: { capacityDeltaAh: 0.04, ocvDeltaV: 0.002, irDeltaMohm: 0.01 },
    created_at: iso(15 - (index % 8), 9),
    updated_at: iso(index % 4, 14),
  }));
  ensure(await supabase.from('modules').upsert(modules, { onConflict: 'id' }), 'modules');

  const racks = ['IN_STOCK', 'IN_RACK', 'SOLD', 'SCRAP'].map((status, index) => ({
    id: `rack-demo-${index + 1}`,
    serial_number: `DEMO-R-${String(index + 1).padStart(4, '0')}`,
    qr_code: `DEMO-R-QR-${index + 1}`,
    rack_template_code: index % 2 === 0 ? 'RACK_25KWH' : 'RACK_75KWH',
    status,
    required_pack_count: index % 2 === 0 ? 5 : 10,
    required_pack_template_code: index % 2 === 0 ? 'PACK_5KWH' : 'PACK_7_5KWH',
    location: `DEMO-RACK-${index + 1}`,
  }));
  ensure(await supabase.from('racks').upsert(racks, { onConflict: 'id' }), 'racks');

  const quarantines = [
    { id: 'quarantine-demo-open', entity_type: 'CELL', entity_id: 'cell-demo-81', reason: 'Demo IR out of tolerance', status: 'OPEN' },
    { id: 'quarantine-demo-resolved', entity_type: 'BATTERY', entity_id: 'battery-demo-10', reason: 'Demo enclosure rework', status: 'RESOLVED', resolved_at: iso(2, 16) },
  ];
  ensure(await supabase.from('quarantine_records').upsert(quarantines, { onConflict: 'id' }), 'quarantine records');

  const auditLogs = [
    { id: 'audit-demo-ceo-1', entity_type: 'SYSTEM', entity_id: 'CEO-DASHBOARD', action: 'DEMO_SEED', actor: 'SYSTEM', result: 'SUCCESS', details: 'CEO monitoring demo data seeded' },
    { id: 'audit-demo-ceo-2', entity_type: 'IMPORT', entity_id: 'DEMO-IMPORT', action: 'BULK_IMPORT', actor: 'SYSTEM', result: 'SUCCESS', details: `${cells.length} demo cells linked to two suppliers` },
  ];
  const auditInsert = await supabase.from('audit_logs').insert(auditLogs);
  if (auditInsert.error && auditInsert.error.code !== '23505') ensure(auditInsert, 'audit logs');

  console.log(`Seeded ${cells.length} cells, ${batteries.length} batteries, ${modules.length} modules, ${orders.length} orders, and all supported statuses in Supabase.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
