import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

function envUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
}

function envAnon() {
  return process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
}

function envService() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function isSupabaseConfigured() {
  return Boolean(envUrl() && (envService() || envAnon()));
}

export function getServiceOrAnonClient(): SupabaseClient | null {
  const url = envUrl();
  const key = envService() || envAnon();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getServiceClient(): SupabaseClient | null {
  const url = envUrl();
  const key = envService();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getUserScopedClient(accessToken: string): SupabaseClient | null {
  const url = envUrl();
  const anon = envAnon();
  if (!url || !anon || !accessToken) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function getUserFromBearer(authorizationHeader?: string): Promise<User | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const client = getServiceOrAnonClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token || null;
}

let lastUserJwt: string | null = null;

export function rememberUserJwt(token: string | null) {
  lastUserJwt = token;
}

export function getRememberedUserJwt() {
  return lastUserJwt;
}
