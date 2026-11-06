#!/usr/bin/env ts-node
import { FieldValue } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import { db } from '../../src/config/firebase';
import { hashPassword } from '../../src/utils/security';

dotenv.config();

function assertSafeScriptEnvironment(): void {
    const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!isEmulator && process.env.CONFIRM_PRODUCTION_SCRIPT !== 'ACTUALIZAR') {
        console.error(
            '[ABORTADO] Mutación fuera del Firestore Emulator bloqueada. Defina FIRESTORE_EMULATOR_HOST o establezca CONFIRM_PRODUCTION_SCRIPT=ACTUALIZAR.'
        );
        process.exit(1);
    }
}

assertSafeScriptEnvironment();

async function main(): Promise<void> {
    const targetAccountId = (process.env.TARGET_ACCOUNT_ID || '').trim();
    const newPassword = (process.env.NEW_ACCOUNT_PASSWORD || '').trim();

    if (!targetAccountId || !newPassword || newPassword.length < 10) {
        throw new Error(
            'Variables de entorno TARGET_ACCOUNT_ID y NEW_ACCOUNT_PASSWORD (mínimo 10 caracteres) requeridas. Cero contraseñas hardcodeadas.'
        );
    }

    const newHash = hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    const usersSnap = await db.collection('users').get();

    let updatedCount = 0;

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const memberships: any[] = Array.isArray(data.memberships) ? data.memberships : [];
        const hasAccount = memberships.some((m) => m.accountId === targetAccountId);

        if (hasAccount) {
            const uid = userDoc.id;

            // Almacenar hash exclusivamente en colección privada de servidor user_auth_credentials/{uid}
            await db
                .collection('user_auth_credentials')
                .doc(uid)
                .set(
                    {
                        uid,
                        email: data.email || null,
                        accounts: {
                            [targetAccountId]: {
                                passwordHash: newHash,
                                updatedAt: nowIso,
                            },
                        },
                        updatedAt: FieldValue.serverTimestamp(),
                    },
                    { merge: true }
                );

            // Purgar cualquier passwordHash heredado dentro de /users/{uid}.memberships
            const sanitizedMems = memberships.map(({ passwordHash: _ph, ...rest }) =>
                rest.accountId === targetAccountId
                    ? { ...rest, status: 'ACTIVE', resetAt: nowIso }
                    : rest
            );

            await userDoc.ref.update({ memberships: sanitizedMems });
            updatedCount++;
            console.log(`[RESET-PW] Credencial actualizada en user_auth_credentials para UID: ${uid} (secreto omitido de consola).`);
        }
    }

    console.log(`[RESET-PW] Proceso completado. Usuarios actualizados: ${updatedCount}.`);
}

main().catch((err) => {
    console.error('[RESET-PW] Error:', err.message || err);
    process.exit(1);
});
