import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthPortal from '@/components/modules/AuthPortal';
import { AuthProvider } from '@/context/AuthContext';

vi.mock('@/lib/departments', () => ({
  isMultiSelectEnabled: () => true,
  fetchDepartments: vi.fn(async () => ({ items: [
    { id: 'root', name: 'Operations', children: [
      { id: 'hk', name: 'Housekeeping' },
      { id: 'mt', name: 'Maintenance' },
    ] },
  ] }))
}));

describe('Department Tree keyboard navigation', () => {
  it('supports expand/collapse and selection with keyboard', async () => {
    render(<AuthProvider><AuthPortal /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    // Focus the first treeitem
    const tree = await screen.findByRole('tree');
    const items = screen.getAllByRole('treeitem');
    expect(items.length).toBeGreaterThan(0);
    items[0].focus();
    // Collapse then expand
    fireEvent.keyDown(items[0], { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(items[0]).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(items[0], { key: 'ArrowRight', code: 'ArrowRight' });
    expect(items[0]).toHaveAttribute('aria-expanded', 'true');
    // Select with Space
    fireEvent.keyDown(items[0], { key: ' ', code: 'Space' });
    const checkbox = items[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
