import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuth from '@minreport/core/hooks/useAuth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import './PluginViewer.css';

interface PluginViewerProps {
  activePlugins: string[] | null;
}

const PluginViewer: React.FC<PluginViewerProps> = ({ activePlugins }) => {
  const { pluginId } = useParams<{ pluginId: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { user, claims } = useAuth();
  const [pluginSrc, setPluginSrc] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pluginId) {
      setLoading(false);
      setError('No se ha especificado un ID de plugin.');
      return;
    }

    const fetchPluginUrl = async () => {
      try {
        const pluginDocRef = doc(db, 'plugins', pluginId);
        const pluginDoc = await getDoc(pluginDocRef);

        if (pluginDoc.exists()) {
          const pluginData = pluginDoc.data();
          if (pluginData.status === 'enabled') {
            setPluginSrc(pluginData.url);
          } else {
            setError(`El plugin "${pluginId}" está deshabilitado.`);
          }
        } else {
          setError(`El plugin "${pluginId}" no se encuentra en la configuración del sistema.`);
        }
      } catch (err) {
        console.error("Error al obtener la configuración del plugin:", err);
        setError('No se pudo cargar la configuración del plugin.');
      } finally {
        setLoading(false);
      }
    };

    fetchPluginUrl();
  }, [pluginId]);

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

  useEffect(() => {
    if (!pluginSrc) return;

    const handlePluginAction = (event: MessageEvent) => {
      if (event.origin !== new URL(pluginSrc).origin) {
        return;
      }
      if (event.data?.type !== 'MINREPORT_ACTION') return;

      const { action, data } = event.data.payload;

      switch (action) {
        case 'navigate':
          if (data.path && typeof data.path === 'string') {
            navigate(data.path);
          }
          break;
        case 'showNotification':
          if (data.message && typeof data.message === 'string') {
            alert(`[Plugin] ${data.level?.toUpperCase() || 'INFO'}: ${data.message}`);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handlePluginAction);
    return () => window.removeEventListener('message', handlePluginAction);
  }, [pluginSrc, navigate]);

  if (loading) {
    return <h2>Cargando plugin...</h2>;
  }

  if (error) {
    return <h2>Error: {error}</h2>;
  }

  if (!pluginId || !pluginSrc) {
    return <h2>Plugin no encontrado</h2>;
  }

  if (!activePlugins || !activePlugins.includes(pluginId)) {
    return (
      <div className="plugin-viewer-container">
        <h2>Acceso Denegado</h2>
        <p>No tienes permiso para acceder a este plugin.</p>
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
