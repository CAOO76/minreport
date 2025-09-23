import React, { useEffect, useState, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, onSnapshot } from 'firebase/firestore';
import useAuth from '@minreport/core/hooks/useAuth';
import { auth } from '../firebaseConfig';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions'; // Import for Cloud Functions

// Define the test plugin metadata
const TEST_PLUGIN_METADATA = {
  id: 'test-plugin',
  name: 'Plugin de Prueba (Built-in)',
  url: 'http://localhost:5177', // Assuming this is the dev server URL for test-plugin
  status: 'enabled',
};

interface PluginData {
  id: string;
  name?: string;
  url?: string;
  status?: string;
}

const PluginSandbox: React.FC = () => {
  const { user, claims } = useAuth(auth);
  const [allPlugins, setAllPlugins] = useState<PluginData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // 1. Fetch all plugins from Firestore
  useEffect(() => {
    const pluginsColRef = collection(db, 'plugins');
    const unsubscribe = onSnapshot(pluginsColRef, (snapshot) => {
      let pluginsList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.id,
        url: doc.data().url,
        status: doc.data().status,
      }));

      // Filter out the test plugin if it's fetched from Firestore to avoid duplicates
      pluginsList = pluginsList.filter(p => p.id !== TEST_PLUGIN_METADATA.id);

      // Only show enabled plugins with a URL, and prepend the test plugin
      const filteredAndSortedPlugins = [
        TEST_PLUGIN_METADATA as PluginData, // Always include the test plugin at the top
        ...pluginsList.filter(p => p.status === 'enabled' && p.url)
      ];

      setAllPlugins(filteredAndSortedPlugins);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching all plugins for sandbox:", err);
      setError("Error al cargar la lista de plugins.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

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
      </header>

      <div className="plugins-table-wrapper">
        {allPlugins.length === 0 ? (
          <p>No hay plugins disponibles en el sistema.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>URL</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {allPlugins.map(plugin => (
                <tr key={plugin.id}>
                  <td>{plugin.id}</td>
                  <td>{plugin.name || 'N/A'}</td>
                  <td>{plugin.url || 'N/A'}</td>
                  <td>{plugin.status || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PluginSandbox;
