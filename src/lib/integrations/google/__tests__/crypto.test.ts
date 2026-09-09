/**
 * Crypto round-trip + tamper detection for OAuth token encryption.
 *
 * Wave 7 — Stream G. Verifies:
 *   - encrypt → decrypt round-trips arbitrary plaintext.
 *   - bit-flipping the ciphertext throws TokenDecryptError.
 *   - bit-flipping the auth tag throws TokenDecryptError.
 *   - missing/short env keys throw TokenEncryptionConfigError.
 *   - distinct calls produce distinct ciphertexts (random IV).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetCryptoCache,
  TokenDecryptError,
  TokenEncryptionConfigError,
  decryptToken,
  encryptToken,
} from '../crypto';

// Deterministic test fixture, never a deployed encryption key.
const VALID_KEY_HEX = Array.from({ length: 64 }, (_, i) => (i % 16).toString(16)).join('');

describe('crypto.encryptToken / decryptToken', () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = VALID_KEY_HEX;
    _resetCryptoCache();
  });

  afterEach(() => {
    if (prevKey === undefined) {
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.OAUTH_TOKEN_ENCRYPTION_KEY = prevKey;
    }
    _resetCryptoCache();
  });

  it('round-trips an OAuth-shaped access token', () => {
    const plain = 'ya29.a0AfH6SMABCDEFGHabcdef-1234-_TOKEN-EXAMPLE';
    const ciphertext = encryptToken(plain);
    expect(ciphertext).not.toBe(plain);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(decryptToken(ciphertext)).toBe(plain);
  });

  it('round-trips multibyte unicode plaintext', () => {
    const plain = 'token-with-émoji-🚀-and-ünicode';
    expect(decryptToken(encryptToken(plain))).toBe(plain);
  });

  it('produces different ciphertexts on repeated encryption (random IV)', () => {
    const plain = 'same-plaintext';
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it('throws TokenDecryptError when the ciphertext blob is tampered', () => {
    const ciphertext = encryptToken('hello');
    const buf = Buffer.from(ciphertext, 'base64');
    // Flip the last byte of the actual ciphertext (after iv+authTag).
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => decryptToken(tampered)).toThrow(TokenDecryptError);
  });

  it('throws TokenDecryptError when the auth tag is tampered', () => {
    const ciphertext = encryptToken('hello');
    const buf = Buffer.from(ciphertext, 'base64');
    // Flip a byte in the auth tag (offset 12 .. 12+16).
    buf[15] = buf[15] ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptToken(tampered)).toThrow(TokenDecryptError);
  });

  it('throws TokenDecryptError on a too-short blob', () => {
    expect(() => decryptToken(Buffer.from('aa', 'utf8').toString('base64'))).toThrow(
      TokenDecryptError,
    );
  });

  it('throws TokenEncryptionConfigError when env var is missing', () => {
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    _resetCryptoCache();
    expect(() => encryptToken('hello')).toThrow(TokenEncryptionConfigError);
  });

  it('throws TokenEncryptionConfigError when env key is wrong length', () => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '00ff';
    _resetCryptoCache();
    expect(() => encryptToken('hello')).toThrow(TokenEncryptionConfigError);
  });

  it('rejects empty plaintext', () => {
    expect(() => encryptToken('')).toThrow(TypeError);
  });

  it('rejects empty ciphertext', () => {
    expect(() => decryptToken('')).toThrow(TokenDecryptError);
  });
});
