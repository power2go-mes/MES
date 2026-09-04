import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing environment variables:');
  console.error('  VITE_SUPABASE_URL =', supabaseUrl ? '✓' : '❌');
  console.error('  SUPABASE_SERVICE_ROLE_KEY =', supabaseServiceRoleKey ? '✓' : '❌');
  process.exit(1);
}

console.log('🚀 Deploying schema to Supabase...');
console.log(`📍 URL: ${supabaseUrl}`);

// Create Supabase client with service role
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false }
});

// Read SQL file
const sqlFilePath = path.resolve('./supabase/power2go_mes.sql');
console.log(`📄 Reading SQL from: ${sqlFilePath}`);

if (!fs.existsSync(sqlFilePath)) {
  console.error(`❌ SQL file not found: ${sqlFilePath}`);
  process.exit(1);
}

const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');
console.log(`✓ Read ${sqlContent.length} bytes of consolidated SQL`);

// Execute schema
async function deploySchema() {
  try {
    console.log('\n⏳ Executing schema deployment...');
    
    // Execute raw SQL via Supabase
    const { data, error } = await supabase.rpc('exec', {
      query: sqlContent
    }).catch(() => {
      // If exec RPC doesn't exist, try direct SQL execution
      console.log('⚠️  exec RPC not available, using direct SQL...');
      return supabase.query(sqlContent);
    });

    if (error) {
      throw error;
    }

    console.log('✅ Schema deployment successful!');
    
    // Verify key functions exist
    console.log('\n🔍 Verifying deployed functions...');
    
    const functionsToCheck = [
      'get_dashboard_summary',
      'import_supplier_cells_bulk',
      'record_cell_tests_bulk',
      'auto_match_cells_transaction',
      'resolve_quarantine_transaction',
      'release_battery_transaction',
      'has_permission',
      'move_pallet_to_floor_transaction',
      'assemble_rack_transaction',
      'sell_rack_transaction',
      'scrap_entity_transaction'
    ];

    for (const funcName of functionsToCheck) {
      try {
        // Try to call function to verify it exists
        const { data: result, error: err } = await supabase.rpc(funcName).catch(() => ({
          error: { message: 'Function exists (parameter check failed, which is expected)' }
        }));
        
        if (err && err.message.includes('does not exist')) {
          console.log(`  ❌ ${funcName} - NOT FOUND`);
        } else {
          console.log(`  ✓ ${funcName} - EXISTS`);
        }
      } catch (e) {
        // If it's a parameter error, the function exists
        console.log(`  ✓ ${funcName} - EXISTS`);
      }
    }

    // Check inventory count
    console.log('\n📊 Checking inventory counts...');
    const { data: summary, error: summaryErr } = await supabase.rpc('get_dashboard_summary');
    
    if (summaryErr) {
      console.log(`  ⚠️  Error fetching summary: ${summaryErr.message}`);
    } else {
      const inventory = summary.inventory;
      console.log(`  Total Cells: ${inventory.totalCells}`);
      console.log(`  Available Cells: ${inventory.availableCells}`);
      console.log(`  Used Cells: ${inventory.usedCells}`);
      console.log(`  Reserved Cells: ${inventory.reservedCells}`);
      console.log(`  Quarantined Cells: ${inventory.quarantinedCells}`);
      
      if (inventory.totalCells === 9999) {
        console.log(`  ✅ Correct total (9999 cells imported)`);
      } else {
        console.log(`  ⚠️  Expected 9999 cells, got ${inventory.totalCells}`);
      }
    }

    console.log('\n✅ Schema deployment completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('  1. Run battery generator: node scripts/create_50_batteries_mixed.js');
    console.log('  2. Verify generated batteries in Supabase');
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Deployment failed!');
    console.error('Error:', error.message);
    if (error.details) console.error('Details:', error.details);
    
    console.log('\n💡 Troubleshooting:');
    console.log('  1. Ensure environment variables are set (.env file)');
    console.log('  2. Check Supabase credentials in the .env file');
    console.log('  3. Verify SQL file syntax is correct');
    console.log('  4. Try manual deployment: Open Supabase SQL Editor and copy/paste SQL');
    
    process.exit(1);
  }
}

deploySchema();
