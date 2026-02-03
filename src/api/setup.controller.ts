import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { hashPassword } from '../utils/security';
import { formatRut } from '../utils/rut';

/**
 * @route POST /api/auth/tunnel/setup-password
 * @desc Set the initial password for a specific account access
 * @access Public (Link from email)
 */
export const setupAccountPassword = async (req: Request, res: Response) => {
    try {
        const { taxId, accountId, password } = req.body;

        if (!taxId || !accountId || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
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

        // 1. Find User by taxId
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('taxId', 'in', finalSearchValues).limit(1).get();

        let userDocRef;
        let userData;
        let memberships;

        if (snapshot.empty) {
            // FALLBACK: User invited but 'users' doc not synced yet (pre-fix invitations)
            const accountsRef = db.collection('accounts');
            const delegateSnapshot = await accountsRef.where('primaryOperator.taxId', '==', taxId).limit(1).get();

            if (delegateSnapshot.empty) {
                return res.status(404).json({ error: 'Identity record not found' });
            }

            // Sync User Doc on the fly
            const accountDoc = delegateSnapshot.docs[0];
            const accData = accountDoc.data();
            const email = accData.primaryOperator.email;

            // Need the Auth UID
            const { auth } = await import('../config/firebase');
            const userRecord = await auth.getUserByEmail(email);
            userDocRef = db.collection('users').doc(userRecord.uid);

            memberships = [{
                accountId: accountDoc.id,
                role: 'ADMINISTRADOR OPERATIVO',
                type: 'BUSINESS',
                status: 'PENDING'
            }];

            await userDocRef.set({
                taxId,
                email,
                fullName: accData.primaryOperator.name,
                memberships,
                updatedAt: Date.now()
            });
            userData = { memberships }; // Mimic doc data for next steps
        } else {
            userDocRef = snapshot.docs[0].ref;
            userData = snapshot.docs[0].data();
            memberships = userData.memberships || [];
        }

        // 2. Find specific membership
        const mIndex = memberships.findIndex((m: any) => m.accountId === accountId);

        if (mIndex === -1) {
            return res.status(404).json({ error: 'Membership link not found' });
        }

        // 3. Hash and Store password
        // We store it inside the membership object for total isolation
        const passwordHash = hashPassword(password);
        memberships[mIndex].passwordHash = passwordHash;
        memberships[mIndex].activatedAt = new Date().toISOString();
        memberships[mIndex].status = 'ACTIVE'; // Move from PENDING to ACTIVE

        // 4. [NEW] Sync with Firebase Auth (Global Identity activation)
        // This ensures the user can login globally while having a specific hash for this account
        const userUid = userDocRef.id;
        console.log(`[AUTH-TUNNEL] Syncing password with Firebase Auth for UID: ${userUid}`);
        const { auth } = await import('../config/firebase');
        await auth.updateUser(userUid, {
            password: password,
            emailVerified: true
        });

        // 5. Update the User document
        await userDocRef.update({
            memberships: memberships,
            updatedAt: Date.now()
        });

        // 5. Update the Tenant/Request status if needed
        const tenantSnap = await db.collection('tenants').doc(accountId).get();
        if (tenantSnap.exists) {
            await tenantSnap.ref.update({
                status: 'ACTIVE',
                activatedAt: new Date().toISOString()
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Password established successfully. You can now log in.'
        });

    } catch (error) {
        console.error('[AUTH-TUNNEL] Setup Password Error:', error);
        return res.status(500).json({ error: 'Failed to establish security credentials' });
    }
};
