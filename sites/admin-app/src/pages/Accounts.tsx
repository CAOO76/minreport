import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where } from 'firebase/firestore';
import './Accounts.css'; // Asegúrate de crear este archivo CSS

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
};

// --- Main Component ---
const Accounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountStatus>('active');

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
              <th>Institución / Nombre</th>
              <th>Email Administrador</th>
              <th>Tipo de Cuenta</th>
              <th>Fecha Creación</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length > 0 ? (
              accounts.map(acc => (
                <tr key={acc.id}>
                  <td>{acc.accountType === 'INDIVIDUAL' ? acc.adminName : acc.institutionName}</td>
                  <td>{acc.designatedAdminEmail}</td>
                  <td>{acc.accountType}</td>
                  <td>{acc.createdAt.toDate().toLocaleDateString()}</td>
                  <td><span className={`status-badge status-${acc.status}`}>{acc.status}</span></td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>No hay cuentas en estado "{filter}".</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Accounts;