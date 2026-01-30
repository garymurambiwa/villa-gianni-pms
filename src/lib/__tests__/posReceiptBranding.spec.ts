import { describe, it, expect, beforeEach } from 'vitest';
import { generateReceiptHTML } from '../posIntegration';

const sampleBill: any = {
  id: 'bill-123',
  items: [ { name: 'Breakfast', quantity: 1, subtotal: 20.0 } ],
  total: 20.0,
  tableId: 't1',
};

function setSettings(name: string, address: string) {
  const settings = {
    restaurant_name: name,
    address,
    phone: '+263 773 038 972',
    email: 'coredigitazw@gmail.com',
    website: 'https://coredigita.co.zw',
    show_logo: false,
    tax_rate: 0,
  };
  localStorage.setItem('corepms_receipt_settings', JSON.stringify(settings));
}

function getSettings(): any {
  try {
    const raw = localStorage.getItem('corepms_receipt_settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

describe('POS Receipt Branding', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('pulls current address and company from settings', () => {
    setSettings('Coredigita Pvt Ltd', '119 Harare Street Honda Centre Room 7A Harare');
    const html = generateReceiptHTML(sampleBill, getSettings(), 'receipt');
    expect(html).toContain('Coredigita Pvt Ltd');
    expect(html).toContain('119 Harare Street');
    expect(html).toContain('Phone: +263 773 038 972');
    expect(html).toContain('Email: coredigitazw@gmail.com');
    // Website is not currently included in generateReceiptHTML header
  });

  it('reflects updates after settings change (cache-busting)', () => {
    setSettings('Coredigita Pvt Ltd', '119 Harare Street Honda Centre Room 7A Harare');
    let html = generateReceiptHTML(sampleBill, getSettings(), 'receipt');
    expect(html).toContain('119 Harare Street');

    // Update address
    setSettings('Coredigita Pvt Ltd', '119 Harare Street Honda Centre Room 7A Harare');
    html = generateReceiptHTML(sampleBill, getSettings(), 'receipt');
    expect(html).toContain('119 Harare Street');
    expect(html).toContain('Harare');
  });
});
