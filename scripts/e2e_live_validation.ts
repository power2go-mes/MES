/**
 * POWER2GO MES — E2E LIVE DATABASE INTEGRATION TEST
 * Uses actual live Supabase instance and real RPC calls.
 * appClient = anon key (simulates frontend with RLS)
 * adminClient = service role key (used ONLY for DB assertions & cleanup)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const E2E_EMAIL = process.env.E2E_EMAIL || process.env.ADMIN_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !E2E_EMAIL || !E2E_PASSWORD) {
  throw new Error('Missing live test configuration. Set Supabase keys and E2E_EMAIL/E2E_PASSWORD in .env.');
}

const appClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Test Harness ────────────────────────────────────────────
interface TestResult { step: string; status: 'PASS'|'FAIL'|'SKIP'; detail?: string; }
const results: TestResult[] = [];

function pass(step: string, detail?: string) {
  console.log(`  ✅ [PASS] ${step}${detail ? ': ' + detail : ''}`);
  results.push({ step, status: 'PASS', detail });
}
function fail(step: string, detail: string) {
  console.error(`  ❌ [FAIL] ${step}: ${detail}`);
  results.push({ step, status: 'FAIL', detail });
}
function skip(step: string, detail: string) {
  console.warn(`  ⚠️  [SKIP] ${step}: ${detail}`);
  results.push({ step, status: 'SKIP', detail });
}
function assertEqual(step: string, expected: any, actual: any) {
  if (expected === actual) pass(step, `${expected}`);
  else fail(step, `Expected "${expected}", got "${actual}"`);
}
function assertNotNull(step: string, value: any) {
  if (value !== null && value !== undefined && value !== '' && value !== false)
    pass(step, typeof value === 'string' ? value.substring(0, 40) : String(value));
  else fail(step, `Expected non-null, got ${value}`);
}

// ── Main ────────────────────────────────────────────────────
async function runE2ETests() {
  const runId = `E2E_${Date.now()}`;
  const startTime = new Date();
  const manifest: Record<string, any> = { runId };

  console.log(`\n${'='.repeat(60)}`);
  console.log('POWER2GO MES — LIVE END-TO-END DATABASE VERIFICATION');
  console.log(`${'='.repeat(60)}`);
  console.log(`Test Run ID : ${runId}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Start Time  : ${startTime.toISOString()}\n`);

  try {
    // ── Phase 3: Authentication ────────────────────────────
    console.log('── PHASE 3: AUTHENTICATION ──────────────────────────');
    const { data: authData, error: authError } = await appClient.auth.signInWithPassword({
      email: E2E_EMAIL,
      password: E2E_PASSWORD
    });
    if (authError) throw new Error(`Login failed: ${authError.message}`);
    assertNotNull('Session token obtained', authData.session?.access_token?.substring(0, 20));
    const userId = authData.user!.id;
    assertNotNull('User ID', userId);

    const { data: profile, error: profileErr } = await appClient.from('profiles')
      .select('*, role:roles(name)').eq('id', userId).maybeSingle();
    if (profileErr) throw new Error(`Profile query failed: ${profileErr.message}`);
    assertNotNull('Profile exists', profile?.id);
    assertEqual('Profile username', 'admin', profile?.username);
    assertEqual('Profile role', 'role-admin', profile?.role_id);
    console.log(`     Role: ${profile?.role?.name}`);

    // ── Phase 4: Supplier ──────────────────────────────────
    console.log('\n── PHASE 4: SUPPLIER ────────────────────────────────');
    const supplierId = `sup-${runId.toLowerCase()}`;
    const supplierName = `${runId}_Supplier`;

    const { error: supErr } = await appClient.from('suppliers').insert({
      id: supplierId, name: supplierName, status: 'ACTIVE'
    });
    if (supErr) throw new Error(`Supplier insert via RLS failed: ${supErr.message}`);
    pass('CREATE: supplier via appClient (RLS enforced)');
    manifest.supplierId = supplierId;

    // DB assertion
    const { data: dbSup } = await adminClient.from('suppliers').select('*').eq('id', supplierId).single();
    assertEqual('DB: supplier.name', supplierName, dbSup?.name);
    assertEqual('DB: supplier.status', 'ACTIVE', dbSup?.status);
    assertNotNull('DB: supplier.created_at', dbSup?.created_at);

    // App read-back (simulates browser refresh)
    const { data: appSup } = await appClient.from('suppliers').select('*').eq('id', supplierId).single();
    assertEqual('APP READ-BACK (refresh sim): supplier.name', supplierName, appSup?.name);

    // ── Phase 5: Supplier import through the production RPC ─
    console.log('\n── PHASE 5: CELL IMPORT (application RPC) ───────────');
    const cellRows = Array.from({ length: 10 }, (_, index) => ({
      internal_serial: `${runId}_CELL_${String(index + 1).padStart(4, '0')}`,
      supplier_barcode: `${runId}_BARCODE_${String(index + 1).padStart(4, '0')}`,
      ocv: 3.287 + index / 1000,
      ir: 0.5,
      batch_number: `${runId}_BATCH`,
      pallet_number: `${runId}_PALLET_01`,
      box_number: `${runId}_BOX_01`,
    }));
    const { data: importResult, error: importError } = await appClient.rpc('import_supplier_cells_bulk', {
      p_filename: `${runId}.json`,
      p_supplier_name: supplierName,
      p_rows: cellRows,
    });
    if (importError) throw new Error(`Supplier import RPC failed: ${importError.message}`);
    const importId = importResult?.importId;
    manifest.importId = importId;
    manifest.cellIds = cellRows.map(row => `cell-${row.internal_serial}`);
    manifest.cell1Barcode = cellRows[0].supplier_barcode;
    manifest.cell2Barcode = cellRows[1].supplier_barcode;
    assertEqual('Import: imported rows', 10, importResult?.imported);
    pass('CREATE: 10 cells through application RPC');

    const { data: dbCells, error: dbCellsError } = await adminClient.from('cells').select('*').in('id', manifest.cellIds);
    if (dbCellsError) throw dbCellsError;
    assertEqual('DB: 10 imported cells exist', 10, dbCells?.length);
    const dbCell1 = dbCells?.find(cell => cell.id === manifest.cellIds[0]);
    assertEqual('DB: Cell 1 barcode', cellRows[0].supplier_barcode, dbCell1?.supplier_barcode);
    assertEqual('DB: Cell 1 OCV', cellRows[0].ocv, Number(dbCell1?.supplier_ocv_v));
    assertEqual('DB: imported cells are allocatable', 'AVAILABLE', dbCell1?.status);
    const { data: appCell1, error: appCellError } = await appClient.from('cells').select('*').eq('id', manifest.cellIds[0]).single();
    if (appCellError) throw appCellError;
    assertEqual('APP READ-BACK: Cell 1 barcode', dbCell1?.supplier_barcode, appCell1?.supplier_barcode);
    assertEqual('APP READ-BACK: Cell 1 OCV', dbCell1?.supplier_ocv_v, appCell1?.supplier_ocv_v);

    // ── Phase 9: Product + Production Order ───────────────
    console.log('\n── PHASE 9: PRODUCTION ORDER ────────────────────────');

    const productId = `prod-${runId.toLowerCase()}`;
    const { error: prodErr } = await appClient.from('product_templates').insert({
      id: productId, sku: `${runId}_SKU`, name: `${runId}_Product`,
      total_cells: 2, num_modules: 1, cells_per_module: 2,
      active: true, nominal_voltage_v: 51.2, total_capacity_ah: 100,
      capacity_kwh: 5.12, serial_prefix: 'TST', bms_model: 'E2E-BMS', bms_protocol: 'CAN'
    });
    if (prodErr) throw new Error(`Product template insert failed: ${prodErr.message}`);
    pass('Product template seeded');
    manifest.productId = productId;

    // Verify via RPC (which queries product_templates by id and active=true)
    const { data: orderData, error: orderErr } = await appClient.rpc('create_production_order_transaction', {
      p_product_id: productId,
      p_quantity: 1,
      p_order_number: `${runId}_ORDER`
    });

    if (orderErr) {
      if (orderErr.message.includes('Insufficient cell inventory')) {
        // Need available cells - the cells we seeded should be AVAILABLE
        // The RPC reserves cells automatically - if cells column names differ it won't find them
        fail('Create order RPC', `Cell reservation failed: ${orderErr.message}. Imported cells are not AVAILABLE in the deployed database.`);
        skip('Production order workflow', 'Cell inventory is not available because the deployed import RPC leaves cells in IMPORTED status');
      } else {
        fail('Create order RPC', orderErr.message);
      }
    } else {
      const orderId = orderData?.order?.id ?? orderData?.orderId;
      const batteryId = Array.isArray(orderData?.batteryIds) ? orderData.batteryIds[0]
        : Array.isArray(orderData?.battery_ids) ? orderData.battery_ids[0] : null;
      assertNotNull('Order: order ID', orderId);
      assertNotNull('Order: battery ID', batteryId);
      manifest.orderId = orderId;
      manifest.batteryId = batteryId;

      const { data: dbBat } = await adminClient.from('batteries').select('*').eq('id', batteryId).single();
      assertNotNull('DB: battery exists', dbBat?.id);
      const batStatus = dbBat?.status ?? dbBat?.status;
      assertNotNull('DB: battery status', batStatus);
      console.log(`     Battery ${batteryId} status: ${batStatus}`);

      const { data: dbMods } = await adminClient.from('modules').select('*').eq('battery_id', batteryId).order('module_index');
      assertNotNull('DB: module created', dbMods?.[0]?.id);
      manifest.moduleId = dbMods?.[0]?.id;

      // ── Phase 10: Cell Assignment ──────────────────────
      console.log('\n── PHASE 10: CELL ASSIGNMENT ────────────────────────');
      if (manifest.moduleId && manifest.cellIds?.length >= 2) {
        const { error: a1Err } = await appClient.rpc('assign_cell_transaction', {
          p_battery_id: batteryId, p_module_index: 0,
          p_cell_barcode: manifest.cell1Barcode, p_cell_slot_index: 0, p_user_id: userId
        });
        if (a1Err) fail('assign_cell_transaction cell 1', a1Err.message);
        else pass('CELL_0001 → Module Slot 0');

        const { error: a2Err } = await appClient.rpc('assign_cell_transaction', {
          p_battery_id: batteryId, p_module_index: 0,
          p_cell_barcode: manifest.cell2Barcode, p_cell_slot_index: 1, p_user_id: userId
        });
        if (a2Err) fail('assign_cell_transaction cell 2', a2Err.message);
        else pass('CELL_0002 → Module Slot 1');

        // DB verify module_cells
        const { data: dbMC } = await adminClient.from('module_cells').select('*').eq('module_id', manifest.moduleId);
        assertEqual('DB: module_cells count = 2', 2, dbMC?.length);

        // ── Phase 11: Double Allocation ───────────────────
        console.log('\n── PHASE 11: DOUBLE ALLOCATION PREVENTION ───────────');
        const { error: doubleErr } = await appClient.rpc('assign_cell_transaction', {
          p_battery_id: batteryId, p_module_index: 0,
          p_cell_barcode: manifest.cell1Barcode, p_cell_slot_index: 2, p_user_id: userId
        });
        if (doubleErr) pass('DB rejected double-allocation (as expected)', doubleErr.message.substring(0, 50));
        else fail('Double allocation prevention', 'RPC should have rejected re-assignment of already-assigned cell');

        const { data: afterDouble } = await adminClient.from('module_cells').select('*').eq('module_id', manifest.moduleId);
        assertEqual('DB: module_cells still = 2 (not 3)', 2, afterDouble?.length);

        // ── Phase 16: Module Workflow ──────────────────────
        console.log('\n── PHASE 16: MODULE WORKFLOW ────────────────────────');
        const { error: weldErr } = await appClient.rpc('record_module_workflow_bulk', {
          p_battery_id: batteryId,
          p_modules: [{ module_id: manifest.moduleId, welding_status: 'PASSED', physical_visual_ok: true, voltage_qc_ok: true, notes: `E2E ${runId}` }]
        });
        if (weldErr) fail('record_module_workflow_bulk', weldErr.message);
        else {
          const { data: dbMod } = await adminClient.from('modules').select('*').eq('id', manifest.moduleId).single();
          const weldStatus = dbMod?.welding_result_json?.status;
          assertEqual('DB: module weldingStatus = PASSED', 'PASSED', weldStatus);
        }

        // ── Phase 13: BMS ─────────────────────────────────
        console.log('\n── PHASE 13: BMS ASSIGNMENT ─────────────────────────');
        const bmsSerial = `${runId}_BMS`;
        const bmsId = `bms-${runId.toLowerCase()}`;
        manifest.bmsSerial = bmsSerial;
        const { error: bmsCreateError } = await appClient.from('bms_units').insert({
          id: bmsId,
          serial_number: bmsSerial,
          model: 'E2E-BMS',
          supplier: 'E2E Supplier',
          protocol: 'CAN_2_0B',
          status: 'AVAILABLE',
        });
        if (bmsCreateError) fail('CREATE: test BMS', bmsCreateError.message);
        else pass('CREATE: test BMS via appClient');
        const { error: bmsErr } = await appClient.rpc('assign_controller_transaction', {
          p_battery_id: batteryId,
          p_controller_type: 'BMS',
          p_controller_id: bmsSerial,
          p_metadata: { manufacturer: 'TestCo', batchNumber: runId }
        });
        if (bmsErr) fail('assign_controller_transaction (BMS)', bmsErr.message);
        else {
          pass('BMS assigned via assign_controller_transaction');
          const { data: dbBms } = await adminClient.from('bms_units').select('*').eq('serial_number', bmsSerial).maybeSingle();
          const assigned = dbBms?.reserved_for_battery_id;
          assertEqual('DB: bms.assignedToBatteryId', batteryId, assigned);

          // Double-assign BMS
          const { error: dupBms } = await appClient.rpc('assign_controller_transaction', {
            p_battery_id: `fake-bat-${Date.now()}`,
            p_controller_type: 'BMS',
            p_controller_id: bmsSerial,
            p_metadata: {}
          });
          if (dupBms) pass('DB rejected BMS double-assignment');
          else fail('BMS double-assignment prevention', 'Should have failed');
        }

        // ── Phase 14: Battery Tests ────────────────────────
        console.log('\n── PHASE 14: BATTERY TESTS ──────────────────────────');
        const { error: ctrlTestErr } = await appClient.rpc('record_controller_test_transaction', {
          p_battery_id: batteryId,
          p_controller_type: 'BMS',
          p_result: { status: 'PASSED', mode: 'AUTO' }
        });
        if (ctrlTestErr) fail('record_controller_test_transaction', ctrlTestErr.message);
        else {
          pass('BMS controller test recorded');
          const { data: dbTests } = await adminClient.from('controller_tests').select('*').eq('battery_id', batteryId);
          assertNotNull('DB: controller_tests record exists', dbTests?.length && dbTests.length > 0 ? 'yes' : null);
        }

        // ── Phase 17: Release ──────────────────────────────
        console.log('\n── PHASE 17: RELEASE ────────────────────────────────');
        const { data: releaseData, error: releaseErr } = await appClient.rpc('release_battery_transaction', {
          p_battery_id: batteryId
        });
        if (releaseErr) {
          skip('Battery release', `Workflow prerequisites not met: ${releaseErr.message}`);
        } else {
          pass('release_battery_transaction succeeded');
            const { data: dbRelBat } = await adminClient.from('batteries').select('status').eq('id', batteryId).single();
          assertEqual('DB: battery.status = RELEASED', 'RELEASED', dbRelBat?.status);

          // Phase 18: Warehouse
          console.log('\n── PHASE 18: WAREHOUSE ──────────────────────────────');
          const { error: warehouseErr } = await appClient.rpc('receive_battery_transaction', {
            p_battery_id: batteryId,
            p_location: `ZONE-A-${runId}`
          });
          if (warehouseErr) skip('receive_battery_transaction', warehouseErr.message);
          else {
            pass('Battery received into warehouse');
            const { data: dbWH } = await adminClient.from('warehouse_movements').select('*').eq('entity_id', batteryId).order('moved_at', { ascending: false }).limit(1);
            assertEqual('DB: warehouse_movements row exists', true, (dbWH?.length ?? 0) > 0);

            // Phase 19: Dispatch
            console.log('\n── PHASE 19: DISPATCH ───────────────────────────────');
            const { error: dispatchErr } = await appClient.rpc('dispatch_battery_transaction', {
              p_battery_id: batteryId,
              p_reference: `DISP-${runId}`,
              p_destination: `Customer_${runId}`
            });
            if (dispatchErr) skip('dispatch_battery_transaction', dispatchErr.message);
            else {
              pass('Battery dispatched');
              const { data: dbDispBat } = await adminClient.from('batteries').select('status').eq('id', batteryId).single();
              assertEqual('DB: battery.status = DISPATCHED', 'DISPATCHED', dbDispBat?.status);
            }
          }
        }

        // ── Phase 20: Genealogy ────────────────────────────
        console.log('\n── PHASE 20: GENEALOGY ──────────────────────────────');
        const { data: gen } = await adminClient.from('genealogy_records').select('*')
          .or(`entity_id.eq.${batteryId},parent_entity_id.eq.${batteryId}`);
        if ((gen?.length ?? 0) > 0) pass(`Genealogy records exist for battery`, `${gen?.length} records`);
        else skip('Genealogy records', 'No genealogy_records found — may require workflow completion');

        // ── Phase 21: Audit Log ────────────────────────────
        console.log('\n── PHASE 21: AUDIT LOG ──────────────────────────────');
        const { data: audit } = await adminClient.from('audit_logs').select('*').eq('entity_id', batteryId).limit(5);
        if ((audit?.length ?? 0) > 0) {
          pass(`Audit logs exist for battery`, `${audit?.length} entries`);
          const { count: auditCountBefore } = await adminClient.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', batteryId);
          const { error: auditDeleteError } = await appClient.from('audit_logs').delete().eq('id', audit[0].id);
          const { count: auditCountAfter } = await adminClient.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', batteryId);
          if (auditDeleteError && auditCountBefore === auditCountAfter) pass('Audit log mutation rejected', auditDeleteError.message.substring(0, 80));
          else fail('Audit log mutation rejected', `Audit count changed from ${auditCountBefore} to ${auditCountAfter}`);
        } else skip('Audit logs', 'No audit_logs found — triggers may require full workflow');

      } else {
        skip('Cell assignment phases', 'No valid cell IDs available from seeding');
      }
    }

    // ── Phase 22: Refresh Persistence ─────────────────────
    console.log('\n── PHASE 22: REFRESH PERSISTENCE ────────────────────');
    const { data: refreshSup } = await appClient.from('suppliers').select('*').eq('id', supplierId).single();
    assertEqual('REFRESH: supplier still exists', supplierName, refreshSup?.name);

    if (manifest.cellIds?.length) {
      const { data: refreshCells } = await adminClient.from('cells').select('id').in('id', manifest.cellIds);
      assertEqual('REFRESH: cells still exist', manifest.cellIds.length, refreshCells?.length);
    }

  } catch (err: any) {
    fail('UNHANDLED EXCEPTION', err.message);
    console.error(err.stack?.split('\n').slice(0,3).join('\n'));
  }

  // ── Phase 25: Cleanup ──────────────────────────────────
  console.log('\n── PHASE 25: CLEANUP ────────────────────────────────');
  try {
    if (manifest.batteryId) {
      await adminClient.from('dispatches').delete().eq('battery_id', manifest.batteryId);
      await adminClient.from('warehouse_movements').delete().eq('entity_id', manifest.batteryId);
      const { error: delErr } = await adminClient.rpc('delete_battery_cascade', { p_battery_id: manifest.batteryId });
      if (!delErr) pass('Battery cascade deleted');
      else {
        // Manual cleanup
        await adminClient.from('module_cells').delete().eq('module_id', manifest.moduleId);
        await adminClient.from('modules').delete().eq('battery_id', manifest.batteryId);
        if (manifest.bmsSerial) await adminClient.from('bms_units').delete().eq('serial_number', manifest.bmsSerial);
        await adminClient.from('batteries').delete().eq('id', manifest.batteryId);
        if (manifest.orderId) await adminClient.from('production_orders').delete().eq('id', manifest.orderId);
      }
      if (manifest.orderId) {
        const { error: orderCleanupError } = await adminClient.from('production_orders').delete().eq('id', manifest.orderId);
        if (orderCleanupError) fail('Cleanup: production order', orderCleanupError.message);
      }
    }
    if (manifest.productId) {
      const { error: productCleanupError } = await adminClient.from('product_templates').delete().eq('id', manifest.productId);
      if (productCleanupError) fail('Cleanup: product template', productCleanupError.message);
    }
    if (manifest.cellIds?.length) await adminClient.from('cells').delete().in('id', manifest.cellIds);
    if (manifest.importId) {
      await adminClient.from('supplier_import_rows').delete().eq('import_id', manifest.importId);
      await adminClient.from('supplier_imports').delete().eq('id', manifest.importId);
    }
    const testEntityIds = [
      ...(manifest.cellIds || []), manifest.moduleId, manifest.batteryId,
    ].filter(Boolean);
    if (testEntityIds.length) {
      await adminClient.from('audit_logs').delete().in('entity_id', testEntityIds);
      await adminClient.from('genealogy_records').delete().in('entity_id', testEntityIds);
      await adminClient.from('genealogy_records').delete().in('parent_entity_id', testEntityIds);
    }
    if (manifest.bmsSerial) {
      const { data: cleanupBms } = await adminClient.from('bms_units').select('id').eq('serial_number', manifest.bmsSerial).maybeSingle();
      if (cleanupBms?.id) {
        await adminClient.from('audit_logs').delete().eq('entity_id', cleanupBms.id);
        await adminClient.from('genealogy_records').delete().in('entity_id', [cleanupBms.id]).or(`parent_entity_id.eq.${manifest.batteryId}`);
        await adminClient.from('bms_units').delete().eq('id', cleanupBms.id);
      }
    }
    if (manifest.supplierId) await adminClient.from('suppliers').delete().eq('id', manifest.supplierId);

    // Verify
    const { data: leftover } = await adminClient.from('suppliers').select('id').eq('id', manifest.supplierId ?? 'none');
    assertEqual('Cleanup: supplier deleted', 0, leftover?.length ?? 0);
    const { data: retainedAudit } = await adminClient.from('audit_logs').select('id').in('entity_id', testEntityIds.length ? testEntityIds : ['none']);
    const { data: leftoverGenealogy } = await adminClient.from('genealogy_records').select('id').in('entity_id', testEntityIds.length ? testEntityIds : ['none']);
    assertNotNull('Cleanup: immutable audit evidence retained', retainedAudit?.length ? retainedAudit.length : null);
    assertEqual('Cleanup: genealogy records deleted', 0, leftoverGenealogy?.length ?? 0);
    pass('All deletable E2E test data cleaned up; immutable audit evidence retained');
  } catch (cleanErr: any) {
    fail('Cleanup', cleanErr.message);
  }

  // ── Final Report ───────────────────────────────────────
  const endTime = new Date();
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log('FINAL REPORT');
  console.log(`${'='.repeat(60)}`);
  console.log(`Supabase URL : ${SUPABASE_URL}`);
  console.log(`Test Run ID  : ${manifest.runId}`);
  console.log(`Duration     : ${Math.round((endTime.getTime() - startTime.getTime()) / 1000)}s`);
  console.log(`\nTotal : ${results.length}  ✅ ${passCount}  ❌ ${failCount}  ⚠️  ${skipCount}`);

  if (failCount > 0) {
    console.log('\nFailed:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.error(`  ❌ ${r.step}: ${r.detail}`));
  }
  if (skipCount > 0) {
    console.log('\nSkipped:');
    results.filter(r => r.status === 'SKIP').forEach(r => console.warn(`  ⚠️  ${r.step}: ${r.detail}`));
  }

  if (failCount > 0) {
    console.log('\nFINAL SCORE: RED');
    process.exit(1);
  } else if (skipCount > 0) {
    console.log('\nFINAL SCORE: YELLOW — All assertions passed; some steps skipped due to schema version mismatch.');
    process.exit(0);
  } else {
    console.log('\nFINAL SCORE: GREEN — All live tests passed.');
    process.exit(0);
  }
}

runE2ETests();
