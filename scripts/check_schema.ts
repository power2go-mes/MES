import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const adminClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkSchema() {
  console.log('Checking live Supabase schema...');
  
  // Test if core RPCs exist
  const { data: dashData, error: dashErr } = await adminClient.rpc('get_dashboard_summary');
  if (dashErr) {
    console.error('\n❌ get_dashboard_summary RPC failed:', dashErr.message);
    console.log('\n⚠️  CONCLUSION: Schema has NOT been deployed to the live Supabase instance.');
    console.log('   Please run supabase/power2go_mes.sql in the Supabase SQL Editor first.');
    console.log('   Then re-run the E2E tests.');
    process.exit(1);
  } else {
    console.log('\n✅ get_dashboard_summary RPC works — schema IS deployed.');
    console.log('Dashboard data:', JSON.stringify(dashData, null, 2));
    
    // Check profiles table
    const { data: profiles, error: pErr } = await adminClient.from('profiles').select('id, username').limit(5);
    if (pErr) {
      console.error('\n❌ profiles table error:', pErr.message);
    } else {
      console.log(`\n✅ profiles table accessible. Rows: ${profiles?.length}`);
      if (profiles?.length) console.log('   Sample:', profiles);
    }

    // Check auth users
    const { data: users, error: uErr } = await adminClient.auth.admin.listUsers({ perPage: 10 });
    if (uErr) {
      console.error('❌ listUsers error:', uErr.message);
    } else {
      console.log(`\n✅ Auth users: ${users?.users?.length}`);
      users?.users?.forEach((u: any) => console.log(`   - ${u.email} (${u.id})`));
    }
  }
}

checkSchema().catch(e => { console.error(e); process.exit(1); });
