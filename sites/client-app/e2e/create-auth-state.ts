import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { chromium } from 'playwright';

// Asegúrate de que estas variables estén definidas o importadas correctamente
const projectId = process.env.FIREBASE_PROJECT_ID || 'minreport-dev'; // Usar variable de entorno o un valor por defecto
const TEST_USER_UID = process.env.TEST_USER_UID || 'test-user-uid'; // Usar variable de entorno o un valor por defecto
const authFile = './e2e/auth.json';
const firebaseClientConfig = {
  apiKey: process.env.FIREBASE_CLIENT_API_KEY,
  authDomain: process.env.FIREBASE_CLIENT_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_CLIENT_PROJECT_ID,
  storageBucket: process.env.FIREBASE_CLIENT_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_CLIENT_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_CLIENT_APP_ID,
};

export async function createAuthFile() {
  let browser;
  let app;

  // Configurar el emulador de autenticación para el Admin SDK
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';
  }

  try {
    if (!admin.apps || admin.apps.length === 0) {
      app = admin.default.initializeApp({ projectId });
    } else {
      app = admin.apps[0]; // Obtener la aplicación ya inicializada
    }

    const customToken = await app.auth().createCustomToken(TEST_USER_UID);
    console.log('✔️ Token personalizado generado.');

    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.addScriptTag({ url: 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js' });
    await page.addScriptTag({ url: 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js' });

    await page.evaluate(async (args) => {
      const { customToken, firebaseClientConfig } = args;

      const waitForFirebase = () => new Promise(resolve => {
        if (typeof window.firebase !== 'undefined') {
          resolve(window.firebase);
        } else {
          const interval = setInterval(() => {
            if (typeof window.firebase !== 'undefined') {
              clearInterval(interval);
              resolve(window.firebase);
            }
          }, 100);
        }
      });

      await waitForFirebase();

      const app = window.firebase.initializeApp(firebaseClientConfig);
      const auth = app.auth();
      auth.useEmulator('http://127.0.0.1:9190');
      console.log('Attempting signInWithCustomToken...');
      await auth.signInWithCustomToken(customToken);
      console.log('signInWithCustomToken completed.');
    }, { customToken, firebaseClientConfig, timeout: 60000 });

    const storageState = await page.context().storageState();

    fs.writeFileSync(authFile, JSON.stringify(storageState, null, 2));
    console.log(`✔️ Archivo de autenticación creado en: ${authFile}`);

  } catch (e: any) {
    console.error('❌ Error creando el archivo de autenticación:', e.message || e);
    throw e;
  } finally {
    if (browser) {
      console.log('✔️ Cerrando navegador...');
      await browser.close();
      console.log('✔️ Navegador cerrado.');
    }
  }
}