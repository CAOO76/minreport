#!/usr/bin/env ts-node
import { db } from './config/firebase';
import { hashPassword } from './utils/security';

async function main() {
    console.log('🔄 Conectando a FIREBASE usando config oficial...');
    const targetAccountId = 'hufKqx09hjhtlOMcTR1n';
    const newPassword = 'Minreport2025!';
    const newHash = hashPassword(newPassword);

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const memberships: any[] = data.memberships || [];
        const hasAccount = memberships.some(m => m.accountId === targetAccountId);

        if (hasAccount) {
            console.log(`👤 Actualizando UID: ${userDoc.id} (${data.email})`);

            const updatedMems = memberships.map(m => {
                if (m.accountId === targetAccountId) {
                    return { ...m, passwordHash: newHash, status: 'ACTIVE', resetAt: new Date().toISOString() };
                }
                return m;
            });
            await userDoc.ref.update({ memberships: updatedMems });
            console.log(`✅ Contraseña de ${data.email} reseteada a: ${newPassword}`);
        }
    }
}

main().catch(console.error);
