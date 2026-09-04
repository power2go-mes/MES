#!/usr/bin/env node

/**
 * POWER2GO MES - Create 50 Mixed Batteries
 * 
 * Creates:
 * - 30 batteries of 5.12 kWh (2 modules × 8 cells each = 16 cells per battery)
 * - 20 batteries of 7.5 kWh (2 modules × 12 cells each = 24 cells per battery)
 * Total: 50 batteries using 960 cells from the 9999 imported pool
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing environment variables');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '❌');
  console.error('   VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓' : '❌');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║              POWER2GO MES - CREATE 50 BATTERIES                     ║
║                                                                     ║
║  Configuration:                                                     ║
║  • 30 batteries of 5.12 kWh (2 modules × 8 cells each)             ║
║  • 20 batteries of 7.5 kWh (2 modules × 12 cells each)             ║
║  • Total: 50 batteries, 960 cells from imported pool               ║
╚═══════════════════════════════════════════════════════════════════╝
`);

async function createBatteries() {
  try {
    console.log('📍 Checking Supabase connection...');
    const { data: profile, error: connError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (connError) {
      throw new Error(`Connection failed: ${connError.message}`);
    }

    console.log('✓ Connected to Supabase\n');

    // Check current inventory
    console.log('📊 Checking current inventory...');
    const { data: cells, error: cellError } = await supabase
      .from('cells')
      .select('status', { count: 'exact' })
      .in('status', ['AVAILABLE', 'IMPORTED', 'OCV_TESTED', 'GRADED']);

    if (!cellError && cells) {
      console.log(`   Available cells: ${cells.length || 0}\n`);
    }

    // Get or create product templates
    console.log('🔍 Setting up product templates...');
    
    const templates = [
      {
        id: 'prod-5k12',
        name: '5.12 kWh Battery',
        model: '5K12',
        voltage_type: 'LV',
        capacity_kwh: 5.12,
        num_modules: 2,
        cells_per_module: 8,
        total_cells: 16,
        serial_prefix: 'PO-5K12',
        controller_type: 'BMS'
      },
      {
        id: 'prod-7k5',
        name: '7.5 kWh Battery',
        model: '7K5',
        voltage_type: 'LV',
        capacity_kwh: 7.5,
        num_modules: 2,
        cells_per_module: 12,
        total_cells: 24,
        serial_prefix: 'PO-7K5',
        controller_type: 'BMU'
      }
    ];

    for (const template of templates) {
      const { error: insertError } = await supabase
        .from('product_templates')
        .upsert(template, { onConflict: 'id' });

      if (insertError) {
        console.log(`   ⚠️  ${template.name}: ${insertError.message}`);
      } else {
        console.log(`   ✓ ${template.name}`);
      }
    }

    console.log('\n🚀 Creating production orders...');

    let totalCreated = 0;
    const timestamp = Date.now().toString().slice(-6);

    // Create 30 × 5.12 kWh batteries
    console.log('\n  Creating 30 × 5.12 kWh batteries...');
    for (let i = 1; i <= 30; i++) {
      const orderNum = `PO-5K12-${i.toString().padStart(3, '0')}-${timestamp}`;
      
      try {
        const { data, error } = await supabase.rpc('create_production_order_transaction', {
          p_product_id: 'prod-5k12',
          p_quantity: 1,
          p_order_number: orderNum,
          p_battery_serial_prefix: `5K12-${timestamp}-${i.toString().padStart(3, '0')}`
        });

        if (error) {
          console.log(`    ❌ Order ${orderNum}: ${error.message}`);
        } else {
          // Auto-match cells
          if (data.battery_ids && data.battery_ids.length > 0) {
            const batteryId = data.battery_ids[0];
            const { error: matchError } = await supabase.rpc('auto_match_cells_transaction', {
              p_battery_id: batteryId,
              p_user_id: null
            });

            if (matchError) {
              console.log(`    ⚠️  Order ${orderNum}: Match failed - ${matchError.message}`);
            } else {
              console.log(`    ✓ Order ${orderNum}`);
              totalCreated++;
            }
          }
        }
      } catch (e) {
        console.log(`    ❌ Order ${orderNum}: ${e.message}`);
      }

      // Rate limiting
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Create 20 × 7.5 kWh batteries
    console.log('\n  Creating 20 × 7.5 kWh batteries...');
    for (let i = 1; i <= 20; i++) {
      const orderNum = `PO-7K5-${i.toString().padStart(3, '0')}-${timestamp}`;
      
      try {
        const { data, error } = await supabase.rpc('create_production_order_transaction', {
          p_product_id: 'prod-7k5',
          p_quantity: 1,
          p_order_number: orderNum,
          p_battery_serial_prefix: `7K5-${timestamp}-${i.toString().padStart(3, '0')}`
        });

        if (error) {
          console.log(`    ❌ Order ${orderNum}: ${error.message}`);
        } else {
          // Auto-match cells
          if (data.battery_ids && data.battery_ids.length > 0) {
            const batteryId = data.battery_ids[0];
            const { error: matchError } = await supabase.rpc('auto_match_cells_transaction', {
              p_battery_id: batteryId,
              p_user_id: null
            });

            if (matchError) {
              console.log(`    ⚠️  Order ${orderNum}: Match failed - ${matchError.message}`);
            } else {
              console.log(`    ✓ Order ${orderNum}`);
              totalCreated++;
            }
          }
        }
      } catch (e) {
        console.log(`    ❌ Order ${orderNum}: ${e.message}`);
      }

      // Rate limiting
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`
✅ Battery creation complete!

📊 Summary:
   • Total batteries created: ${totalCreated} of 50
   • 5.12 kWh batteries: Expected 30
   • 7.5 kWh batteries: Expected 20
   • Total cells allocated: ~${totalCreated * 20} (mix of 16 and 24 per battery)

🔍 Next steps:
   1. Check Supabase dashboard to verify batteries were created
   2. Query: SELECT COUNT(*) FROM batteries;
   3. Query: SELECT COUNT(*) FROM cells WHERE status = 'RESERVED';

📝 Note:
   If some batteries failed to create, it might be because:
   • Not enough available cells (need ${30 * 16 + 20 * 24} = 960 total)
   • Schema not yet deployed to live Supabase
   • BMS/BMU units not available in inventory

Check AUDIT_FIXES_SUMMARY.md for more details.
    `);

    process.exit(0);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

createBatteries();
