import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app'; // Assuming firebase app is initialized elsewhere

// TODO: Fetch plugin base URLs from Firestore 'plugins' collection
// For now, use a mock or configuration
const PLUGIN_BASE_URLS: { [id: string]: string } = {
  'test-plugin': 'http://localhost:5177', // Example for local development
  // Add other plugin URLs here
};

export const getSecurePluginUrl = async (pluginId: string, idToken: string): Promise<string> => {
  console.log(`[Núcleo] Solicitando ticket de carga para el plugin: ${pluginId}`);

  const app = getApp(); // Get the initialized Firebase app
  const functions = getFunctions(app, 'southamerica-west1'); // Specify region

  const generateTokenCallable = httpsCallable<{ pluginId: string }, { ticket: string }>(functions, 'generatePluginLoadToken');

  try {
    const result = await generateTokenCallable({ pluginId });
    const { ticket } = result.data;

    const baseUrl = PLUGIN_BASE_URLS[pluginId];
    if (!baseUrl) {
      throw new Error(`URL base para el plugin "${pluginId}" no encontrada en la configuración.`);
    }

    console.log(`[Núcleo] Ticket de carga obtenido para ${pluginId}.`);
    return `${baseUrl}?ticket=${ticket}`;
  } catch (error: any) {
    console.error(`[Núcleo] Error al obtener el ticket de carga para el plugin ${pluginId}:`, error);
    throw new Error(`No se pudo obtener la URL segura para el plugin: ${error.message}`);
  }
};
