import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthPortal from '@/components/modules/AuthPortal';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    register: vi.fn(async () => ({ ok: true })),
    requestPasswordReset: vi.fn(() => ({ ok: true, token: 'T' })),
    resetPassword: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/lib/approvalWorkflow', () => ({
  default: {
    createApprovalRequest: vi.fn(async () => ({ id: 'A1', status: 'pending' })),
    getApprovalStatus: vi.fn(async () => 'pending'),
    cancelRequest: vi.fn(async () => {}),
    validateSessionIP: vi.fn(async () => true),
    provisionPermissions: vi.fn(async () => {}),
  },
}));

describe('AuthPortal approval workflow UI', () => {
  beforeEach(() => {
    vi.spyOn(global as any, 'fetch').mockResolvedValue({ json: async () => ({ ip: '127.0.0.1' }) } as any);
  });
  it('requires role selection before submission', async () => {
    render(<AuthPortal />);
    const registerTab = screen.getByRole('button', { name: /register/i });
    fireEvent.click(registerTab);
    const submit = screen.getByRole('button', { name: /submit for approval/i });
    expect(submit).toBeDisabled();
  });

  it('shows cancel dialog and can confirm', async () => {
    render(<AuthPortal />);
    const registerTab = screen.getByRole('button', { name: /register/i });
    fireEvent.click(registerTab);
    const roleSelect = screen.getByRole('combobox', { name: /role/i });
    fireEvent.change(roleSelect, { target: { value: 'manager' } });
    const submit = screen.getByRole('button', { name: /submit for approval/i });
    fireEvent.click(submit);
    const cancelBtn = await screen.findByRole('button', { name: /cancel request/i });
    fireEvent.click(cancelBtn);
    const confirm = await screen.findByRole('button', { name: /confirm cancel/i });
    fireEvent.click(confirm);
    expect(await screen.findByText(/request cancelled/i)).toBeInTheDocument();
  });
});
