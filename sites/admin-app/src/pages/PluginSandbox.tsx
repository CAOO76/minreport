import React, { useEffect, useState } from 'react';
import { db } from '../firebaseConfig';
import { collection, onSnapshot } from 'firebase/firestore';


interface PluginData {
  id: string;
  name?: string;
  url?: string;
  status?: string;
}

const PluginSandbox: React.FC = () => {
  const [allPlugins, setAllPlugins] = useState<PluginData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      // Only show enabled plugins with a URL
      const filteredPlugins = pluginsList.filter(p => p.status === 'enabled' && p.url);
      setAllPlugins(filteredPlugins);
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
