import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';

const PLUGIN_BASE_URLS: { [id: string]: string } = {
  'test-plugin': 'http://localhost:5177',
};

export const getSecurePluginUrl = async (pluginId: string, idToken: string): Promise<string> => {
  const app = getApp();
  const functions = getFunctions(app, 'southamerica-west1');
  const generateTokenCallable = httpsCallable<{ pluginId: string }, { ticket: string }>(functions, 'generatePluginLoadToken');
  const result = await generateTokenCallable({ pluginId });
  const { ticket } = result.data;
  const baseUrl = PLUGIN_BASE_URLS[pluginId];
  if (!baseUrl) throw new Error(`URL base para el plugin "${pluginId}" no encontrada en la configuración.`);
  return `${baseUrl}?ticket=${ticket}`;
};
