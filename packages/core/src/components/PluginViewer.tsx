import React, { useEffect, useRef, useState } from 'react';
import { getSecurePluginUrl } from '../utils/plugin-loader';

// --- Tipos y Interfaces ---
type Theme = { [key: string]: string };
type Claims = { [key: string]: any };

interface SerializableUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface PluginViewerProps {
  pluginId: string;
  user: SerializableUser;
  claims: Claims;
  idToken: string;
  theme: Theme;
  // Función para proxy de acciones, será implementada por la app anfitriona
  onActionProxy: (action: string, data: any) => Promise<any>;
}



// --- Componente Principal ---
export const PluginViewer: React.FC<PluginViewerProps> = ({
  pluginId,
  user,
  claims,
  idToken,
  theme,
  onActionProxy,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [secureSrc, setSecureSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Obtener la URL segura con el ticket de carga
  useEffect(() => {
    getSecurePluginUrl(pluginId, idToken)
      .then(setSecureSrc)
      .catch(err => {
        console.error(err);
        setError('No se pudo obtener la URL segura para el plugin.');
      })
      .finally(() => setIsLoading(false));
  }, [pluginId, idToken]);

  // 2. Enviar contexto al plugin una vez que el iframe cargue
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      if (iframe.contentWindow && secureSrc) {
        console.log(`[Núcleo] Iframe cargado. Enviando contexto inicial al plugin: ${pluginId}`);
        iframe.contentWindow.postMessage(
          {
            type: 'MINREPORT_INIT',
            payload: { user, claims, idToken, theme },
          },
          new URL(secureSrc).origin
        );
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [secureSrc, user, claims, idToken, theme, pluginId]);

  // 3. Escuchar y procesar acciones solicitadas por el plugin
  useEffect(() => {
    if (!secureSrc) return;

    const handlePluginMessage = async (event: MessageEvent) => {
      // Validar origen y tipo de mensaje
      if (event.origin !== new URL(secureSrc).origin) return;
      if (event.data?.type !== 'MINREPORT_ACTION') return;

      const { action, data, correlationId } = event.data.payload;
      console.log(`[Núcleo] Acción recibida del plugin: ${action}`, { data, correlationId });

      try {
        const result = await onActionProxy(action, data);
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'MINREPORT_RESPONSE',
            payload: { result, correlationId },
          },
          new URL(secureSrc).origin
        );
      } catch (err: any) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'MINREPORT_RESPONSE',
            payload: { error: err.message || 'Error desconocido', correlationId },
          },
          new URL(secureSrc).origin
        );
      }
    };

    window.addEventListener('message', handlePluginMessage);
    return () => window.removeEventListener('message', handlePluginMessage);
  }, [secureSrc, onActionProxy]);

  // --- Renderizado ---
  if (isLoading) {
    return <div>Cargando plugin...</div>;
  }

  if (error) {
    return <div>Error al cargar el plugin: {error}</div>;
  }

  return (
    <iframe
      ref={iframeRef}
      src={secureSrc || ''}
      title={`Plugin: ${pluginId}`}
      className="plugin-iframe" // Asume que una clase CSS le dará tamaño
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
};
