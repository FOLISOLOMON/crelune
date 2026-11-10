/**
 * CRELUNE — Cryptographic Password Hashing & Verification
 *
 * Implements scrypt key derivation with random 16-byte salt and constant-time comparison.
 */

import crypto from 'node:crypto';

const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) {
      return resolve(false);
    }

    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const keyBuffer = Buffer.from(key, 'hex');
        const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}
