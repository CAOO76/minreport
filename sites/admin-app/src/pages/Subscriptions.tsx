import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import './Subscriptions.css';

// --- Type Definitions ---
type RequestStatus = 'pending_review' | 'pending_additional_data' | 'pending_final_review' | 'rejected' | 'activated' | 'expired';
type Request = { id: string; status: RequestStatus; createdAt: { toDate: () => Date; }; applicantName: string; applicantEmail: string; rut?: string; institutionName?: string; accountType: 'B2B' | 'EDUCACIONALES' | 'INDIVIDUAL'; country: string; city?: string; entityType: 'natural' | 'juridica'; additionalData?: any; };
type HistoryEntry = { id: string; timestamp: { toDate: () => Date; }; action: string; actor: string; details?: string; };
type Clarification = { id: string; adminMessage: string; userReply?: string; status: string; createdAt: { toDate: () => Date; }; };

// --- Helper Components ---
const RequestCard = ({ request, onClick }: { request: Request, onClick: () => void }) => (
  <div className="request-card" onClick={onClick}>
    <div className="card-header">
      <strong>{request.accountType === 'INDIVIDUAL' ? request.applicantName : request.institutionName}</strong>
      <span className={`status-badge status-${request.status}`}>{request.status.replace('_', ' ')}</span>
    </div>
    <div className="card-body">
      <p>{request.applicantEmail}</p>
      <small>{request.createdAt.toDate().toLocaleDateString()}</small>
    </div>
  </div>
);

const DetailView = ({ request, onClose, onAction, isActionLoading, onRequestClarification }: any) => {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [clarifications, setClarifications] = useState<Clarification[]>([]);
    const [view, setView] = useState('details'); // 'details', 'history', 'clarifications'

    const hasPendingClarification = clarifications.some(c => c.status === 'pending_response');

    useEffect(() => {
        const fetchSubCollections = async () => {
            const historyQuery = query(collection(db, 'requests', request.id, 'history'), orderBy('timestamp', 'desc'));
            const clarificationsQueryAsc = query(collection(db, 'requests', request.id, 'clarifications'), orderBy('createdAt', 'asc'));
            const clarificationsSnapshotAsc = await getDocs(clarificationsQueryAsc);
            const clarificationsWithOriginalIndex = clarificationsSnapshotAsc.docs.map((d, idx) => ({ id: d.id, ...d.data(), originalIndex: idx + 1 } as Clarification & { originalIndex: number }));

            // Now sort for display (latest first)
            const sortedClarifications = [...clarificationsWithOriginalIndex].sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime());

            const [historySnapshot] = await Promise.all([getDocs(historyQuery)]); // Only fetch history here
            setHistory(historySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as HistoryEntry)));
            setClarifications(sortedClarifications);
        };
        fetchSubCollections();
    }, [request.id]);

    const renderDetails = () => (
        <div className="detail-content-section">
            <div className="data-card">
                <h4>Datos del Solicitante</h4>
                <p><span className="material-symbols-outlined icon-inline">person</span> <span>{request.applicantName}</span></p>
                <p><span className="material-symbols-outlined icon-inline">mail</span> <span>{request.applicantEmail}</span></p>
                <p><span className="material-symbols-outlined icon-inline">flag</span> <span>{request.country}</span></p>
                {request.accountType === 'INDIVIDUAL' && <p><span className="material-symbols-outlined icon-inline">location_city</span> <span>{request.city}</span></p>}
            </div>
            {request.additionalData && <>
                <div className="data-card">
                    <h4>Datos del Administrador Designado</h4>
                <p><span className="material-symbols-outlined icon-inline">person</span> <span>{request.additionalData.adminName}</span></p>
                <p><span className="material-symbols-outlined icon-inline">mail</span> <span>{request.additionalData.adminEmail}</span></p>
                <p><span className="material-symbols-outlined icon-inline">phone</span> <a href={`tel:${request.additionalData.adminPhone}`}>{request.additionalData.adminPhone}</a></p>
                {request.additionalData.adminRole && <p><span className="material-symbols-outlined icon-inline">work</span> <span>{request.additionalData.adminRole}</span></p>}
                </div>
            </>}

            {request.additionalData?.streetAddress && <>
                <div className="data-card">
                    <h4>Dirección Comercial</h4>
                <p><span className="material-symbols-outlined icon-inline">home</span> <span>{request.additionalData.streetAddress}</span></p>
                <p><span className="material-symbols-outlined icon-inline">location_city</span> <span>{request.additionalData.city}</span></p>
                <p><span className="material-symbols-outlined icon-inline">map</span> <span>{request.additionalData.state}</span></p>
                <p><span className="material-symbols-outlined icon-inline">pin_drop</span> <span>{request.additionalData.postalCode}</span></p>
                </div>
            </>}
        </div>
    );

    return (
        <div className="detail-modal-overlay" onClick={onClose}>
            <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="close-button">&times;</button>
                <div className="modal-header-with-actions">
                    <div className="header-title-group">
                        <h2>Detalle de Solicitud</h2>
                        <p className="request-detail-subtitle">{request.accountType === 'INDIVIDUAL' ? request.applicantName : request.institutionName}</p>
                        {request.rut && <p className="request-detail-subtitle">RUT: {request.rut}</p>}
                        {request.additionalData?.run && <p className="request-detail-subtitle">RUN: {request.additionalData.run}</p>}
                    </div>
                    <div className="header-icons" style={{ display: 'flex', gap: '1rem' }}>
                        {view === 'details' && <button onClick={() => setView('history')} className="icon-button"><span className="material-symbols-outlined">history</span></button>}
                        {view === 'details' && <button onClick={() => setView('clarifications')} className="icon-button"><span className="material-symbols-outlined">chat_bubble_outline</span></button>}
                        {view === 'details' && request.status !== 'activated' && request.status !== 'rejected' && <button className="icon-button" onClick={() => onAction('rejected')} disabled={isActionLoading}><span className="material-symbols-outlined">unpublished</span></button>}
                        {view === 'details' && request.status === 'pending_final_review' && <button className="icon-button" onClick={() => onAction('activated')} disabled={isActionLoading}><span className="material-symbols-outlined">done_all</span></button>}
                    </div>
                </div>
                
                {hasPendingClarification && (
                    <div className="pending-clarification-alert">
                        <span className="material-symbols-outlined">help_outline</span>
                        <p>Aclaración pendiente de respuesta por parte del usuario.</p>
                    </div>
                )}

                

                {view === 'details' && (
                    <>
                        {renderDetails()}
                    </>
                )}

                {view === 'history' && (
                    <>
                        <button onClick={() => setView('details')} className="icon-button"><span className="material-symbols-outlined">arrow_back</span></button>
                        <h3>HISTORIAL</h3>
                        <ul className="history-list">{history.map((h, index) => <li key={h.id}><strong>{index + 1}. {h.action}</strong> por <em>{h.actor}</em> ({h.timestamp.toDate().toLocaleString()})<p>{h.details}</p></li>)}</ul>
                    </>
                )}

                {view === 'clarifications' && (
                    <>
                        <button onClick={() => setView('details')} className="icon-button"><span className="material-symbols-outlined">arrow_back</span></button>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3>Aclaraciones</h3>
                            <button onClick={onRequestClarification} className="icon-button"><span className="material-symbols-outlined">add_comment</span></button>
                        </div>
                        <div className="clarifications-list">{clarifications.map((c) => <div key={c.id} className='clarification-item'><strong>{c.originalIndex}. Pregunta:</strong> <small>{c.createdAt.toDate().toLocaleString()}</small><p>{c.adminMessage}</p>{c.userReply && <><strong>Respuesta:</strong><p>{c.userReply}</p></>}</div>)}</div>
                    </>
                )}
            </div>
        </div>
    );
};

// --- Main Component ---
const Subscriptions = () => {
  const [requests, setRequests] = useState<Request[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'requests'), where('status', 'in', ['pending_review', 'pending_additional_data', 'pending_final_review']));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Request));
      setRequests(list);
      setError(null);
    } catch (err: any) { 
        console.error("Error fetching requests: ", err);
        setError(`Error al cargar solicitudes: ${err.message}`); 
    } finally { 
        setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleAction = async (decision: string) => {
    if (!selectedRequest) return;
    
    let url = '';
    let body: any = { requestId: selectedRequest.id, adminId: 'admin@minreport.com' };
    let reason = '';

    if (decision === 'rejected') {
        reason = window.prompt('Por favor, especifica el motivo del rechazo:');
        if (!reason) return; // User cancelled the prompt
        body.reason = reason;
    }

    if (selectedRequest.status === 'pending_review') {
      url = 'http://localhost:8082/processInitialDecision';
      body.decision = decision;
    } else if (selectedRequest.status === 'pending_final_review') {
      url = 'http://localhost:8082/processFinalDecision';
      body.decision = decision;
    }

    if (!url) return;

    setIsActionLoading(true);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      alert('Acción completada con éxito.');
      setSelectedRequest(null);
      fetchRequests(); // Refresh list
    } catch (err: any) { 
        alert(`Error al procesar la acción: ${err.message}`); 
    } finally { 
        setIsActionLoading(false); 
    }
  };

  const handleRequestClarification = async () => {
      if (!selectedRequest) return;
      const message = window.prompt('Escribe el mensaje o la pregunta para el solicitante:');
      if (!message) return;

      setIsActionLoading(true);
      try {
          const response = await fetch('http://localhost:8082/request-clarification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId: selectedRequest.id, adminId: 'admin@minreport.com', message })
          });
          if (!response.ok) throw new Error('Falló el envío de la aclaración.');
          alert('Solicitud de aclaración enviada.');
      } catch (err: any) { 
          alert(`Error al enviar la solicitud de aclaración: ${err.message}`); 
      } finally { 
          setIsActionLoading(false); 
      }
  };

  const columns: { title: string, status: RequestStatus }[] = [
    { title: 'Nuevas Solicitudes', status: 'pending_review' },
    { title: 'Esperando Datos Adicionales', status: 'pending_additional_data' },
    { title: 'Revisión Final', status: 'pending_final_review' },
  ];

  if (isLoading) return <p>Cargando solicitudes...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="subscriptions-board">
      {columns.map(col => (
        <div key={col.status} className="board-column">
          <h3>{col.title} ({requests.filter(r => r.status === col.status).length})</h3>
          <div className="column-content">
            {requests.filter(r => r.status === col.status).map(req => (
              <RequestCard key={req.id} request={req} onClick={() => setSelectedRequest(req)} />
            ))}
          </div>
        </div>
      ))}
      {selectedRequest && 
        <DetailView 
          request={selectedRequest} 
          onClose={() => setSelectedRequest(null)} 
          onAction={handleAction}
          isActionLoading={isActionLoading}
          onRequestClarification={handleRequestClarification}
        />}
    </div>
  );
};

export default Subscriptions;
