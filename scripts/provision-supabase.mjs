/**
 * One-time Supabase provisioner for Power2Go MES.
 * Loads .env. Uses service role if present; otherwise public signup.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) throw new Error('Missing .env');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL || 'admin@gmail.com';
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin123456';

if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const adminMeta = {
  full_name: 'Administrator',
  username: 'admin',
  role_id: 'role-admin',
  badge_id: 'P2G-ADMIN-001',
};

async function main() {
  if (service) {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: adminMeta,
    });
    if (error && !String(error.message).toLowerCase().includes('already')) {
      console.error('Admin createUser failed:', error.message);
      process.exit(1);
    }
    const userId = data?.user?.id;
    if (userId) {
      const { error: profileError } = await admin.from('profiles').upsert({
        id: userId,
        email,
        full_name: 'Administrator',
        username: 'admin',
        badge_id: 'P2G-ADMIN-001',
        role_id: 'role-admin',
        status: 'ACTIVE',
      });
      if (profileError) console.warn('Profile upsert:', profileError.message);
      await admin.from('mes_memory').upsert({ id: 'default', payload: {}, version: 1 });
      console.log('Created/confirmed Auth user and admin profile.');
      return;
    }
    console.log('User may already exist. Auth admin path finished.');
    return;
  }

  const publicClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await publicClient.auth.signUp({
    email,
    password,
    options: { data: adminMeta },
  });
  if (error) {
    if (String(error.message).toLowerCase().includes('already')) {
      console.log('User already registered. Sign in with that email.');
      return;
    }
    console.error('signUp failed:', error.message);
    console.error('Add SUPABASE_SERVICE_ROLE_KEY to .env to create the user with Admin API.');
    process.exit(1);
  }
  if (data.user && !data.session) {
    console.log('User created. Email confirmation may be required in the Supabase dashboard.');
    return;
  }
  console.log('User created and session issued.');
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
