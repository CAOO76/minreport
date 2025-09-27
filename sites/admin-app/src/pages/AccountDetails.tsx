import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, functions } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './AccountDetails.css';

// --- Type Definitions ---
type AccountStatus = 'active' | 'suspended';

type Account = {
  id: string;
  status: AccountStatus;
  createdAt: { toDate: () => Date };
  institutionName: string;
  accountType: 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL';
  designatedAdminEmail: string;
  adminName: string;
  adminActivatedPlugins?: string[]; // Correct field name
};

// As per business rule: use a mock array for all available plugins
const ALL_AVAILABLE_PLUGINS = [
  { id: 'test-plugin', name: 'Plugin de Prueba Interno' },
  { id: 'metrics-v1', name: 'Dashboard de Métricas v1' },
  { id: 'reports-basic', name: 'Generador de Reportes Básico' },
  { id: 'data-importer', name: 'Importador de Datos Externos' },
];

// --- Sub-component for Plugin Management ---
interface ManageClientPluginsProps {
  accountId: string;
  activePlugins: string[];
  onPluginsUpdated: () => void; // Callback to refresh account data
}

const ManageClientPlugins: React.FC<ManageClientPluginsProps> = ({ accountId, activePlugins, onPluginsUpdated }) => {
  const [loadingPluginId, setLoadingPluginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const manageClientPlugins = httpsCallable(functions, 'manageClientPluginsCallable');

  const handleTogglePlugin = async (pluginId: string, isActive: boolean) => {
    setLoadingPluginId(pluginId);
    setError(null);
    try {
      const action = isActive ? 'deactivate' : 'activate';
      await manageClientPlugins({ accountId, pluginId, action });
      onPluginsUpdated(); // Refresh the parent component's data
    } catch (err: any) {
      console.error('Error toggling plugin:', err);
      setError(`Error al cambiar estado del plugin ${pluginId}: ${err.message}`);
    } finally {
      setLoadingPluginId(null);
    }
  };

  return (
    <div className="plugin-management-section">
      <h3>Gestión de Plugins</h3>
      {error && <p className="error">{error}</p>}
      <ul className="plugins-list">
        {ALL_AVAILABLE_PLUGINS.map((plugin) => {
          const isActive = activePlugins.includes(plugin.id);
          const isLoading = loadingPluginId === plugin.id;
          return (
            <li key={plugin.id} className="plugin-item">
              <span className="plugin-name">{plugin.name}</span>
              <md-switch
                selected={isActive}
                disabled={isLoading}
                onClick={() => handleTogglePlugin(plugin.id, isActive)}
              ></md-switch>
            </li>
          );
        })}
      </ul>
    </div>
  );
};


// --- Main Account Details Component ---
const AccountDetails: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccountDetails = useCallback(async () => {
    if (!accountId) {
      setError('ID de cuenta no proporcionado.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const accountRef = doc(db, 'accounts', accountId);
      const accountSnap = await getDoc(accountRef);

      if (accountSnap.exists()) {
        const accountData = { id: accountSnap.id, ...accountSnap.data() } as Account;
        setAccount(accountData);
        setError(null);
      } else {
        setError('Cuenta no encontrada.');
        setAccount(null);
      }
    } catch (err: any) {
      setError(`Error al cargar detalles de la cuenta: ${err.message}`);
      setAccount(null);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAccountDetails();
  }, [fetchAccountDetails]);

  if (isLoading) return <p>Cargando detalles de la cuenta...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!account) return <p>No se pudo cargar la información de la cuenta.</p>;

  return (
    <div className="account-details-page">
      <div className="account-details-main">
        <button onClick={() => navigate('/accounts')} className="back-button">
          <span className="material-symbols-outlined">arrow_back</span>
          Volver a Cuentas
        </button>
        <h2>Detalles de la Cuenta: {account.accountType === 'INDIVIDUAL' ? account.adminName : account.institutionName}</h2>

        <div className="account-info-section">
          <h3>Información General</h3>
          <p><strong>ID:</strong> {account.id}</p>
          <p><strong>Email Administrador:</strong> {account.designatedAdminEmail}</p>
          <p><strong>Tipo de Cuenta:</strong> {account.accountType}</p>
          <p><strong>Estado:</strong> <span className={`status-badge status-${account.status}`}>{account.status}</span></p>
          <p><strong>Fecha de Creación:</strong> {account.createdAt.toDate().toLocaleDateString()}</p>
        </div>

        <ManageClientPlugins
          accountId={account.id}
          activePlugins={account.adminActivatedPlugins || []}
          onPluginsUpdated={fetchAccountDetails}
        />
        
      </div>
    </div>
  );
};

export default AccountDetails;
