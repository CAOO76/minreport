import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';

// --- Type Definitions ---
type RequestStatus = 'pending_review' | 'pending_additional_data' | 'pending_final_review' | 'rejected' | 'activated' | 'expired';
type AccountStatus = 'active' | 'suspended';

type Request = {
  id: string;
  status: RequestStatus;
  createdAt: { toDate: () => Date };
  applicantName: string;
  applicantEmail: string;
  rut?: string; // Optional for INDIVIDUAL
  institutionName?: string; // Optional for INDIVIDUAL
  accountType: 'B2B' | 'EDUCACIONALES' | 'INDIVIDUAL';
  country: string;
  entityType: 'natural' | 'juridica';
  additionalData?: {
    designatedAdminName?: string;
    designatedAdminEmail?: string;
    run?: string; // For individual
    institutionAddress?: string; // For B2B/Edu
    institutionPhone?: string; // For B2B/Edu
    contactPhone?: string; // For B2B/Edu
  };
};

type Account = {
  id: string;
  institutionName: string;
  status: AccountStatus;
  createdAt: { toDate: () => Date };
  // Add other relevant account fields here if needed for display
};

type HistoryEntry = {
  id: string;
  timestamp: { toDate: () => Date };
  action: string;
  actor: string;
  details?: string;
};

export function AdminPanel() {
  // --- State Management ---
  const [view, setView] = useState('requests'); // 'requests' or 'accounts'
  const [requestFilter, setRequestFilter] = useState<RequestStatus>('pending_review');
  const [requests, setRequests] = useState<Request[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedItem, setSelectedItem] = useState<Request | Account | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Data Fetching ---
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setSelectedItem(null);
    try {
      let q;
      if (view === 'requests') {
        q = query(collection(db, 'requests'), where('status', '==', requestFilter));
      } else { // view === 'accounts'
        q = query(collection(db, 'accounts'), where('status', '==', 'active'));
      }
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      view === 'requests' ? setRequests(list) : setAccounts(list);
      setError(null);
    } catch (err: any) {
      console.error(`Error fetching ${view}:`, err);
      setError(`Error al cargar ${view}: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [view, requestFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchHistory = async (collectionName: string, docId: string) => {
    try {
      const historyQuery = query(collection(db, collectionName, docId, 'history'), orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(historyQuery);
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryEntry)));
    } catch (err) {
      console.error('Error fetching history:', err);
      setHistory([]);
    }
  };

  const handleSelectItem = (item: Request | Account) => {
    setSelectedItem(item);
    // Determine collection name for history based on view
    const collectionName = view === 'requests' ? 'requests' : 'accounts';
    fetchHistory(collectionName, item.id);
  };

  // --- Action Handlers ---
  const handleInitialDecision = async (decision: 'approved' | 'rejected') => {
    if (!selectedItem || selectedItem.status !== 'pending_review') return;
    const reason = decision === 'rejected' ? window.prompt('Motivo del rechazo:') : '';
    if (decision === 'rejected' && !reason) return alert('El motivo es obligatorio.');

    setIsActionLoading(true);
    try {
      const response = await fetch('http://localhost:8082/processInitialDecision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: selectedItem.id, decision, adminId: 'admin@minreport.com', reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      alert('Decisión procesada con éxito.');
      fetchData();
    } catch (err: any) { alert(`Error: ${err.message}`); } finally { setIsActionLoading(false); }
  };
  
  const handleFinalDecision = async (decision: 'activated' | 'rejected') => {
    if (!selectedItem || selectedItem.status !== 'pending_final_review') return;
    const reason = decision === 'rejected' ? window.prompt('Motivo del rechazo final:') : '';
    if (decision === 'rejected' && !reason) return alert('El motivo es obligatorio para el rechazo final.');

    setIsActionLoading(true);
    try {
      const response = await fetch('http://localhost:8082/processFinalDecision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: selectedItem.id, decision, adminId: 'admin@minreport.com', reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      alert('Decisión final procesada con éxito.');
      fetchData();
    } catch (err: any) { alert(`Error: ${err.message}`); } finally { setIsActionLoading(false); }
  };

  // --- UI Rendering ---
  const renderDetailView = () => {
    if (!selectedItem) return null;
    const isRequest = 'status' in selectedItem && typeof selectedItem.status === 'string';

    if (isRequest) {
      const item = selectedItem as Request;
      return (
        <div className="detail-view">
          <button onClick={() => setSelectedItem(null)} className="back-button">&larr; Volver</button>
          <h2>Detalle de Solicitud</h2>
          <div className="detail-grid">
            <p><strong>ID:</strong> <span>{item.id}</span></p>
            <p><strong>Estado:</strong> <span>{item.status}</span></p>
            <p><strong>Fecha Solicitud:</strong> <span>{item.createdAt.toDate().toLocaleString()}</span></p>
            <p><strong>Nombre Solicitante:</strong> <span>{item.applicantName}</span></p>
            <p><strong>Email Solicitante:</strong> <span>{item.applicantEmail}</span></p>
            <p><strong>País:</strong> <span>{item.country}</span></p>
            <p><strong>Tipo de Cuenta:</strong> <span>{item.accountType}</span></p>
            <p><strong>Tipo de Entidad:</strong> <span>{item.entityType === 'natural' ? 'Persona Natural' : 'Persona Jurídica'}</span></p>

            {item.accountType !== 'INDIVIDUAL' && (
              <>
                <p><strong>Nombre Institución / Razón Social:</strong> <span>{item.institutionName}</span></p>
                <p><strong>RUT:</strong> <span>{item.rut}</span></p>
              </>
            )}

            {item.status === 'pending_final_review' && item.additionalData && (
              <>
                <h3>Datos Adicionales Enviados:</h3>
                <p><strong>Administrador Designado:</strong> <span>{item.additionalData.designatedAdminName}</span></p>
                <p><strong>Email Administrador:</strong> <span>{item.additionalData.designatedAdminEmail}</span></p>
                {item.accountType === 'INDIVIDUAL' ? (
                  <p><strong>RUN del Solicitante:</strong> <span>{item.additionalData.run}</span></p>
                ) : (
                  <>
                    <p><strong>Dirección Institución:</strong> <span>{item.additionalData.institutionAddress}</span></p>
                    <p><strong>Teléfono Institución:</strong> <span>{item.additionalData.institutionPhone}</span></p>
                    <p><strong>Teléfono Contacto:</strong> <span>{item.additionalData.contactPhone}</span></p>
                  </>
                )}
              </>
            )}
          </div>

          <div className="action-buttons">
            {item.status === 'pending_review' && (
              <>
                <button className="approve" onClick={() => handleInitialDecision('approved')} disabled={isActionLoading}>Aprobar Inicialmente</button>
                <button className="reject" onClick={() => handleInitialDecision('rejected')} disabled={isActionLoading}>Rechazar</button>
              </>
            )}
            {item.status === 'pending_final_review' && (
              <>
                <button className="approve" onClick={() => handleFinalDecision('activated')} disabled={isActionLoading}>Activar Cuenta Definitiva</button>
                <button className="reject" onClick={() => handleFinalDecision('rejected')} disabled={isActionLoading}>Rechazar Finalmente</button>
              </>
            )}
          </div>

          <h3>Historial de Trazabilidad</h3>
          <ul className="history-list">{history.map(h => <li key={h.id}><strong>{h.action}</strong> por <em>{h.actor}</em> ({h.timestamp.toDate().toLocaleString()})<p>{h.details}</p></li>)}</ul>
        </div>
      );
    } else { // Account detail view
      const item = selectedItem as Account;
      return (
        <div className="detail-view">
          <button onClick={() => setSelectedItem(null)} className="back-button">&larr; Volver</button>
          <h2>Detalle de Cuenta</h2>
          <div className="detail-grid">
            <p><strong>ID:</strong> <span>{item.id}</span></p>
            <p><strong>Institución:</strong> <span>{item.institutionName}</span></p>
            <p><strong>Estado:</strong> <span>{item.status}</span></p>
            <p><strong>Fecha Creación:</strong> <span>{item.createdAt.toDate().toLocaleString()}</span></p>
            {/* Add more account details here as needed */}
          </div>
          <h3>Historial de Trazabilidad</h3>
          <ul className="history-list">{history.map(h => <li key={h.id}><strong>{h.action}</strong> por <em>{h.actor}</em> ({h.timestamp.toDate().toLocaleString()})<p>{h.details}</p></li>)}</ul>
        </div>
      );
    }
  };

  const renderListView = () => (
    <div className="list-view">
      {view === 'requests' && (
        <div className="sub-view-selector">
          <button onClick={() => setRequestFilter('pending_review')} className={requestFilter === 'pending_review' ? 'active' : ''}>Pendientes de Revisión</button>
          <button onClick={() => setRequestFilter('pending_final_review')} className={requestFilter === 'pending_final_review' ? 'active' : ''}>Pendientes de Aprobación Final</button>
        </div>
      )}
      {view === 'requests' && (requests.length > 0 ? <ul className="requests-list">{requests.map(req => <li key={req.id} onClick={() => handleSelectItem(req)}><strong>{req.institutionName}</strong><span>{req.applicantName}</span></li>)}</ul> : <p>No hay solicitudes en este estado.</p>)}
      {view === 'accounts' && (accounts.length > 0 ? <ul className="requests-list">{accounts.map(acc => <li key={acc.id} onClick={() => handleSelectItem(acc)}><strong>{acc.institutionName}</strong><span>{acc.id}</span></li>)}</ul> : <p>No hay cuentas activas.</p>)}
    </div>
  );

  return (
    <div className="panel-container">
      <div className="view-selector">
        <button onClick={() => setView('requests')} className={view === 'requests' ? 'active' : ''}>Solicitudes</button>
        <button onClick={() => setView('accounts')} className={view === 'accounts' ? 'active' : ''}>Cuentas Activas</button>
      </div>
      {isLoading ? <p>Cargando...</p> : error ? <p className="error">{error}</p> : (selectedItem ? renderDetailView() : renderListView())}
    </div>
  );
}