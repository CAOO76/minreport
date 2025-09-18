import React, { useState, useEffect, useCallback } from 'react';

import { db, functions, httpsCallable } from '../firebaseConfig'; // Asegúrate de que 'functions' esté exportado desde firebaseConfig
import { doc, getDoc } from 'firebase/firestore';
import './ManageClientPlugins.css'; // Crearemos este archivo CSS
import M3Switch from './M3Switch';

interface ManageClientPluginsProps {
  accountId: string;
}

// Definición de tipos para el documento de cuenta
interface AccountData {
  activePlugins?: { [key: string]: boolean };
  // ... otras propiedades de la cuenta que puedas necesitar
}

// Lista estática de plugins disponibles
const availablePlugins = [
  { id: 'cash-flow', name: 'Flujo de Caja' },
  { id: 'inventory', name: 'Gestor de Inventario' },
  { id: 'reports', name: 'Reportes Fotográficos' }
];

const ManageClientPlugins: React.FC<ManageClientPluginsProps> = ({ accountId }) => {
  const [accountPlugins, setAccountPlugins] = useState<{ [key: string]: boolean }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Estado para controlar el modal de confirmación
  const [pluginToConfirm, setPluginToConfirm] = useState<{ id: string, name: string, isActive: boolean } | null>(null);

  // Referencia a la Cloud Function
  const togglePluginStatusCallable = httpsCallable(functions, 'togglePluginStatus');

  const fetchAccountPlugins = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const accountRef = doc(db, 'accounts', accountId);
      const accountSnap = await getDoc(accountRef);

      if (accountSnap.exists()) {
        const data = accountSnap.data() as AccountData;
        setAccountPlugins(data.activePlugins || {});
      } else {
        setError('Cuenta no encontrada.');
        setAccountPlugins({});
      }
    } catch (err: any) {
      console.error('Error al obtener plugins de la cuenta:', err);
      setError(`Error al cargar plugins: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAccountPlugins();
  }, [fetchAccountPlugins]);

  // Inicia el proceso de confirmación cuando se hace click en un switch
  const handleToggleInitiate = (pluginId: string, currentIsActive: boolean) => {
    const pluginName = availablePlugins.find(p => p.id === pluginId)?.name || pluginId; // Usar availablePlugins
    setPluginToConfirm({ id: pluginId, name: pluginName, isActive: !currentIsActive }); // El nuevo estado
    setConfirmationText(''); // Limpiar texto de confirmación previo
    setSaveError(null); // Limpiar errores previos
  };

  // Confirma y llama a la Cloud Function
  const handleConfirmToggle = async () => {
    if (!pluginToConfirm) return; // No debería ocurrir

    if (confirmationText !== 'CONFIRMAR') {
      setSaveError('Debe escribir "CONFIRMAR" para confirmar la acción.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await togglePluginStatusCallable({
        accountId,
        pluginId: pluginToConfirm.id,
        isActive: pluginToConfirm.isActive,
      });
      console.log('Resultado de la llamada a Cloud Function (togglePluginStatus):', result.data);

      // Actualizar el estado local después de una llamada exitosa a la Cloud Function
      setAccountPlugins(prev => ({
        ...prev,
        [pluginToConfirm.id]: pluginToConfirm.isActive,
      }));

      setPluginToConfirm(null); // Cerrar modal de confirmación
      setConfirmationText(''); // Limpiar texto de confirmación
      // alert(`Plugin '${pluginToConfirm.name}' actualizado con éxito.`); // Opcional: mostrar un toast/notificación
    } catch (err: any) {
      console.error('Error al llamar a la Cloud Function:', err);
      setSaveError(`Error al guardar: ${err.message}`);
      // Opcional: Revertir el estado local si la llamada falla (si se hizo una actualización optimista)
    } finally {
      setIsSaving(false);
    }
  };

  // Cancela la acción de toggle
  const handleCancelToggle = () => {
    setPluginToConfirm(null);
    setConfirmationText('');
    setSaveError(null);
  };

  if (isLoading) return <p>Cargando plugins...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="manage-client-plugins-container">
      <h3>Gestión de Plugins</h3>
      <div className="plugin-list">
        {availablePlugins.map((plugin) => { // Usar availablePlugins
          const isActive = accountPlugins[plugin.id] || false;
          return (
            <div key={plugin.id} className="plugin-item">
              <label htmlFor={`toggle-${plugin.id}`}>{plugin.name}</label>
              <M3Switch
                id={`toggle-${plugin.id}`}
                checked={isActive}
                onChange={() => handleToggleInitiate(plugin.id, isActive)}
                disabled={isSaving}
              />
            </div>
          );
        })}
      </div>

      {pluginToConfirm && (
        <div className="confirmation-modal-overlay">
          <div className="confirmation-modal-content">
            <h4>Confirmar Cambio de Plugin</h4>
            <p>¿Está seguro de que desea {pluginToConfirm.isActive ? 'activar' : 'desactivar'} el plugin "<strong>{pluginToConfirm.name}</strong>"?</p>
            <p>Escriba "CONFIRMAR" para proceder:</p>
            <input
              type="text"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              disabled={isSaving}
            />
            {saveError && <p className="error-message">{saveError}</p>}
            <div className="modal-actions">
              <button onClick={handleConfirmToggle} disabled={isSaving}>
                {isSaving ? 'Confirmando...' : 'Confirmar'}
              </button>
              <button onClick={handleCancelToggle} disabled={isSaving}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageClientPlugins;