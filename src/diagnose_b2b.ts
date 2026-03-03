#!/usr/bin/env ts-node
// Diagnóstico directo de cuentas B2B en los emuladores
// Usar con: npx ts-node src/diagnose_b2b.ts

import admin from 'firebase-admin';

const app = admin.initializeApp({
    projectId: 'minreport-8f2a8'
});

const db = admin.firestore();

async function diagnose() {
    console.log('\n==============================');
    console.log('🔍 DIAGNÓSTICO B2B EMULADORES');
    console.log('==============================\n');

    // 1. Listar todas las cuentas B2B
    console.log('📁 Colección /accounts (tipo ENTERPRISE/BUSINESS):');
    const accountsSnap = await db.collection('accounts').get();
    const b2bAccounts: any[] = [];
    accountsSnap.forEach(d => {
        const data = d.data();
        if (['ENTERPRISE', 'BUSINESS'].includes(data.type)) {
            b2bAccounts.push({ id: d.id, ...data });
            console.log(`  ✅ ID: ${d.id}`);
            console.log(`     name: ${data.name}`);
            console.log(`     type: ${data.type}`);
            console.log(`     taxId: ${data.taxId}`);
            console.log(`     ownerId: ${data.ownerId}`);
            console.log(`     status: ${data.status || 'N/A'}`);
        }
    });

    if (b2bAccounts.length === 0) {
        console.log('  ❌ No hay cuentas B2B activas');
    }

    // 2. Listar user_directory entries que tienen cuentas B2B
    console.log('\n📁 Colección /user_directory (cuentas B2B):');
    const dirSnap = await db.collection('user_directory').get();
    dirSnap.forEach(d => {
        const data = d.data();
        const b2bAccs = (data.accounts || []).filter((a: any) => ['ENTERPRISE', 'BUSINESS'].includes(a.type));
        if (b2bAccs.length > 0) {
            console.log(`  ID (RUT/RUN): ${d.id}`);
            b2bAccs.forEach((a: any) => {
                console.log(`    📂 accountId: ${a.accountId} | role: ${a.role} | status: ${a.status} | email: ${a.authEmail}`);
            });
        }
    });

    // 3. Verificar /users con memberships B2B
    console.log('\n📁 Colección /users (memberships B2B):');
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(d => {
        const data = d.data();
        const memberships = data.memberships || [];
        const b2bMems = memberships.filter((m: any) => b2bAccounts.some(a => a.id === m.accountId));
        if (b2bMems.length > 0) {
            console.log(`  UID: ${d.id} | email: ${data.email} | taxId: ${data.taxId}`);
            b2bMems.forEach((m: any) => {
                console.log(`    📋 accountId: ${m.accountId}`);
                console.log(`       role: ${m.role}`);
                console.log(`       status: ${m.status || 'N/A'}`);
                console.log(`       passwordHash: ${m.passwordHash ? '✅ PRESENTE' : '❌ AUSENTE'}`);
            });
        }
    });

    // 4. Verificar members subcollection
    console.log('\n📁 Subcolección /accounts/{id}/members:');
    for (const acc of b2bAccounts) {
        const membersSnap = await db.collection(`accounts/${acc.id}/members`).get();
        if (membersSnap.empty) {
            console.log(`  ❌ ${acc.id} (${acc.name}): SIN MIEMBROS REGISTRADOS`);
        } else {
            console.log(`  Cuenta: ${acc.id} (${acc.name}):`);
            membersSnap.forEach(m => {
                const md = m.data();
                console.log(`    👤 UID: ${m.id} | run: ${md.run} | role: ${md.role} | status: ${md.status}`);
            });
        }
    }

    console.log('\n✅ Diagnóstico completado');
}

diagnose().catch(e => {
    console.error('❌ Error de diagnóstico:', e.message);
    process.exit(1);
});
