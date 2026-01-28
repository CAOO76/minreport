
import admin from '../src/config/firebase'; // Asegúrate de que este path resuelva al admin SDK inicializado
import { env } from '../src/config/env';

const fixAdminClaims = async () => {
    const adminEmail = env.SUPER_ADMIN_EMAIL || 'admin@minreport.com';
    console.log(`🔍 Buscando usuario admin: ${adminEmail}`);

    try {
        const user = await admin.auth().getUserByEmail(adminEmail);
        console.log(`✅ Usuario encontrado: ${user.uid}`);

        console.log('🔄 Asignando claim { role: "SUPER_ADMIN" }...');
        await admin.auth().setCustomUserClaims(user.uid, { role: 'SUPER_ADMIN' });

        // Verificar
        const updatedUser = await admin.auth().getUser(user.uid);
        console.log('📋 Claims actuales:', updatedUser.customClaims);

        console.log('🎉 ¡LISTO! Por favor cierra sesión y vuelve a entrar en el panel admin.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixAdminClaims();
