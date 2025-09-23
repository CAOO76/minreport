// sites/admin-app/src/pages/ClientPluginManagementPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app'; // Import getApp
import { db } from '../firebaseConfig';
import M3Switch from '../components/M3Switch'; // Asumiendo que M3Switch existe en esta ruta
import './ClientPluginManagementPage.css'; // Archivo CSS para estilos específicos

interface Plugin {
  id: string;
  name: string;
  description: string;
  url: string;
  version: string;
}

interface AccountData {
  activePlugins: string[];
  // Otros campos de la cuenta que puedan ser relevantes
}

interface ManageClientPluginsCallableData {
  accountId: string;
  pluginId: string;
  action: 'activate' | 'deactivate';
}

interface ManageClientPluginsCallableResult {
  status: 'success' | 'error';
  message: string;
}

const ClientPluginManagementPage: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [activePlugins, setActivePlugins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>('');

  const manageClientPlugins = useCallback(
    httpsCallable<ManageClientPluginsCallableData, ManageClientPluginsCallableResult>(
      getFunctions(getApp(), 'southamerica-west1'), // Specify the region here
      'manageClientPluginsCallable'
    ),
    []
  );

  useEffect(() => {
    if (!accountId) {
      setError('ID de cuenta no proporcionado.');
      setLoading(false);
      return;
    }

    const fetchAccountData = async () => {
      try {
        const accountDocRef = doc(db, 'accounts', accountId);
        const accountDocSnap = await getDoc(accountDocRef);

        if (accountDocSnap.exists()) {
          const data = accountDocSnap.data() as AccountData;
          setActivePlugins(data.activePlugins || []);
          setAccountName(accountDocSnap.data()?.name || accountId); // Asumiendo que la cuenta tiene un campo 'name'
        } else {
          setError('Cuenta no encontrada.');
        }
      } catch (err) {
        console.error('Error fetching account data:', err);
        setError('Error al cargar los datos de la cuenta.');
      }
    };

    const fetchPlugins = async () => {
      try {
        const pluginsCollectionRef = collection(db, 'plugins');
        const pluginsSnapshot = await getDocs(pluginsCollectionRef);
        const fetchedPlugins: Plugin[] = pluginsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Plugin[];
        setPlugins(fetchedPlugins);
      } catch (err) {
        console.error('Error fetching plugins:', err);
        setError('Error al cargar la lista de plugins.');
      }
    };

    Promise.all([fetchAccountData(), fetchPlugins()]).finally(() => setLoading(false));

    // Opcional: Escuchar cambios en activePlugins en tiempo real
    const unsubscribe = onSnapshot(doc(db, 'accounts', accountId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as AccountData;
        setActivePlugins(data.activePlugins || []);
      }
    });

    return () => unsubscribe();
  }, [accountId]);

  const handleTogglePlugin = async (pluginId: string, isActive: boolean) => {
    if (!accountId) return;

    try {
      const action = isActive ? 'activate' : 'deactivate';
      const result = await manageClientPlugins({ accountId, pluginId, action });

      if (result.data.status === 'error') {
        setError(result.data.message);
      } else {
        // La UI se actualizará automáticamente gracias al onSnapshot
        console.log(result.data.message);
      }
    } catch (err: any) {
      console.error('Error toggling plugin:', err);
      setError(err.message || 'Error al cambiar el estado del plugin.');
    }
  };

  if (loading) {
    return <div className="loading-container">Cargando gestión de plugins...</div>;
  }

  if (error) {
    return <div className="error-container">Error: {error}</div>;
  }

  return (
    <div className="client-plugin-management-page">
      <h2>Gestión de Plugins para {accountName}</h2>
      <p>Activa o desactiva los plugins disponibles para esta cuenta de cliente.</p>

      <div className="plugins-list">
        {plugins.length === 0 ? (
          <p>No hay plugins disponibles.</p>
        ) : (
          plugins.map((plugin) => (
            <div key={plugin.id} className="plugin-item">
              <div className="plugin-info">
                <h3>{plugin.name}</h3>
                <p>{plugin.description}</p>
              </div>
              <div className="plugin-toggle">
                <M3Switch
                  checked={activePlugins.includes(plugin.id)}
                  onChange={(e) => handleTogglePlugin(plugin.id, e.target.checked)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ClientPluginManagementPage;
