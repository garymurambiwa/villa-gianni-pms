import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DataProvider } from '@/context/DataContext';
import { AuthProvider } from '@/context/AuthContext';
import { Reservations } from '../Reservations';

describe('Reservations form validation', () => {
  it('prevents submission when required fields are missing', async () => {
    render(<AuthProvider><DataProvider><Reservations /></DataProvider></AuthProvider>);
    
    fireEvent.click(screen.getByText('+ New Reservation'));
    
    // The submit button should be disabled when required fields are missing
    const submitButton = screen.getByText('Create Reservation');
    expect(submitButton).toBeDisabled();
    
    // Fill in required fields one by one
    fireEvent.change(screen.getByPlaceholderText('Guest Name *'), { target: { value: 'Test Guest' } });
    fireEvent.change(screen.getByPlaceholderText('Check-In *'), { target: { value: '2025-12-01' } });
    fireEvent.change(screen.getByPlaceholderText('Check-Out *'), { target: { value: '2025-12-02' } });
    fireEvent.change(screen.getByLabelText('ID or Passport Number'), { target: { value: 'A123456' } });
    fireEvent.change(screen.getByPlaceholderText('Rate *'), { target: { value: '120' } });
    
    // Set room type (select Standard King from dropdown)
    fireEvent.change(screen.getByDisplayValue('Select source...'), { target: { value: 'website' } });
    
    // Set payment verification
    fireEvent.change(screen.getByDisplayValue('Select source of payment information...'), { target: { value: 'Guest provided at booking' } });
    fireEvent.click(screen.getByText('I confirm the payment details source and authorization are correct.'));
    
    // The button should still be disabled because origin region and room type are missing
    expect(submitButton).toBeDisabled();
  });

  it('validates ID/Passport field in real-time', async () => {
    render(<AuthProvider><DataProvider><Reservations /></DataProvider></AuthProvider>);
    fireEvent.click(screen.getByText('+ New Reservation'));

    // Enter invalid ID
    fireEvent.change(screen.getByLabelText('ID or Passport Number'), { target: { value: '123' } });
    
    // Should show validation error
    expect(await screen.findByText(/Invalid ID\/Passport for selected nationality\/type/i)).toBeTruthy();
    
    // Enter valid ID
    fireEvent.change(screen.getByLabelText('ID or Passport Number'), { target: { value: 'A123456' } });
    
    // Error should disappear
    expect(screen.queryByText(/Invalid ID\/Passport for selected nationality\/type/i)).toBeFalsy();
  });
});
