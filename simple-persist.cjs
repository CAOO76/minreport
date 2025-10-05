// SOLUCIÓN DEFINITIVA - Datos persistentes en archivo local JSON
const fs = require('fs');
const admin = require('firebase-admin');

const DATA_FILE = './persistent-data.json';

// Inicializar con projectId correcto
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'minreport-8f2a8'
  });
}

async function saveDataToFile() {
  try {
    console.log('💾 Guardando datos en archivo local...');
    
    // Obtener datos del emulador
    const listUsers = await admin.auth().listUsers();
    const users = listUsers.users.map(user => ({
      uid: user.uid,
      email: user.email,
      customClaims: user.customClaims,
      emailVerified: user.emailVerified
    }));

    // Obtener datos de Firestore
    const adminsSnapshot = await admin.firestore().collection('admins').get();
    const adminDocs = [];
    adminsSnapshot.forEach(doc => {
      adminDocs.push({ id: doc.id, data: doc.data() });
    });

    const data = {
      timestamp: new Date().toISOString(),
      users: users,
      adminDocs: adminDocs
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Datos guardados en ${DATA_FILE}`);
    
  } catch (error) {
    console.log('⚠️ Error guardando datos:', error.message);
  }
}

async function loadDataFromFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log('ℹ️ No hay archivo de datos para cargar');
      return;
    }

    console.log('🔄 Cargando datos desde archivo local...');
    
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    
    // Restaurar usuarios
    for (const user of data.users) {
      try {
        await admin.auth().createUser({
          uid: user.uid,
          email: user.email,
          password: 'password-seguro-local',
          emailVerified: user.emailVerified
        });
        
        if (user.customClaims) {
          await admin.auth().setCustomUserClaims(user.uid, user.customClaims);
        }
      } catch (error) {
        if (error.code !== 'auth/uid-already-exists') {
          console.log(`⚠️ Error creando usuario ${user.email}:`, error.message);
        }
      }
    }

    // Restaurar documentos de Firestore
    for (const doc of data.adminDocs) {
      try {
        await admin.firestore().collection('admins').doc(doc.id).set(doc.data);
      } catch (error) {
        console.log(`⚠️ Error restaurando doc ${doc.id}:`, error.message);
      }
    }

    console.log('✅ Datos restaurados exitosamente');
    console.log(`📧 Super admin: app_dev@minreport.com`);
    console.log(`🔐 Password: password-seguro-local`);
    
  } catch (error) {
    console.log('⚠️ Error cargando datos:', error.message);
  }
}

// Determinar acción basada en argumentos
const action = process.argv[2];

if (action === 'save') {
  saveDataToFile();
} else if (action === 'load') {
  loadDataFromFile();
} else {
  console.log('Uso: node simple-persist.cjs [save|load]');
  console.log('  save - Guardar datos del emulador a archivo');
  console.log('  load - Cargar datos del archivo al emulador');
}