import { Request, Response } from 'express';
import { db, auth } from '../config/firebase';
import { verifyPassword } from '../utils/security';
import { formatRut } from '../utils/rut';

/**
 * @route POST /api/auth/tunnel/challenge
 * @desc Verify password for a specific account and issue a context-restricted token
 * @access Public (Step 2 of Login)
 */
export const challengeAccountAccess = async (req: Request, res: Response) => {
    try {
        const { taxId, accountId, password } = req.body;

        if (!taxId || !accountId || !password) {
            return res.status(400).json({ error: 'Tax ID, Account ID and Password are required' });
        }

        // Normalize taxId formats for resilient lookup
        const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
        const formattedTaxId = formatRut(cleanTaxId);
        const searchValues = new Set([formattedTaxId, cleanTaxId]);

        if (cleanTaxId.length >= 2) {
            const body = cleanTaxId.slice(0, -1);
            const dv = cleanTaxId.slice(-1);
            searchValues.add(`${body}-${dv}`);
        }
        const finalSearchValues = Array.from(searchValues);

        // 1. Find User by taxId (RUN/RUT)
        const usersRef = db.collection('users');
        const userSnapshot = await usersRef.where('taxId', 'in', finalSearchValues).limit(1).get();

        if (userSnapshot.empty) {
            // FALLBACK: If not in 'users', check if they were invited as a delegate
            const accountsRef = db.collection('accounts');
            const delegateSnapshot = await accountsRef.where('primaryOperator.taxId', 'in', finalSearchValues).get();

            if (!delegateSnapshot.empty) {
                return res.status(401).json({ error: 'Cuenta no activada. Por favor revisa tu email para establecer una clave.' });
            }
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const memberships = userData.memberships || [];

        // 2. Find specific membership
        const membership = memberships.find((m: any) => m.accountId === accountId);

        if (!membership) {
            return res.status(403).json({ error: 'No access to this account' });
        }

        // 3. Verify Password (Stored in membership for bank-level isolation)
        // If passwordHash is missing, the account might not be activated yet
        if (!membership.passwordHash) {
            return res.status(401).json({ error: 'Account not activated. Please check your email.' });
        }

        const isValid = verifyPassword(password, membership.passwordHash);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password for this account' });
        }

        // 4. Issue Firebase Custom Token
        // This token will have restricted claims for this specific session
        const customToken = await auth.createCustomToken(userDoc.id, {
            activeAccountId: accountId,
            role: membership.role,
            type: membership.type || 'B2B' // Contextual type
        });

        // 5. Update last active account for convenience
        await userDoc.ref.update({
            lastActiveAccountId: accountId,
            lastLogin: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            firebaseToken: customToken,
            user: {
                displayName: userData.displayName,
                role: membership.role,
                activeAccountId: accountId
            }
        });

    } catch (error) {
        console.error('[AUTH-TUNNEL] Challenge Error:', error);
        return res.status(500).json({ error: 'Internal security error during challenge' });
    }
};
