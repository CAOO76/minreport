import { FullConfig } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createAuthFile } from './create-auth-state'; // Moved to top

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMULATORS_DATA_DIR = path.resolve(__dirname, '../../firebase-emulators-data');
const AUTH_FILE = path.resolve(__dirname, 'auth.json');

const EMULATOR_PORTS = [4001, 9190, 8085, 5010, 9195, 4400, 4500]; // Puertos comunes de emuladores

let emulatorsProcess: ChildProcess | null = null;

async function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const command = `lsof -t -i :${port}`;
    spawn(command, { shell: true, stdio: 'pipe' }).stdout?.on('data', (data) => {
      const pid = data.toString().trim();
      if (pid) {
        console.log(`[Global Setup] Matando proceso ${pid} en puerto ${port}...`);
        try {
          process.kill(parseInt(pid, 10));
        } catch (e) {
          console.warn(`[Global Setup] No se pudo matar el proceso ${pid}: ${e}`);
        }
      }
    }).on('close', () => resolve());
  });
}

async function globalSetup(config: FullConfig) {
  console.log('\n[Global Setup] Iniciando setup global de Playwright...');

  // 0. Asegurar que los puertos estén libres
  console.log('[Global Setup] Verificando y liberando puertos de emuladores...');
  await Promise.all(EMULATOR_PORTS.map(killProcessOnPort));
  await new Promise(resolve => setTimeout(resolve, 1000)); // Pequeña espera para que los puertos se liberen completamente

  // 1. Limpiar datos de emuladores anteriores
  console.log('[Global Setup] Limpiando datos de emuladores...');
  if (fs.existsSync(EMULATORS_DATA_DIR)) {
    fs.rmSync(EMULATORS_DATA_DIR, { recursive: true, force: true });
  }

  // 2. Iniciar emuladores de Firebase
  console.log('[Global Setup] Iniciando emuladores de Firebase...');
  emulatorsProcess = spawn('pnpm', ['emulators:start'], {
    stdio: 'pipe',
    cwd: path.resolve(__dirname, '../../'), // Root of the monorepo
  });

  // Esperar a que los emuladores estén listos
  await new Promise<void>((resolve, reject) => {
    if (!emulatorsProcess) return reject(new Error('Emulators process not started.'));
    emulatorsProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`[Emulators] ${output.trim()}`);
      if (output.includes('All emulators ready!')) {
        emulatorsProcess.stdout?.removeAllListeners('data');
        emulatorsProcess.stderr?.removeAllListeners('data');
        resolve();
      }
    });
    emulatorsProcess.stderr?.on('data', (data) => {
      console.error(`[Emulators ERROR] ${data.toString().trim()}`);
    });
  });
  console.log('[Global Setup] Emuladores de Firebase listos.');

  // 3. Sembrar la base de datos
  console.log('[Global Setup] Sembrando la base de datos...');
  const seedProcess = spawn('pnpm', ['db:seed'], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../../'), // Root of the monorepo
  });

  await new Promise<void>((resolve, reject) => {
    seedProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[Global Setup] Base de datos sembrada con éxito.');
        resolve();
      } else {
        reject(new Error(`Seed process exited with code ${code}`));
      }
    });
  });

  // 4. Generar el archivo de estado de autenticación (auth.json)
  console.log('[Global Setup] Generando archivo de autenticación...');
  try {
    await createAuthFile();
    console.log('[Global Setup] Archivo de autenticación creado con éxito.');
  } catch (error: any) {
    console.error('[Global Setup ERROR] Falló la generación del archivo de autenticación:', error.message);
    throw error; // Re-lanzar el error para que Playwright lo capture
  }

  console.log('[Global Setup] Setup global completado. Iniciando pruebas...');
}

export default globalSetup;

// Función para detener los procesos en globalTeardown
export async function globalTeardown() {
  console.log('\n[Global Teardown] Deteniendo procesos...');
  if (emulatorsProcess) {
    emulatorsProcess.kill();
    console.log('[Global Teardown] Emuladores detenidos.');
  }
  // Asegurarse de que los emuladores exporten los datos al cerrar
  // Esto ya lo maneja el script emulators:start con --export-on-exit
  console.log('[Global Teardown] Teardown global completado.');
}