import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { AccountLogViewer } from './AccountLogViewer';
import './AdminPanel.css';

// Tipos de datos basados en DATA_CONTRACT.md
type Request = {
  id: string;
  institutionName: string;
  applicantName: string;
  applicantEmail: string;
  accountType: 'B2B' | 'EDUCACIONALES';
  status: 'pending_review' | 'pending_additional_data' | 'rejected' | 'approved';
  createdAt: Date;
};

type Account = {
  id: string;
  institutionName: string;
  accountType: 'B2B' | 'EDUCACIONALES';
  status: 'active' | 'suspended';
  createdAt: Date;
};

export function AdminPanel() {
  const [view, setView] = useState('requests'); // 'requests' o 'accounts'
  const [accountFilter, setAccountFilter] = useState('all'); // 'all', 'B2B', 'EDUCACIONALES'
  const [requests, setRequests] = useState<Request[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedItem, setSelectedItem] = useState<Request | Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (view === 'requests') {
        const requestsCollection = collection(db, 'requests');
        const q = query(requestsCollection, where('status', '==', 'pending_review'));
        const querySnapshot = await getDocs(q);
        const requestsList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt.toDate(),
        } as Request));
        setRequests(requestsList);
      } else {
        const accountsCollection = collection(db, 'accounts');
        let accountsQuery = query(accountsCollection, where('status', '==', 'active'));

        if (accountFilter !== 'all') {
          accountsQuery = query(accountsQuery, where('accountType', '==', accountFilter));
        }

        const querySnapshot = await getDocs(accountsQuery);
        const accountsList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt.toDate(),
        } as Account));
        setAccounts(accountsList);
      }
      setError(null);
    } catch (err) {
      console.error(`Error fetching ${view}:`, err);
      setError(`Error al cargar ${view}. Verifique la consola.`);
    } finally {
      setIsLoading(false);
    }
  }, [view, accountFilter]); // Dependencies for useCallback

  useEffect(() => {
    fetchData();
  }, [fetchData]); // fetchData is now a dependency

  const handleSelectItem = (item: Request | Account) => {
    setSelectedItem(item);
  };

  const handleBackToList = () => {
    setSelectedItem(null);
    setShowLogs(false); // Asegurarse de cerrar el visor de logs al volver a la lista
  };

  const handleApproveAccount = async (requestId: string) => {
    if (!window.confirm('¿Estás seguro de que quieres aprobar inicialmente esta solicitud?')) {
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await fetch('http://localhost:8080/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al aprobar la solicitud inicialmente');
      }

      alert('Solicitud aprobada inicialmente. Ahora espera datos adicionales.');
      // Recargar datos para reflejar el cambio de estado
      fetchData();
      handleBackToList();

    } catch (err: any) {
      console.error('Error al aprobar la solicitud inicialmente:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRejectAccount = async (requestId: string) => {
    if (!window.confirm('¿Estás seguro de que quieres rechazar esta solicitud?')) {
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await fetch('http://localhost:8080/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId, reason: 'Rechazado por administrador' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al rechazar la solicitud');
      }

      alert('Solicitud rechazada exitosamente.');
      fetchData();
      handleBackToList();

    } catch (err: any) {
      console.error('Error al rechazar la solicitud:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleFinalApproveAccount = async (requestId: string) => {
    if (!window.confirm('¿Estás seguro de que quieres aprobar FINALMENTE esta solicitud y crear la cuenta?')) {
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await fetch('http://localhost:8080/final-approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al aprobar finalmente la cuenta');
      }

      alert('Cuenta creada y solicitud aprobada finalmente.');
      // Recargar datos para reflejar el cambio de estado
      fetchData();
      handleBackToList();

    } catch (err: any) {
      console.error('Error al aprobar finalmente la cuenta:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSuspendAccount = async (accountId: string) => {
    if (!window.confirm('¿Estás seguro de que quieres suspender esta cuenta?')) {
      return;
    }

    setIsActionLoading(true);
    try {
      // TODO: Reemplazar con la URL real del servicio de Cloud Run
      const response = await fetch('http://localhost:8080/suspend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId, reason: 'Suspendido por administrador' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al suspender la cuenta');
      }

      alert('Cuenta suspendida exitosamente.');
      // TODO: Actualizar la lista de cuentas o recargar datos
      handleBackToList(); // Volver a la lista después de la acción

    } catch (err: any) {
      console.error('Error al suspender la cuenta:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleViewLogs = () => {
    setShowLogs(true);
  };

  if (isLoading) {
    return <div className="panel-container">Cargando...</div>;
  }

  if (error) {
    return <div className="panel-container error">{error}</div>;
  }

  return (
    <div className="panel-container">
      <header className="panel-header">
        <h1>Panel de Administración</h1>
        <div className="view-selector">
          <button onClick={() => setView('requests')} className={view === 'requests' ? 'active' : ''}>Solicitudes Pendientes</button>
          <button onClick={() => setView('accounts')} className={view === 'accounts' ? 'active' : ''}>Cuentas Activas</button>
        </div>
      </header>
      {selectedItem ? (
        <div className="detail-view">
          <button onClick={handleBackToList} className="back-button">&larr; Volver a la lista</button>
          <h2>Detalle</h2>
          {/* Aquí podrías diferenciar el detalle si es Request o Account */}
          <div className="detail-grid">
            <p><strong>ID:</strong> {selectedItem.id}</p>
            <p><strong>Institución:</strong> {selectedItem.institutionName}</p>
            <p><strong>Tipo de Cuenta:</strong> {selectedItem.accountType}</p>
            <p><strong>Estado:</strong> {selectedItem.status}</p>
            <p><strong>Fecha:</strong> {selectedItem.createdAt.toLocaleString()}</p>
          </div>
          <div className="action-buttons">
            {/* Lógica de botones condicional según el tipo de item */}
            {view === 'requests' && selectedItem.status === 'pending_review' && (
              <button className="approve" onClick={() => handleApproveAccount(selectedItem.id)} disabled={isActionLoading}>
                {isActionLoading ? 'Aprobando...' : 'Aprobar'}
              </button>
            )}
            {view === 'requests' && selectedItem.status === 'pending_additional_data' && (
              <button className="approve" onClick={() => handleFinalApproveAccount(selectedItem.id)} disabled={isActionLoading}>
                {isActionLoading ? 'Aprobando Final...' : 'Aprobación Final'}
              </button>
            )}
            {view === 'requests' && selectedItem.status === 'pending_review' && (
              <button className="reject" onClick={() => handleRejectAccount(selectedItem.id)} disabled={isActionLoading}>
                {isActionLoading ? 'Rechazando...' : 'Rechazar'}
              </button>
            )}
            {view === 'accounts' && selectedItem.status !== 'suspended' && (
              <button className="suspend" onClick={() => handleSuspendAccount(selectedItem.id)} disabled={isActionLoading}>
                {isActionLoading ? 'Suspendiendo...' : 'Suspender'}
              </button>
            )}
            {view === 'accounts' && (
              <button onClick={handleViewLogs} className="view-logs-button">
                Ver Trazabilidad
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="list-view">
          {view === 'requests' && (
            requests.length > 0 ? (
              <ul className="requests-list">
                {requests.map(req => (
                  <li key={req.id} onClick={() => handleSelectItem(req)}>
                    <strong>{req.institutionName}</strong>
                    <span>{req.applicantName}</span>
                  </li>
                ))}
              </ul>
            ) : <p>No hay solicitudes pendientes.</p>
          )}
          {view === 'accounts' && (
            <div className="sub-view-selector">
              <button onClick={() => setAccountFilter('all')} className={accountFilter === 'all' ? 'active' : ''}>Todas</button>
              <button onClick={() => setAccountFilter('B2B')} className={accountFilter === 'B2B' ? 'active' : ''}>B2B</button>
              <button onClick={() => setAccountFilter('EDUCACIONALES')} className={accountFilter === 'EDUCACIONALES' ? 'active' : ''}>EDUCACIONALES</button>
            </div>
          )}
          {view === 'accounts' && (
            accounts.length > 0 ? (
              <ul className="requests-list"> 
                {accounts.map(acc => (
                  <li key={acc.id} onClick={() => handleSelectItem(acc)}>
                    <strong>{acc.institutionName}</strong>
                    <span>{acc.status}</span>
                  </li>
                ))}
              </ul>
            ) : <p>No hay cuentas activas.</p>
          )}
        </div>
      )}
      {showLogs && selectedItem && (
        <AccountLogViewer accountId={selectedItem.id} onClose={() => setShowLogs(false)} />
      )}
    </div>
  );
}