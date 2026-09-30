#!/usr/bin/env ts-node
// Diagnóstico del hash de contraseña almacenado y reset directo por superadmin
// Uso: FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx ts-node src/check_hash.ts [nueva_clave]

import admin from 'firebase-admin';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

admin.initializeApp({ projectId: 'minreport-8f2a8' });
const db = admin.firestore();

const ITERATIONS = 100000;
const KEY_LEN = 64;
const DIGEST = 'sha512';

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;
    const hashToVerify = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    const originalBuffer = Buffer.from(originalHash, 'hex');
    const verifyBuffer = Buffer.from(hashToVerify, 'hex');
    if (originalBuffer.length !== verifyBuffer.length) return false;
    return timingSafeEqual(originalBuffer, verifyBuffer);
}

async function main() {
    const newPassword = process.argv[2]; // Opcional: nueva clave para resetear
    const targetAccountId = 'hufKqx09hjhtlOMcTR1n';

    console.log('\n==============================');
    console.log('🔑 DIAGNÓSTICO DE CONTRASEÑAS');
    console.log('==============================\n');

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const memberships: any[] = data.memberships || [];
        const targetMems = memberships.filter(m => m.accountId === targetAccountId && m.passwordHash);

        if (targetMems.length === 0) continue;

        console.log(`👤 UID: ${userDoc.id}`);
        console.log(`   Email: ${data.email}`);
        console.log(`   TaxId: ${data.taxId}`);

        for (const mem of targetMems) {
            console.log(`\n   Membership: role=${mem.role}, status=${mem.status}`);
            console.log(`   Hash formato: ${mem.passwordHash ? mem.passwordHash.substring(0, 40) + '...' : 'AUSENTE'}`);

            const hashParts = mem.passwordHash?.split(':');
            if (hashParts) {
                console.log(`   Salt (hex): ${hashParts[0]?.length} chars`);
                console.log(`   Hash (hex): ${hashParts[1]?.length} chars`);
            }

            // Probar claves comunes de desarrollo
            const testPasswords = ['minreport2024!', 'Minreport2024!', 'minreport_2024', 'test1234', 'Admin123!', 'admin123'];
            for (const testPass of testPasswords) {
                if (verifyPassword(testPass, mem.passwordHash)) {
                    console.log(`   ✅ CLAVE ENCONTRADA: "${testPass}"`);
                }
            }
        }

        if (newPassword) {
            console.log(`\n   🔄 Reseteando contraseña a: "${newPassword}"`);
            const newHash = hashPassword(newPassword);
            const updatedMems = memberships.map(m => {
                if (m.accountId === targetAccountId) {
                    return { ...m, passwordHash: newHash, status: 'ACTIVE', resetAt: new Date().toISOString() };
                }
                return m;
            });
            await userDoc.ref.update({ memberships: updatedMems });
            console.log(`   ✅ Contraseña actualizada correctamente.`);

            // Verificar el nuevo hash
            if (verifyPassword(newPassword, newHash)) {
                console.log(`   ✅ Verificación del nuevo hash: OK`);
            } else {
                console.log(`   ❌ El nuevo hash NO verifica correctamente`);
            }
        }
    }

    console.log('\n✅ Diagnóstico completado');
    if (!newPassword) {
        console.log('\n💡 Para resetear la contraseña, ejecuta:');
        console.log('   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9190 /usr/local/bin/node node_modules/.bin/ts-node src/check_hash.ts "nueva_clave"');
    }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
