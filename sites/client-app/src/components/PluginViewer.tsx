
import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useAuth from '@minreport/core/hooks/useAuth';
import { auth } from '../firebaseConfig';
import './PluginViewer.css';

interface PluginViewerProps {
  activePlugins: string[] | null;
}

// TODO: Esto debería venir de una configuración central
const PLUGIN_URLS: Record<string, string> = {
  'test-plugin': 'http://127.0.0.1:5017' // Apuntar al emulador de hosting
};

const PluginViewer: React.FC<PluginViewerProps> = ({ activePlugins }) => {
  const { pluginId } = useParams<{ pluginId: string }>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { user, claims } = useAuth(auth);

  const pluginSrc = pluginId ? PLUGIN_URLS[pluginId] : undefined;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !pluginSrc || !user) return;

    const handleLoad = () => {
      if (iframe.contentWindow) {
        const serializableUser = user ? {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerified,
        } : null;

        console.log('Sending serializableUser:', serializableUser);

        const sessionData = {
          user: serializableUser,
          claims,
        };
        iframe.contentWindow.postMessage({ type: 'MINREPORT_SESSION_DATA', data: sessionData }, new URL(pluginSrc).origin);
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [user, claims, pluginSrc]);

  if (!pluginId || !pluginSrc) {
    return <h2>Plugin no encontrado</h2>;
  }

  // Check if the plugin is active for the current user
  if (!activePlugins || !activePlugins.includes(pluginId)) {
    return (
      <div className="plugin-viewer-container">
        <h2>Acceso Denegado</h2>
        <p>No tienes permiso para acceder a este plugin o no está activado para tu cuenta.</p>
      </div>
    );
  }

  return (
    <div className="plugin-viewer-container">
      <iframe
        ref={iframeRef}
        src={pluginSrc}
        className="plugin-iframe"
        title={`Plugin Content: ${pluginId}`}
        sandbox="allow-scripts allow-same-origin allow-forms"
      ></iframe>
    </div>
  );
};

export default PluginViewer;
