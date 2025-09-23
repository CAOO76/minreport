import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import './AccountDetails.css'; // Asegúrate de crear este archivo CSS

// --- Type Definitions ---
type AccountStatus = 'active' | 'suspended';

type Account = {
  id: string;
  status: AccountStatus;
  createdAt: { toDate: () => Date };
  institutionName: string;
  accountType: 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL';
  designatedAdminEmail: string;
  adminName: string; // Nombre del admin/persona natural
  activePlugins?: string[];
};

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
    <div className="account-details-page"> {/* Usar la clase de layout principal */}
      <div className="account-details-main"> {/* Contenido principal */}
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
          {/* Aquí se pueden añadir más campos de información de la cuenta */}
        </div>

        {/* Aquí se pueden añadir otras secciones de gestión de la cuenta (métricas, etc.) */}
      </div>

      {/* Columna lateral derecha */}
    </div>
  );
};

export default AccountDetails;