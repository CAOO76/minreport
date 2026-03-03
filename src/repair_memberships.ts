#!/usr/bin/env ts-node
// Script para limpiar memberships duplicados en el emulador
// Ejecutar con: FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx ts-node src/repair_memberships.ts

import admin from 'firebase-admin';

const app = admin.initializeApp({
    projectId: 'minreport-8f2a8'
});

const db = admin.firestore();

async function repairMemberships() {
    console.log('\n==================================');
    console.log('🔧 REPARANDO MEMBERSHIPS DUPLICADOS');
    console.log('==================================\n');

    const usersSnap = await db.collection('users').get();
    let repairsCount = 0;

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const memberships: any[] = data.memberships || [];

        if (memberships.length === 0) continue;

        // Agrupar memberships por accountId
        const grouped = new Map<string, any[]>();
        memberships.forEach(m => {
            if (!grouped.has(m.accountId)) {
                grouped.set(m.accountId, []);
            }
            grouped.get(m.accountId)!.push(m);
        });

        // Verificar si hay duplicados
        let hasDuplicates = false;
        grouped.forEach((mems, accountId) => {
            if (mems.length > 1) {
                hasDuplicates = true;
                console.log(`⚠️  Usuario ${userDoc.id} tiene ${mems.length} memberships para accountId ${accountId}`);
            }
        });

        if (!hasDuplicates) continue;

        // Reparar: For each accountId, keep the best membership
        const repairedMemberships: any[] = [];
        grouped.forEach((mems, accountId) => {
            if (mems.length === 1) {
                repairedMemberships.push(mems[0]);
                return;
            }
            // Priority: keep the one with passwordHash
            const withHash = mems.find(m => !!m.passwordHash);
            if (withHash) {
                console.log(`  → Keeping membership con hash para ${accountId} (role: ${withHash.role})`);
                repairedMemberships.push(withHash);
            } else {
                // Keep the latest or most specific one (BILLING_ONLY > OWNER > ADMIN)
                const priority = ['BILLING_ONLY', 'OWNER', 'ADMIN', 'OPERATOR'];
                const sorted = [...mems].sort((a, b) => {
                    const ai = priority.indexOf(a.role);
                    const bi = priority.indexOf(b.role);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                });
                console.log(`  → Keeping membership sin hash para ${accountId} (role: ${sorted[0].role})`);
                repairedMemberships.push(sorted[0]);
            }
        });

        console.log(`✅ Reparando usuario ${userDoc.id}: ${memberships.length} → ${repairedMemberships.length} memberships`);
        await userDoc.ref.update({ memberships: repairedMemberships });
        repairsCount++;
    }

    if (repairsCount === 0) {
        console.log('✅ No se encontraron duplicados en el emulador.');
    } else {
        console.log(`\n✅ Reparados ${repairsCount} documentos de usuario.`);
    }
}

repairMemberships().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
