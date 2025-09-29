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
  onActionProxy: (action: string, data: any) => Promise<any>;
}

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

  useEffect(() => {
    getSecurePluginUrl(pluginId, idToken)
      .then(setSecureSrc)
      .catch(err => {
        console.error(err);
        setError('No se pudo obtener la URL segura para el plugin.');
      })
      .finally(() => setIsLoading(false));
  }, [pluginId, idToken]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      if (iframe.contentWindow && secureSrc) {
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

  useEffect(() => {
    if (!secureSrc) return;
    const handlePluginMessage = async (event: MessageEvent) => {
      if (event.origin !== new URL(secureSrc).origin) return;
      if (event.data?.type !== 'MINREPORT_ACTION') return;
      const { action, data, correlationId } = event.data.payload;
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
      className="plugin-iframe"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
};
