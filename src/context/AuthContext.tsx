import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import {
  setAccessToken,
  supabase,
  resolveLoginEmail,
} from '../lib/supabaseBrowser';

export type AuthState = 'AUTH_LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

export interface AuthContextValue {
  state: AuthState;
  currentUser: User | null;
  user: User | null;
  profile: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  isLoading: boolean;
  pendingToken: string | null;
  error: string | null;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string; pendingToken?: string }>;
  verifyOtp: (token: string, otp: string) => Promise<{ success: boolean; error?: string }>;
  resendOtp: (token: string) => Promise<{ resendInSec?: number; error?: string; message?: string }>;
  logout: () => Promise<{ error?: string | null }>;
  hasPermission: (perm: string) => boolean;
  subscribeAuthState: () => () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapProfile(authUser: { id: string; email?: string | null }, profile: any | null): User {
  const email = profile?.email || authUser.email || '';
  const roleId = profile?.role_id || 'role-operator';
  return {
    id: authUser.id,
    name: profile?.full_name || email.split('@')[0] || 'Operator',
    username: profile?.username || email.split('@')[0] || 'operator',
    email,
    roleId,
    role: roleId.replace(/^role-/, ''),
    permissions: Array.isArray(profile?.role?.permissions) ? profile.role.permissions : [],
    badgeId: profile?.badge_id || '',
    status: profile?.status || 'ACTIVE',
  };
}

async function loadProfile(userId: string, authUser: { id: string; email?: string | null }): Promise<User> {
  if (!supabase) return mapProfile(authUser, null);
  const { data } = await supabase.from('profiles').select('*, role:roles(id, name, description, status)').eq('id', userId).maybeSingle();
  const { data: grants } = await supabase.from('role_permissions').select('permission_id').eq('role_id', data?.role_id || '');
  const profile = data ? { ...data, role: { ...data.role, permissions: (grants || []).map((grant: any) => grant.permission_id) } } : data;
  return mapProfile(authUser, profile);
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subStore, setSubStore] = useState<{ unsubscribe: () => void } | null>(null);

  const isAuthenticated = !!currentUser;
  const state: AuthState = authLoading ? 'AUTH_LOADING' : isAuthenticated ? 'AUTHENTICATED' : 'UNAUTHENTICATED';

  const applySession = useCallback(async (session: { access_token: string; user: { id: string; email?: string | null } } | null) => {
    if (!session) {
      setAccessToken(null);
      setCurrentUser(null);
      return;
    }
    setAccessToken(session.access_token);
    const mapped = await loadProfile(session.user.id, session.user);
    setCurrentUser(mapped);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const boot = async () => {
      try {
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (cancelled) return;
          if (sessionData.session) {
            await applySession(sessionData.session);
            return;
          }
          setCurrentUser(null);
          return;
        }
        setCurrentUser(null);
      } catch {
        if (!cancelled) setCurrentUser(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void boot();

    // Set up persistent auth state listener
    if (supabase) {
      const sub = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (!session) {
          setAccessToken(null);
          setCurrentUser(null);
          return;
        }
        void applySession(session);
      });

      // Store unsubscribe for cleanup - use a ref pattern via setSubStore
      setSubStore({
        unsubscribe: () => {
          sub.data?.subscription?.unsubscribe?.();
        },
      });
      unsubscribe = () => sub.data?.subscription?.unsubscribe?.();
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applySession]);

  const login = async (identifier: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      if (!supabase) {
        const message = 'Authentication is unavailable because Supabase is not configured.';
        setError(message);
        return { success: false, error: message };
      }
      const trimmed = identifier.trim();
      const email = trimmed.includes('@') ? trimmed : await resolveLoginEmail(trimmed);
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
        return { success: false, error: authError.message };
      }
      if (!data.session) {
        setError('No session returned');
        return { success: false, error: 'No session returned' };
      }
      await applySession(data.session);
      return { success: true };
    } catch (err: any) {
      const message = err?.message || 'Login failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (token: string, otp: string) => {
    setIsLoading(true);
    setError(null);
    try {
      if (supabase && (pendingEmail || token.includes('@'))) {
        const email = pendingEmail || token;
        const { data, error: otpError } = await supabase.auth.verifyOtp({
          email,
          token: otp,
          type: 'email',
        });
        if (otpError) {
          setError(otpError.message);
          return { success: false, error: otpError.message };
        }
        if (data.session) {
          await applySession(data.session);
          setPendingToken(null);
          setPendingEmail(null);
          return { success: true };
        }
      }

      return { success: false, error: 'OTP verification suppressed - use Supabase verification only' };
    } catch (err: any) {
      const message = err?.message || 'Verification failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  };

  const resendOtp = async (token: string) => {
    try {
      if (supabase && (pendingEmail || token.includes('@'))) {
        const email = pendingEmail || token;
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
        if (resendError) return { error: resendError.message };
        return { message: 'Code sent', resendInSec: 60 };
      }
      return { error: 'Resend only supported with Supabase session and email' };
    } catch (err: any) {
      return { error: err?.message || 'Failed to resend code' };
    }
  };

  const logout = async () => {
    try {
      if (supabase) await supabase.auth.signOut();
      setAccessToken(null);
      setCurrentUser(null);
      setPendingToken(null);
      setPendingEmail(null);
      return { error: null };
    } catch (err: any) {
      setCurrentUser(null);
      setAccessToken(null);
      return { error: err?.message || 'Logout failed' };
    }
  };

  const hasPermission = useCallback(
    (perm: string) => {
      if (!currentUser) return false;
      if (currentUser.role === 'admin' || currentUser.roleId === 'role-admin') return true;
      return currentUser.permissions?.includes(perm) ?? false;
    },
    [currentUser]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      currentUser,
      user: currentUser,
      profile: currentUser,
      isAuthenticated,
      authLoading,
      isLoading,
      pendingToken,
      error,
      login,
      verifyOtp,
      resendOtp,
      logout,
      hasPermission,
      subscribeAuthState: () => {
        if (subStore?.unsubscribe) {
          return subStore.unsubscribe;
        }
        return () => {};
      },
    }),
    [state, currentUser, isAuthenticated, authLoading, isLoading, pendingToken, error, hasPermission, subStore]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
