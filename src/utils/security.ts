import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Security utility for password hashing and constant-time comparisons (ISO 27001 Banking Standard)
 * Uses PBKDF2 with 100,000 iterations to resist brute-force attacks.
 */

const ITERATIONS = 100000;
const KEY_LEN = 64;
const DIGEST = 'sha512';

/**
 * Comparación en tiempo constante mediante digests SHA-256 de ambas cadenas.
 * Rechaza siempre cadenas vacías o compuestas solo de espacios en blanco.
 */
export const constantTimeEqualStrings = (candidate?: string | null, expected?: string | null): boolean => {
    if (typeof candidate !== 'string' || typeof expected !== 'string') {
        return false;
    }
    if (candidate.trim().length === 0 || expected.trim().length === 0) {
        return false;
    }
    const digestCandidate = createHash('sha256').update(candidate, 'utf8').digest();
    const digestExpected = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(digestCandidate, digestExpected);
};

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
 * @returns { rawToken: string, hashedToken: string, expiresAt: number }
 */
export const generateSetupToken = () => {
    const rawToken = randomBytes(32).toString('base64url'); // URL safe
    const hashedToken = pbkdf2Sync(rawToken, 'setup_salt', 1000, 32, 'sha256').toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    return { rawToken, hashedToken, expiresAt };
};

/**
 * Verifies a setup token against its stored PBKDF2 hash in constant time
 */
export const verifySetupTokenHash = (rawToken: string, storedHashedToken?: string): boolean => {
    if (!rawToken || !storedHashedToken) return false;
    const computed = pbkdf2Sync(rawToken, 'setup_salt', 1000, 32, 'sha256').toString('hex');
    return constantTimeEqualStrings(computed, storedHashedToken);
};

/**
 * Verifies a password against a stored hash
 */
export const verifyPassword = (password: string, storedHash: string): boolean => {
    if (!password || !storedHash) return false;
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const hashToVerify = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');

    const originalBuffer = Buffer.from(originalHash, 'hex');
    const verifyBuffer = Buffer.from(hashToVerify, 'hex');

    if (originalBuffer.length === 0 || originalBuffer.length !== verifyBuffer.length) {
        return false;
    }

    return timingSafeEqual(originalBuffer, verifyBuffer);
};
