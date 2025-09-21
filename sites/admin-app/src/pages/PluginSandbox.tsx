import React, { useEffect, useRef, useState } from 'react';
import { db } from '../firebaseConfig';
import { collection, onSnapshot } from 'firebase/firestore';
import useAuth from '@minreport/core/hooks/useAuth';
import { auth } from '../firebaseConfig'; // Re-adding import
import { useNavigate } from 'react-router-dom'; // New import

interface PluginData {
  id: string;
  name?: string;
  url?: string;
  status?: string;
}

const PluginSandbox: React.FC = () => {
  const { user, claims } = useAuth(auth); // Pass auth instance
  const [allPlugins, setAllPlugins] = useState<PluginData[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [selectedPluginUrl, setSelectedPluginUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate(); // Initialize useNavigate
  const [notification, setNotification] = useState<{ message: string; level: string } | null>(null); // New notification state

  // 1. Fetch all plugins from Firestore
  useEffect(() => {
    const pluginsColRef = collection(db, 'plugins');
    const unsubscribe = onSnapshot(pluginsColRef, (snapshot) => {
      const pluginsList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.id,
        url: doc.data().url,
        status: doc.data().status,
      }));
      setAllPlugins(pluginsList.filter(p => p.status === 'enabled' && p.url)); // Only show enabled plugins with a URL
      setLoading(false);
    }, (err) => {
      console.error("Error fetching all plugins for sandbox:", err);
      setError("Error al cargar la lista de plugins.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Handle plugin selection and loading into iframe
  useEffect(() => {
    if (!selectedPluginId) {
      setSelectedPluginUrl(null);
      return;
    }
    const plugin = allPlugins.find(p => p.id === selectedPluginId);
    if (plugin && plugin.url) {
      setSelectedPluginUrl(plugin.url);
    } else {
      setSelectedPluginUrl(null);
      setError("URL del plugin no encontrada o plugin deshabilitado.");
    }
  }, [selectedPluginId, allPlugins]);

  // 3. Post session data to iframe on load
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !selectedPluginUrl || !user) return;

    const handleLoad = async () => {
      if (iframe.contentWindow) {
        try {
          const token = await user.getIdToken();
          const serializableUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            emailVerified: user.emailVerified,
          };

          const sessionData = {
            user: serializableUser,
            claims, // Incluye los claims del admin
            token,
          };

          iframe.contentWindow.postMessage(
            { type: 'CONTEXT_UPDATE', payload: sessionData },
            new URL(selectedPluginUrl).origin
          );
        } catch (error) {
          console.error('Error al obtener el token de sesión para el plugin en sandbox:', error);
          iframe.contentWindow.postMessage({ type: 'MINREPORT_SESSION_ERROR' }, new URL(selectedPluginUrl).origin);
        }
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [user, claims, selectedPluginUrl]);

  // 4. Handle messages from iframe (e.g., navigation, notifications)
  useEffect(() => {
    if (!selectedPluginUrl) return;

    const handlePluginAction = (event: MessageEvent) => {
      if (event.origin !== new URL(selectedPluginUrl).origin) {
        return;
      }
      if (event.data?.type !== 'MINREPORT_ACTION') return;

      const { action, data } = event.data.payload;

      switch (action) {
        case 'navigate':
          if (data.path && typeof data.path === 'string') {
            console.log('Plugin solicitó navegación:', data.path);
            navigate(data.path); // Actual navigation
          }
          break;
        case 'showNotification':
          if (data.message && typeof data.message === 'string') {
            setNotification({ message: data.message, level: data.level || 'info' });
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handlePluginAction);
    return () => window.removeEventListener('message', handlePluginAction);
  }, [selectedPluginUrl, navigate]); // Add navigate to dependency array

  // Clear notification after a few seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000); // Clear after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [notification]);

  if (loading) {
    return <h2>Cargando plugins disponibles...</h2>;
  }

  if (error) {
    return <h2>Error: {error}</h2>;
  }

  return (
    <div className="plugin-sandbox-container">
      <header className="plugin-sandbox-header">
        <h1>Sandbox de Plugins</h1>
        <select 
          onChange={(e) => setSelectedPluginId(e.target.value)}
          value={selectedPluginId || ''}
          disabled={allPlugins.length === 0}
        >
          <option value="">Selecciona un plugin</option>
          {allPlugins.map(plugin => (
            <option key={plugin.id} value={plugin.id}>
              {plugin.name} ({plugin.id})
            </option>
          ))}
        </select>
      </header>

      {notification && (
        <div className={`sandbox-notification notification-${notification.level}`}>
          {notification.message}
        </div>
      )}

      {selectedPluginUrl ? (
        <div className="iframe-wrapper">
          <iframe
            ref={iframeRef}
            src={selectedPluginUrl}
            className="plugin-iframe"
            title={`Plugin Sandbox: ${selectedPluginId}`}
            sandbox="allow-scripts allow-same-origin allow-forms"
          ></iframe>
        </div>
      ) : (
        <p>Selecciona un plugin de la lista para cargarlo.</p>
      )}
    </div>
  );
};

export default PluginSandbox;
