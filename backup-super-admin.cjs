// Script para hacer backup del super admin de forma manual
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

async function backupSuperAdmin() {
  try {
    console.log('💾 Haciendo backup del super admin...');
    
    // Buscar usuario admin
    const userRecord = await admin.auth().getUserByEmail('app_dev@minreport.com');
    
    // Buscar datos en Firestore
    const adminDoc = await admin.firestore().collection('admins').doc(userRecord.uid).get();
    
    const backupData = {
      userRecord: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        customClaims: userRecord.customClaims
      },
      adminData: adminDoc.exists ? adminDoc.data() : null,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync('./super-admin-backup.json', JSON.stringify(backupData, null, 2));
    console.log('✅ Backup del super admin guardado');
    
  } catch (error) {
    console.log('⚠️ No se pudo hacer backup del super admin:', error.message);
  }
}

backupSuperAdmin();