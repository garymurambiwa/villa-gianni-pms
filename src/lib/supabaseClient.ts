// Local-only authentication client (no cloud dependencies)
// This replaces Supabase with a local mock for offline LAN operation

let session: any = null;
let listeners: Array<(event: any, s: any) => void> = [];

// Simple in-memory mock for tables used by approval workflow
const db: Record<string, any[]> = {
  approval_requests: [],
  notifications: [],
  audit_log: [],
};

let idCounter = 1;

const makeInsertResult = (row: any) => ({
  data: row,
  error: null,
  select: (_fields: string) => ({
    single: async () => ({ data: row, error: null }),
  }),
});

const from = (table: string) => {
  const api: any = {
    insert: async (values: any) => {
      const row = { id: `LOCAL_${idCounter++}`, ...values };
      if (table === 'approval_requests') {
        row.status = row.status || 'pending';
        row.created_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        row.requested_at = row.requested_at ?? Date.now();
      }
      db[table] = db[table] || [];
      db[table].push(row);
      return makeInsertResult(row);
    },
    select: (_fields: string) => {
      let rows = (db[table] || []).slice();
      const selApi: any = {
        eq: (key: string, val: any) => {
          rows = rows.filter(r => String(r[key]) === String(val));
          return selApi;
        },
        limit: async (_n: number) => ({ data: rows, error: null }),
        single: async () => ({ data: rows[0] || null, error: null }),
      };
      return selApi;
    },
  };
  return api;
};

const rpc = async (fn: string, params: Record<string, any>) => {
  if (fn === 'approve_request_tx') {
    const id = params.req_id;
    let req = (db.approval_requests || []).find(r => String(r.id) === String(id));
    if (!req) {
      req = { id, status: 'approved', created_at: new Date().toISOString(), requested_at: Date.now() };
      db.approval_requests.push(req);
    }
    req.status = 'approved';
    req.approved_at = new Date().toISOString();
    req.updated_at = new Date().toISOString();
    db.audit_log.push({ action: 'request_approved', actor_id: params.approver, target: id, ts: new Date().toISOString() });
    return { data: null, error: null };
  }
  if (fn === 'reject_request_tx') {
    const id = params.req_id;
    let req = (db.approval_requests || []).find(r => String(r.id) === String(id));
    if (!req) {
      req = { id, status: 'rejected', created_at: new Date().toISOString(), requested_at: Date.now() };
      db.approval_requests.push(req);
    }
    req.status = 'rejected';
    req.updated_at = new Date().toISOString();
    db.audit_log.push({ action: 'request_rejected', actor_id: params.approver, target: id, ts: new Date().toISOString() });
    return { data: null, error: null };
  }
  if (fn === 'cancel_request_tx') {
    const id = params.req_id;
    let req = (db.approval_requests || []).find(r => String(r.id) === String(id));
    if (!req) {
      req = { id, status: 'cancelled', created_at: new Date().toISOString(), requested_at: Date.now() };
      db.approval_requests.push(req);
    }
    req.status = 'cancelled';
    req.updated_at = new Date().toISOString();
    db.audit_log.push({ action: 'request_cancelled', actor_id: params.requester, target: id, ts: new Date().toISOString() });
    return { data: null, error: null };
  }
  return { data: null, error: null };
};

const auth = {
  async getUser() {
    const user = session?.user ?? null;
    return { data: { user }, error: null };
  },
  async getSession() {
    return { data: { session }, error: null };
  },
  onAuthStateChange(cb?: (event: any, s: any) => void) {
    if (typeof cb === 'function') {
      listeners.push(cb);
      try { cb(session ? 'SIGNED_IN' : 'SIGNED_OUT', session ?? { user: null }); } catch {}
    }
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            if (typeof cb === 'function') listeners = listeners.filter(fn => fn !== cb);
          }
        }
      },
      error: null
    };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    // Local auth is handled by pmsAuthDb - this is just for compatibility
    let role = 'frontdesk';
    try {
      const { listUsers } = await import('@/lib/authService');
      const users = listUsers();
      const q = String(email || '').toLowerCase();
      const found = users.find(u => u.username.toLowerCase() === q || (u.email || '').toLowerCase() === q);
      if (found) role = found.role as any;
    } catch {}
    session = { user: { id: 'LOCAL_USER', email, user_metadata: { username: email, name: email, role } } };
    listeners.forEach(fn => { try { fn('SIGNED_IN', session); } catch {} });
    return { data: { user: session.user, session }, error: null };
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, any> } }) {
    const meta = options?.data ?? {};
    session = { user: { id: 'LOCAL_USER', email, user_metadata: meta } };
    listeners.forEach(fn => { try { fn('SIGNED_IN', session); } catch {} });
    return { data: { user: session.user, session }, error: null };
  },
  async resetPasswordForEmail(_email: string) {
    return { data: {}, error: null };
  },
  async updateUser(patch: { data?: Record<string, any>; password?: string }) {
    if (patch?.data && session?.user) {
      session.user.user_metadata = { ...session.user.user_metadata, ...patch.data };
    }
    return { data: { user: session?.user ?? { id: 'LOCAL_USER' } }, error: null };
  },
  async signOut() {
    session = null;
    listeners.forEach(fn => { try { fn('SIGNED_OUT', { user: null }); } catch {} });
    return { error: null };
  }
};

// Minimal realtime stubs
const channels: Set<any> = new Set();
const channel = (name: string) => {
  const ch: any = {
    name,
    on(_event: string, _config: any, _cb: (payload: any) => void) {
      return ch;
    },
    subscribe(cb?: (status: any) => void) {
      channels.add(ch);
      try { cb && cb({ status: 'SUBSCRIBED' }); } catch {}
      return { id: name };
    }
  };
  return ch;
};

const removeChannel = (ch: any) => {
  channels.delete(ch);
};

// Create local client
const localClient = { from, rpc, auth, channel, removeChannel };

console.log('Using local authentication client for LAN operation.');

export const supabase = localClient;

export function requireSupabase(): any {
  return localClient;
}

// No-op for local mode
export function promoteMockSessionToAdmin() {
  try {
    if (session?.user) {
      session.user.user_metadata = {
        ...session.user.user_metadata || {},
        role: 'admin'
      };
    }
    auth.updateUser?.({ data: { role: 'admin' } });
  } catch { /* ignore */ }
}
