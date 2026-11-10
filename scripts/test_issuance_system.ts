import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getIssuedDisplayStatus, isItemIssued } from '../src/lib/issuance';

const adminClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const BASE_URL = 'http://localhost:3000';
let authToken = '';

async function issueViaApi(payload: any) {
  const res = await fetch(`${BASE_URL}/api/inventory/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function returnViaApi(payload: any) {
  const res = await fetch(`${BASE_URL}/api/inventory/return`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runIssuanceTest() {
  console.log('--- Starting Comprehensive Issuance Subsystem Validation ---');

  // Authenticate
  const { data: authData, error: authError } = await adminClient.auth.signInWithPassword({
    email: 'admin@gmail.com',
    password: 'admin123456'
  });
  if (authError || !authData.session) {
    throw new Error(`Authentication failed: ${authError?.message}`);
  }
  authToken = authData.session.access_token;
  console.log('✅ Authenticated as admin operator.');

  // 1. Test getIssuedDisplayStatus helper
  console.log('\n1. Testing display format helper...');
  const itemWithDept = {
    issuedToPerson: 'Ali Khan',
    issuedToDepartment: 'Testing & QA',
  };
  const itemWithoutDept = {
    issuedToPerson: 'Hamza Farooq',
    issuedToDepartment: '',
  };
  const itemNotIssued = {
    issuedToPerson: null,
  };

  if (getIssuedDisplayStatus(itemWithDept) !== 'ISSUED (Testing & QA)') {
    throw new Error(`Expected 'ISSUED (Testing & QA)', got '${getIssuedDisplayStatus(itemWithDept)}'`);
  }
  if (getIssuedDisplayStatus(itemWithoutDept) !== 'ISSUED (Hamza Farooq)') {
    throw new Error(`Expected 'ISSUED (Hamza Farooq)', got '${getIssuedDisplayStatus(itemWithoutDept)}'`);
  }
  if (getIssuedDisplayStatus(itemNotIssued) !== null) {
    throw new Error(`Expected null, got '${getIssuedDisplayStatus(itemNotIssued)}'`);
  }
  if (!isItemIssued(itemWithDept) || !isItemIssued(itemWithoutDept) || isItemIssued(itemNotIssued)) {
    throw new Error('isItemIssued returned incorrect boolean values');
  }
  console.log('✅ Display status helper verified.');

  const issuerName = 'Administrator';

  // 2. Test Cell Issuance
  console.log('\n2. Testing Cell Issuance...');
  const { data: cells } = await adminClient.from('cells').select('*').limit(1);
  const cell = cells![0];
  console.log(`Issuing Cell: ${cell.internal_serial} (ID: ${cell.id})`);
  await issueViaApi({
    entityType: 'CELL',
    entityId: cell.id,
    serialNumber: cell.internal_serial,
    person: 'Ali Khan',
    department: 'Testing & QA',
    issuedBy: issuerName,
  });

  const { data: dbCell } = await adminClient.from('cells').select('*').eq('id', cell.id).single();
  console.log('DB Cell Status:', getIssuedDisplayStatus(dbCell));
  if (dbCell.issued_to_person !== 'Ali Khan' || dbCell.issued_to_department !== 'Testing & QA') {
    throw new Error('Cell issuance DB write failed');
  }
  if (getIssuedDisplayStatus(dbCell) !== 'ISSUED (Testing & QA)') {
    throw new Error(`Cell display status mismatch: ${getIssuedDisplayStatus(dbCell)}`);
  }

  await returnViaApi({
    entityType: 'CELL',
    entityId: cell.id,
    serialNumber: cell.internal_serial,
    returnedBy: issuerName,
  });
  const { data: dbCellReturned } = await adminClient.from('cells').select('*').eq('id', cell.id).single();
  if (dbCellReturned.issued_to_person !== null) throw new Error('Cell return clear failed');
  console.log('✅ Cell Issue & Return Cycle passed.');

  // 3. Test BMS Issuance
  console.log('\n3. Testing BMS Issuance...');
  const { data: bmsUnits } = await adminClient.from('bms_units').select('*').limit(1);
  const bms = bmsUnits![0];
  console.log(`Issuing BMS: ${bms.serial_number} (ID: ${bms.id})`);
  await issueViaApi({
    entityType: 'BMS',
    entityId: bms.id,
    serialNumber: bms.serial_number,
    person: 'Sara Ahmed',
    department: 'Firmware Dev',
    issuedBy: issuerName,
  });

  const { data: dbBms } = await adminClient.from('bms_units').select('*').eq('id', bms.id).single();
  console.log('DB BMS Status:', getIssuedDisplayStatus(dbBms));
  if (dbBms.issued_to_person !== 'Sara Ahmed' || getIssuedDisplayStatus(dbBms) !== 'ISSUED (Firmware Dev)') {
    throw new Error('BMS issuance verification failed');
  }

  await returnViaApi({
    entityType: 'BMS',
    entityId: bms.id,
    serialNumber: bms.serial_number,
    returnedBy: issuerName,
  });
  const { data: dbBmsReturned } = await adminClient.from('bms_units').select('*').eq('id', bms.id).single();
  if (dbBmsReturned.issued_to_person !== null) throw new Error('BMS return failed');
  console.log('✅ BMS Issue & Return Cycle passed.');

  // 4. Test BMU Issuance (with optional department omitted -> person fallback)
  console.log('\n4. Testing BMU Issuance...');
  const { data: bmuUnits } = await adminClient.from('bmu_units').select('*').limit(1);
  const bmu = bmuUnits![0];
  console.log(`Issuing BMU: ${bmu.serial_number} (ID: ${bmu.id})`);
  await issueViaApi({
    entityType: 'BMU',
    entityId: bmu.id,
    serialNumber: bmu.serial_number,
    person: 'Hamza Farooq',
    // Department omitted
    issuedBy: issuerName,
  });

  const { data: dbBmu } = await adminClient.from('bmu_units').select('*').eq('id', bmu.id).single();
  console.log('DB BMU Status:', getIssuedDisplayStatus(dbBmu));
  if (dbBmu.issued_to_person !== 'Hamza Farooq' || getIssuedDisplayStatus(dbBmu) !== 'ISSUED (Hamza Farooq)') {
    throw new Error(`BMU person-only fallback mismatch: ${getIssuedDisplayStatus(dbBmu)}`);
  }

  await returnViaApi({
    entityType: 'BMU',
    entityId: bmu.id,
    serialNumber: bmu.serial_number,
    returnedBy: issuerName,
  });
  const { data: dbBmuReturned } = await adminClient.from('bmu_units').select('*').eq('id', bmu.id).single();
  if (dbBmuReturned.issued_to_person !== null) throw new Error('BMU return failed');
  console.log('✅ BMU Issue & Return Cycle passed.');

  // 5. Test Module Issuance
  console.log('\n5. Testing Module Issuance...');
  const { data: modules } = await adminClient.from('modules').select('*').limit(1);
  const moduleItem = modules![0];
  console.log(`Issuing Module: ${moduleItem.serial_number} (ID: ${moduleItem.id})`);
  await issueViaApi({
    entityType: 'MODULE',
    entityId: moduleItem.id,
    serialNumber: moduleItem.serial_number,
    person: 'Usman Ghani',
    department: 'Spot Welding',
    issuedBy: issuerName,
  });

  const { data: dbMod } = await adminClient.from('modules').select('*').eq('id', moduleItem.id).single();
  console.log('DB Module Status:', getIssuedDisplayStatus(dbMod));
  if (dbMod.issued_to_person !== 'Usman Ghani' || getIssuedDisplayStatus(dbMod) !== 'ISSUED (Spot Welding)') {
    throw new Error('Module issuance verification failed');
  }

  await returnViaApi({
    entityType: 'MODULE',
    entityId: moduleItem.id,
    serialNumber: moduleItem.serial_number,
    returnedBy: issuerName,
  });
  const { data: dbModReturned } = await adminClient.from('modules').select('*').eq('id', moduleItem.id).single();
  if (dbModReturned.issued_to_person !== null) throw new Error('Module return failed');
  console.log('✅ Module Issue & Return Cycle passed.');

  // 6. Test Battery Pack Issuance
  console.log('\n6. Testing Battery Pack Issuance...');
  const { data: batteries } = await adminClient.from('batteries').select('*').limit(1);
  const battery = batteries![0];
  console.log(`Issuing Battery: ${battery.serial_number} (ID: ${battery.id})`);
  await issueViaApi({
    entityType: 'BATTERY',
    entityId: battery.id,
    serialNumber: battery.serial_number,
    person: 'Kamran Akmal',
    department: 'Field Trial',
    issuedBy: issuerName,
  });

  const { data: dbBat } = await adminClient.from('batteries').select('*').eq('id', battery.id).single();
  console.log('DB Battery Status:', getIssuedDisplayStatus(dbBat));
  if (dbBat.issued_to_person !== 'Kamran Akmal' || getIssuedDisplayStatus(dbBat) !== 'ISSUED (Field Trial)') {
    throw new Error('Battery pack issuance verification failed');
  }

  await returnViaApi({
    entityType: 'BATTERY',
    entityId: battery.id,
    serialNumber: battery.serial_number,
    returnedBy: issuerName,
  });
  const { data: dbBatReturned } = await adminClient.from('batteries').select('*').eq('id', battery.id).single();
  if (dbBatReturned.issued_to_person !== null) throw new Error('Battery return failed');
  console.log('✅ Battery Pack Issue & Return Cycle passed.');

  // 7. Test Rack Issuance
  console.log('\n7. Testing Rack Issuance...');
  const { data: racks } = await adminClient.from('racks').select('*').limit(1);
  const rack = racks![0];
  const rackSerial = rack.serial_number || rack.id;
  console.log(`Issuing Rack: ${rackSerial} (ID: ${rack.id})`);
  await issueViaApi({
    entityType: 'RACK',
    entityId: rack.id,
    serialNumber: rackSerial,
    person: 'Zahid Khan',
    department: 'Site Installation',
    issuedBy: issuerName,
  });

  const { data: dbRack } = await adminClient.from('racks').select('*').eq('id', rack.id).single();
  console.log('DB Rack Status:', getIssuedDisplayStatus(dbRack));
  if (dbRack.issued_to_person !== 'Zahid Khan' || getIssuedDisplayStatus(dbRack) !== 'ISSUED (Site Installation)') {
    throw new Error('Rack issuance verification failed');
  }

  await returnViaApi({
    entityType: 'RACK',
    entityId: rack.id,
    serialNumber: rackSerial,
    returnedBy: issuerName,
  });
  const { data: dbRackReturned } = await adminClient.from('racks').select('*').eq('id', rack.id).single();
  if (dbRackReturned.issued_to_person !== null) throw new Error('Rack return failed');
  console.log('✅ Rack Issue & Return Cycle passed.');

  // 8. Verify Audit Logs were created
  console.log('\n8. Verifying Audit Logs...');
  const { data: auditLogs } = await adminClient
    .from('audit_logs')
    .select('*')
    .ilike('action', '%ISSUED%')
    .order('timestamp', { ascending: false })
    .limit(6);
  console.log(`Found ${auditLogs?.length || 0} recent issuance audit log entries.`);
  if (!auditLogs || auditLogs.length === 0) {
    throw new Error('Expected issuance audit logs to be recorded');
  }
  console.log('Sample audit log:', auditLogs[0].action);
  console.log('✅ Audit log verification passed.');

  console.log('\n=============================================================');
  console.log('🎉 ALL 6 ENTITY TYPES ISSUED, VERIFIED, AND RETURNED SUCCESSFULLY!');
  console.log('   - Cells: ISSUED & RETURNED ✅');
  console.log('   - BMS Units: ISSUED & RETURNED ✅');
  console.log('   - BMU Units: ISSUED & RETURNED (with person fallback) ✅');
  console.log('   - Modules: ISSUED & RETURNED ✅');
  console.log('   - Battery Packs: ISSUED & RETURNED ✅');
  console.log('   - Racks: ISSUED & RETURNED ✅');
  console.log('   - Audit Trail: Recorded ✅');
  console.log('=============================================================');
}

runIssuanceTest().catch(err => {
  console.error('\n❌ Comprehensive issuance test failed:', err);
  process.exit(1);
});
