import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import './ManageClientPlugins.css';
import M3Switch from './M3Switch';

interface ManageClientPluginsProps {
  accountId: string;
}

interface PluginDefinition {
  id: string;
  name: string;
}

const ManageClientPlugins: React.FC<ManageClientPluginsProps> = ({ accountId }) => {
  const [activePlugins, setActivePlugins] = useState<{ [key: string]: boolean }>({});
  const [availablePlugins, setAvailablePlugins] = useState<PluginDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Obtener plugins disponibles
      const pluginsCollectionRef = collection(db, 'plugins');
      const pluginsSnapshot = await getDocs(pluginsCollectionRef);
      const pluginsList = pluginsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PluginDefinition));
      setAvailablePlugins(pluginsList);

      // 2. Obtener plugins activos de la cuenta
      const accountRef = doc(db, 'accounts', accountId);
      const accountSnap = await getDoc(accountRef);
      if (accountSnap.exists()) {
        setActivePlugins(accountSnap.data().plugins || {});
      } else {
        setError('Cuenta no encontrada.');
      }
    } catch (err: any) {
      console.error('Error al cargar datos de plugins:', err);
      setError(`Error al cargar datos: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTogglePlugin = async (pluginId: string, currentIsActive: boolean) => {
    const newActiveState = !currentIsActive;
    setIsSaving(true);

    const accountRef = doc(db, 'accounts', accountId);

    try {
      // Operación de escritura segura: updateDoc solo modifica los campos especificados.
      await updateDoc(accountRef, {
        [`plugins.${pluginId}`]: newActiveState
      });

      // Actualizar estado local optimistamente
      setActivePlugins(prev => ({
        ...prev,
        [pluginId]: newActiveState,
      }));

    } catch (err: any) {
      console.error('Error al actualizar el plugin:', err);
      setError(`Error al guardar: ${err.message}`);
      // Opcional: revertir el estado si falla
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <p>Cargando plugins...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="manage-client-plugins-container">
      <h4>Gestión de Plugins</h4>
      <div className="plugin-list">
        {availablePlugins.length > 0 ? availablePlugins.map((plugin) => {
          const isActive = activePlugins[plugin.id] || false;
          return (
            <div key={plugin.id} className="plugin-item">
              <label htmlFor={`toggle-${plugin.id}`}>{plugin.name}</label>
              <M3Switch
                id={`toggle-${plugin.id}`}
                checked={isActive}
                onChange={() => handleTogglePlugin(plugin.id, isActive)}
                disabled={isSaving}
              />
            </div>
          );
        }) : <p>No hay plugins disponibles en el sistema.</p>}
      </div>
    </div>
  );
};

export default ManageClientPlugins;
