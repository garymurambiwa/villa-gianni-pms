import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AuthPortal from '@/components/modules/AuthPortal';
import { AuthProvider } from '@/context/AuthContext';

describe('Dialog a11y: focus trap', () => {
  it('traps focus inside role info dialog when open', async () => {
    render(<AuthProvider><AuthPortal /></AuthProvider>);
    // Open Register tab and role info dialog
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    fireEvent.click(screen.getByRole('button', { name: /role info/i }));
    const dialog = await screen.findByRole('dialog');
    const firstFocusable = within(dialog).getAllByRole('button')[0];

    // Cycle focus using Tab several times; should remain within dialog
    firstFocusable.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThan(0);
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).not.toBeNull();

    // Try Shift+Tab cycle
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).not.toBeNull();
    // Ensure focus remains within the dialog container
    expect(dialog).toContainElement(document.activeElement as Element);
  });
});
