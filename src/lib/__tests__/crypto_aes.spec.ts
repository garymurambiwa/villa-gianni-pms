import { describe, it, expect } from 'vitest';
import { encryptAES256, decryptAES256, encryptSensitive, decryptSensitive } from '@/lib/crypto';

describe('crypto AES-256', () => {
  it('encrypts and decrypts using AES-GCM when available', async () => {
    const text = 'hello-world';
    const token = await encryptAES256(text);
    const out = await decryptAES256(token);
    expect(out).toBe(text);
  });

  it('falls back to XOR for invalid tokens gracefully', async () => {
    const text = 'abc123';
    const token = encryptSensitive(text);
    const out = decryptSensitive(token);
    expect(out).toBe(text);
  });
});

