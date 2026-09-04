import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function fixProductTemplate() {
  console.log('Fixing Power2Go 7.5 kWh product template...');

  try {
    // Find the Power2Go 7.5 kWh template
    const { data: templates, error: selectError } = await supabase
      .from('product_templates')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (selectError) throw selectError;

    if (!templates || templates.length === 0) {
      console.log('No active product templates found.');
      return;
    }

    console.log(`Found ${templates.length} active product templates:`);
    templates.forEach((t, i) => {
      console.log(`  [${i}] ${t.name} (SKU: ${t.sku})`);
      console.log(`      Cells/Module: ${t.cells_per_module}, Modules: ${t.num_modules}, Total: ${t.total_cells}`);
    });

    // Find the 7.5 kWh template
    let template = templates.find(t => 
      t.name.toLowerCase().includes('7.5') || 
      t.capacity_kwh === 7.5 ||
      t.battery_name?.toLowerCase().includes('7.5')
    );

    if (!template) {
      console.log('\nNo 7.5 kWh template found. Using first template.');
      template = templates[0];
    }

    console.log(`\nUpdating template: ${template.name} (ID: ${template.id})`);
    console.log(`  Current: ${template.cells_per_module} cells/module × ${template.num_modules} modules = ${template.total_cells} total`);
    console.log(`  Target:  12 cells/module × 2 modules = 24 total`);

    const { data: updated, error: updateError } = await supabase
      .from('product_templates')
      .update({
        cells_per_module: 12,
        num_modules: 2,
        total_cells: 24,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id)
      .select();

    if (updateError) throw updateError;

    if (updated && updated.length > 0) {
      const u = updated[0];
      console.log(`\n✅ Template updated successfully!`);
      console.log(`  New: ${u.cells_per_module} cells/module × ${u.num_modules} modules = ${u.total_cells} total`);
    }
  } catch (err) {
    console.error('❌ Error fixing template:', err);
    process.exit(1);
  }
}

fixProductTemplate();
