/**
 * One-time admin user seed script.
 * Run this ONCE before the E2E tests.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function seedAdmin() {
  console.log('Seeding admin account...');

  // 1. Create admin role
  await adminClient.from('roles').upsert({
    id: 'role-admin',
    name: 'Administrator',
    description: 'System Administrator',
    status: 'ACTIVE'
  }, { onConflict: 'id' });

  // 2. Create ALL permission
  await adminClient.from('permissions').upsert({
    id: 'ALL',
    name: 'Full Access',
    description: 'Superuser access',
    resource: 'ALL',
    action: 'ALL'
  }, { onConflict: 'id' });

  // 3. Link them
  const { error: rpErr } = await adminClient.from('role_permissions').upsert({
    role_id: 'role-admin',
    permission_id: 'ALL'
  }, { onConflict: 'role_id,permission_id' });
  if (rpErr) console.warn('role_permissions upsert warning:', rpErr.message);

  // 4. Create or update auth user
  let userId: string;

  // List all users and find by email (Supabase Admin API)
  const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  
  const existingAdmin = userList?.users?.find((u: any) => u.email === 'admin@gmail.com');

  if (existingAdmin) {
    console.log('Admin auth user already exists:', existingAdmin.id);
    userId = existingAdmin.id;
    // Reset password
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, { password: 'admin123456' });
    if (pwErr) console.warn('Password reset warning:', pwErr.message);
    else console.log('Password reset to "admin123456"');
  } else {
    // Try createUser, but handle the "Database error" case by re-listing
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: 'admin@gmail.com',
      password: 'admin123456',
      email_confirm: true,
      user_metadata: { name: 'Administrator' }
    });
    if (createErr) {
      // May already exist despite not showing in list — re-check
      const { data: reList } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const found = reList?.users?.find((u: any) => u.email === 'admin@gmail.com');
      if (found) {
        userId = found.id;
        console.log('User already existed (found on retry):', userId);
        await adminClient.auth.admin.updateUserById(userId, { password: 'admin123456' });
      } else {
        throw createErr;
      }
    } else {
      userId = newUser.user!.id;
      console.log('Created auth user:', userId);
    }
  }

  // 5. Upsert profile
  const { error: profileErr } = await adminClient.from('profiles').upsert({
    id: userId,
    full_name: 'Administrator',
    email: 'admin@gmail.com',
    username: 'admin',
    role_id: 'role-admin',
    status: 'ACTIVE'
  }, { onConflict: 'id' });
  if (profileErr) console.warn('Profile upsert warning:', profileErr.message);

  console.log('\nAdmin account ready:');
  console.log('  Email   : admin@gmail.com');
  console.log('  Password: admin123456');
  console.log('  User ID :', userId);
}

seedAdmin().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
