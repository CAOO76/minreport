import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom'; // Importar useNavigate
// import PluginManagementModal from '../components/PluginManagementModal'; // Ya no se usa
import './Accounts.css'; // Asegúrate de crear este archivo CSS

// --- Type Definitions ---
type AccountStatus = 'active' | 'suspended';

type Account = {
  id: string;
  status: AccountStatus;
  createdAt: { toDate: () => Date };
  institutionName: string;
  accountType: 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL';
  email: string;
  adminName: string; // Nombre del admin/persona natural
  activePlugins?: string[]; // Nuevo campo para almacenar los IDs de los plugins activos
};

// --- Main Component ---
const Accounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountStatus>('active');
  const navigate = useNavigate(); // Inicializar useNavigate

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'accounts'), where('status', '==', filter));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
      setAccounts(list);
      setError(null);
    } catch (err: any) {
      setError(`Error al cargar cuentas: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleViewAccountDetails = (accountId: string) => {
    navigate(`/accounts/${accountId}`); // Navegar a la página de detalles de la cuenta
  };

  if (isLoading) return <p>Cargando cuentas...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="accounts-container">
      <h2>Cuentas de Clientes</h2>
      <div className="filter-tabs">
        <button onClick={() => setFilter('active')} className={filter === 'active' ? 'active' : ''}>Activas</button>
        <button onClick={() => setFilter('suspended')} className={filter === 'suspended' ? 'active' : ''}>Suspendidas</button>
      </div>
      <div className="accounts-table-container">
        <table className="accounts-table">
          <thead>
            <tr>
              <th><>Institución / Nombre</></th>
              <th><>Email Administrador</></th>
              <th><>Tipo de Cuenta</></th>
              <th><>Fecha Creación</></th>
              <th><>Estado</></th>
              <th><>Acciones</> {/* Nueva columna para acciones */}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length > 0 ? (
              accounts.map(acc => (
                <tr key={acc.id}>
                  <td><>{acc.accountType === 'INDIVIDUAL' ? acc.adminName : acc.institutionName}</></td>
                  <td><>{acc.email}</></td>
                  <td><>{acc.accountType}</></td>
                  <td><>{acc.createdAt.toDate().toLocaleDateString()}</></td>
                  <td><><span className={`status-badge status-${acc.status}`}>{acc.status}</span></></td>
                  <td>
                    <button 
                      className="icon-button" 
                      title="Ver Detalles de Cuenta" 
                      onClick={() => handleViewAccountDetails(acc.id)} 
                    >
                      <span className="material-symbols-outlined">info</span>
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}><>No hay cuentas en estado "{filter}".</></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* El modal de gestión de plugins ya no se renderiza aquí */}
    </div>
  );
};

export default Accounts;