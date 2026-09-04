import crypto from 'crypto';
import type { User, UserRole } from '../src/types';
import type { User as UserType } from '../src/types';

// Default password for the built-in Administrator on a clean installation.
// Always stored as a scrypt hash; never returned to the client.
export const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin123456';
export const SESSION_COOKIE = 'p2g_session';
export const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 8;

const SCRYPT_KEYLEN = 64;
const OTP_PEPPER = process.env.OTP_PEPPER || 'p2g-static-otp-pepper-change-in-production';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
const PENDING_TTL_MS = 1000 * 60 * 5; // 5 minutes (matches OTP lifetime)

// ----------------------------------------------------------------------------
// Password hashing (Node built-in scrypt KDF — NIST approved, no new deps)
// ----------------------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  const salt = parts[1];
  const hash = parts[2];
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ----------------------------------------------------------------------------
// OTP generation + hashing (cryptographically strong, single-use verification)
// ----------------------------------------------------------------------------
export function generateOtp(): string {
  // 0..999999 inclusive, zero-padded to 6 digits
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(`${otp}:${OTP_PEPPER}`).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ----------------------------------------------------------------------------
// OTP per-user tracking (hashed, single-use, expiration, rate limiting)
// ----------------------------------------------------------------------------

export interface UserOtpState {
  otpHash: string | null;
  otpExpiresAt: string | null;
  otpAttempts: number;
  otpLastSentAt: string | null;
}

export function initialUserOtpState(): UserOtpState {
  return {
    otpHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    otpLastSentAt: null,
  };
}

export function userHasOtpExpired(otpExpiresAt: string | null): boolean {
  if (!otpExpiresAt) return true;
  return new Date(otpExpiresAt).getTime() < Date.now();
}

export function canAttemptOtp(otpAttempts: number, maxAttempts: number = 5): boolean {
  return otpAttempts < maxAttempts;
}

export function isLockedUntil(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

// ----------------------------------------------------------------------------
// Set / clear OTP on a user record (hashed storage — plaintext OTP never stored)
// ----------------------------------------------------------------------------

export function setUserOtp(user: User, otp: string): User {
  const otpHash = hashOtp(otp);
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 5); // 5 minutes
  return {
    ...user,
    otpHash,
    otpExpiresAt: expires.toISOString(),
    otpAttempts: 0,
    otpLastSentAt: now.toISOString(),
  };
}

export function clearUserOtp(user: User): User {
  return {
    ...user,
    otpHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    otpLastSentAt: null,
  };
}

export function incrementUserOtpAttempts(user: User): User {
  return {
    ...user,
    otpAttempts: (user.otpAttempts || 0) + 1,
  };
}

// ----------------------------------------------------------------------------
// OTP verification (timing-safe, single-use, expiration, lockout)
// ----------------------------------------------------------------------------

export function verifyOtp(
  inputOtp: string,
  storedOtpHash: string | null,
  otpExpiresAt: string | null,
  currentAttempts: number,
  lockedUntil: string | null = null
): { valid: boolean; newAttempts: number; lockedUntil: string | null } {
  // Check if locked out
  if (isLockedUntil(lockedUntil)) {
    return { valid: false, newAttempts: currentAttempts, lockedUntil };
  }

  // Check expiration
  if (userHasOtpExpired(otpExpiresAt)) {
    return { valid: false, newAttempts: currentAttempts, lockedUntil: null };
  }

  // Check attempt count
  if (!canAttemptOtp(currentAttempts)) {
    return { valid: false, newAttempts: currentAttempts, lockedUntil: null };
  }

  // Verify OTP hash (timing-safe)
  if (!storedOtpHash || !constantTimeEquals(hashOtp(inputOtp), storedOtpHash)) {
    // Increment attempts on failure
    const newAttempts = currentAttempts + 1;
    let lockedUntil: string | null = null;

    // Lockout after 5 failed attempts (account lockout, not just OTP lock)
    if (newAttempts >= 5) {
      const lockUntil = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes
      lockedUntil = lockUntil.toISOString();
    }

    return { valid: false, newAttempts, lockedUntil };
  }

  // OTP verified successfully — clear the OTP (single-use)
  return { valid: true, newAttempts: 0, lockedUntil: null };
}

// ----------------------------------------------------------------------------
// Resend cooldown check
// ----------------------------------------------------------------------------

export function isResendCooldownActive(otpLastSentAt: string | null, cooldownSec: number = 60): boolean {
  if (!otpLastSentAt) return false;
  const lastSent = new Date(otpLastSentAt).getTime();
  const now = Date.now();
  return (now - lastSent) < (cooldownSec * 1000);
}

// ----------------------------------------------------------------------------
// Cookie helpers (manual parsing — avoids adding cookie-parser dependency)
// ----------------------------------------------------------------------------
export function parseCookies(req: any): Record<string, string> {
  const header = req?.headers?.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(';').forEach((part: string) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

function appendCookie(res: any, value: string) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing as string, value]);
  }
}

function cookieAttributes(maxAgeSec: number, expire: boolean): string[] {
  const attrs = [
    `Max-Age=${expire ? 0 : maxAgeSec}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];
  if (isProd) attrs.push('Secure');
  return attrs;
}

export function setCookie(res: any, name: string, value: string, maxAgeSec: number) {
  appendCookie(res, `${name}=${encodeURIComponent(value)}; ${cookieAttributes(maxAgeSec, false).join('; ')}`);
}

export function clearCookie(res: any, name: string) {
  appendCookie(res, `${name}=; ${cookieAttributes(0, true).join('; ')}`);
}

// ----------------------------------------------------------------------------
// Server-side session store (in-memory; survives refresh while server runs)
// ----------------------------------------------------------------------------
export interface Session {
  sessionId: string;
  userId: string;
  username: string;
  role: UserRole;
  roleId: string;
  issuedAt: string;
  expiresAt: string;
}

const sessions = new Map<string, Session>();

export function createSession(user: Pick<User, 'id' | 'username' | 'role' | 'roleId'>): { sessionId: string; session: Session } {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  const session: Session = {
    sessionId,
    userId: user.id,
    username: user.username,
    role: user.role,
    roleId: user.roleId,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  sessions.set(sessionId, session);
  return { sessionId, session };
}

export function getSession(sessionId: string | undefined): Session | null {
  if (!sessionId) return null;
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

export function destroySession(sessionId: string | undefined) {
  if (sessionId) sessions.delete(sessionId);
}

// ----------------------------------------------------------------------------
// Pending OTP-login state (short-lived, between password check and OTP verify)
// ----------------------------------------------------------------------------
interface PendingLogin {
  userId: string;
  username: string;
  expiresAt: string;
}
export const pendingLogins = new Map<string, PendingLogin>();

export function createPending(userId: string, username: string): { token: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + PENDING_TTL_MS);
  pendingLogins.set(token, { userId, username, expiresAt: expires.toISOString() });
  return { token };
}

export function getPending(token: string | undefined): PendingLogin | null {
  if (!token) return null;
  const p = pendingLogins.get(token);
  if (!p) return null;
  if (new Date(p.expiresAt).getTime() < Date.now()) {
    pendingLogins.delete(token);
    return null;
  }
  return p;
}

export function destroyPending(token: string | undefined) {
  if (token) pendingLogins.delete(token);
}
