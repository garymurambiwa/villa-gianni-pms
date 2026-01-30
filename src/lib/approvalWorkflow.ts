import { Crypto } from './crypto';
import { logger } from './logger';
import { requireSupabase } from './supabaseClient';
import { Config } from '@/config';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'cancelled';

export interface ApprovalRequestPayload {
  userId: string;
  username: string;
  role: string;
  departments: string[];
  requestedAt: number;
}

export interface ApprovalRecord extends ApprovalRequestPayload {
  id: string;
  status: ApprovalStatus;
  approverId?: string;
  updatedAt: number;
}

const ESCALATION_MS = 72 * 60 * 60 * 1000; // 72 hours

export async function createApprovalRequest(payload: ApprovalRequestPayload): Promise<ApprovalRecord> {
  const supabase = requireSupabase();
  const encrypted = await Crypto.encryptAES256(JSON.stringify(payload));
  const now = Date.now();
  const res = await supabase.from('approval_requests').insert({
    payload_enc: encrypted,
    status: 'pending',
    requested_at: payload.requestedAt,
    updated_at: now,
  }).select('*').single();
  if (res.error) {
    logger.error('approval.create.error', res.error);
    throw res.error;
  }
  const id = res.data.id as string;
  await logAudit('request_created', payload.userId, id);
  await notifyAdmins(id);
  return {
    ...payload,
    id,
    status: 'pending',
    updatedAt: now,
  };
}

export async function getApprovalStatus(id: string): Promise<ApprovalStatus> {
  const supabase = requireSupabase();
  const res = await supabase.from('approval_requests').select('status, requested_at, updated_at').eq('id', id).single();
  if (res.error) {
    logger.error('approval.status.error', res.error);
    throw res.error;
  }
  const { status, requested_at } = res.data;
  if (status === 'pending') {
    const age = Date.now() - Number(requested_at);
    if (age > ESCALATION_MS) return 'escalated';
  }
  return status as ApprovalStatus;
}

export async function approveRequest(id: string, approverId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('approve_request_tx', { req_id: id, approver: approverId });
  if (error) {
    logger.error('approval.approve.error', error);
    throw error;
  }
  await logAudit('request_approved', approverId, id);
}

export async function rejectRequest(id: string, approverId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('reject_request_tx', { req_id: id, approver: approverId });
  if (error) {
    logger.error('approval.reject.error', error);
    throw error;
  }
  await logAudit('request_rejected', approverId, id);
}

export async function cancelRequest(id: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('cancel_request_tx', { req_id: id, requester: userId });
  if (error) {
    logger.error('approval.cancel.error', error);
    throw error;
  }
  await logAudit('request_cancelled', userId, id);
}

export async function notifyAdmins(approvalId: string): Promise<void> {
  // Stub: write a notification record; integration points for email/SMS/in-app
  const supabase = requireSupabase();
  const { error } = await supabase.from('notifications').insert({
    type: 'approval_request',
    ref_id: approvalId,
    channels: ['email', 'sms', 'in_app'],
    created_at: new Date().toISOString(),
  });
  if (error) logger.warn('notify.admins.error', error);
}

export async function provisionPermissions(userId: string, role: string, departments: string[]): Promise<void> {
  // Immediate RBAC provisioning via synchronous service call
  try {
    const url = `${Config.rbacServiceUrl}/provision`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role, departments }),
    });
    if (!res.ok) {
      const msg = await safeText(res);
      throw new Error(`RBAC service error: ${res.status} ${msg}`);
    }
    await logAudit('rbac_provision_applied', userId, role);
  } catch (e) {
    logger.error('rbac.provision.error', e);
    throw e;
  }
}

export async function validateSessionIP(expectedIp: string): Promise<boolean> {
  try {
    if (import.meta.env.VITE_USE_SUPABASE_MOCK === 'true') {
      // Offline deterministic mode: trust session IP
      return true
    }
    const res = await fetch('https://api.ipify.org?format=json');
    const json = await res.json();
    return String(json.ip) === String(expectedIp);
  } catch (e) {
    logger.warn('ip.validation.error', e);
    return false;
  }
}

export async function logAudit(action: string, actorId: string, target: string): Promise<void> {
  try {
    const supabase = requireSupabase();
    const { error } = await supabase.from('audit_log').insert({
      action,
      actor_id: actorId,
      target,
      ts: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    logger.warn('audit.write.error', e);
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

/**
 * Compute ETA in milliseconds based on historical approvals.
 * Uses average of (approved_at - created_at) for rows with status='approved'.
 * Falls back to updated_at when approved_at is missing.
 */
export async function computeEtaMs(): Promise<number> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('approval_requests')
    .select('created_at, approved_at, updated_at, status')
    .eq('status', 'approved')
    .limit(250);
  if (error) {
    logger.warn('approval.eta.query.error', error);
    // Fallback: 48 hours
    return 48 * 60 * 60 * 1000;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return 48 * 60 * 60 * 1000;
  let sum = 0; let count = 0;
  for (const r of rows as any[]) {
    const c = r.created_at ? Date.parse(r.created_at) : undefined;
    const a = r.approved_at ? Date.parse(r.approved_at) : (r.updated_at ? Date.parse(r.updated_at) : undefined);
    if (c && a && a > c) { sum += (a - c); count++; }
  }
  if (count === 0) return 48 * 60 * 60 * 1000;
  // Slight buffer to account for current queue variability (add 10%)
  return Math.round((sum / count) * 1.1);
}

export function formatEta(ms: number): string {
  const hrs = Math.round(ms / (60 * 60 * 1000));
  if (hrs < 1) {
    const mins = Math.max(15, Math.round(ms / (60 * 1000)));
    return `~${mins} minutes`;
  }
  if (hrs <= 72) return `~${hrs} hours`;
  const days = Math.round(hrs / 24);
  return `~${days} days`;
}

export default {
  createApprovalRequest,
  getApprovalStatus,
  approveRequest,
  rejectRequest,
  cancelRequest,
  notifyAdmins,
  provisionPermissions,
  validateSessionIP,
  logAudit,
  computeEtaMs,
  formatEta,
};
