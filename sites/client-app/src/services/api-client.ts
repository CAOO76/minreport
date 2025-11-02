/**
 * API Client para desarrollo y producción
 * En desarrollo, usa fetch directo al emulador
 * En producción, usa httpsCallable
 */

import { functions } from '../firebaseConfig';
import { httpsCallable } from 'firebase/functions';

/**
 * Llamar función Firebase con manejo automático de CORS
 */
export async function callFunction<T = any, R = any>(
  functionName: string,
  data: T
): Promise<R> {
  // En desarrollo, usar proxy local que evita problemas de CORS
  const isDev = import.meta.env.DEV;
  
  if (isDev) {
    console.log(`🔄 [DEV] Llamando función via proxy: ${functionName}`);
    const proxyUrl = `http://localhost:3001/call/${functionName}`;
    
    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ Resultado de ${functionName}:`, result);
      return result;
    } catch (error) {
      console.error(`❌ Error en proxy para ${functionName}:`, error);
      throw error;
    }
  } else {
    // En producción, usar httpsCallable
    console.log(`🔄 [PROD] Llamando función: ${functionName}`);
    try {
      const callable = httpsCallable<T, R>(functions, functionName);
      const result = await callable(data);
      console.log(`✅ Resultado de ${functionName}:`, result);
      return result.data;
    } catch (error) {
      console.error(`❌ Error llamando ${functionName}:`, error);
      throw error;
    }
  }
}

/**
 * Registrar solicitud inicial
 */
export async function registerInitialRequest(data: {
  applicantName: string;
  applicantEmail: string;
  accountType: string;
}) {
  // Mapear al formato que espera validateEmailAndStartProcess
  return callFunction('validateEmailAndStartProcess', {
    name: data.applicantName,
    email: data.applicantEmail,
    accountType: data.accountType,
  });
}

/**
 * Enviar datos completos
 */
export async function submitCompleteData(data: any) {
  return callFunction('submitCompleteData', data);
}

/**
 * Procesar acción de solicitud
 */
export async function processRequestAction(data: {
  requestId: string;
  action: string;
  decision?: string;
}) {
  return callFunction('processRequestAction', data);
}

/**
 * Importar resultado de email
 */
export async function importEmailResult(data: any) {
  return callFunction('importEmailResult', data);
}
