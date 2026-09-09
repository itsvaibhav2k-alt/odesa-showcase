/**
 * AES-256-GCM token encryption for OAuth credentials at rest.
 *
 * Wave 7 — Stream G. The `oauth_tokens` table stores both the access
 * token and the refresh token as plain `text` columns (pgsodium isn't
 * enabled on the cloud project). To avoid leaving raw bearer tokens
 * sitting in Postgres, we wrap them with AES-256-GCM here using a
 * symmetric key sourced from the `OAUTH_TOKEN_ENCRYPTION_KEY` env var
 * (32 hex bytes = 64 hex chars).
 *
 * Format on disk: a single base64 string laid out as
 *   `iv (12B) || authTag (16B) || ciphertext (N)`
 * The 12-byte IV is the GCM-recommended nonce length; we generate a
 * fresh one for every encryption call. AuthTag length is fixed at 16B.
 *
 * Tamper detection: GCM verifies the authTag at decrypt time and
 * `decipher.final()` throws if the ciphertext (or auth tag) was
 * altered. The wrapper translates that into a stable `TokenDecryptError`
 * so callers can narrate `calendar_not_connected` instead of a stack
 * trace when an old ciphertext appears after a key rotation.
 *
 * Logging discipline: never log the plaintext, ciphertext, or the key.
 * Errors only surface a message like "decryption failed" without
 * embedding any of the three.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;

const ENV_VAR = 'OAUTH_TOKEN_ENCRYPTION_KEY';

export class TokenEncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptionConfigError';
  }
}

export class TokenDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenDecryptError';
  }
}

/**
 * Resolve the encryption key from env. Cached after first read so we
 * don't hex-decode on every encrypt/decrypt call. A missing or wrong-
 * length key fails loudly — the OAuth route handlers must not silently
 * write unencrypted tokens.
 */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[ENV_VAR];
  if (!raw || raw.trim().length === 0) {
    throw new TokenEncryptionConfigError(
      `${ENV_VAR} is not set; OAuth tokens cannot be encrypted at rest.`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'hex');
  } catch {
    throw new TokenEncryptionConfigError(
      `${ENV_VAR} must be a hex string; received non-hex characters.`,
    );
  }
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new TokenEncryptionConfigError(
      `${ENV_VAR} must decode to ${KEY_BYTE_LENGTH} bytes (64 hex chars); got ${key.length}.`,
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypt a plaintext token. Returns a single base64 blob suitable for
 * a `text` column in `oauth_tokens.access_token` / `refresh_token`.
 *
 * @param plaintext - Raw token. MUST be a non-empty string.
 * @returns Base64-encoded `iv || authTag || ciphertext` blob.
 * @throws TokenEncryptionConfigError if the env key is missing/malformed.
 */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('encryptToken: plaintext must be a non-empty string');
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_BYTE_LENGTH) {
    // Defensive — Node's GCM always returns 16B but we depend on it
    // to slice on the way back out.
    throw new Error('encryptToken: unexpected auth tag length');
  }
  const blob = Buffer.concat([iv, authTag, encrypted]);
  return blob.toString('base64');
}

/**
 * Decrypt a previously-encrypted token blob.
 *
 * @param ciphertext - Base64 blob produced by {@link encryptToken}.
 * @returns Plaintext token string.
 * @throws TokenDecryptError if the blob is malformed or auth fails.
 * @throws TokenEncryptionConfigError if the env key is missing/malformed.
 */
export function decryptToken(ciphertext: string): string {
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new TokenDecryptError('decryptToken: ciphertext must be a non-empty string');
  }
  const key = getKey();
  let blob: Buffer;
  try {
    blob = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new TokenDecryptError('decryptToken: not valid base64');
  }
  if (blob.length < IV_BYTE_LENGTH + AUTH_TAG_BYTE_LENGTH + 1) {
    throw new TokenDecryptError('decryptToken: blob too short');
  }
  const iv = blob.subarray(0, IV_BYTE_LENGTH);
  const authTag = blob.subarray(
    IV_BYTE_LENGTH,
    IV_BYTE_LENGTH + AUTH_TAG_BYTE_LENGTH,
  );
  const data = blob.subarray(IV_BYTE_LENGTH + AUTH_TAG_BYTE_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Don't surface the underlying message — it can leak whether the
    // key or the ciphertext was wrong.
    throw new TokenDecryptError('decryptToken: authentication failed');
  }
}

/**
 * Test-only — clear the cached key so a test that mutates
 * `process.env.OAUTH_TOKEN_ENCRYPTION_KEY` mid-run gets the new value.
 */
export function _resetCryptoCache(): void {
  cachedKey = null;
}
