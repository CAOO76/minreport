import React, { useEffect, useState } from 'react';
import { db } from '../firebaseConfig';
import { collection, onSnapshot } from 'firebase/firestore';

interface PluginData {
  id: string;
  name?: string;
  version?: string;
  url?: string;
  status?: string;
}

const PluginsManagement: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pluginsColRef = collection(db, 'plugins');
    const unsubscribe = onSnapshot(pluginsColRef, (snapshot) => {
      const pluginsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      console.log("Firestore Snapshot received. pluginsList:", pluginsList);
      console.log("Snapshot is empty:", snapshot.empty);

      setPlugins(pluginsList);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching plugins:", err);
      setError("Error al cargar los plugins.");
      setLoading(false);
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  return (
    <div className="plugins-management-container">
      <header className="plugins-management-header">
        <h1>Gestión de Plugins</h1>
        <button className="add-plugin-btn">Añadir Nuevo Plugin</button>
      </header>
      
      <div className="plugins-list">
        {loading && <p>Cargando plugins...</p>}
        {error && <p className="error-message">Error: {error}</p>}
        {!loading && plugins.length === 0 && <p>No hay plugins registrados.</p>}
        {!loading && plugins.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Versión</th>
                <th>URL</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {plugins.map(plugin => (
                <tr key={plugin.id}>
                  <td>{plugin.id}</td>
                  <td>{plugin.name || 'N/A'}</td>
                  <td>{plugin.version || 'N/A'}</td>
                  <td>{plugin.url || 'N/A'}</td>
                  <td><span className={`status-badge status-${plugin.status || 'unknown'}`}>{plugin.status || 'Desconocido'}</span></td>
                  <td>
                    <button>Editar</button>
                    <button className="delete-btn">Desactivar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PluginsManagement;