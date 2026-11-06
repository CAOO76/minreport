import { db } from '../src/config/firebase';

function assertSafeScriptEnvironment(): void {
    const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!isEmulator && process.env.CONFIRM_PRODUCTION_SCRIPT !== 'ACTUALIZAR') {
        console.error(
            '[ABORTADO] Lectura diagnóstica fuera del emulador bloqueada. Defina FIRESTORE_EMULATOR_HOST o establezca CONFIRM_PRODUCTION_SCRIPT=ACTUALIZAR.'
        );
        process.exit(1);
    }
}

assertSafeScriptEnvironment();

async function checkInvites(email: string): Promise<void> {
    const accountsSnap = await db
        .collection('accounts')
        .where('primaryOperator.email', '==', email)
        .get();

    if (accountsSnap.empty) {
        console.log('[CHECK-USER] Sin invitaciones pendientes.');
        return;
    }

    accountsSnap.forEach((doc) => {
        console.log(`[CHECK-USER] Invitación pendiente en cuenta: ${doc.id} (${doc.data().name || ''})`);
    });
}

async function checkUser(): Promise<void> {
    const targetEmail = (process.env.TARGET_USER_EMAIL || '').trim().toLowerCase();
    if (!targetEmail) {
        throw new Error('Defina TARGET_USER_EMAIL en el entorno para ejecutar la verificación diagnóstica.');
    }

    console.log(`[CHECK-USER] Buscando usuario ${targetEmail}...`);
    const snapshot = await db.collection('users').where('email', '==', targetEmail).get();

    if (snapshot.empty) {
        console.log('[CHECK-USER] Usuario no encontrado.');
        return;
    }

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const safeMemberships = Array.isArray(data.memberships)
            ? data.memberships.map(({ passwordHash: _ph, ...rest }: any) => rest)
            : [];
        console.log(`[CHECK-USER] UID: ${doc.id}`);
        console.log('[CHECK-USER] Membresías:', JSON.stringify(safeMemberships, null, 2));
        console.log('[CHECK-USER] Last Active Account:', data.lastActiveAccountId || null);
        await checkInvites(targetEmail);
    }
}

checkUser().catch((err) => {
    console.error('[CHECK-USER] Error:', err.message || err);
    process.exit(1);
});
