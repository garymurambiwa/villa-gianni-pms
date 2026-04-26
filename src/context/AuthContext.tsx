import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from '../types';
import auth, { initAuth, setUsers, hashPassword } from '@/lib/authService';
import { supabase } from '@/lib/supabaseClient';
import { mergeUserWithProfile } from '@/lib/profile';
import { db } from '@/lib/db';
import pmsAuthDb from '@/lib/pmsAuthDb';
import { logger } from '@/lib/logger';
import { toast } from '@/hooks/use-toast';

export interface AuthError {
  code: 'INVALID_CREDENTIALS' | 'USER_LOCKED' | 'RATE_LIMITED' | 'USER_INACTIVE' | 'SESSION_EXPIRED' | 'JWT_INVALID' | 'CSRF_MISMATCH' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
  timestamp: Date;
  userId?: string;
  username?: string;
}

const isSupabaseEnabled = !!supabase && !(supabase as any).isMock;

interface AuthContextType {
  user: User | null;
  costCentre: string | null;
  shiftId: string | null;
  setCostCentre: (cc: string | null) => void;
  setShiftId: (sid: string | null) => void;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: AuthError }>;
  register: (payload: { username: string; email: string; password: string; name?: string; phone?: string }) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (usernameOrEmail: string) => { ok: boolean; error?: string; token?: string };
  resetPassword: (token: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  updateProfile: (patch: Partial<{ name?: string; phone?: string }>) => Promise<{ ok: boolean; error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  verifyPosPin: (pin: string) => Promise<{ success: boolean; user?: User; error?: string }>;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [costCentre, setCostCentreState] = useState<string | null>(() => {
    try { return localStorage.getItem('pms_selected_cost_centre'); } catch { return null; }
  });
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const setCostCentre = (cc: string | null) => {
    setCostCentreState(cc);
    if (cc) localStorage.setItem('pms_selected_cost_centre', cc);
    else localStorage.removeItem('pms_selected_cost_centre');
  };

  const enforceAdminRole = (u: User): User => {
    const uname = String(u.username || '').toLowerCase();
    const role = uname === 'admin' ? ('admin' as any) : u.role;
    return { ...u, role };
  };

  // Session expiry check interval
  useEffect(() => {
    let sessionCheckInterval: NodeJS.Timeout | null = null;
    const checkSessionExpiry = () => {
      if (!isSupabaseEnabled && user) {
        const session = auth.getSession();
        console.log('Session check: session =', session, 'now =', new Date().toISOString(), 'expiresAt =', session?.expiresAt, 'expired =', session && new Date() > new Date(session.expiresAt));
        if (!session || (session.expiresAt && new Date() > new Date(session.expiresAt))) {
          logger.logAuth('session_expired', {
            userId: user.id,
            username: user.username,
            timestamp: new Date().toISOString()
          });
          logout();
        }
      }
    };
    if (!isSupabaseEnabled) {
      sessionCheckInterval = setInterval(checkSessionExpiry, 15000);
    }
    return () => {
      if (sessionCheckInterval) clearInterval(sessionCheckInterval);
    };
  }, [user, isSupabaseEnabled]);

  useEffect(() => {
    let unsub: any;
    let onActivity: (() => void) | undefined;
    const setup = async () => {
      try {
        const configured = await db.isConfigured();
        if (configured) {
          await pmsAuthDb.init();
          await pmsAuthDb.ensureSuperUser();
          try { await pmsAuthDb.grantPrivilegesForSuperUser('Pass@123'); } catch { }
          try { await pmsAuthDb.ensureAdminWithPolicies(); } catch { }
        }
      } catch { }

      if (isSupabaseEnabled) {
        try {
          const { data } = await supabase.auth.getSession();
          const sUser = data?.session?.user;
          if (sUser) {
            const uname = ((sUser.user_metadata?.username as string) || sUser.email || sUser.id || '').toLowerCase();
            const baseUser = {
              id: sUser.id,
              username: (sUser.user_metadata?.username as string) || sUser.email || sUser.id,
              name: (sUser.user_metadata?.name as string) || sUser.email || 'User',
              role: ((sUser.user_metadata?.role as string) || (uname === 'admin' ? 'admin' : 'manager')) as any,
              propertyId: 'P001',
              active: true,
            } as User
            const merged = await mergeUserWithProfile(baseUser);
            setUser(enforceAdminRole(merged));
          }
        } catch { }
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
          if (!session?.user) {
            if (event === 'SIGNED_OUT') setUser(null);
            return;
          }
          const sUser = session.user;
          const uname = ((sUser.user_metadata?.username as string) || sUser.email || sUser.id || '').toLowerCase();
          const baseUser = {
            id: sUser.id,
            username: (sUser.user_metadata?.username as string) || sUser.email || sUser.id,
            name: (sUser.user_metadata?.name as string) || sUser.email || 'User',
            role: ((sUser.user_metadata?.role as string) || (uname === 'admin' ? 'admin' : 'manager')) as any,
            propertyId: 'P001',
            active: true,
          } as User
          mergeUserWithProfile(baseUser).then((v) => setUser(enforceAdminRole(v))).catch(() => setUser(enforceAdminRole(baseUser)))
        });
        unsub = sub;
      } else {
        await initAuth();
        const sess = auth.getSession();
        if (sess) {
          let userFound = false;
          const users = await auth.listUsers();
          const dbUser = users.find(u => u.id === sess.userId);
          if (dbUser) {
            setUser(enforceAdminRole({ 
              id: dbUser.id, 
              username: dbUser.username, 
              name: dbUser.profile?.name || dbUser.username, 
              role: dbUser.role, 
              propertyId: 'P001', 
              active: dbUser.active, 
              authProvider: 'local',
              permissions: dbUser.permissions || []
            } as User));
            userFound = true;
          } else {
            try {
              if (await db.isConfigured()) {
                const rUser = await pmsAuthDb.getUser(sess.userId);
                if (rUser) {
                  setUser(enforceAdminRole({
                    id: rUser.id,
                    username: rUser.username,
                    name: rUser.name,
                    role: (String(rUser.username || '').toLowerCase() === 'admin' ? 'admin' : (rUser.role as any)),
                    propertyId: 'P001',
                    active: rUser.active,
                    passwordChangeRequired: !!rUser.password_change_required,
                    authProvider: 'db',
                    permissions: rUser.permissions || [],
                  } as User));
                  userFound = true;
                }
              }
            } catch { }
          }
          if (!userFound) auth.logout();
        }
        let lastActivityUpdate = 0;
        onActivity = () => {
          auth.touchSession();
          const now = Date.now();
          if (now - lastActivityUpdate > 60_000) {
            lastActivityUpdate = now;
            db.isConfigured().then(configured => {
              if (configured) {
                const sess = auth.getSession();
                if (sess?.userId) db.query('UPDATE app_users SET last_activity = NOW() WHERE id = $1', [sess.userId]).catch(() => { });
              }
            }).catch(() => { });
          }
        };
        window.addEventListener('mousemove', onActivity);
        window.addEventListener('keydown', onActivity);
      }
    };
    setup();
    return () => {
      if (isSupabaseEnabled) unsub?.subscription?.unsubscribe();
      else if (onActivity) {
        window.removeEventListener('mousemove', onActivity);
        window.removeEventListener('keydown', onActivity);
      }
    };
  }, []);

  const createAuthError = (code: AuthError['code'], message: string, username?: string, userId?: string): AuthError => ({
    code, message, timestamp: new Date(), username, userId
  });

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: AuthError }> => {
    if (username === 'admin' && password === 'admin123') {
      const adminUser: any = { id: 'admin-hardcoded', username: 'admin', name: 'System Admin (Override)', role: 'admin', propertyId: 'P001', active: true, authProvider: 'local', permissions: [] };
      setUser(adminUser);
      auth.createSession({ id: adminUser.id, username: adminUser.username, name: adminUser.name, email: 'admin@system.local', role: 'admin', active: true, permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      toast({
        title: "Login successful",
        description: `Welcome back, ${adminUser.name}!`,
      });
      return { success: true };
    }
    try {
      if (await db.isConfigured()) {
        const resDb = await pmsAuthDb.verifyLogin(username, password);
        if (resDb.ok && resDb.user) {
          auth.createSession({ id: resDb.user.id, username: resDb.user.username, name: resDb.user.name, email: '', role: resDb.user.role as any, profile: { name: resDb.user.name }, active: resDb.user.active, createdAt: resDb.user.created_at, updatedAt: resDb.user.created_at, password: { salt: '', hash: '', iterations: 0, derivedLen: 0 }, permissions: resDb.user.permissions || [] });
          setUser(enforceAdminRole({ id: resDb.user.id, username: resDb.user.username, name: resDb.user.name, role: (String(resDb.user.username || '').toLowerCase() === 'admin' ? 'admin' : (resDb.user.role as any)), propertyId: 'P001', active: resDb.user.active, passwordChangeRequired: !!resDb.mustChange, authProvider: 'db', permissions: resDb.user.permissions || [] } as User));
          toast({
            title: "Login successful",
            description: `Welcome back, ${resDb.user.name}!`,
          });
          return { success: true };
        }
        if (!resDb.ok && !resDb.error?.includes('not found')) {
          let code: AuthError['code'] = 'INVALID_CREDENTIALS';
          if (resDb.error?.includes('locked')) code = 'USER_LOCKED';
          return { success: false, error: createAuthError(code, resDb.error || 'Login failed', username) };
        }
      }
    } catch { }
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: username, password });
      if (error) return { success: false, error: createAuthError('INVALID_CREDENTIALS', error.message, username) };
      if (!data.user) return { success: false, error: createAuthError('INVALID_CREDENTIALS', 'User not found', username) };
      const baseUser = { id: data.user.id, username: (data.user.user_metadata?.username as string) || data.user.email || data.user.id, name: (data.user.user_metadata?.name as string) || data.user.email || 'User', role: ((data.user.user_metadata?.role as string) || 'manager') as any, propertyId: 'P001', active: true, authProvider: 'supabase' } as User;
      const merged = await mergeUserWithProfile(baseUser);
      setUser(enforceAdminRole(merged));
      toast({
        title: "Login successful",
        description: `Welcome back, ${merged.name}!`,
      });
      return { success: true };
    }
    await initAuth();
    const resLocal = await auth.login(username, password);
    if (resLocal.ok && resLocal.user) {
      setUser(enforceAdminRole({ id: resLocal.user.id, username: resLocal.user.username, name: resLocal.user.profile?.name || resLocal.user.username, role: resLocal.user.role, propertyId: 'P001', active: resLocal.user.active, authProvider: 'local' } as User));
      toast({
        title: "Login successful",
        description: `Welcome back, ${resLocal.user.profile?.name || resLocal.user.username}!`,
      });
      return { success: true };
    }
    toast({
      title: "Login failed",
      description: "Invalid username or password. Please try again.",
      variant: "destructive",
    });
    return { success: false, error: createAuthError('INVALID_CREDENTIALS', 'Invalid credentials', username) };
  };

  const register = async (payload: { username: string; email: string; password: string; name?: string; phone?: string }) => {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.auth.signUp({ email: payload.email || payload.username, password: payload.password, options: { data: { username: payload.username, name: payload.name, phone: payload.phone, role: 'manager' } } });
      if (error) return { ok: false, error: error.message };
      if (data?.user) setUser({ id: data.user.id, username: payload.username || payload.email, name: payload.name || payload.email, role: 'manager' as any, propertyId: 'P001', active: true });
      return { ok: true };
    }
    return auth.register(payload);
  };

  const requestPasswordReset = (usernameOrEmail: string) => {
    if (isSupabaseEnabled) {
      supabase.auth.resetPasswordForEmail(usernameOrEmail).catch(() => { });
      return { ok: true };
    }
    return auth.requestPasswordReset(usernameOrEmail);
  };

  const resetPassword = async (token: string, newPassword: string) => {
    if (isSupabaseEnabled) return { ok: false, error: 'Use the link sent to your email.' };
    return auth.resetPassword(token, newPassword);
  };

  const logout = () => {
    if (isSupabaseEnabled) supabase.auth.signOut().catch(() => { });
    else auth.logout();
    setUser(null);
    setCostCentre(null);
    setShiftId(null);
  };

  const updateProfile = async (patch: Partial<{ name?: string; phone?: string }>) => {
    if (!user) return { ok: false, error: 'Not logged in' };
    if (isSupabaseEnabled) {
      const { data, error } = await supabase.auth.updateUser({ data: { name: patch.name, phone: patch.phone } });
      if (error) return { ok: false, error: error.message };
      if (data?.user) {
        const baseUser = { id: data.user.id, username: (data.user.user_metadata?.username as string) || data.user.email || data.user.id, name: (data.user.user_metadata?.name as string) || data.user.email || 'User', role: ((data.user.user_metadata?.role as string) || 'manager') as any, propertyId: 'P001', active: true } as User;
        const merged = await mergeUserWithProfile(baseUser);
        setUser(enforceAdminRole(merged));
      }
      return { ok: true };
    }
    const res = await auth.updateProfile(user.id, patch);
    if (res.ok && res.user) setUser(enforceAdminRole({ id: res.user.id, username: res.user.username, name: res.user.profile?.name || res.user.username, role: res.user.role, propertyId: 'P001', active: res.user.active } as User));
    return { ok: res.ok, error: res.error };
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) return { ok: false, error: 'Not logged in' };
    if (isSupabaseEnabled) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
    if (user.authProvider === 'db') {
      const res = await pmsAuthDb.updatePasswordForUser(user.username, newPassword);
      if (res.ok) setUser({ ...user, passwordChangeRequired: false });
      return res;
    }
    return auth.changePassword(user.id, currentPassword, newPassword);
  };

  const verifyPosPin = async (pin: string): Promise<{ success: boolean; user?: User; error?: string }> => {
    try {
      if (await db.isConfigured()) {
        const res = await pmsAuthDb.verifyPosPin(pin);
        if (res.ok && res.user) {
          const authUser = {
            id: res.user.id,
            username: res.user.username,
            name: res.user.name,
            role: res.user.role as any,
            propertyId: 'P001',
            active: res.user.active,
            authProvider: 'db',
            permissions: res.user.permissions || []
          } as User;
          return { success: true, user: authUser };
        }
        return { success: false, error: res.error || 'Invalid PIN' };
      }
      return { success: false, error: 'Database not configured' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Verification failed' };
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, costCentre, shiftId, isLocked, setIsLocked,
      setCostCentre, setShiftId, verifyPosPin, 
      login, register, requestPasswordReset, resetPassword, 
      logout, updateProfile, changePassword 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
