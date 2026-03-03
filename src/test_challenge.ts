#!/usr/bin/env ts-node
// Simula el nuevo flujo de challenge para verificar la resolución de identidad
import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'minreport-8f2a8' });
const db = admin.firestore();

function getRutVariants(rawTaxId: string): string[] {
    const variants = new Set<string>();
    const clean = rawTaxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    variants.add(clean);
    if (clean.length >= 2) {
        const body = clean.slice(0, -1);
        const dv = clean.slice(-1);
        variants.add(`${body}-${dv}`);
        const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
        variants.add(formatted);
    }
    variants.add(rawTaxId.trim().toUpperCase());
    return Array.from(variants);
}

async function simulateChallenge(taxId: string, accountId: string) {
    console.log(`\n🔐 Simulando challenge: taxId="${taxId}", accountId="${accountId}"`);
    const variants = getRutVariants(taxId);
    console.log(`   Variantes generadas: ${JSON.stringify(variants)}`);

    let authEmail: string | null = null;
    for (const variant of variants) {
        const snap = await db.collection('user_directory').doc(variant).get();
        if (snap.exists) {
            const data = snap.data();
            const entry = (data?.accounts || []).find((a: any) => a.accountId === accountId);
            if (entry) {
                authEmail = entry.authEmail;
                console.log(`   ✅ Encontrado en user_directory["${variant}"] → email: ${authEmail}`);
                break;
            } else {
                console.log(`   ⚠️  user_directory["${variant}"] existe pero con cuentas: ${JSON.stringify((data?.accounts || []).map((a: any) => a.accountId))}`);
            }
        } else {
            console.log(`   ❌ user_directory["${variant}"] — no existe`);
        }
    }

    if (!authEmail) {
        console.log(`   🔁 Fallback: buscando en /users por taxId...`);
        const snap = await db.collection('users').where('taxId', 'in', variants).limit(1).get();
        if (!snap.empty) {
            authEmail = snap.docs[0].data().email;
            console.log(`   ✅ Encontrado en /users por taxId → email: ${authEmail}`);
        } else {
            console.log(`   ❌ No encontrado en /users tampoco`);
        }
    }

    if (authEmail) {
        const usersSnap = await db.collection('users').where('email', '==', authEmail).limit(1).get();
        if (!usersSnap.empty) {
            const userData = usersSnap.docs[0].data();
            const mems = (userData.memberships || []).filter((m: any) => m.accountId === accountId);
            const best = mems.find((m: any) => !!m.passwordHash) || mems[0];
            if (best) {
                console.log(`   ✅ Membership encontrado: role=${best.role}, passwordHash=${best.passwordHash ? 'PRESENTE' : 'AUSENTE'}`);
            } else {
                console.log(`   ❌ No tiene membership para accountId: ${accountId}`);
                console.log(`      memberships disponibles: ${JSON.stringify((userData.memberships || []).map((m: any) => m.accountId))}`);
            }
        }
    }
}

async function run() {
    // Probar con el RUT de la empresa (como lo vería el flujo)
    await simulateChallenge('77.609.112-K', 'hufKqx09hjhtlOMcTR1n');
    await simulateChallenge('77609112K', 'hufKqx09hjhtlOMcTR1n');
    await simulateChallenge('77609112-K', 'hufKqx09hjhtlOMcTR1n');
    // Probar con el RUN personal (admin designado)
    await simulateChallenge('130110142', 'hufKqx09hjhtlOMcTR1n');
    console.log('\n✅ Simulación completada');
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
