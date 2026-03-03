import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Security utility for password hashing (Bank-level standard)
 * Uses PBKDF2 with 100,000 iterations to resist brute-force attacks.
 */

const ITERATIONS = 100000;
const KEY_LEN = 64;
const DIGEST = 'sha512';

/**
 * Creates a secure hash for a password
 * @returns string in format salt:hash
 */
export const hashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    return `${salt}:${hash}`;
};

/**
 * Generates a secure, cryptographically random token for setup links.
 * Used instead of Firebase Auth reset links since we decouple identity from email.
 * @returns { token: string, hashedToken: string, expiresAt: number }
 */
export const generateSetupToken = () => {
    const rawToken = randomBytes(32).toString('base64url'); // URL safe
    const hashedToken = pbkdf2Sync(rawToken, 'setup_salt', 1000, 32, 'sha256').toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    return { rawToken, hashedToken, expiresAt };
};

/**
 * Verifies a password against a stored hash
 */
export const verifyPassword = (password: string, storedHash: string): boolean => {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const hashToVerify = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');

    // Use timingSafeEqual to prevent timing attacks, but only if lengths match
    // to avoid "RangeError: Input buffers must have the same byte length"
    const originalBuffer = Buffer.from(originalHash, 'hex');
    const verifyBuffer = Buffer.from(hashToVerify, 'hex');

    if (originalBuffer.length !== verifyBuffer.length) {
        console.warn(`[SECURITY] Hash length mismatch: expected ${verifyBuffer.length}, got ${originalBuffer.length}`);
        return false;
    }

    return timingSafeEqual(originalBuffer, verifyBuffer);
};
