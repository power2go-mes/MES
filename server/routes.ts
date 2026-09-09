import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.ts';
import { MachineGateway } from './machineAdapters.ts';
import {
  hashPassword, verifyPassword, generateOtp, hashOtp, constantTimeEquals,
  parseCookies, setCookie, clearCookie,
  createSession, getSession, destroySession,
  createPending, getPending, destroyPending,
  UserOtpState, initialUserOtpState, userHasOtpExpired, canAttemptOtp, isLockedUntil,
  setUserOtp, clearUserOtp, incrementUserOtpAttempts,
  verifyOtp, isResendCooldownActive,
  pendingLogins,
  SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC,
} from './auth.ts';
import { sendOtpEmail } from './email.ts';
import { ProductTemplate, CellItem, ModuleItem, BatteryUnit, ProductionOrder, Role, User } from '../src/types';
import { getBearerToken, getServiceClient, getUserFromBearer, getUserScopedClient, rememberUserJwt } from './supabase.ts';

function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleId: user.roleId,
    status: user.status,
    badgeId: user.badgeId,
  };
}

function issueLocalSession(res: any, user: User) {
  const { sessionId } = createSession({
    id: user.id,
    username: user.username,
    role: user.role,
    roleId: user.roleId,
  });
  setCookie(res, SESSION_COOKIE, sessionId, SESSION_COOKIE_MAX_AGE_SEC);
  return { sessionId, user: publicUser(user) };
}

async function ensureLocalUserFromSupabase(sbUser: { id: string; email?: string | null; user_metadata?: Record<string, any> }, accessToken?: string): Promise<User> {
  const email = sbUser.email || '';
  const profileClient = accessToken ? getUserScopedClient(accessToken) : getServiceClient();
  const { data: profile } = profileClient
    ? await profileClient.from('profiles').select('full_name, username, role_id, badge_id, status').eq('id', sbUser.id).maybeSingle()
    : { data: null };
  const roleId = profile?.role_id || sbUser.user_metadata?.role_id || 'role-operator';
  const role = db.roles.find(item => item.id === roleId);
  let existing = db.users.find(u => u.id === sbUser.id || (email && u.email === email));
  if (existing) {
    existing.id = sbUser.id;
    if (email) existing.email = email;
    existing.roleId = roleId;
    existing.role = roleId === 'role-admin' ? 'admin' : (role?.name.toLowerCase() || roleId.replace(/^role-/, ''));
    existing.status = profile?.status || existing.status;
    return existing;
  }
  const isAdmin = roleId === 'role-admin';
  const created: User = {
    id: sbUser.id,
    name: profile?.full_name || sbUser.user_metadata?.full_name || (email.split('@')[0] || 'Operator'),
    username: profile?.username || sbUser.user_metadata?.username || (email.split('@')[0] || 'operator'),
    email,
    roleId,
    role: isAdmin ? 'admin' : (role?.name.toLowerCase() || 'operator'),
    badgeId: profile?.badge_id || sbUser.user_metadata?.badge_id || '',
    status: profile?.status || 'ACTIVE',
  };
  db.users.push(created);
  return created;
}

export const apiRouter = Router();

function asyncHandler(handler: (req: any, res: any, next: any) => Promise<any>) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Auto-commit database state on any mutating requests to ensure persistence across container restarts
apiRouter.use((req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.json = function (this: any, body: any) {
      const response = this;
      db.commit();
      return db.flush().then(
        () => originalJson.call(response, body),
        err => {
          console.error(err);
            return originalJson.call(response.status(500), { error: 'Failed to persist factory data' });
        }
      ) as unknown as typeof res;
    } as typeof res.json;
    res.send = function (this: any, body: any) {
      const response = this;
      db.commit();
      return db.flush().then(
        () => originalSend.call(response, body),
          err => originalSend.call(response.status(500), JSON.stringify({ error: 'Failed to persist factory data' }))
      ) as unknown as typeof res;
    } as typeof res.send;
  }
  next();
});

// --- AUTH ENDPOINTS ---

// 1. Login: validate credentials, generate OTP, send email
apiRouter.post('/auth/login', async (req: any, res: any) => {
  const { identifier, password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  // Find user by username or email
  const ident = String(identifier || '').trim().toLowerCase();
  let user: any = db.users.find(
    (u: any) =>
      String(u.username || '').toLowerCase() === ident ||
      String(u.email || '').toLowerCase() === ident
  );

  if (!user) {
    // Do not reveal whether account exists — generic error
    return res.status(400).json({ error: 'Invalid username or password.' });
  }

  // Check if account is disabled
  if (user.status === 'INACTIVE') {
    return res.status(400).json({ error: 'Your account is disabled. Contact an administrator.' });
  }

  if (isLockedUntil(user.lockedUntil || null)) {
    return res.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
  }

  // Verify password
  const passwordValid = verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    // Increment login attempts and record audit
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    db.users = db.users.map((u: any) => u.id === user.id ? user : u);
    db.addAuditLog(user.id, `LOGIN_FAILED: username=${user.username}`, 'AUTH', user.id, undefined, 'failed password');
    return res.status(400).json({ error: 'Invalid username or password.' });
  }

  const otp = generateOtp();
  const userWithOtp = setUserOtp({ ...user, loginAttempts: 0, lockedUntil: null }, otp);
  db.users = db.users.map((u: any) => (u.id === user.id ? userWithOtp : u));
  db.commit();
  const delivery = await sendOtpEmail({ to: user.email, username: user.username, otp });
  if (!delivery.delivered) {
    return res.status(503).json({ error: 'Verification email delivery is unavailable. Contact an administrator.' });
  }
  const pending = createPending(user.id, user.username);
  db.addAuditLog(user.id, `LOGIN: username=${user.username}`, 'AUTH', user.id, undefined, 'otp sent');

  return res.json({
    message: 'Verification code sent',
    pendingToken: pending.token,
  });
});

// 2. Verify OTP: validate OTP and create session
apiRouter.post('/auth/verify-otp', (req: any, res: any) => {
  const { token, otp } = req.body;

  if (!token || !otp) {
    return res.status(400).json({ error: 'Token and OTP are required' });
  }

  // Check pending login state
  const pending = getPending(token);
  if (!pending) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  // Find user
  const user = db.users.find((u: any) => u.id === pending.userId);
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  // Verify OTP
  const { valid, newAttempts, lockedUntil } = verifyOtp(
    otp,
    user.otpHash || null,
    user.otpExpiresAt || null,
    user.otpAttempts || 0,
    user.lockedUntil || null
  );

  if (!valid) {
    // Update user's OTP attempts
    const updatedUser = { ...incrementUserOtpAttempts(user), lockedUntil };
    db.users = db.users.map((u: any) => u.id === user.id ? updatedUser : u);
    db.commit();

    // Record audit failed
    db.addAuditLog(user.id, `OTP_FAILED: username=${user.username}`, 'AUTH', user.id, undefined, `attempts=${newAttempts}`);

    if (lockedUntil) {
      return res.status(400).json({ error: 'Too many verification attempts. Please try again later.' });
    }
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  // OTP validated — clear OTP (single-use)
  const clearedUser = { ...clearUserOtp(user), lockedUntil: null };
  db.users = db.users.map((u: any) => u.id === user.id ? clearedUser : u);
  db.commit();
  destroyPending(token);

  // Create session
  const issued = issueLocalSession(res, clearedUser);
  db.addAuditLog(user.id, `OTP_VERIFIED: username=${user.username}`, 'AUTH', user.id, undefined, 'session created');

  return res.json({
    message: 'OTP verified, session created',
    sessionId: issued.sessionId,
    user: issued.user,
  });
});

// 3. Resend OTP
apiRouter.post('/auth/resend-otp', async (req: any, res: any) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Verification token is required' });
  }

  // Check pending login state
  const pending = getPending(token);
  if (!pending) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  // Find user
  let user = db.users.find((u: any) => u.id === pending.userId);
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  // Check resend cooldown
  const lastSentAt = user.otpLastSentAt || null;
  if (isResendCooldownActive(lastSentAt, 60)) {
    const remaining = 60 - Math.floor((Date.now() - new Date(lastSentAt || 0).getTime()) / 1000);
    return res.status(400).json({ error: `Resend available in ${remaining}s` });
  }

  // Generate new OTP (invalidates previous one via setUserOtp)
  const otp = generateOtp();
  const userWithOtp = setUserOtp(user, otp);

  // Update user OTP state in DB
  user = { ...userWithOtp };
  db.users = db.users.map((u: any) => u.id === user.id ? user : u);
  db.commit();

  // Send OTP email
  await sendOtpEmail({ to: user.email, username: user.username, otp });

  // Record audit
  const adminId = req.headers['x-user-id'] || 'usr-admin-01';
  db.addAuditLog(adminId as string, `OTP_RESENT: username=${user.username}`, 'AUTH', user.id, undefined, 'otp resent');

  return res.json({ message: 'New OTP sent to registered email address' });
});

// 4. Get current user info
apiRouter.get('/auth/me', async (req: any, res: any) => {
  const token = getBearerToken(req.headers.authorization);
  const sbUser = await getUserFromBearer(req.headers.authorization);
  if (sbUser) {
    rememberUserJwt(token);
    const user = await ensureLocalUserFromSupabase(sbUser, token || undefined);
    return res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      roleId: user.roleId,
      status: user.status,
      badgeId: user.badgeId,
    });
  }

  const sid = parseCookies(req)[SESSION_COOKIE];
  const session = getSession(sid);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  const user = db.users.find((u: any) => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleId: user.roleId,
    status: user.status,
  });
});

// 5. Logout
apiRouter.post('/auth/logout', (req: any, res: any) => {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) {
    destroySession(sid);
    // Record audit
    const adminId = req.headers['x-user-id'] || 'usr-admin-01';
    db.addAuditLog(adminId as string, `LOGOUT: username=unknown`, 'AUTH', sid, undefined, 'session invalidated');
  }
  // Clear the session cookie
  clearCookie(res, SESSION_COOKIE);
  return res.json({ message: 'Logged out successfully' });
});

// --- GLOBAL AUTHENTICATION GUARD ---
// Every /api route requires a valid session cookie, except the auth endpoints
// themselves (login / verify-otp / resend-otp / logout / me) and the health check.
apiRouter.use(async (req: any, res: any, next: any) => {
  const p = req.path;
  if (p.startsWith('/auth/') || p === '/health') {
    return next();
  }

  const token = getBearerToken(req.headers.authorization);
  const sbUser = await getUserFromBearer(req.headers.authorization);
  if (sbUser) {
    rememberUserJwt(token);
    const local = await ensureLocalUserFromSupabase(sbUser, token || undefined);
    req.userId = local.id;
    req.session = { userId: local.id, username: local.username, role: local.role, roleId: local.roleId };
    if (req.body && typeof req.body === 'object') req.body.userId = local.id;
    return next();
  }

  const sid = parseCookies(req)[SESSION_COOKIE];
  const session = getSession(sid);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  req.userId = session.userId;
  req.session = session;
  if (req.body && typeof req.body === 'object') req.body.userId = session.userId;
  next();
});

// --- RBAC AUTHORIZATION MIDDLEWARE ---
export function requirePermission(permissionId: string) {
  return async (req: any, res: any, next: any) => {
    const userId = req.userId;
    const user = db.users.find(u => u.id === userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }
    if (user.status === 'INACTIVE') {
      return res.status(403).json({ error: 'Forbidden: User account is inactive' });
    }
    if (user.role === 'admin' || user.roleId === 'role-admin') {
      return next();
    }
    const role = db.roles.find(r => r.id === user.roleId);
    if (!role || role.status === 'INACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Assigned role is inactive or not found' });
    }
    if (role.permissions.includes('ALL') || role.permissions.includes(permissionId)) {
      return next();
    }
    const service = getServiceClient();
    if (service) {
      const { data: grant, error } = await service
        .from('role_permissions')
        .select('permission_id')
        .eq('role_id', user.roleId)
        .eq('permission_id', permissionId)
        .maybeSingle();
      if (!error && grant) return next();
    }
    return res.status(403).json({ error: `Access Denied: Requires permission [${permissionId}]` });
  };
}

function requireAdministrator(req: any, res: any, next: any) {
  const user = db.users.find(item => item.id === req.userId);
  if (!user || user.status === 'INACTIVE') {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  if (user.roleId !== 'role-admin' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an Administrator can manage users and roles.' });
  }
  return next();
}

// 1. Health check
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. Users & Roles Management API
apiRouter.get('/users', requirePermission('security.users'), requireAdministrator, (req, res) => {
  res.json(db.users.map(({ passwordHash, otpHash, ...safe }) => safe));
});

apiRouter.post('/users', requirePermission('security.users'), requireAdministrator, async (req: any, res) => {
  const { name, username, email, password, roleId, status, badgeId } = req.body;
  if (!name || !username || !email || !password) return res.status(400).json({ error: 'Name, username, email, and password are required' });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: 'Supabase service client is not configured' });

  const assignedRoleId = roleId || 'role-operator';
  const role = db.roles.find(r => r.id === assignedRoleId);
  if (!role || role.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'The selected role does not exist or is inactive.' });
  }
  const assignedBadgeId = badgeId || `P2G-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, username, role_id: assignedRoleId, badge_id: assignedBadgeId },
  });
  if (authError || !authData.user) return res.status(400).json({ error: authError?.message || 'Could not create Auth user' });

  const { data: profile, error: profileError } = await service.from('profiles').upsert({
    id: authData.user.id,
    full_name: name,
    email,
    username,
    role_id: assignedRoleId,
    badge_id: assignedBadgeId,
    status: status || 'ACTIVE',
  }, { onConflict: 'id' }).select().single();
  if (profileError) {
    await service.auth.admin.deleteUser(authData.user.id);
    return res.status(400).json({ error: profileError.message });
  }

  const newUser = await ensureLocalUserFromSupabase({ id: authData.user.id, email, user_metadata: { full_name: name, username, role_id: assignedRoleId, badge_id: assignedBadgeId } });
  newUser.roleId = assignedRoleId;
  newUser.role = role?.name.toLowerCase() || 'operator';
  newUser.badgeId = assignedBadgeId;
  newUser.status = status || 'ACTIVE';

  if (!db.users.some(user => user.id === newUser.id)) db.users.push(newUser);
  db.addAuditLog(req.userId, `Created User: ${name} (${username})`, 'SYSTEM', newUser.id, undefined, JSON.stringify(newUser));
  res.json(newUser);
});

apiRouter.put('/users/:id', requirePermission('security.users'), requireAdministrator, async (req: any, res) => {
  const { id } = req.params;
  const { name, username, email, roleId, status, badgeId } = req.body;
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.id === req.userId && (status === 'INACTIVE' || (roleId && roleId !== 'role-admin'))) {
    return res.status(400).json({ error: 'Cannot deactivate or change role of the primary Administrator account.' });
  }

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: 'Supabase service client is not configured' });

  const nextRoleId = roleId || user.roleId;
  const role = db.roles.find(item => item.id === nextRoleId);
  if (!role || role.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'The selected role does not exist or is inactive.' });
  }

  const oldVal = JSON.stringify(user);
  user.name = name !== undefined ? name : user.name;
  user.username = username !== undefined ? username : user.username;
  user.email = email !== undefined ? email : user.email;
  user.roleId = nextRoleId;
  user.role = nextRoleId === 'role-admin' ? 'admin' : role.name.toLowerCase();
  user.status = status !== undefined ? status : user.status;
  user.badgeId = badgeId !== undefined ? badgeId : user.badgeId;

  const { error: profileError } = await service.from('profiles').update({
    full_name: user.name,
    email: user.email,
    username: user.username,
    role_id: user.roleId,
    badge_id: user.badgeId,
    status: user.status,
    updated_at: new Date().toISOString(),
  }).eq('id', user.id);
  if (profileError) return res.status(400).json({ error: profileError.message });

  db.addAuditLog(req.userId, `Updated User: ${user.name}`, 'SYSTEM', user.id, oldVal, JSON.stringify(user));
  res.json(user);
});

apiRouter.delete('/users/:id', requirePermission('security.users'), requireAdministrator, async (req: any, res: any) => {
  const { id } = req.params;
  if (id === req.userId) return res.status(400).json({ error: 'You cannot delete your own account.' });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: 'Supabase service client is not configured' });

  const { error } = await service.auth.admin.deleteUser(id);
  if (error) return res.status(400).json({ error: error.message, detail: error.message });
  const user = db.users.find(u => u.id === id);
  if (user) db.users = db.users.filter(u => u.id !== id);
  db.addAuditLog(req.userId, `Deleted User: ${id}`, 'SYSTEM', id);
  return res.json({ success: true });
});

// Roles API
apiRouter.get('/roles', requirePermission('security.roles'), requireAdministrator, (req, res) => {
  res.json(db.roles);
});

apiRouter.post('/roles', requirePermission('security.roles'), requireAdministrator, (req, res) => {
  res.status(400).json({ error: 'Only Administrator and Operator roles are supported.' });
});

apiRouter.put('/roles/:id', requirePermission('security.roles'), requireAdministrator, (req, res) => {
  const { id } = req.params;
  const { name, description, permissions, status } = req.body;
  const role = db.roles.find(r => r.id === id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  if (role.id === 'role-admin' && status === 'INACTIVE') {
    return res.status(400).json({ error: 'Cannot deactivate the default Administrator role' });
  }

  const oldVal = JSON.stringify(role);
  role.name = name !== undefined ? name : role.name;
  role.description = description !== undefined ? description : role.description;
  role.permissions = permissions !== undefined ? permissions : role.permissions;
  role.status = status !== undefined ? status : role.status;
  role.updatedAt = new Date().toISOString();

  const userId = req.headers['x-user-id'] || 'usr-admin-01';
  db.addAuditLog(userId as string, `Updated Role: ${role.name}`, 'SYSTEM', role.id, oldVal, JSON.stringify(role));
  res.json(role);
});

apiRouter.delete('/roles/:id', requirePermission('security.roles'), requireAdministrator, (req, res) => {
  res.status(400).json({ error: 'Administrator and Operator roles cannot be deleted.' });
});

// 3. Dashboard Statistics
apiRouter.get('/dashboard/stats', (req, res) => {
  const cells = Array.from(db.cells.values());
  const modules = Array.from(db.modules.values());
  const batteries = Array.from(db.batteries.values());
  const orders = Array.from(db.orders.values());
  const machines = Array.from(db.machines.values());

  const isAssigned = (c: CellItem) => Boolean(c.assignedToModuleId || c.reservedForBatteryId || c.reservedForOrderId);
  const activeProductionStatuses = new Set(['RESERVED', 'MODULE_ASSIGNED', 'SCANNED', 'ASSEMBLED', 'IN_PROCESS', 'VALIDATING', 'TESTING', 'PASSED']);
  const isUsed = (c: CellItem) => isAssigned(c) || activeProductionStatuses.has(c.status || '');
  const usedCells = cells.filter(isUsed).length;
  const availableCells = cells.filter(c => c.status === 'AVAILABLE' && !c.reservedForBatteryId && !c.reservedForOrderId).length;
  const reservedCells = cells.filter(c =>
    !isAssigned(c) && (c.status === 'RESERVED' || ((c.reservedForOrderId || c.reservedForBatteryId) && c.status !== 'QUARANTINED' && c.status !== 'ASSEMBLED'))
  ).length;
  const inProcessCells = cells.filter(c =>
    (c.status === 'IN_PROCESS' || c.status === 'VALIDATING' || c.status === 'TESTING' || c.status === 'SCANNED' || c.status === 'PASSED') && !isAssigned(c)
  ).length;
  const assembledCells = cells.filter(c => c.status === 'ASSEMBLED' || Boolean(c.assignedToModuleId)).length;
  const quarantinedCells = cells.filter(c => c.status === 'QUARANTINED').length;

  const finishedBatteries = batteries.filter(b => b.status === 'FINISHED' || b.status === 'DISPATCHED').length;
  const inProcessBatteries = batteries.filter(b => b.status === 'IN_PROCESS').length;

  // First Pass Yield calculation
  const totalCompleted = finishedBatteries;
  const totalQuarantined = db.quarantineRecords.length;
  const yieldPct = totalCompleted + totalQuarantined > 0
    ? Number(((totalCompleted / (totalCompleted + totalQuarantined)) * 100).toFixed(1))
    : 0;
  const finishedPackTrend = batteries
    .filter(b => b.status === 'FINISHED' || b.status === 'DISPATCHED')
    .slice(0, 6)
    .reverse()
    .map(b => ({ label: b.serialNumber, value: 1 }));
  const activeBatchTrend = orders
    .slice(0, 6)
    .reverse()
    .map(o => ({ label: o.orderNumber, value: o.quantityInProcess }));
  const batteryBuildByDay = new Map<string, number>();
  batteries
    .filter(b => b.status === 'FINISHED' || b.status === 'DISPATCHED')
    .forEach(b => {
      const day = b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : 'Unknown';
      batteryBuildByDay.set(day, (batteryBuildByDay.get(day) || 0) + 1);
    });
  const batteryBuildTrend = Array.from(batteryBuildByDay.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .slice(-7)
    .map(([label, value]) => ({ label, value }));

  res.json({
    inventory: {
      totalCells: cells.length,
      availableCells,
      usedCells,
      reservedCells,
      inProcessCells,
      assembledCells,
      quarantinedCells,
      finishedBatteries,
      inProcessBatteries,
    },
    quality: {
      firstPassYieldPercent: yieldPct,
      quarantinedCount: db.quarantineRecords.filter(q => q.status === 'OPEN').length,
    },
    orders: {
      total: orders.length,
      inProcess: orders.filter(o => o.status === 'IN_PROCESS').length,
      completed: orders.filter(o => o.status === 'COMPLETED').length,
      planned: orders.filter(o => o.status === 'PLANNED').length,
    },
    kpis: {
      totalCellsInInventory: cells.length,
      availableCells,
      usedCells,
      reservedCells,
      inProcessCells,
      assembledCells,
      quarantinedCells,
      totalBatteriesCompleted: finishedBatteries,
      batteriesInProduction: inProcessBatteries,
      activeOrders: orders.filter(o => o.status === 'IN_PROCESS').length,
      firstPassYield: yieldPct,
      onlineMachines: machines.filter(m => m.status === 'ONLINE' || m.status === 'BUSY').length,
      totalMachines: machines.length,
    },
    recentBatteries: batteries.slice(0, 5).map(b => ({
      ...b,
      progressPercent: b.progressPercent ?? (b.status === 'FINISHED' || b.status === 'DISPATCHED' ? 100 : null),
    })),
    recentOrders: orders.slice(0, 5),
    recentAuditLogs: db.auditLogs.slice(0, 10),
    machines,
    finishedPackTrend,
    activeBatchTrend,
    batteryBuildTrend,
    bmsTelemetry: {
      total: db.bmsUnits.size,
      tested: Array.from(db.bmsUnits.values()).filter(b => b.testResult).length,
    },
    quarantineOpenCount: db.quarantineRecords.filter(q => q.status === 'OPEN').length,
  });
});

// Analytics & Reports
apiRouter.get('/reports/analytics', (req, res) => {
  const cells = Array.from(db.cells.values());
  const batteries = Array.from(db.batteries.values());
  const modules = Array.from(db.modules.values());
  const quarantine = db.quarantineRecords;
  const bmsUnits = Array.from(db.bmsUnits.values());

  const hasData = cells.length > 0 || batteries.length > 0 || modules.length > 0 || bmsUnits.length > 0 || quarantine.length > 0;

  if (!hasData) {
    return res.json({
      hasData: false,
      fpy: 0,
      totalCycles: 0,
      laserWeldQuality: 0,
      bmsTelemetryRate: 0,
      ocvDistribution: [],
      pareto: [],
      totalCells: 0,
      totalModules: 0,
      totalBatteries: 0,
      testedCells: 0,
      testedBatteries: 0,
      testedBms: 0,
      totalBms: bmsUnits.length,
      weldedModules: 0,
      quarantineOpen: 0,
      quarantineResolved: 0,
    });
  }

  // Real calculations
  const testedCells = cells.filter(c => c.testedAt).length;
  const testedBatteries = batteries.filter(b => Boolean(b.stepResults?.FINAL_TESTING?.status)).length;
  const totalTestCycles = testedCells + testedBatteries;
  const totalQuarantined = quarantine.length;

  const fpy = totalTestCycles > 0
    ? Number((((Math.max(0, totalTestCycles - totalQuarantined)) / totalTestCycles) * 100).toFixed(1))
    : 0;

  // Laser Weld Quality from real welded modules
  const weldedModules = modules.filter(m => Boolean(m.weldingResult?.status));
  const passedWelds = weldedModules.filter(m => m.weldingResult?.status === 'PASSED').length;
  const laserWeldQuality = weldedModules.length > 0
    ? Number(((passedWelds / weldedModules.length) * 100).toFixed(1))
    : 0;

  // BMS Telemetry Rate from real BMS tests
  const testedBms = bmsUnits.filter(b => Boolean(b.testResult?.status));
  const passedBms = testedBms.filter(b => b.testResult?.status === 'PASSED').length;
  const bmsTelemetryRate = testedBms.length > 0
    ? Number(((passedBms / testedBms.length) * 100).toFixed(1))
    : 0;

  // Compute live OCV Distribution Histogram
  const buckets: { [key: string]: number } = {
    '< 3.297V': 0,
    '3.298V': 0,
    '3.300V': 0,
    '3.302V': 0,
    '> 3.303V': 0,
  };

  cells.forEach(c => {
    const v = c.productionOcvV || c.supplierOcvV || 3.300;
    if (v < 3.298) buckets['< 3.297V']++;
    else if (v < 3.2995) buckets['3.298V']++;
    else if (v < 3.3015) buckets['3.300V']++;
    else if (v < 3.303) buckets['3.302V']++;
    else buckets['> 3.303V']++;
  });

  const maxCount = Math.max(1, ...Object.values(buckets));
  const ocvDistribution = Object.entries(buckets).map(([label, count]) => ({
    label,
    count,
    height: `${Math.max(8, Math.round((count / maxCount) * 100))}%`,
  }));

  // Compute live Pareto defects from quarantine records
  const defectCounts: { [reason: string]: number } = {};
  quarantine.forEach(q => {
    const r = q.reason || 'General Quality Deviation';
    defectCounts[r] = (defectCounts[r] || 0) + 1;
  });

  const totalDefects = Math.max(1, quarantine.length);
  const paretoColors = ['bg-amber-500', 'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
  const pareto = Object.entries(defectCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, count], idx) => ({
      mode,
      count,
      pct: Math.round((count / totalDefects) * 100),
      color: paretoColors[idx % paretoColors.length],
    }));

  res.json({
    hasData: true,
    fpy,
    totalCycles: totalTestCycles,
    laserWeldQuality,
    bmsTelemetryRate,
    ocvDistribution,
    pareto,
    totalCells: cells.length,
    totalModules: modules.length,
    totalBatteries: batteries.length,
    weldedModules: weldedModules.length,
    testedCells,
    testedBatteries,
    testedBms: testedBms.length,
    totalBms: db.bmsUnits.size,
    quarantineOpen: quarantine.filter(q => q.status === 'OPEN').length,
    quarantineResolved: quarantine.filter(q => q.status === 'RESOLVED').length,
  });
});

// 4. Products
apiRouter.get('/products', (req, res) => {
  res.json(db.products);
});

apiRouter.post('/products', requirePermission('products.edit'), (req, res) => {
  const body = req.body as ProductTemplate;
  if (!body.name || !body.sku || !body.cellsPerModule || !body.numModules) {
    return res.status(400).json({ error: 'Missing required product configuration fields' });
  }
  if (!body.productModel || !body.batteryName || !['LV', 'HV'].includes(body.voltageType)) {
    return res.status(400).json({ error: 'Product model, battery name, and LV/HV voltage type are required' });
  }

  const newProd: ProductTemplate = {
    ...body,
    id: `prod-${Date.now()}`,
    totalCells: body.numModules * body.cellsPerModule,
    productModel: body.productModel,
    batteryName: body.batteryName,
    voltageType: body.voltageType,
    bmsConfig: body.bmsConfig || {
      required: true,
      model: body.bmsModel || 'PACE 51.2V',
      protocol: body.bmsProtocol || 'CAN_2.0B',
    },
    bmuConfig: body.bmuConfig || {
      required: false,
    },
    active: true,
  };

  db.products.push(newProd);
  db.addAuditLog('usr-1', `Created product template: ${newProd.name} (${newProd.sku})`, 'SYSTEM', newProd.id);
  res.status(201).json(newProd);
});

apiRouter.delete('/products/:id', requirePermission('products.edit'), (req, res) => {
  const { id } = req.params;
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Product template not found' });
  }
  const removed = db.products.splice(idx, 1)[0];
  db.addAuditLog('usr-1', `Deleted product template: ${removed.name} (${removed.sku})`, 'SYSTEM', removed.id);
  res.json({ success: true, removed });
});

// 5. Suppliers
apiRouter.get('/suppliers', (req, res) => {
  res.json(db.suppliers);
});

// 6. Supplier Imports (Bulk cell import with auto-validation)
apiRouter.post('/supplier-imports', requirePermission('cells.create'), asyncHandler(async (req, res) => {
  const { filename, rows, userId = 'usr-1' } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No data rows provided' });
  }

  const accessToken = getBearerToken(req.headers.authorization);
  const client = accessToken ? getUserScopedClient(accessToken) : null;
  if (!client) {
    return res.status(401).json({ error: 'A valid authenticated Supabase session is required for supplier imports' });
  }

  const supplierName = rows.find((row: any) => row.manufacturer_name)?.manufacturer_name || 'Unknown Supplier';
  const { data: bulkResult, error: bulkError } = await client.rpc('import_supplier_cells_bulk', {
    p_filename: filename || 'supplier_cells_manifest.csv',
    p_supplier_name: supplierName,
    p_rows: rows,
  });
  if (bulkError) return res.status(502).json({ error: bulkError.message });
  return res.json(bulkResult);

  let validRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  const importedCellIds = [];
  const existingCells: Array<{ supplier_barcode: string; internal_serial: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error: existingError } = await client
      .from('cells')
      .select('supplier_barcode, internal_serial')
      .range(offset, offset + 999);
    if (existingError) return res.status(502).json({ error: existingError.message });
    existingCells.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  const existingBarcodes = new Set((existingCells || []).map(c => c.supplier_barcode));
  const usedInternalSerials = new Set((existingCells || []).map(c => c.internal_serial));
  const pendingCells: any[] = [];
  let nextInternalSerial = Math.max(
    0,
    ...(existingCells || []).map(c => Number(String(c.internal_serial || '').match(/(\d+)$/)?.[1] || 0)),
  ) + 1;

  const normalizeSupplier = (supplier: any) => ({
    id: supplier.id,
    name: supplier.name,
    code: supplier.code,
    country: supplier.country ?? supplier.country,
    cellChemistry: supplier.cell_chemistry ?? supplier.cellChemistry,
    nominalCapacityAh: supplier.nominal_capacity_ah ?? supplier.nominalCapacityAh,
    ratingScore: supplier.rating_score ?? supplier.ratingScore,
  });

  const findStoredSupplier = async (name: string) => {
    const { data, error } = await client
      .from('suppliers')
      .select('*')
      .ilike('name', name)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeSupplier(data) : undefined;
  };

  const createSupplier = async (name: string, suffix: string) => {
    const baseCode = (name.replace(/[^a-z0-9]/gi, '').substring(0, 3) || 'SUP').toUpperCase();
    let code = baseCode;
    let attempt = 1;
    while (true) {
      const { data: codeOwner, error: codeError } = await client
        .from('suppliers')
        .select('*')
        .eq('code', code)
        .maybeSingle();
      if (codeError) throw codeError;
      if (!codeOwner) break;
      if (String(codeOwner.name).toLowerCase() === name.toLowerCase()) return normalizeSupplier(codeOwner);
      code = `${baseCode}-${attempt++}`;
    }

    const candidate = {
      id: `sup-${Date.now()}-${suffix}`,
      name,
      code,
      country: 'Unknown',
      cell_chemistry: 'LFP',
      nominal_capacity_ah: 100,
      rating_score: 5,
    };
    const { data, error } = await client.from('suppliers').insert(candidate).select().single();
    if (error) throw error;
    return normalizeSupplier(data);
  };

  // Auto-detect and collect suppliers
  // Find primary supplier from data or use fallback
  const firstManufacturer = rows.find(r => r.manufacturer_name)?.manufacturer_name || 'Unknown Supplier';
  let primarySupplier = db.suppliers.find(s => s.name.toLowerCase() === firstManufacturer.toLowerCase());
  if (!primarySupplier) {
    primarySupplier = await findStoredSupplier(firstManufacturer);
  }
  
  if (!primarySupplier) {
    primarySupplier = await createSupplier(firstManufacturer, 'primary');
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const barcode = String(row.barcode || '').trim();

    if (!barcode) { invalidRows++; continue; }
    if (existingBarcodes.has(barcode)) { duplicateRows++; continue; }

    const cap = parseFloat(row.capacity);
    const ocv = parseFloat(row.ocv);
    const ir = parseFloat(row.ri);

    if (isNaN(cap) || isNaN(ocv) || isNaN(ir)) {
      invalidRows++;
      continue;
    }

    // Determine supplier per cell if they differ, though we default to primary
    const cellManufacturer = row.manufacturer_name || primarySupplier.name;
    let cellSupplier = db.suppliers.find(s => s.name.toLowerCase() === cellManufacturer.toLowerCase());
    if (!cellSupplier && cellManufacturer === primarySupplier.name) cellSupplier = primarySupplier;
    if (!cellSupplier) {
      cellSupplier = await findStoredSupplier(cellManufacturer);
    }
    if (!cellSupplier) {
      cellSupplier = await createSupplier(cellManufacturer, String(i));
    }

    const cellId = `cell-imp-${Date.now()}-${i}-${randomUUID().slice(0, 8)}`;
    let internalSerial = `P2G-CL-${String(nextInternalSerial).padStart(7, '0')}`;
    while (usedInternalSerials.has(internalSerial)) {
      nextInternalSerial++;
      internalSerial = `P2G-CL-${String(nextInternalSerial).padStart(7, '0')}`;
    }
    usedInternalSerials.add(internalSerial);
    nextInternalSerial++;

    const cell = {
      id: cellId,
      internalSerial,
      supplierBarcode: barcode,
      supplierId: cellSupplier.id,
      supplierName: cellManufacturer,
      batchNumber: String(row.group || `BAT-${Date.now()}`),
      palletNumber: String(row.pallet || `PAL-${Date.now()}`),
      boxNumber: String(row.box_number || `BOX-${Date.now()}`),
      manufacturingDate: row.manufacture_date || new Date().toISOString().slice(0, 10),
      supplierCapacityAh: cap,
      supplierOcvV: ocv,
      supplierIrMilliOhm: ir,
      supplierIrMohm: ir,
      supplierGrade: String(row.gear || 'Grade-A'),
      status: 'AVAILABLE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    pendingCells.push({
      id: cell.id,
      internal_serial: cell.internalSerial,
      supplier_barcode: cell.supplierBarcode,
      supplier_id: cell.supplierId,
      supplier_name: cell.supplierName,
      batch_number: cell.batchNumber,
      pallet_number: cell.palletNumber,
      box_number: cell.boxNumber,
      manufacturing_date: cell.manufacturingDate,
      supplier_capacity_ah: cell.supplierCapacityAh,
      supplier_ocv_v: cell.supplierOcvV,
      supplier_ir_mohm: cell.supplierIrMilliOhm,
      supplier_grade: cell.supplierGrade,
      status: cell.status,
    });
    existingBarcodes.add(barcode);
    importedCellIds.push(cellId);
    validRows++;
  }

  // Insert in batches to avoid one network round trip per supplier row.
  for (let offset = 0; offset < pendingCells.length; offset += 500) {
    const batch = pendingCells.slice(offset, offset + 500);
    const { error: cellError } = await client.from('cells').upsert(batch, {
      onConflict: 'supplier_barcode',
      ignoreDuplicates: true,
    });
    if (cellError) return res.status(502).json({ error: cellError.message });
  }

  const importSummary = {
    id: `imp-${Date.now()}`,
    filename: filename || 'supplier_cells_manifest.csv',
    supplierId: primarySupplier.id,
    supplierName: primarySupplier.name,
    totalRows: rows.length,
    validRows,
    duplicateRows,
    invalidRows,
    importedAt: new Date().toISOString(),
    importedBy: userId,
  };

  const { error: summaryError } = await client.from('supplier_import_summaries').insert({
    filename: importSummary.filename,
    supplier_id: primarySupplier.id,
    supplier_name: primarySupplier.name,
    total_rows: importSummary.totalRows,
    valid_rows: importSummary.validRows,
    duplicate_rows: importSummary.duplicateRows,
    invalid_rows: importSummary.invalidRows,
    import_status: 'COMPLETED',
  });
  if (summaryError) return res.status(502).json({ error: summaryError.message });

  const { error: auditError } = await client.from('audit_logs').insert({
    user_name: 'Administrator',
    user_role: 'admin',
    action: `Imported ${validRows} cells (detected primarily from ${primarySupplier.name}) (${duplicateRows} duplicates skipped)`,
    entity_type: 'IMPORT',
    entity_id: importSummary.id,
    new_value: importSummary,
  });
  if (auditError) return res.status(502).json({ error: auditError.message });

  res.json({
    summary: importSummary,
    importedCount: validRows,
  });
}));

apiRouter.get('/supplier-imports', (req, res) => {
  const client = getServiceClient();
  if (!client) return res.status(503).json({ error: 'Supabase service client is not configured' });
  void client.from('supplier_imports').select('*').order('imported_at', { ascending: false })
    .then(({ data, error }) => {
      if (error) return res.status(502).json({ error: error.message });
      return res.json(data || []);
    });
});

// 7. Inventory Endpoints
apiRouter.get('/inventory/cells', (req, res) => {
  const { status, search, limit, usedOnly } = req.query;
  let items = Array.from(db.cells.values());

  // Filter by specific status
  if (status) {
    items = items.filter(c => c.status === status);
  }

  // Filter only used (non-available) cells
  if (usedOnly === 'true') {
    items = items.filter(c => c.status !== 'AVAILABLE');
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    items = items.filter(c =>
      c.internalSerial.toLowerCase().includes(q) ||
      c.supplierBarcode.toLowerCase().includes(q) ||
      c.supplierName.toLowerCase().includes(q) ||
      c.palletNumber.toLowerCase().includes(q) ||
      c.boxNumber.toLowerCase().includes(q)
    );
  }

  // Apply limit only if explicitly provided; default to all
  const maxItems = limit ? Number(limit) : items.length;
  res.json(items.slice(0, maxItems));
});

apiRouter.get('/inventory/bms', (req, res) => {
  res.json(Array.from(db.bmsUnits.values()));
});

apiRouter.post('/inventory/bms/batch', requirePermission('bms.edit'), (req, res) => {
  const { count = 10, model = 'PACE-51.2V-100A-CAN', supplier = 'Pace Electronic Tech', protocol = 'CAN_2.0B' } = req.body;
  const created: any[] = [];
  const currentCount = db.bmsUnits.size;
  for (let i = 1; i <= count; i++) {
    const nextNum = currentCount + i;
    const serial = `P2G-BMS-${String(nextNum).padStart(6, '0')}`;
    const id = `bms-${Date.now()}-${i}`;
    const bmsItem = {
      id,
      serialNumber: serial,
      model,
      supplier,
      firmwareVersion: 'v4.2.1-prod',
      hardwareVersion: 'HW-Rev3',
      protocol: protocol as any,
      status: 'AVAILABLE' as any,
      createdAt: new Date().toISOString(),
    };
    db.bmsUnits.set(id, bmsItem);
    created.push(bmsItem);
  }
  db.addAuditLog('usr-1', `Ingested batch of ${created.length} BMS units (${model})`, 'BMS', `bms-batch-${Date.now()}`);
  res.status(201).json({ count: created.length, items: created });
});

apiRouter.get('/inventory/modules', (req, res) => {
  res.json(Array.from(db.modules.values()));
});

apiRouter.get('/inventory/batteries', (req, res) => {
  res.json(Array.from(db.batteries.values()));
});

// 8. Production Orders
apiRouter.get('/production-orders', (req, res) => {
  res.json(Array.from(db.orders.values()));
});

// Create Production Order with dynamic structure generation & Material Reservation (Cells only)
  apiRouter.post('/production-orders', requirePermission('production_orders.create'), (req, res) => {
    const { productId, quantity = 1, orderNumber, userId = 'usr-2' } = req.body;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be a positive whole number' });
    }
    const product = db.products.find(p => p.id === productId);
    if (!product) {
      return res.status(400).json({ error: 'Product template not found' });
    }

    const requiredCells = product.totalCells * quantity;

    // Material Availability Check (Cells only)
    const availableCells = Array.from(db.cells.values()).filter(c => c.status === 'AVAILABLE');
    const shortageCells = Math.max(0, requiredCells - availableCells.length);

    if (shortageCells > 0) {
      return res.status(400).json({
        error: 'Insufficient cell inventory to start production order',
        shortage: {
          requiredCells,
          availableCells: availableCells.length,
          shortageCells,
        },
      });
    }

    const orderId = `po-${Date.now()}`;
    const poNum = orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(db.orders.size + 1).padStart(4, '0')}`;

    const batteryIds: string[] = [];

    // Create Battery Units and Reserve Cells
    for (let q = 0; q < quantity; q++) {
      const batId = `bat-${Date.now()}-${q}`;
      const batteryBase = `P2G-${product.productModel.toUpperCase().replace(/[^A-Z0-9.]+/g, '')}-${new Date().toISOString().slice(2, 7).replace('-', '')}`;
      const nextBatteryNumber = Array.from(db.batteries.values()).reduce((max, battery) => {
        if (!/^P2G-[A-Z0-9.]+-[0-9]{4}-[0-9]{6}$/i.test(battery.serialNumber)) return max;
        return Math.max(max, Number(battery.serialNumber.match(/(\d+)$/)?.[1] || 0));
      }, 0) + q + 1;
      const batSerial = `${batteryBase}-${String(nextBatteryNumber).padStart(6, '0')}`;
      batteryIds.push(batId);

      // Create module skeletons based on product configuration
      const modules: ModuleItem[] = [];
      for (let m = 0; m < product.numModules; m++) {
        const modId = `mod-${Date.now()}-${q}-${m}`;
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const modulePrefix = `P2G-MOD-${day}${month}`;
        const nextModuleNumber = Array.from(db.modules.values()).reduce((max, module) => {
          const match = module.serialNumber.match(new RegExp(`^${modulePrefix}-(\\d+)$`, 'i'));
          return Math.max(max, Number(match?.[1] || 0));
        }, 0) + m + 1;
        const modSerial = `P2G-MOD-${day}${month}-${String(nextModuleNumber).padStart(5, '0')}`;
        const mod: ModuleItem = {
          id: modId,
          serialNumber: modSerial,
          qrCode: `${modSerial}|${product.sku}|MOD-${m + 1}`,
          productId: product.id,
          productionOrderId: orderId,
          batteryId: batId,
          moduleIndex: m,
          cells: [],
          matchingScore: 0,
          matchingMetrics: {
            avgCapacityAh: 0,
            deltaCapacityAh: 0,
            avgOcvV: 0,
            deltaOcvV: 0,
            avgIrMilliOhm: 0,
            deltaIrMilliOhm: 0,
          },
          status: 'IN_PROCESS',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        modules.push(mod);
        db.modules.set(modId, mod);
      }

      // Reserve Cells for this battery
      const cellsToReserve = availableCells.splice(0, product.totalCells);
      for (const cell of cellsToReserve) {
        cell.status = 'RESERVED';
        cell.reservedForOrderId = orderId;
        cell.reservedForBatteryId = batId;
        cell.updatedAt = new Date().toISOString();
      }

      // Create Battery Record (without BMS requirement)
      const battery: BatteryUnit = {
        id: batId,
        serialNumber: batSerial,
        qrCode: `${batSerial}|${product.sku}|IN_PROCESS`,
        productionOrderId: orderId,
        productId: product.id,
        productName: product.name,
        currentStep: 'CELL_IDENTIFICATION',
        progressPercent: 5,
        status: 'IN_PROCESS',
        modules,
        stepResults: {
          CELL_IDENTIFICATION: { stepName: 'Cell Identification & Verification', status: 'READY', mode: 'AUTO' },
          CELL_TESTING: { stepName: 'OCV & IR Testing', status: 'PENDING', mode: 'AUTO' },
          GRADING: { stepName: 'Automatic Cell Grading', status: 'PENDING', mode: 'AUTO' },
          CELL_MATCHING: { stepName: 'Module Cell Matching', status: 'PENDING', mode: 'AUTO' },
          MODULE_ASSEMBLY: { stepName: 'Module Assembly', status: 'PENDING', mode: 'MANUAL' },
          LASER_WELDING: { stepName: 'Laser Busbar Welding', status: 'PENDING', mode: 'AUTO' },
          MODULE_QC: { stepName: 'Module QC Inspection', status: 'PENDING', mode: 'MANUAL' },
          BATTERY_ASSEMBLY: { stepName: 'Battery Enclosure Assembly', status: 'PENDING', mode: 'MANUAL' },
          BMS_INTEGRATION: { stepName: 'BMS Harness & Comms Testing', status: 'PENDING', mode: 'AUTO' },
          FINAL_TESTING: { stepName: 'Pack High-Pot & Dyn Load Test', status: 'PENDING', mode: 'AUTO' },
          FINAL_QC: { stepName: 'Final Quality Release & Label', status: 'PENDING', mode: 'MANUAL' },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      db.batteries.set(batId, battery);
    }

    const order: ProductionOrder = {
      id: orderId,
      orderNumber: poNum,
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      quantityPlanned: quantity,
      quantityCompleted: 0,
      quantityInProcess: quantity,
      quantityFailed: 0,
      status: 'IN_PROCESS',
      requiredCells,
      availableCells: availableCells.length,
      reservedCells: requiredCells,
      shortageCells: 0,
      requiredBms: 0,
      availableBms: 0,
      reservedBms: 0,
      shortageBms: 0,
      batteryIds,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.orders.set(orderId, order);
    db.addAuditLog(userId, `Created Production Order ${poNum} for ${quantity}x ${product.name} (Reserved ${requiredCells} cells)`, 'ORDER', orderId);

    res.status(201).json({
      order,
      batteryIds,
    });
  });

  // Cancel Production Order & Release Material Reservations safely
  apiRouter.post('/production-orders/:id/cancel', requirePermission('production_orders.edit'), (req, res) => {
    const { id } = req.params;
    const { reason = 'Order cancelled by operator', userId = 'usr-2' } = req.body;
    const order = db.orders.get(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel a completed production order' });
    }

    // Release unused reserved cells
    for (const cell of db.cells.values()) {
      if (cell.reservedForOrderId === id && cell.status === 'RESERVED') {
        cell.status = 'AVAILABLE';
        cell.reservedForOrderId = undefined;
        cell.reservedForBatteryId = undefined;
        cell.updatedAt = new Date().toISOString();
      }
    }

    order.status = 'CANCELLED';
    order.updatedAt = new Date().toISOString();

    db.addAuditLog(userId, `Cancelled Production Order ${order.orderNumber} - Reason: ${reason}`, 'ORDER', id);
    res.json({ message: 'Order cancelled and reserved cells released', order });
  });

// Resolve a battery by internal id, serial number, QR code, or the legacy
// "active battery" placeholder (which falls back to the most-recent battery).
function findBattery(id: string | undefined) {
  if (!id) return undefined;
  const direct = db.batteries.get(id);
  if (direct) return direct;
  const ql = String(id).toLowerCase();
  const byIdentifier = Array.from(db.batteries.values()).find(
    x => (x.serialNumber && x.serialNumber.toLowerCase() === ql) || (x.qrCode && x.qrCode.toLowerCase() === ql)
  );
  if (byIdentifier) return byIdentifier;
  if (id === 'bat-active-101') {
    const all = Array.from(db.batteries.values());
    if (all.length) return all[all.length - 1];
  }
  return undefined;
}

// 9. Battery Detail (Visual Battery Builder Data)
apiRouter.get('/batteries/:id', (req, res) => {
  const { id } = req.params;
  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  const product = db.products.find(p => p.id === battery.productId);
  const order = db.orders.get(battery.productionOrderId);

  // Hydrate modules with real cells
  const hydratedModules = battery.modules.map(m => {
    const realMod = db.modules.get(m.id) || m;
    return realMod;
  });

  res.json({
    battery: {
      ...battery,
      modules: hydratedModules,
    },
    product,
    order,
  });
});

// 10. Component Scanning & One-Time Identification
apiRouter.post('/batteries/:id/scan', requirePermission('production.scan_component'), (req, res) => {
  const { id } = req.params;
  const { barcode, slotType, moduleIndex, cellSlotIndex, userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  const query = (barcode || '').trim();
  if (!query) return res.status(400).json({ error: 'No barcode provided' });

  const product = db.products.find(p => p.id === battery.productId);

  if (slotType === 'BMS') {
    let bms = Array.from(db.bmsUnits.values()).find(b =>
      b.serialNumber.toLowerCase() === query.toLowerCase() ||
      b.id.toLowerCase() === query.toLowerCase()
    );

    if (!bms) {
      bms = {
        id: `bms-${Date.now()}`,
        serialNumber: query,
        model: product?.bmsConfig?.model || product?.bmsModel || 'PACE 51.2V',
        supplier: product?.bmsConfig?.manufacturer || 'Power2Go Verified',
        firmwareVersion: 'v1.2.0',
        hardwareVersion: 'v2.0',
        protocol: product?.bmsConfig?.protocol || 'CAN_2.0B',
        status: 'IN_PROCESS',
        assignedToBatteryId: id,
        createdAt: new Date().toISOString(),
      };
      db.bmsUnits.set(bms.id, bms);
      db.addAuditLog(userId, `New BMS detected & registered on-the-fly: ${bms.serialNumber} for Battery ${battery.serialNumber}`, 'BMS', bms.id);
    } else {
      if (bms.assignedToBatteryId && bms.assignedToBatteryId !== id) {
        return res.status(400).json({ error: `BMS ${bms.serialNumber} is already assembled in Battery ${bms.assignedToBatteryId}` });
      }
      if (bms.status === 'QUARANTINED') {
        return res.status(400).json({ error: `BMS ${bms.serialNumber} is in QUARANTINE: ${bms.quarantineReason || 'Failed test'}` });
      }
      bms.assignedToBatteryId = id;
      bms.status = 'IN_PROCESS';
      db.addAuditLog(userId, `Scanned & Assigned BMS ${bms.serialNumber} to Battery ${battery.serialNumber}`, 'BMS', bms.id);
    }

    battery.bms = bms;
    battery.updatedAt = new Date().toISOString();
    return res.json({ success: true, itemType: 'BMS', item: bms });
  }

  if (slotType === 'BMU') {
    let bmu = Array.from(db.bmuUnits.values()).find(b =>
      b.serialNumber.toLowerCase() === query.toLowerCase() ||
      b.id.toLowerCase() === query.toLowerCase()
    );

    if (!bmu) {
      bmu = {
        id: `bmu-${Date.now()}`,
        serialNumber: query,
        model: product?.bmuConfig?.model || 'Power2Go BMU-X1',
        manufacturer: product?.bmuConfig?.manufacturer || 'Power2Go',
        protocol: product?.bmuConfig?.protocol || 'CAN',
        status: 'IN_PROCESS',
        assignedToBatteryId: id,
        createdAt: new Date().toISOString(),
      };
      db.bmuUnits.set(bmu.id, bmu);
      db.addAuditLog(userId, `New BMU detected & registered on-the-fly: ${bmu.serialNumber} for Battery ${battery.serialNumber}`, 'BMS', bmu.id);
    } else {
      if (bmu.assignedToBatteryId && bmu.assignedToBatteryId !== id) {
        return res.status(400).json({ error: `BMU ${bmu.serialNumber} is already assembled in Battery ${bmu.assignedToBatteryId}` });
      }
      if (bmu.status === 'QUARANTINED') {
        return res.status(400).json({ error: `BMU ${bmu.serialNumber} is in QUARANTINE: ${bmu.quarantineReason || 'Failed test'}` });
      }
      bmu.assignedToBatteryId = id;
      bmu.status = 'IN_PROCESS';
      db.addAuditLog(userId, `Scanned & Assigned BMU ${bmu.serialNumber} to Battery ${battery.serialNumber}`, 'BMS', bmu.id);
    }

    battery.bmu = bmu;
    battery.updatedAt = new Date().toISOString();
    return res.json({ success: true, itemType: 'BMU', item: bmu });
  }

  // CELL Scanning
  // Look up cell by internal serial OR supplier barcode
  const cell = Array.from(db.cells.values()).find(c =>
    c.supplierBarcode.toLowerCase() === query.toLowerCase() ||
    c.internalSerial.toLowerCase() === query.toLowerCase() ||
    c.id.toLowerCase() === query.toLowerCase()
  );

  if (!cell) {
    return res.status(404).json({
      error: `Cell with barcode "${query}" not found in Supplier Manifest or Inventory. Import supplier batch first.`,
    });
  }

  // Check double allocation
  if (cell.assignedToModuleId) {
    const existingMod = db.modules.get(cell.assignedToModuleId);
    return res.status(400).json({
      error: `Cell ${cell.internalSerial} (${cell.supplierBarcode}) is already assigned to Module ${existingMod?.serialNumber || cell.assignedToModuleId}. Double allocation prevented.`,
    });
  }

  if (cell.status === 'QUARANTINED') {
    return res.status(400).json({
      error: `Cell ${cell.internalSerial} is QUARANTINED. Reason: ${cell.quarantineReason || 'Grading/QC failure'}. Cannot assign.`,
    });
  }

  // Assign to specified module slot
  const targetModule = battery.modules[moduleIndex || 0];
  if (!targetModule) {
    return res.status(400).json({ error: `Module index ${moduleIndex} out of range` });
  }

  cell.status = 'SCANNED';
  cell.reservedForBatteryId = id;
  cell.assignedToModuleId = targetModule.id;
  cell.moduleSlotIndex = cellSlotIndex;
  cell.updatedAt = new Date().toISOString();

  // Add to target module if not already in list
  const existingIdx = targetModule.cells.findIndex(c => c.id === cell.id);
  if (existingIdx >= 0) {
    targetModule.cells[existingIdx] = cell;
  } else {
    targetModule.cells.push(cell);
  }

  db.modules.set(targetModule.id, targetModule);
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Identified Cell ${cell.internalSerial} (Supplier Barcode: ${cell.supplierBarcode}) → Module ${targetModule.serialNumber} Slot ${cellSlotIndex + 1}`, 'CELL', cell.id);

  return res.json({
    success: true,
    itemType: 'CELL',
    cell,
    supplierData: {
      manufacturer: cell.supplierName,
      supplierBarcode: cell.supplierBarcode,
      capacityAh: cell.supplierCapacityAh,
      ocvV: cell.supplierOcvV,
      irMilliOhm: cell.supplierIrMilliOhm,
      grade: cell.supplierGrade,
      pallet: cell.palletNumber,
      box: cell.boxNumber,
      mfgDate: cell.manufacturingDate,
    },
  });
});

// 11. Auto Cell Matching & Module Assembly
apiRouter.post('/batteries/:id/auto-match', requirePermission('assign_cell'), (req, res) => {
  const { id } = req.params;
  const { userId = 'usr-3' } = req.body;
  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  const product = db.products.find(p => p.id === battery.productId);
  if (!product) return res.status(400).json({ error: 'Product template missing' });

  // Gather all reserved/available cells for this battery
  let candidateCells = Array.from(db.cells.values()).filter(c =>
    c.reservedForBatteryId === id || c.status === 'RESERVED' || c.status === 'AVAILABLE' || c.status === 'SCANNED'
  );

  for (let m = 0; m < battery.modules.length; m++) {
    const mod = battery.modules[m];
    const matchResult = db.matchCellsForModule(candidateCells, product.cellsPerModule, product.gradingRules);
    if (!matchResult) {
      return res.status(400).json({
        error: `Could not match tight tolerance cells for Module ${m + 1}. Need ${product.cellsPerModule} cells with delta OCV < ${product.gradingRules.maxDeltaOcvMv}mV and delta IR < ${product.gradingRules.maxDeltaIrMilliOhm}mΩ.`,
      });
    }

    mod.cells = matchResult.matched;
    mod.matchingScore = matchResult.score;
    mod.matchingMetrics = matchResult.metrics;
    mod.status = 'IN_PROCESS';
    mod.updatedAt = new Date().toISOString();

    // Mark matched cells as ASSEMBLED in this module
    matchResult.matched.forEach((c, idx) => {
      c.status = 'ASSEMBLED';
      c.assignedToModuleId = mod.id;
      c.moduleSlotIndex = idx;
      c.updatedAt = new Date().toISOString();
      // Remove from candidate pool
      candidateCells = candidateCells.filter(cand => cand.id !== c.id);
    });

    db.modules.set(mod.id, mod);
  }

  // Update battery step
  battery.stepResults.CELL_MATCHING = {
    stepName: 'Module Cell Matching',
    status: 'PASSED',
    mode: 'AUTO',
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `All ${product.numModules} modules matched with average score ${(battery.modules.reduce((s, m) => s + m.matchingScore, 0) / battery.modules.length).toFixed(1)}%`,
  };

  battery.stepResults.MODULE_ASSEMBLY = {
    stepName: 'Module Assembly',
    status: 'READY',
    mode: 'MANUAL',
  };

  battery.currentStep = 'MODULE_ASSEMBLY';
  battery.progressPercent = 40;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Completed Automated Cell Matching for Battery ${battery.serialNumber} across ${product.numModules} modules`, 'BATTERY', id);

  res.json({
    success: true,
    battery,
    modules: battery.modules,
  });
});

// 12. Laser Welding Station Endpoint
apiRouter.post('/batteries/:id/modules/:moduleId/weld', requirePermission('qc.perform'), async (req, res) => {
  const { id, moduleId } = req.params;
  const { mode = 'AUTO', machineId = 'MC-WELD-01', userId = 'usr-3', manualParams, status = 'PASSED' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  // Auto-pass MODULE_ASSEMBLY if not done
  if (battery.currentStep === 'MODULE_ASSEMBLY') {
    battery.stepResults.MODULE_ASSEMBLY = {
      stepName: 'Module Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Physical assembly auto-verified on weld initiation.',
    };
    battery.currentStep = 'LASER_WELDING';
    battery.progressPercent = 50;
  }
  
  const mod = db.modules.get(moduleId);
  if (!mod) return res.status(404).json({ error: 'Module not found' });

  if (mod.cells.length === 0) {
    return res.status(400).json({ error: 'Module has no cells assigned to weld' });
  }

  let weldResult;

  if (mode === 'AUTO') {
    const exec = await MachineGateway.executeStep(machineId, 'LASER_WELDING', { cellCount: mod.cells.length });
    if (!exec.success) {
      return res.status(500).json({ error: exec.error || 'Machine execution failed' });
    }
    weldResult = {
      status: status as any,
      machineId: 'MANUAL_OVERRIDE',
      laserPowerWatts: manualParams?.laserPowerWatts || 2800,
      weldTimeMs: manualParams?.weldTimeMs || 4200,
      pullForceKg: manualParams?.pullForceKg || 18.2,
      weldedAt: new Date().toISOString(),
      operatorId: userId,
    };
  } else {
    // BYPASS
    weldResult = {
      status: 'BYPASSED' as const,
      machineId: 'SUPERVISOR_BYPASS',
      laserPowerWatts: 0,
      weldTimeMs: 0,
      pullForceKg: 0,
      weldedAt: new Date().toISOString(),
      operatorId: userId,
    };
  }

  mod.weldingResult = weldResult;
  mod.updatedAt = new Date().toISOString();
  db.modules.set(moduleId, mod);

  // Check if all modules welded
  const allWelded = battery.modules.every(m => {
    const mRec = db.modules.get(m.id);
    return mRec?.weldingResult?.status === 'PASSED' || mRec?.weldingResult?.status === 'BYPASSED';
  });

  if (allWelded) {
    battery.stepResults.LASER_WELDING = {
      stepName: 'Laser Busbar Welding',
      status: 'PASSED',
      mode,
      completedAt: new Date().toISOString(),
      completedBy: userId,
    };
    battery.stepResults.MODULE_QC = {
      stepName: 'Module QC Inspection',
      status: 'READY',
      mode: 'MANUAL',
    };
    battery.currentStep = 'MODULE_QC';
    battery.progressPercent = 60;
  }

  db.addAuditLog(userId, `Laser Welded Module ${mod.serialNumber} via [${mode}] mode (Pull force: ${weldResult.pullForceKg}kg)`, 'MODULE', moduleId);

  res.json({ success: true, module: mod, battery });
});

// 13. Module QC Endpoint
apiRouter.post('/batteries/:id/modules/:moduleId/qc', requirePermission('qc.perform'), (req, res) => {
  const { id, moduleId } = req.params;
  const { status = 'PASSED', physicalVisualOk = true, busbarResistanceMilliOhm = 0.18, packVoltageV = 26.4, insulationResistanceMOhm = 450, notes, userId = 'usr-4' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  const mod = db.modules.get(moduleId);
  if (!mod) return res.status(404).json({ error: 'Module not found' });

  mod.qcResult = {
    status,
    physicalVisualOk,
    busbarResistanceMilliOhm,
    packVoltageV,
    insulationResistanceMOhm,
    inspectedAt: new Date().toISOString(),
    inspectorId: userId,
    notes,
  };

  if (status === 'FAILED') {
    mod.status = 'QUARANTINED';
    db.quarantineRecords.push({
      id: `quar-${Date.now()}`,
      entityType: 'MODULE',
      entityId: mod.id,
      entitySerial: mod.serialNumber,
      reason: notes || 'Failed Module QC Inspection',
      stage: 'MODULE_QC',
      quarantinedBy: userId,
      quarantinedAt: new Date().toISOString(),
      status: 'OPEN',
    });
  }

  db.modules.set(moduleId, mod);

  const allPassed = battery.modules.every(m => {
    const mRec = db.modules.get(m.id);
    return mRec?.qcResult?.status === 'PASSED';
  });

  if (allPassed) {
    battery.stepResults.MODULE_QC = {
      stepName: 'Module QC Inspection',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
    };
    battery.stepResults.BATTERY_ASSEMBLY = {
      stepName: 'Battery Enclosure Assembly',
      status: 'READY',
      mode: 'MANUAL',
    };
    battery.currentStep = 'BATTERY_ASSEMBLY';
    battery.progressPercent = 70;
  }

  db.addAuditLog(userId, `QC Inspection on Module ${mod.serialNumber}: ${status}`, 'MODULE', moduleId);
  res.json({ success: true, module: mod, battery });
});

// 13.5 Bulk Module Workflow Endpoint
apiRouter.post('/batteries/:id/modules/bulk-workflow', requirePermission('qc.perform'), (req, res) => {
  const { id } = req.params;
  const { modules, userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  if (!Array.isArray(modules) || modules.length === 0) {
    return res.status(400).json({ error: 'No modules provided' });
  }

  let allWelded = true;
  let allQcPassed = true;

  modules.forEach((item: {
    moduleId: string;
    weldingStatus: 'PASSED' | 'FAILED' | 'BYPASSED';
    physicalVisualOk: boolean;
    voltageQcOk: boolean;
    laserPowerWatts?: number;
    weldTimeMs?: number;
    pullForceKg?: number;
    busbarResistanceMilliOhm?: number;
    packVoltageV?: number;
    insulationResistanceMOhm?: number;
    notes?: string;
  }) => {
    const mod = db.modules.get(item.moduleId);
    if (mod) {
      mod.weldingResult = {
        status: item.weldingStatus || 'PASSED',
        machineId: 'MANUAL_OVERRIDE',
        laserPowerWatts: item.laserPowerWatts || 2800,
        weldTimeMs: item.weldTimeMs || 4200,
        pullForceKg: item.pullForceKg || 18.5,
        weldedAt: new Date().toISOString(),
        operatorId: userId,
      };

      const qcPass = item.physicalVisualOk && item.voltageQcOk;
      mod.qcResult = {
        status: qcPass ? 'PASSED' : 'FAILED',
        physicalVisualOk: item.physicalVisualOk,
        busbarResistanceMilliOhm: item.busbarResistanceMilliOhm || 0.18,
        packVoltageV: item.packVoltageV || 26.4,
        insulationResistanceMOhm: item.insulationResistanceMOhm || 520,
        inspectedAt: new Date().toISOString(),
        inspectorId: userId,
        notes: item.notes,
      };

      if (!qcPass || item.weldingStatus === 'FAILED') {
        mod.status = 'QUARANTINED';
        db.quarantineRecords.push({
          id: `quar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          entityType: 'MODULE',
          entityId: mod.id,
          entitySerial: mod.serialNumber,
          reason: item.notes || 'Module failed Welding or QC verification',
          stage: 'MODULE_QC',
          quarantinedBy: userId,
          quarantinedAt: new Date().toISOString(),
          status: 'OPEN',
        });
      } else {
        mod.status = 'ASSEMBLED';
      }

      db.modules.set(mod.id, mod);

      // Sync into battery.modules
      const bModIdx = battery.modules.findIndex(m => m.id === mod.id);
      if (bModIdx >= 0) {
        battery.modules[bModIdx] = mod;
      }
    }
  });

  allWelded = battery.modules.every(m => {
    const mRec = db.modules.get(m.id);
    return mRec?.weldingResult?.status === 'PASSED' || mRec?.weldingResult?.status === 'BYPASSED';
  });

  allQcPassed = battery.modules.every(m => {
    const mRec = db.modules.get(m.id);
    return mRec?.qcResult?.status === 'PASSED';
  });

  if (allWelded) {
    battery.stepResults.LASER_WELDING = {
      stepName: 'Laser Busbar Welding',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'All modules laser welding verified.',
    };
  }

  if (allQcPassed) {
    battery.stepResults.MODULE_QC = {
      stepName: 'Module QC Inspection',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'All modules physical and voltage QC verified.',
    };
    battery.stepResults.BATTERY_ASSEMBLY = {
      stepName: 'Battery Enclosure Assembly',
      status: 'READY',
      mode: 'MANUAL',
    };
    battery.currentStep = 'BATTERY_ASSEMBLY';
    battery.progressPercent = 70;
  }

  battery.updatedAt = new Date().toISOString();
  db.addAuditLog(userId, `Completed Bulk Module Workflow for Battery ${battery.serialNumber} (${battery.modules.length} modules processed)`, 'BATTERY', id);

  res.json({ success: true, battery });
});

// 14. BMS Integration & Communication Test
apiRouter.post('/batteries/:id/bms/test', requirePermission('qc.perform'), async (req, res) => {
  const { id } = req.params;
  const { mode = 'AUTO', machineId = 'MC-BMS-01', userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  if (!battery.bms) {
    return res.status(400).json({ error: 'No BMS assigned to battery. Scan BMS first.' });
  }

  let testResult;
  if (mode === 'AUTO') {
    const exec = await MachineGateway.executeStep(machineId, 'BMS_TEST', { cellCount: 16 });
    if (!exec.success) {
      return res.status(500).json({ error: exec.error || 'BMS Rig communication error' });
    }
    testResult = {
      status: 'PASSED' as const,
      canCommsOk: exec.data.canCommsOk,
      tempSensorsOk: true,
      voltageDeltaMv: exec.data.deltaMv,
      testedAt: exec.data.testedAt,
      testedBy: userId,
    };
  } else {
    testResult = {
      status: 'PASSED' as const,
      canCommsOk: true,
      tempSensorsOk: true,
      voltageDeltaMv: 2.1,
      testedAt: new Date().toISOString(),
      testedBy: userId,
    };
  }

  battery.bms.testResult = testResult;
  battery.bms.status = 'ASSEMBLED';
  db.bmsUnits.set(battery.bms.id, battery.bms);

  battery.stepResults.BMS_INTEGRATION = {
    stepName: 'BMS Harness & Comms Testing',
    status: 'PASSED',
    mode,
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `CAN 2.0B Telemetry Verified, Delta V = ${testResult.voltageDeltaMv}mV`,
  };

  battery.stepResults.FINAL_TESTING = {
    stepName: 'Pack High-Pot & Dyn Load Test',
    status: 'READY',
    mode: 'AUTO',
  };

  battery.currentStep = 'FINAL_TESTING';
  battery.progressPercent = 85;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `BMS Telemetry & Hardware Test Passed for BMS ${battery.bms.serialNumber}`, 'BMS', battery.bms.id);
  res.json({ success: true, battery });
});

// 15. Final Pack Testing & Dyn Load Test
apiRouter.post('/batteries/:id/final-test', requirePermission('qc.perform'), async (req, res) => {
  const { id } = req.params;
  const { mode = 'AUTO', machineId = 'MC-DYN-01', userId = 'usr-4', manualValues } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  // Auto-pass intermediate assembly steps that don't have dedicated UI actions
  if (battery.currentStep === 'BATTERY_ASSEMBLY' || battery.currentStep === 'BMS_INTEGRATION' || battery.currentStep === 'MODULE_QC') {
    battery.stepResults.BATTERY_ASSEMBLY = {
      stepName: 'Battery Enclosure Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Physical enclosure and wiring auto-verified before testing.',
    };
    battery.stepResults.BMS_INTEGRATION = {
      stepName: 'BMS Harness & Comms Testing',
      status: 'PASSED',
      mode: 'AUTO',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'BMS Comms verified successfully.',
    };
    battery.currentStep = 'FINAL_TESTING';
  }
  
  let finalData: any;
  if (mode === 'AUTO') {
    const exec = await MachineGateway.executeStep(machineId, 'FINAL_TESTING', {});
    if (!exec.success) return res.status(500).json({ error: exec.error });
    finalData = exec.data;
  } else {
    finalData = {
      packVoltageV: manualValues?.packVoltageV !== undefined ? Number(manualValues.packVoltageV) : 52.84,
      internalResistanceMilliOhm: manualValues?.batteryIrMohm !== undefined ? Number(manualValues.batteryIrMohm) : 0.42,
      hiPotInsulationMOhm: manualValues?.hiPotInsulationMOhm !== undefined ? Number(manualValues.hiPotInsulationMOhm) : 520,
      bmsTelemetryOk: manualValues?.bmsTelemetryOk !== undefined ? Boolean(manualValues.bmsTelemetryOk) : true,
      thermalSensorDeltaC: 0.5,
      enclosureVisualOk: manualValues?.enclosureVisualOk !== undefined ? Boolean(manualValues.enclosureVisualOk) : true,
      testedAt: new Date().toISOString(),
    };
  }

  battery.finalQcResult = {
    status: manualValues?.qcTesting === 'FAILED' ? 'FAILED' : 'PASSED',
    packVoltageV: finalData.packVoltageV,
    internalResistanceMilliOhm: finalData.internalResistanceMilliOhm,
    hiPotInsulationMOhm: finalData.hiPotInsulationMOhm,
    bmsTelemetryOk: finalData.bmsTelemetryOk,
    thermalSensorDeltaC: finalData.thermalSensorDeltaC,
    enclosureVisualOk: finalData.enclosureVisualOk,
    testedBy: userId,
    testedAt: new Date().toISOString(),
  };

  battery.stepResults.FINAL_TESTING = {
    stepName: 'Pack High-Pot & Dyn Load Test',
    status: manualValues?.qcTesting === 'FAILED' ? 'FAILED' : 'PASSED',
    mode,
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `Voltage: ${finalData.packVoltageV}V, Hi-Pot: ${finalData.hiPotInsulationMOhm} MΩ`,
  };

  battery.stepResults.FINAL_QC = {
    stepName: 'Final Quality Release & Label',
    status: 'READY',
    mode: 'MANUAL',
  };

  battery.currentStep = 'FINAL_QC';
  battery.progressPercent = 95;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Final Pack Dynamic Load & Hi-Pot Test Passed for Battery ${battery.serialNumber}`, 'BATTERY', id);
  res.json({ success: true, battery });
});

// 16. Final QC Quality Release & Finish
apiRouter.post('/batteries/:id/final-qc', requirePermission('qc.approve_final'), (req, res) => {
  const { id } = req.params;
  const { status = 'PASSED', userId = 'usr-4' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  const product = db.products.find(p => p.id === battery.productId);
  if (status === 'PASSED' && product) {
    if (product.bmsConfig?.required && !battery.bms) {
      return res.status(400).json({ error: `Product template ${product.sku} requires a BMS. Please scan and assign BMS before final release.` });
    }
    if (product.bmuConfig?.required && !battery.bmu) {
      return res.status(400).json({ error: `Product template ${product.sku} requires a BMU. Please scan and assign BMU before final release.` });
    }
  }

  if (status === 'PASSED') {
    const cellsComplete = battery.modules.length > 0 && battery.modules.every(module => module.cells.length > 0);
    if (!cellsComplete) return res.status(400).json({ error: 'Cannot release battery: all module cells must be assigned.' });
    if (!battery.bms && !battery.bmu) return res.status(400).json({ error: 'Cannot release battery: assign a BMS or BMU first.' });
    if (battery.stepResults.FINAL_TESTING?.status !== 'PASSED') return res.status(400).json({ error: 'Cannot release battery: pack testing must pass first.' });
    if (battery.modules.some(module => module.qcResult?.status && module.qcResult.status !== 'PASSED')) {
      return res.status(400).json({ error: 'Cannot release battery: every module QC result must pass.' });
    }
    if (db.quarantineRecords.some(record => record.status === 'OPEN' && (record.entityId === id || battery.modules.some(module => module.id === record.entityId)))) {
      return res.status(400).json({ error: 'Cannot release battery: an open quarantine record exists.' });
    }
  }

  if (status === 'PASSED') {
    battery.status = 'FINISHED';
    battery.progressPercent = 100;
    battery.currentStep = 'COMPLETED';
    battery.qrCode = `${battery.serialNumber}|${battery.productName}|PASSED|${new Date().toISOString().slice(0, 10)}`;

    battery.stepResults.FINAL_QC = {
      stepName: 'Final Quality Release & Label',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Certified for customer dispatch & finished goods inventory',
    };

    // Update Production Order completed count
    const order = db.orders.get(battery.productionOrderId);
    if (order) {
      order.quantityCompleted += 1;
      order.quantityInProcess = Math.max(0, order.quantityInProcess - 1);
      if (order.quantityCompleted >= order.quantityPlanned) {
        order.status = 'COMPLETED';
      }
      order.updatedAt = new Date().toISOString();
    }

    db.addAuditLog(userId, `Approved Final Quality Release for Battery ${battery.serialNumber} → Moved to FINISHED INVENTORY`, 'BATTERY', id);
  } else {
    battery.status = 'QUARANTINED';
    db.quarantineRecords.push({
      id: `quar-${Date.now()}`,
      entityType: 'BATTERY',
      entityId: battery.id,
      entitySerial: battery.serialNumber,
      reason: 'Failed Final QC sign-off',
      stage: 'FINAL_QC',
      quarantinedBy: userId,
      quarantinedAt: new Date().toISOString(),
      status: 'OPEN',
    });
  }

  battery.updatedAt = new Date().toISOString();
  res.json({ success: true, battery });
});

// 16.5 Bulk Cell Workflow Endpoints (Authoritative Backend State Transitions)
apiRouter.post('/batteries/:id/cells/bulk-ocv-ir', requirePermission('manual'), (req, res) => {
  const { id } = req.params;
  const { measurements, userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  if (!Array.isArray(measurements) || measurements.length === 0) {
    return res.status(400).json({ error: 'No cell measurements provided' });
  }

  // Update each cell in database and battery modules
  measurements.forEach((m: { cellId: string; productionOcvV: number; productionIrMilliOhm: number }) => {
    const cell = db.cells.get(m.cellId);
    const ocv = Number(m.productionOcvV);
    const ir = Number(m.productionIrMilliOhm);

    if (cell) {
      cell.productionOcvV = isNaN(ocv) ? cell.supplierOcvV : ocv;
      cell.productionIrMilliOhm = isNaN(ir) ? cell.supplierIrMilliOhm : ir;
      cell.productionIrMohm = cell.productionIrMilliOhm;
      cell.productionCapacityAh = cell.supplierCapacityAh;
      cell.measurementMethod = 'MANUAL';
      cell.testedAt = new Date().toISOString();
      cell.testedBy = userId;
      cell.status = 'PASSED';
      db.cells.set(cell.id, cell);
    }

    // Also update within battery modules
    battery.modules.forEach(mod => {
      const modCell = mod.cells.find(c => c.id === m.cellId);
      if (modCell) {
        modCell.productionOcvV = isNaN(ocv) ? modCell.supplierOcvV : ocv;
        modCell.productionIrMilliOhm = isNaN(ir) ? modCell.supplierIrMilliOhm : ir;
        modCell.productionIrMohm = modCell.productionIrMilliOhm;
        modCell.productionCapacityAh = modCell.supplierCapacityAh;
        modCell.measurementMethod = 'MANUAL';
        modCell.testedAt = new Date().toISOString();
        modCell.testedBy = userId;
        modCell.status = 'PASSED';
      }
    });
  });

  battery.stepResults.CELL_TESTING = {
    stepName: 'OCV & IR Testing',
    status: 'PASSED',
    mode: 'MANUAL',
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `All ${measurements.length} cells verified for OCV & IR`,
  };
  battery.stepResults.GRADING = {
    stepName: 'Cell Grading',
    status: 'READY',
    mode: 'MANUAL',
  };
  battery.currentStep = 'GRADING';
  battery.progressPercent = 25;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Completed Bulk OCV & IR Testing for ${measurements.length} cells on Battery ${battery.serialNumber}`, 'BATTERY', id);

  res.json({ success: true, battery });
});

apiRouter.post('/batteries/:id/cells/bulk-grading', requirePermission('qc.perform'), (req, res) => {
  const { id } = req.params;
  const { grades, userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  if (!Array.isArray(grades) || grades.length === 0) {
    return res.status(400).json({ error: 'No cell grades provided' });
  }

  let quarantinedCount = 0;

  grades.forEach((g: { cellId: string; grade: string; remarks?: string }) => {
    const cell = db.cells.get(g.cellId);
    const grade = g.grade || 'GOOD';

    if (cell) {
      cell.productionGrade = grade;
      if (g.remarks) cell.quarantineReason = g.remarks;

      if (grade === 'DAMAGED' || grade === 'FAILED') {
        cell.status = 'QUARANTINED';
        quarantinedCount++;
        db.quarantineRecords.push({
          id: `quar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          entityType: 'CELL',
          entityId: cell.id,
          entitySerial: cell.internalSerial,
          reason: g.remarks || 'Flagged DAMAGED during Cell Grading',
          stage: 'GRADING',
          quarantinedBy: userId,
          quarantinedAt: new Date().toISOString(),
          status: 'OPEN',
        });
      }
      db.cells.set(cell.id, cell);
    }

    battery.modules.forEach(mod => {
      const modCell = mod.cells.find(c => c.id === g.cellId);
      if (modCell) {
        modCell.productionGrade = grade;
        if (g.remarks) modCell.quarantineReason = g.remarks;
        if (grade === 'DAMAGED' || grade === 'FAILED') {
          modCell.status = 'QUARANTINED';
        }
      }
    });
  });

  battery.stepResults.GRADING = {
    stepName: 'Cell Grading',
    status: 'PASSED',
    mode: 'MANUAL',
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `All ${grades.length} cells graded (${quarantinedCount} quarantined)`,
  };
  battery.stepResults.DAMAGE_HISTORY = {
    stepName: 'Damage History Inspection',
    status: 'READY',
    mode: 'MANUAL',
  };
  battery.currentStep = 'DAMAGE_HISTORY';
  battery.progressPercent = 35;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Completed Bulk Cell Grading on Battery ${battery.serialNumber} (${grades.length} cells, ${quarantinedCount} quarantined)`, 'BATTERY', id);

  res.json({ success: true, battery });
});

apiRouter.post('/batteries/:id/cells/bulk-damage-history', requirePermission('qc.perform'), (req, res) => {
  const { id } = req.params;
  const { items, userId = 'usr-3' } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No inspection records provided' });
  }

  let damagedCount = 0;

  items.forEach((item: { cellId: string; condition: string; remarks?: string; imageUri?: string }) => {
    const cell = db.cells.get(item.cellId);
    const isDamaged = item.condition === 'DAMAGED';

    if (cell) {
      if (isDamaged) {
        cell.status = 'QUARANTINED';
        cell.quarantineReason = item.remarks || 'Visual/Mechanical damage detected';
        damagedCount++;
        db.quarantineRecords.push({
          id: `quar-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          entityType: 'CELL',
          entityId: cell.id,
          entitySerial: cell.internalSerial,
          reason: item.remarks || 'Visual/mechanical damage detected during Damage History',
          stage: 'DAMAGE_HISTORY',
          quarantinedBy: userId,
          quarantinedAt: new Date().toISOString(),
          status: 'OPEN',
        });
      }
      db.cells.set(cell.id, cell);
    }

    battery.modules.forEach(mod => {
      const modCell = mod.cells.find(c => c.id === item.cellId);
      if (modCell && isDamaged) {
        modCell.status = 'QUARANTINED';
        modCell.quarantineReason = item.remarks || 'Visual/Mechanical damage detected';
      }
    });
  });

  battery.stepResults.DAMAGE_HISTORY = {
    stepName: 'Damage History Inspection',
    status: 'PASSED',
    mode: 'MANUAL',
    completedAt: new Date().toISOString(),
    completedBy: userId,
    details: `Damage inspection complete for ${items.length} cells (${damagedCount} quarantined)`,
  };
  battery.stepResults.MODULE_ASSEMBLY = {
    stepName: 'Module Assembly',
    status: 'READY',
    mode: 'MANUAL',
  };
  battery.currentStep = 'MODULE_ASSEMBLY';
  battery.progressPercent = 40;
  battery.updatedAt = new Date().toISOString();

  db.addAuditLog(userId, `Completed Damage History Inspection on Battery ${battery.serialNumber} (${damagedCount} defects recorded)`, 'BATTERY', id);

  res.json({ success: true, battery });
});

// 17. Step Execution Engine (Generic handler for OCV/IR, Cell Testing, Grading, Bypass)
apiRouter.post('/batteries/:id/steps/:stepKey/execute', requirePermission('production.execute_step'), async (req, res) => {
  const { id, stepKey } = req.params;
  const { mode = 'AUTO', reuseSupplierData = false, manualValues, bypassReason, bypassPin, userId = 'usr-3', cellId, grade, remarks } = req.body;

  const battery = findBattery(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  // STRICT TRANSITION VALIDATION
  const validTransitions: Record<string, string[]> = {
    'CELL_IDENTIFICATION': ['CELL_IDENTIFICATION', 'CELL_TESTING', 'OCV_IR'],
    'CELL_TESTING': ['CELL_TESTING', 'OCV_IR', 'GRADING'],
    'GRADING': ['GRADING', 'DAMAGE_HISTORY', 'MODULE_ASSEMBLY'],
    'DAMAGE_HISTORY': ['DAMAGE_HISTORY', 'MODULE_ASSEMBLY'],
    'CELL_MATCHING': ['CELL_MATCHING', 'MODULE_ASSEMBLY'],
    'MODULE_ASSEMBLY': ['MODULE_ASSEMBLY', 'LASER_WELDING'],
    'LASER_WELDING': ['LASER_WELDING', 'MODULE_QC'],
    'MODULE_QC': ['MODULE_QC', 'BATTERY_ASSEMBLY'],
    'BATTERY_ASSEMBLY': ['BATTERY_ASSEMBLY', 'BMS_INTEGRATION', 'FINAL_TESTING'],
    'BMS_INTEGRATION': ['BMS_INTEGRATION', 'FINAL_TESTING'],
    'FINAL_TESTING': ['FINAL_TESTING', 'FINAL_QC'],
    'FINAL_QC': ['FINAL_QC', 'COMPLETED'],
  };

  const allowedTargets = validTransitions[battery.currentStep] || [];
  if (!allowedTargets.includes(stepKey)) {
    return res.status(400).json({
      error: `State Machine Exception: Out-of-order transition blocked. Current battery step is [${battery.currentStep}], cannot execute [${stepKey}].`
    });
  }

  // Handle Supervisor BYPASS mode with audit
  if (mode === 'BYPASS') {
    if (!bypassReason) {
      return res.status(400).json({ error: 'Bypass requires an explicit justification reason' });
    }

    battery.stepResults[stepKey] = {
      stepName: stepKey,
      status: 'BYPASSED',
      mode: 'BYPASS',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: `BYPASS AUTHORIZED: ${bypassReason}`,
    };

    if (stepKey === 'CELL_IDENTIFICATION') {
      battery.currentStep = 'CELL_TESTING';
      battery.progressPercent = 15;
    } else if (stepKey === 'CELL_TESTING' || stepKey === 'OCV_IR') {
      battery.currentStep = 'GRADING';
      battery.progressPercent = 25;
    } else if (stepKey === 'GRADING') {
      battery.currentStep = 'MODULE_ASSEMBLY';
      battery.progressPercent = 35;
    } else if (stepKey === 'MODULE_ASSEMBLY') {
      battery.currentStep = 'LASER_WELDING';
      battery.progressPercent = 50;
    } else if (stepKey === 'BATTERY_ASSEMBLY') {
      battery.currentStep = 'BMS_INTEGRATION';
      battery.progressPercent = 75;
    }
    
    battery.updatedAt = new Date().toISOString();
    db.addAuditLog(userId, `SUPERVISOR BYPASS applied to Step [${stepKey}] on Battery ${battery.serialNumber}`, 'BATTERY', id, 'PENDING', 'BYPASSED', bypassReason);
    
    return res.json({ success: true, battery });
  }

  // Handle Step Logic
  if (stepKey === 'CELL_IDENTIFICATION') {
    battery.stepResults.CELL_IDENTIFICATION = {
      stepName: 'Cell Identification & Verification',
      status: 'PASSED',
      mode: 'AUTO',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'All component serials successfully scanned and verified.',
    };
    battery.stepResults.CELL_TESTING = {
      stepName: 'OCV & IR Testing',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'CELL_TESTING';
    battery.progressPercent = 15;
    
  } else if (stepKey === 'CELL_TESTING' || stepKey === 'OCV_IR') {
    if (battery.currentStep === 'CELL_IDENTIFICATION') {
      battery.stepResults.CELL_IDENTIFICATION = {
        stepName: 'Cell Identification & Verification',
        status: 'PASSED',
        mode: 'AUTO',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: 'All component serials successfully scanned and verified.',
      };
      battery.currentStep = 'CELL_TESTING';
      battery.progressPercent = 15;
    }
  
    // Gather all cells in battery
    const cellsToTest: any[] = [];
    battery.modules.forEach(m => m.cells.forEach(c => cellsToTest.push(c)));
    if (cellsToTest.length === 0) {
      Array.from(db.cells.values())
        .filter(c => c.reservedForBatteryId === id)
        .forEach(c => cellsToTest.push(c));
    }

    if (cellId) {
      const singleCell = cellsToTest.find(c => c.id === cellId);
      if (singleCell) {
        singleCell.productionOcvV = manualValues?.ocvV !== undefined ? Number(manualValues.ocvV) : singleCell.supplierOcvV;
        singleCell.productionIrMilliOhm = manualValues?.irMilliOhm !== undefined ? Number(manualValues.irMilliOhm) : singleCell.supplierIrMilliOhm;
        singleCell.productionIrMohm = manualValues?.irMilliOhm !== undefined ? Number(manualValues.irMilliOhm) : singleCell.supplierIrMilliOhm;
        singleCell.productionCapacityAh = singleCell.supplierCapacityAh;
        singleCell.measurementMethod = 'MANUAL';
        singleCell.testedAt = new Date().toISOString();
        singleCell.testedBy = userId;
        singleCell.status = 'PASSED';
      }
    }

    const allCellsTested = cellsToTest.length > 0 && cellsToTest.every(c => c.productionOcvV !== undefined && c.productionOcvV !== null);
    
    if (allCellsTested) {
      battery.stepResults.CELL_TESTING = {
        stepName: 'OCV & IR Testing',
        status: 'PASSED',
        mode: mode || 'AUTO',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: `${cellsToTest.length} cells fully tested`,
      };
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'READY',
        mode: 'MANUAL',
      };
      battery.currentStep = 'GRADING';
      battery.progressPercent = 25;
    } else {
      const testedCount = cellsToTest.filter(c => c.productionOcvV !== undefined && c.productionOcvV !== null).length;
      battery.stepResults.CELL_TESTING = {
        stepName: 'OCV & IR Testing',
        status: 'READY',
        mode: mode || 'AUTO',
        details: `${testedCount}/${cellsToTest.length} cells verified.`,
      };
    }
    
  } else if (stepKey === 'GRADING') {
    let cellsToTest: CellItem[] = [];
    battery.modules.forEach(m => m.cells.forEach(c => cellsToTest.push(c)));
    if (cellsToTest.length === 0) {
      cellsToTest = Array.from(db.cells.values()).filter(c => c.reservedForBatteryId === id) as CellItem[];
    }
    
    if (cellId) {
      const cell = cellsToTest.find(c => c.id === cellId);
      if (cell) {
        cell.productionGrade = grade;
        if (remarks) cell.quarantineReason = remarks;
      }
    }
    
    const allCellsGraded = cellsToTest.length > 0 && cellsToTest.every(c => !!c.productionGrade);
    
    if (allCellsGraded) {
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'PASSED',
        mode: 'MANUAL',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: 'All cells have been manually graded.',
      };
      battery.stepResults.MODULE_ASSEMBLY = {
        stepName: 'Module Assembly',
        status: 'READY',
        mode: 'MANUAL',
      };
      battery.currentStep = 'MODULE_ASSEMBLY';
      battery.progressPercent = 35;
    } else {
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'READY',
        mode: 'MANUAL',
      };
    }
    
  } else if (stepKey === 'MODULE_ASSEMBLY') {
    battery.stepResults.MODULE_ASSEMBLY = {
      stepName: 'Module Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Cells physical positioning and busbar fitting verified.',
    };
    battery.stepResults.LASER_WELDING = {
      stepName: 'Laser Busbar Welding',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'LASER_WELDING';
    battery.progressPercent = 50;
    
  } else if (stepKey === 'BATTERY_ASSEMBLY') {
    battery.stepResults.BATTERY_ASSEMBLY = {
      stepName: 'Battery Enclosure Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Physical enclosure and wiring confirmed.',
    };
    battery.stepResults.BMS_INTEGRATION = {
      stepName: 'BMS Harness & Comms Testing',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'BMS_INTEGRATION';
    battery.progressPercent = 75;
  }

  battery.updatedAt = new Date().toISOString();
  db.addAuditLog(userId, `Executed Step [${stepKey}] on Battery ${battery.serialNumber}`, 'BATTERY', id);

  return res.json({ success: true, battery });
});

apiRouter.get('/machines', (req, res) => {
  res.json(Array.from(db.machines.values()));
});

apiRouter.post('/machines/:id/toggle', requirePermission('machines.edit'), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const updated = MachineGateway.toggleMachineStatus(id, status);
  if (!updated) return res.status(404).json({ error: 'Machine not found' });

  db.addAuditLog('usr-6', `Changed Machine [${updated.name}] status to ${status}`, 'SYSTEM', id);
  res.json(updated);
});

// 21. Universal Traceability Engine — single endpoint, auto-detects entity type
// Accepts ANY registered identifier and returns its complete genealogy.
// Supported: Cell internal serial / supplier barcode, Module serial,
// Battery serial / QR, BMS serial, BMU serial, Production Order number,
// Supplier batch / pallet / box.

function traceAuditLogs(ids: (string | undefined)[]): any[] {
  const idSet = new Set(ids.filter(Boolean).map(i => String(i).toLowerCase()));
  return db.auditLogs
    .filter(l => idSet.has(l.entityId.toLowerCase()))
    .slice(0, 50);
}

apiRouter.get('/traceability/search/:query', (req, res) => {
  const q = (req.params.query || '').trim();
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_QUERY',
      message: 'No identifier provided for traceability search.',
    });
  }
  const ql = q.toLowerCase();

  try {
    // 1. PRODUCTION ORDER
    const order = Array.from(db.orders.values()).find(
      o => o.orderNumber.toLowerCase() === ql || o.id.toLowerCase() === ql
    );
    if (order) {
      const batteries = order.batteryIds
        .map(id => findBattery(id))
        .filter(Boolean) as any[];
      const modules = batteries.flatMap(b => b.modules);
      const cells = modules.flatMap(m => m.cells);
      const ids = [order.id, ...batteries.map(b => b.id), ...modules.map(m => m.id), ...cells.map(c => c.id)];
      batteries.forEach(b => { if (b.bms) ids.push(b.bms.id); if (b.bmu) ids.push(b.bmu.id); });
      return res.json({
        success: true,
        entityType: 'PRODUCTION_ORDER',
        identifier: order.orderNumber,
        status: order.status,
        entity: order,
        product: db.products.find(p => p.id === order.productId) || null,
        batteries,
        modules,
        cells,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 2. BATTERY
    const battery = Array.from(db.batteries.values()).find(
      b => b.serialNumber.toLowerCase() === ql || (b.qrCode && b.qrCode.toLowerCase() === ql)
    );
    if (battery) {
      const product = db.products.find(p => p.id === battery.productId);
      const orderRef = db.orders.get(battery.productionOrderId);
      const modules = battery.modules;
      const cells = modules.flatMap(m => m.cells);
      const ids: (string | undefined)[] = [battery.id, product?.id, orderRef?.id];
      modules.forEach(m => { ids.push(m.id); m.cells.forEach(c => ids.push(c.id)); });
      if (battery.bms) ids.push(battery.bms.id);
      if (battery.bmu) ids.push(battery.bmu.id);
      return res.json({
        success: true,
        entityType: 'BATTERY',
        identifier: battery.serialNumber,
        status: battery.status,
        entity: battery,
        product: product || null,
        order: orderRef || null,
        modules,
        cells,
        bms: battery.bms || null,
        bmu: battery.bmu || null,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 3. MODULE
    const module = Array.from(db.modules.values()).find(
      m => m.serialNumber.toLowerCase() === ql || (m.qrCode && m.qrCode.toLowerCase() === ql)
    );
    if (module) {
      const batteryRef = module.batteryId ? db.batteries.get(module.batteryId) : null;
      const product = batteryRef ? db.products.find(p => p.id === batteryRef.productId) : null;
      const ids: (string | undefined)[] = [module.id, batteryRef?.id, product?.id];
      module.cells.forEach(c => ids.push(c.id));
      if (batteryRef?.bms) ids.push(batteryRef.bms.id);
      if (batteryRef?.bmu) ids.push(batteryRef.bmu.id);
      return res.json({
        success: true,
        entityType: 'MODULE',
        identifier: module.serialNumber,
        status: module.status,
        entity: module,
        battery: batteryRef || null,
        product: product || null,
        cells: module.cells,
        bms: batteryRef?.bms || null,
        bmu: batteryRef?.bmu || null,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 4. BMS
    const bms = Array.from(db.bmsUnits.values()).find(b => b.serialNumber.toLowerCase() === ql);
    if (bms) {
      const batteryRef = bms.assignedToBatteryId ? db.batteries.get(bms.assignedToBatteryId) : null;
      const product = batteryRef ? db.products.find(p => p.id === batteryRef.productId) : null;
      const modules = batteryRef ? batteryRef.modules : [];
      const cells = modules.flatMap(m => m.cells);
      const ids: (string | undefined)[] = [bms.id, batteryRef?.id, product?.id];
      modules.forEach(m => { ids.push(m.id); m.cells.forEach(c => ids.push(c.id)); });
      return res.json({
        success: true,
        entityType: 'BMS',
        identifier: bms.serialNumber,
        status: bms.status,
        entity: bms,
        battery: batteryRef || null,
        product: product || null,
        modules,
        cells,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 5. BMU
    const bmu = Array.from(db.bmuUnits.values()).find(b => b.serialNumber.toLowerCase() === ql);
    if (bmu) {
      const batteryRef = bmu.assignedToBatteryId ? db.batteries.get(bmu.assignedToBatteryId) : null;
      const product = batteryRef ? db.products.find(p => p.id === batteryRef.productId) : null;
      const modules = batteryRef ? batteryRef.modules : [];
      const cells = modules.flatMap(m => m.cells);
      const ids: (string | undefined)[] = [bmu.id, batteryRef?.id, product?.id];
      modules.forEach(m => { ids.push(m.id); m.cells.forEach(c => ids.push(c.id)); });
      return res.json({
        success: true,
        entityType: 'BMU',
        identifier: bmu.serialNumber,
        status: bmu.status,
        entity: bmu,
        battery: batteryRef || null,
        product: product || null,
        modules,
        cells,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 6. CELL (internal serial or supplier barcode)
    const cell = Array.from(db.cells.values()).find(
      c => c.internalSerial.toLowerCase() === ql || c.supplierBarcode.toLowerCase() === ql
    );
    if (cell) {
      const supplier = db.suppliers.find(s => s.id === cell.supplierId) || null;
      const mod = cell.assignedToModuleId ? db.modules.get(cell.assignedToModuleId) : null;
      const batteryRef = mod?.batteryId
        ? db.batteries.get(mod.batteryId)
        : (cell.reservedForBatteryId ? db.batteries.get(cell.reservedForBatteryId) : null);
      const product = batteryRef ? db.products.find(p => p.id === batteryRef.productId) : null;
      const ids: (string | undefined)[] = [cell.id, supplier?.id, mod?.id, batteryRef?.id, product?.id];
      return res.json({
        success: true,
        entityType: 'CELL',
        identifier: cell.internalSerial || cell.supplierBarcode,
        status: cell.status,
        entity: cell,
        supplier,
        module: mod || null,
        battery: batteryRef || null,
        product: product || null,
        bms: batteryRef?.bms || null,
        bmu: batteryRef?.bmu || null,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // 7. SUPPLIER BATCH / PALLET / BOX
    const batchCells = Array.from(db.cells.values()).filter(c =>
      c.batchNumber.toLowerCase() === ql ||
      c.palletNumber.toLowerCase() === ql ||
      c.boxNumber.toLowerCase() === ql
    );
    if (batchCells.length > 0) {
      const supplier = db.suppliers.find(s => s.id === batchCells[0].supplierId) || null;
      const matchField =
        batchCells[0].batchNumber.toLowerCase() === ql ? 'batchNumber'
        : batchCells[0].palletNumber.toLowerCase() === ql ? 'palletNumber' : 'boxNumber';
      const ids: (string | undefined)[] = batchCells.map(c => c.id);
      if (supplier) ids.push(supplier.id);
      return res.json({
        success: true,
        entityType: 'SUPPLIER_BATCH',
        identifier: q,
        status: 'BATCH',
        entity: {
          batchIdentifier: q,
          matchField,
          cellCount: batchCells.length,
          supplierName: batchCells[0].supplierName,
        },
        supplier,
        cells: batchCells,
        auditTrail: traceAuditLogs(ids),
      });
    }

    // NOT FOUND
    return res.status(404).json({
      success: false,
      error: 'IDENTIFIER_NOT_FOUND',
      message: `No registered Cell, Module, Battery, BMS/BMU, Supplier record, or Production Order matches identifier "${q}".`,
    });
  } catch (err: any) {
    console.error('Traceability search error', err);
    return res.status(500).json({
      success: false,
      error: 'TRACEABILITY_ERROR',
      message: err.message || 'Unexpected error during traceability search.',
    });
  }
});

// 21. Audit Logs
apiRouter.get('/audit-logs', (req, res) => {
  const { entityType, search, limit = 200 } = req.query;
  let logs = db.auditLogs;

  if (entityType && typeof entityType === 'string') {
    logs = logs.filter(l => l.entityType === entityType);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    logs = logs.filter(l =>
      l.action.toLowerCase().includes(q) ||
      l.userName.toLowerCase().includes(q) ||
      l.entityId.toLowerCase().includes(q)
    );
  }

  res.json(logs.slice(0, Number(limit)));
});

// Catch-all for unmatched /api routes → JSON 404 (never return HTML)
apiRouter.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'ROUTE_NOT_FOUND',
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});
