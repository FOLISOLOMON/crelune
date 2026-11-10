import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('Password Hashing & Verification', () => {
  it('correctly hashes and verifies a password', async () => {
    const rawPassword = 'MasterSecurePassword123!';
    const hash = await hashPassword(rawPassword);

    expect(hash).toContain(':');
    const [salt, key] = hash.split(':');
    expect(salt).toHaveLength(32); // 16 bytes in hex
    expect(key).toHaveLength(128); // 64 bytes in hex

    const isMatch = await verifyPassword(rawPassword, hash);
    expect(isMatch).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const rawPassword = 'CorrectPassword123!';
    const hash = await hashPassword(rawPassword);

    const isMatch = await verifyPassword('WrongPassword123!', hash);
    expect(isMatch).toBe(false);
  });

  it('generates distinct salts for identical passwords', async () => {
    const password = 'IdenticalPassword123!';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('safely handles corrupted hash strings', async () => {
    expect(await verifyPassword('any', 'corrupted-hash-without-colon')).toBe(false);
    expect(await verifyPassword('any', '')).toBe(false);
  });
});
