// Script para restaurar el super admin de forma manual
const admin = require('firebase-admin');
const fs = require('fs');

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log('❌ Este script debe ejecutarse contra el emulador de Firebase');
  process.exit(1);
}

// Inicializar Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'minreport-8f2a8'
  });
}

async function restoreSuperAdmin() {
  try {
    if (!fs.existsSync('./super-admin-backup.json')) {
      console.log('ℹ️ No hay backup del super admin para restaurar');
      return;
    }
    
    console.log('🔄 Restaurando super admin...');
    
    const backupData = JSON.parse(fs.readFileSync('./super-admin-backup.json', 'utf8'));
    
    // Crear usuario
    const userRecord = await admin.auth().createUser({
      uid: backupData.userRecord.uid,
      email: backupData.userRecord.email,
      password: 'password-seguro-local',
      emailVerified: true
    });
    
    // Asignar claims personalizados
    if (backupData.userRecord.customClaims) {
      await admin.auth().setCustomUserClaims(userRecord.uid, backupData.userRecord.customClaims);
    }
    
    // Restaurar datos en Firestore
    if (backupData.adminData) {
      await admin.firestore().collection('admins').doc(userRecord.uid).set(backupData.adminData);
    }
    
    console.log('✅ Super admin restaurado exitosamente');
    console.log(`📧 Email: ${userRecord.email}`);
    console.log('🔐 Password: password-seguro-local');
    
  } catch (error) {
    if (error.code === 'auth/uid-already-exists') {
      console.log('ℹ️ Super admin ya existe, saltando restauración');
    } else {
      console.log('⚠️ Error restaurando super admin:', error.message);
    }
  }
}

restoreSuperAdmin();