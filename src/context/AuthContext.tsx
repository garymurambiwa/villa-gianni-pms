import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from '../types';
import auth, { initAuth, setUsers, hashPassword } from '@/lib/authService';
import { supabase } from '@/lib/supabaseClient';
import { mergeUserWithProfile } from '@/lib/profile';
import { db } from '@/lib/db';
import pmsAuthDb from '@/lib/pmsAuthDb';
import { logger } from '@/lib/logger';

export interface AuthError {
  code: 'INVALID_CREDENTIALS' | 'USER_LOCKED' | 'RATE_LIMITED' | 'USER_INACTIVE' | 'SESSION_EXPIRED' | 'JWT_INVALID' | 'CSRF_MISMATCH' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
  timestamp: Date;
  userId?: string;
  username?: string;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: AuthError }>;
  register: (payload: { username: string; email: string; password: string; name?: string; phone?: string }) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (usernameOrEmail: string) => { ok: boolean; error?: string; token?: string };
  resetPassword: (token: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  updateProfile: (patch: Partial<{ name?: string; phone?: string }>) => Promise<{ ok: boolean; error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const enforceAdminRole = (u: User): User => {
    const uname = String(u.username || '').toLowerCase();
    const role = uname === 'admin' ? ('admin' as any) : u.role;
    return { ...u, role };
  };

  // Session expiry check interval
  useEffect(() => {
    let sessionCheckInterval: NodeJS.Timeout | null = null;

    const checkSessionExpiry = () => {
      if (!supabase && user) {
        const session = auth.getSession();
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

    // Check session expiry every 30 seconds
    if (!supabase) {
      sessionCheckInterval = setInterval(checkSessionExpiry, 30000);
    }

    return () => {
      if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
      }
    };
  }, [user, supabase]);

  useEffect(() => {
    let unsub: any;
    let onActivity: (() => void) | undefined;

    const setup = async () => {
      // If central DB is configured, initialize auth tables and ensure Super User exists
      try {
        const configured = await db.isConfigured();
        if (configured) {
          await pmsAuthDb.init();
          await pmsAuthDb.ensureSuperUser();
          // Ensure Super User has admin privileges and the requested password
          try { await pmsAuthDb.grantPrivilegesForSuperUser('Pass@123'); } catch { }
          try { await pmsAuthDb.ensureAdminWithPolicies(); } catch { }
        }
      } catch { }
      if (supabase) {
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
            {
              const merged = await mergeUserWithProfile(baseUser);
              setUser(enforceAdminRole(merged));
            }
          }
        } catch {
          // ignore
        }
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          const sUser = session?.user || null;
          if (!sUser) { setUser(null); return; }
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
        try {
          if (sess) {
            logger.logAuth('session_detected_on_boot', { userId: sess.userId, expiresAt: sess.expiresAt });
          } else {
            logger.logAuth('no_session_on_boot');
          }
        } catch { }
        if (sess) {
          let userFound = false;
          const users = await auth.listUsers();
          const dbUser = users.find(u => u.id === sess.userId);
          if (dbUser) {
            setUser(enforceAdminRole({ id: dbUser.id, username: dbUser.username, name: dbUser.profile?.name || dbUser.username, role: dbUser.role, propertyId: 'P001', active: dbUser.active, authProvider: 'local' } as User));
            userFound = true;
          } else {
            // Try to restore from central DB
            try {
              const configured = await db.isConfigured();
              if (configured) {
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
                  } as User));
                  userFound = true;
                }
              }
            } catch { }
          }
          if (!userFound) auth.logout();
        }
        onActivity = () => auth.touchSession();
        window.addEventListener('mousemove', onActivity);
        window.addEventListener('keydown', onActivity);
      }
    };

    setup();

    return () => {
      if (supabase) {
        unsub?.subscription?.unsubscribe();
      } else {
        if (onActivity) {
          window.removeEventListener('mousemove', onActivity);
          window.removeEventListener('keydown', onActivity);
        }
      }
    };
  }, []);

  const createAuthError = (code: AuthError['code'], message: string, username?: string, userId?: string): AuthError => ({
    code,
    message,
    timestamp: new Date(),
    username,
    userId
  });

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: AuthError }> => {
    try {
      const configured = await db.isConfigured();
      if (configured) {
        const resDb = await pmsAuthDb.verifyLogin(username, password);
        if (resDb.ok && resDb.user) {
          // Persist session for DB users so it survives refreshes/redirects
          auth.createSession({
            id: resDb.user.id,
            username: resDb.user.username,
            email: '',
            role: resDb.user.role as any,
            profile: { name: resDb.user.name },
            active: resDb.user.active,
            createdAt: resDb.user.created_at,
            updatedAt: resDb.user.created_at,
            password: { salt: '', hash: '', iterations: 0, derivedLen: 0 }, // Mock for session
            permissions: []
          });
          try {
            const existing = await auth.listUsers() || [];
            const exists = !!existing.find(u => u.id === resDb.user.id);
            if (!exists) {
              const next = [{
                id: resDb.user.id,
                username: resDb.user.username,
                email: '',
                role: resDb.user.role as any,
                profile: { name: resDb.user.name },
                password: { salt: '', hash: '', iterations: 0, derivedLen: 0 },
                active: resDb.user.active,
                createdAt: resDb.user.created_at,
                updatedAt: resDb.user.created_at,
                permissions: []
              }, ...existing].slice(0, 2000);
              setUsers(next as any);
            }
          } catch { }

          setUser(enforceAdminRole({
            id: resDb.user.id,
            username: resDb.user.username,
            name: resDb.user.name,
            role: (String(resDb.user.username || '').toLowerCase() === 'admin' ? 'admin' : (resDb.user.role as any)),
            propertyId: 'P001',
            active: resDb.user.active,
            passwordChangeRequired: !!resDb.mustChange,
            authProvider: 'db',
          } as User));
          logger.logAuth('login_success', { username, userId: resDb.user.id, timestamp: new Date().toISOString() });
          return { success: true };
        }
        if (resDb.error) {
          let errorCode: AuthError['code'] = 'INVALID_CREDENTIALS';
          if (resDb.error.includes('locked')) errorCode = 'USER_LOCKED';
          else if (resDb.error.includes('rate limit')) errorCode = 'RATE_LIMITED';
          else if (resDb.error.includes('inactive')) errorCode = 'USER_INACTIVE';
          const authError = createAuthError(errorCode, resDb.error, username);
          logger.logAuth('login_failure', { username, errorCode: authError.code, error: resDb.error, timestamp: new Date().toISOString() });
          return { success: false, error: authError };
        }
      }
    } catch { }
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: username, password });
      if (error) {
        const authError = createAuthError('INVALID_CREDENTIALS', 'Invalid email or password', username);
        logger.logAuth('login_failure', { username, errorCode: authError.code, timestamp: new Date().toISOString() });
        return { success: false, error: authError };
      }
      const sUser = data?.user;
      if (!sUser) {
        const authError = createAuthError('INVALID_CREDENTIALS', 'User not found', username);
        logger.logAuth('login_failure', { username, errorCode: authError.code, timestamp: new Date().toISOString() });
        return { success: false, error: authError };
      }
      const baseUser = {
        id: sUser.id,
        username: (sUser.user_metadata?.username as string) || sUser.email || sUser.id,
        name: (sUser.user_metadata?.name as string) || sUser.email || 'User',
        role: ((sUser.user_metadata?.role as string) || 'manager') as any,
        propertyId: 'P001',
        active: true,
        authProvider: 'supabase',
      } as User
      {
        const merged = await mergeUserWithProfile(baseUser);
        setUser(enforceAdminRole(merged));
      }
      logger.logAuth('login_success', { username, userId: sUser.id, timestamp: new Date().toISOString() });
      return { success: true };
    }
    await initAuth();
    const existingUsers = await auth.listUsers() || [];
    if (!existingUsers || existingUsers.length === 0) {
      const now = new Date().toISOString();
      const mk = async (u: string, p: string, r: string, name: string) => ({
        id: `USR_${Date.now()}_${u}`,
        username: u,
        email: '',
        role: r as any,
        profile: { name },
        password: await hashPassword(p),
        active: true,
        createdAt: now,
        updatedAt: now,
        permissions: [],
      });
      const seeds = [
        await mk('admin', 'admin123', 'admin', 'System Administrator'),
        await mk('frontdesk', 'front123', 'frontdesk', 'Front Desk Manager'),
        await mk('auditor', 'audit123', 'auditor', 'Night Auditor'),
        await mk('posmanager', 'pos123', 'posmanager', 'POS Manager'),
        await mk('housekeeping', 'house123', 'housekeeping', 'Housekeeping'),
      ];
      setUsers(seeds as any);
    }
    const resLocal = await auth.login(username, password);
    if (resLocal.ok && resLocal.user) {
      setUser(enforceAdminRole({ id: resLocal.user.id, username: resLocal.user.username, name: resLocal.user.profile?.name || resLocal.user.username, role: resLocal.user.role, propertyId: 'P001', active: resLocal.user.active, authProvider: 'local' } as User));
      logger.logAuth('login_success', { username, userId: resLocal.user.id, timestamp: new Date().toISOString() });
      return { success: true };
    }
    const authError = createAuthError('INVALID_CREDENTIALS', 'Invalid username or password', username);
    logger.logAuth('login_failure', { username, errorCode: authError.code, timestamp: new Date().toISOString() });
    return { success: false, error: authError };
  };

  const register = async (payload: { username: string; email: string; password: string; name?: string; phone?: string }) => {
    if (supabase) {
      const email = payload.email || payload.username;
      const { data, error } = await supabase.auth.signUp({
        email,
        password: payload.password,
        options: { data: { username: payload.username, name: payload.name, phone: payload.phone, role: 'manager' } }
      });
      if (error) return { ok: false, error: error.message };
      // User may need to verify email; reflect optimistic ok
      if (data?.user) {
        setUser({
          id: data.user.id,
          username: payload.username || email,
          name: payload.name || email,
          role: 'manager' as any,
          propertyId: 'P001',
          active: true,
        });
      }
      return { ok: true };
    }
    const res = await auth.register(payload);
    return { ok: res.ok, error: res.error };
  };

  const requestPasswordReset = (usernameOrEmail: string) => {
    if (supabase) {
      const email = usernameOrEmail;
      // Supabase sends a password reset email; token handling is via the email link flow
      supabase.auth.resetPasswordForEmail(email).catch(() => {/* ignore */ });
      return { ok: true };
    }
    return auth.requestPasswordReset(usernameOrEmail);
  };
  const resetPassword = async (token: string, newPassword: string) => {
    if (supabase) {
      // Password reset with Supabase is handled via email link; in-app token reset is not supported here
      return { ok: false, error: 'Use the password reset link sent to your email.' };
    }
    return auth.resetPassword(token, newPassword);
  };

  const logout = () => {
    if (supabase) {
      supabase.auth.signOut().catch(() => {/* ignore */ });
    } else {
      auth.logout();
    }
    setUser(null);
  };

  const updateProfile = async (patch: Partial<{ name?: string; phone?: string }>) => {
    if (!user) return { ok: false, error: 'Not logged in' };
    if (supabase) {
      const { data, error } = await supabase.auth.updateUser({ data: { name: patch.name, phone: patch.phone } });
      if (error) return { ok: false, error: error.message };
      const sUser = data?.user;
      if (sUser) {
        const baseUser = {
          id: sUser.id,
          username: (sUser.user_metadata?.username as string) || sUser.email || sUser.id,
          name: (sUser.user_metadata?.name as string) || sUser.email || 'User',
          role: ((sUser.user_metadata?.role as string) || 'manager') as any,
          propertyId: 'P001',
          active: true,
        } as User
        const merged = await mergeUserWithProfile(baseUser)
        setUser(enforceAdminRole(merged))
      }
      return { ok: true };
    }
    const res = await auth.updateProfile(user.id, patch);
    if (res.ok && res.user) setUser(enforceAdminRole({ id: res.user.id, username: res.user.username, name: res.user.profile?.name || res.user.username, role: res.user.role, propertyId: 'P001', active: res.user.active } as User));
    return { ok: res.ok, error: res.error };
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) return { ok: false, error: 'Not logged in' };
    try {
      const beforeSession = auth.getSession();
      logger.logAuth('password_change_attempt', { username: user.username, userId: user.id, provider: user.authProvider || 'local', sessionId: beforeSession?.token, expiresAt: beforeSession?.expiresAt });
    } catch { }
    if (supabase) {
      // Supabase requires the user to be logged in; we update directly.
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        logger.logAuth('password_change_failure', { username: user.username, userId: user.id, provider: 'supabase', error: error.message });
        return { ok: false, error: error.message };
      }
      logger.logAuth('password_change_success', { username: user.username, userId: user.id, provider: 'supabase' });
      return { ok: true };
    }
    // If user logged in via DB, change their password there and clear the must-change flag
    if (user.authProvider === 'db') {
      const res = await pmsAuthDb.updatePasswordForUser(user.username, newPassword);
      if (res.ok) {
        setUser({ ...user, passwordChangeRequired: false });
        const sessUser = {
          id: user.id,
          username: user.username,
          email: '',
          role: user.role as any,
          profile: { name: user.name },
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          password: { salt: '', hash: '', iterations: 0, derivedLen: 0 },
          permissions: []
        } as any;
        const newSess = auth.createSession(sessUser);
        logger.logAuth('session_regenerated_after_password_change', { username: user.username, userId: user.id, provider: 'db', sessionId: newSess.token, expiresAt: newSess.expiresAt });
      }
      if (!res.ok) logger.logAuth('password_change_failure', { username: user.username, userId: user.id, provider: 'db', error: res.error });
      return res;
    }
    const resLocal = await auth.changePassword(user.id, currentPassword, newPassword);
    if (resLocal.ok) {
      const users = await auth.listUsers();
      const dbUser = users.find(u => u.id === user.id);
      if (dbUser) {
        const newSess = auth.createSession(dbUser);
        logger.logAuth('session_regenerated_after_password_change', { username: dbUser.username, userId: dbUser.id, provider: 'local', sessionId: newSess.token, expiresAt: newSess.expiresAt });
      }
      logger.logAuth('password_change_success', { username: user.username, userId: user.id, provider: 'local' });
    } else {
      logger.logAuth('password_change_failure', { username: user.username, userId: user.id, provider: 'local', error: resLocal.error });
    }
    return resLocal;
  };

  return (
    <AuthContext.Provider value={{ user, login, register, requestPasswordReset, resetPassword, logout, updateProfile, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
