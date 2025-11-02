import { useState, useEffect, useCallback } from 'react';
import { db, functions, httpsCallable } from '../firebaseConfig.ts';
import { collection, getDocs, query, where, orderBy, doc, updateDoc } from 'firebase/firestore';
import './Subscriptions.css';

// --- Type Definitions ---
type RequestStatus = 'pending_review' | 'pending_additional_data' | 'pending_final_review' | 'rejected' | 'activated' | 'expired' | 'email_confirmed' | 'archived';
type Request = { 
  id: string; 
  status: RequestStatus; 
  createdAt: { toDate: () => Date; }; 
  applicantName: string; 
  applicantEmail: string; 
  rut?: string; 
  institutionName?: string; 
  accountType: 'B2B' | 'EDUCACIONALES' | 'INDIVIDUAL'; 
  country: string; 
  city?: string; 
  entityType: 'natural' | 'juridica'; 
  additionalData?: any;
  emailStatus?: string;
  emailId?: string;
  resendLastEvent?: string;
};
type HistoryEntry = { id: string; timestamp: { toDate: () => Date; }; action: string; actor: string; details?: string; };
type Clarification = { id: string; adminMessage: string; userReply?: string; status: string; createdAt: { toDate: () => Date; }; respondedAt?: { toDate: () => Date; }; };

// --- Helper Components ---
// Component para mostrar íconos de estado de email
const EmailStatusIcon = ({ emailStatus, resendLastEvent }: { emailStatus?: string, resendLastEvent?: string }) => {
    // Determinar el estado basado en emailStatus y resendLastEvent
    const getEmailStatus = () => {
        if (!emailStatus) return 'unknown';
        
        // Si tenemos resendLastEvent, usarlo para determinar el estado
        if (resendLastEvent) {
            switch (resendLastEvent.toLowerCase()) {
                case 'delivered':
                    return 'delivered';
                case 'bounce':
                case 'bounced':
                case 'failed':
                    return 'failed';
                case 'sent':
                    return 'pending';
                default:
                    return 'unknown';
            }
        }
        
        // Si no tenemos resendLastEvent, usar emailStatus
        switch (emailStatus.toLowerCase()) {
            case 'delivered':
                return 'delivered';
            case 'bounce':
            case 'bounced':
            case 'failed':
                return 'failed';
            case 'sent':
            case 'pending':
                return 'pending';
            default:
                return 'unknown';
        }
    };

    const status = getEmailStatus();
    
    switch (status) {
        case 'delivered':
            return (
                <span className="email-status email-delivered">
                    <span className="material-symbols-outlined">mark_email_read</span>
                </span>
            );
        case 'failed':
            return (
                <span className="email-status email-failed">
                    <span className="material-symbols-outlined">error</span>
                </span>
            );
        case 'pending':
            return (
                <span className="email-status email-pending">
                    <span className="material-symbols-outlined">schedule</span>
                </span>
            );
        default:
            return (
                <span className="email-status email-unknown">
                    <span className="material-symbols-outlined">help</span>
                </span>
            );
    }
};

// Función para obtener el icono según el tipo de cuenta
const getAccountTypeIcon = (accountType: string) => {
  switch(accountType) {
    case 'EMPRESARIAL':
      return 'business';
    case 'EDUCACIONAL':
      return 'school';
    case 'INDIVIDUAL':
      return 'person';
    default:
      return 'help_outline';
  }
};

const RequestCard = ({ request, onClick }: { request: Request, onClick: () => void }) => {
  const isEmailInvalid = request.emailStatus === 'failed_invalid_email';
  
  return (
    <div className={`request-card ${isEmailInvalid ? 'email-invalid' : ''}`} onClick={onClick}>
      <div className="card-header">
        <strong>{request.accountType === 'INDIVIDUAL' ? request.applicantName : request.institutionName}</strong>
              <div className="status-group">
        {/* Icono del tipo de cuenta */}
        <span className="account-type-icon" title={`Tipo: ${request.accountType}`}>
          <span className="material-symbols-outlined">{getAccountTypeIcon(request.accountType)}</span>
        </span>
        
        {request.status !== 'pending_review' && request.status !== 'email_confirmed' && (
          <span className={`status-badge status-${request.status}`}>{request.status.replace('_', ' ')}</span>
        )}
        {isEmailInvalid && request.status !== 'rejected' && (
          <span className="invalid-email-badge" title="Email inválido - Interacciones bloqueadas">
            <span className="material-symbols-outlined">block</span>
          </span>
        )}
      </div>
      </div>
      <div className="card-body">
        <p>{request.applicantEmail}</p>
        <div className="card-footer">
          <small>{request.createdAt.toDate().toLocaleDateString()}</small>
        </div>
      </div>
    </div>
  );
};

const DetailView = ({ request, onClose, onAction, isActionLoading, onRequestClarification, onImportEmailResult }: any) => {
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

    const renderDetails = () => {
    // Limpieza: se eliminó debug de consola
        
    // Limpieza: se eliminó debug de consola
        
        return (
        <div className="detail-content-section">
            {/* Para personas jurídicas (EMPRESARIAL/EDUCACIONAL): dividir en dos subtarjetas */}
            {(request.accountType === 'EMPRESARIAL' || request.accountType === 'EDUCACIONAL') ? (
                <>
                    {/* Subtarjeta 1: Datos del Solicitante */}
                    <div className="data-card">
                        <h4>Datos del Solicitante</h4>
                        {request.applicantName && <p><span className="material-symbols-outlined icon-inline">person</span> <span>{request.applicantName}</span></p>}
                        {request.applicantEmail && <p><span className="material-symbols-outlined icon-inline">mail</span> <span>{request.applicantEmail}</span></p>}
                        {/* Ubicación básica: ciudad, país */}
                        {(request.city || request.country) && (
                            <p><span className="material-symbols-outlined icon-inline">globe_location_pin</span> 
                               <span>{[request.city, request.country].filter(Boolean).join(', ')}</span></p>
                        )}
                    </div>
                    
                    {/* Subtarjeta 2: Datos Corporativos */}
                    <div className="data-card">
                        <h4>Datos Corporativos</h4>
                        {request.accountType && <p><span className="material-symbols-outlined icon-inline">business</span> <span>Tipo: {request.accountType}</span></p>}
                        {request.institutionName && <p><span className="material-symbols-outlined icon-inline">business</span> <span>Institución: {request.institutionName}</span></p>}
                        {request.rut && <p><span className="material-symbols-outlined icon-inline">badge</span> <span>RUT: {request.rut}</span></p>}
                    </div>
                </>
            ) : (
                /* Para personas naturales (INDIVIDUAL): tarjeta única como antes */
                <div className="data-card">
                    <h4>Datos del Solicitante</h4>
                    {request.applicantName && <p><span className="material-symbols-outlined icon-inline">person</span> <span>{request.applicantName}</span></p>}
                    {request.applicantEmail && <p><span className="material-symbols-outlined icon-inline">mail</span> <span>{request.applicantEmail}</span></p>}
                    {/* Ubicación básica: ciudad, país */}
                    {(request.city || request.country) && (
                        <p><span className="material-symbols-outlined icon-inline">globe_location_pin</span> 
                           <span>{[request.city, request.country].filter(Boolean).join(', ')}</span></p>
                    )}
                    {request.accountType && <p><span className="material-symbols-outlined icon-inline">person</span> <span>Tipo: {request.accountType}</span></p>}
                    {request.rut && <p><span className="material-symbols-outlined icon-inline">badge</span> <span>RUN: {request.rut}</span></p>}
                </div>
            )}
            
            {/* Sección de Estado del Email - SOLO para solicitudes falsas/problemáticas */}
            {(request.emailStatus === 'failed_invalid_email' || 
              request.resendLastEvent === 'bounced' || 
              request.resendLastEvent === 'complained' || 
              request.resendLastEvent === 'failed') && (
            <div className={`data-card email-status-card email-invalid`}>
                <h4>Estado del Email</h4>
                <div className="email-status-details">
                    {request.emailId ? (
                        <>
                            <p><span className="material-symbols-outlined icon-inline">alternate_email</span> 
                               <code>{request.emailId}</code></p>
                            {(request.resendLastEvent || request.emailStatus) && (
                                <p><EmailStatusIcon emailStatus={request.emailStatus} resendLastEvent={request.resendLastEvent} />
                                   <span>{request.resendLastEvent || request.emailStatus}</span></p>
                            )}
                        </>
                    ) : (
                        <p><span className="material-symbols-outlined icon-inline">mail_off</span> 
                           <span>No se envió email</span></p>
                    )}
                </div>
            </div>
            )}
            {request.additionalData && <>
                <div className="data-card">
                    <h4>Datos del Administrador Designado</h4>
                    {request.additionalData.adminName && <p><span className="material-symbols-outlined icon-inline">person</span> <span>{request.additionalData.adminName}</span></p>}
                    {request.additionalData.adminEmail && <p><span className="material-symbols-outlined icon-inline">mail</span> <span>{request.additionalData.adminEmail}</span></p>}
                    {request.additionalData.adminPhone && <p><span className="material-symbols-outlined icon-inline">phone</span> <a href={`tel:${request.additionalData.adminPhone}`}>{request.additionalData.adminPhone}</a></p>}
                    {request.additionalData.adminRole && <p><span className="material-symbols-outlined icon-inline">work</span> <span>{request.additionalData.adminRole}</span></p>}
                    {request.additionalData.run && <p><span className="material-symbols-outlined icon-inline">fingerprint</span> <span>RUN: {request.additionalData.run}</span></p>}
                </div>
            </>}

            {request.additionalData?.streetAddress && <>
                <div className="data-card">
                    <h4>Dirección Comercial</h4>
                    {request.additionalData.streetAddress && <p><span className="material-symbols-outlined icon-inline">home</span> <span>{request.additionalData.streetAddress}</span></p>}
                </div>
            </>}
        </div>
        );
    };

    return (
        <div className="detail-modal-overlay" onClick={onClose}>
            <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="close-button">&times;</button>
                <div className="modal-header-with-actions">
                    <div className="header-title-group">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {view !== 'details' && <button onClick={() => setView('details')} className="icon-button back-to-details-button"><span className="material-symbols-outlined">arrow_back</span></button>}
                            <h2>{view === 'clarifications' ? 'Aclaraciones de Solicitud' : 'Detalle de Solicitud'}</h2>
                            {view === 'clarifications' && <button onClick={onRequestClarification} className="icon-button"><span className="material-symbols-outlined">add_comment</span></button>}
                        </div>
                        <p className="request-detail-subtitle">{request.accountType === 'INDIVIDUAL' ? request.applicantName : request.institutionName}</p>
                        {request.rut && <p className="request-detail-subtitle">RUT: {request.rut}</p>}
                        {request.additionalData?.run && <p className="request-detail-subtitle">RUN: {request.additionalData.run}</p>}
                    </div>
                    <div className="header-icons" style={{ display: 'flex', gap: '1rem' }}>
                        {view === 'details' && <button onClick={() => setView('history')} className="icon-button"><span className="material-symbols-outlined">history</span></button>}
                        {view === 'details' && request.status !== 'pending_additional_data' && request.emailStatus !== 'failed_invalid_email' && <button onClick={() => setView('clarifications')} className="icon-button"><span className="material-symbols-outlined">chat_bubble_outline</span></button>}
                        

                        {/* Botón de rechazar - SIMPLE: aparece para cualquier solicitud no finalizada */}
                        {view === 'details' && request.status !== 'activated' && request.status !== 'rejected' && request.status !== 'archived' && (
                            <button 
                                className="icon-button" 
                                onClick={() => onAction('rejected')} 
                                disabled={isActionLoading}
                                title={request.emailStatus === 'failed_invalid_email' ? "Rechazar solicitud falsa" : "Rechazar solicitud"}
                                style={{ backgroundColor: request.emailStatus === 'failed_invalid_email' ? '#ffebee' : '' }}
                            >
                                <span className="material-symbols-outlined">unpublished</span>
                            </button>
                        )}
                        
                        {/* Botón de aprobar - solo para emails válidos */}
                        {view === 'details' && request.status === 'pending_review' && request.emailStatus !== 'failed_invalid_email' && (
                            <button 
                                className="icon-button" 
                                onClick={() => onAction('approved')} 
                                disabled={isActionLoading}
                                title="Aprobar solicitud"
                            >
                                <span className="material-symbols-outlined">check</span>
                            </button>
                        )}
                        
                        {view === 'details' && request.status === 'pending_final_review' && request.emailStatus !== 'failed_invalid_email' && (
                            <button 
                                className="icon-button" 
                                onClick={() => onAction('activated')} 
                                disabled={isActionLoading}
                                title="Activar cuenta"
                            >
                                <span className="material-symbols-outlined">done_all</span>
                            </button>
                        )}
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
                        <button onClick={() => setView('details')} className="icon-button back-to-details-button"><span className="material-symbols-outlined">arrow_back</span></button>
                        <h3>HISTORIAL</h3>
                        <ul className="history-list">{history.map((h, index) => <li key={h.id}><strong>{index + 1}. {h.action}</strong> por <em>{h.actor}</em> ({h.timestamp.toDate().toLocaleString()})<p>{h.details}</p></li>)}</ul>
                    </>
                )}

                {view === 'clarifications' && (
                    <>
                        
                        <p style={{ display: 'flex', alignItems: 'center' }}><span className="material-symbols-outlined icon-inline" style={{ marginRight: '0.5rem' }}>person</span> {request.applicantName} ({request.applicantEmail})</p>
                        <div className="clarifications-list">{clarifications.map((c, idx) => <div key={c.id} className='clarification-item'><strong>{idx + 1}. Pregunta:</strong> <small>{c.createdAt.toDate().toLocaleString()}</small><p>{c.adminMessage}</p>{c.userReply && <><strong>Respuesta:</strong> {c.respondedAt && <small>{c.respondedAt.toDate().toLocaleString()}</small>}<p>{c.userReply}</p></>}</div>)}</div>
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
  const [error, setError] = useState<string>('');
  const [showRequestHistory, setShowRequestHistory] = useState(false);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch both 'requests' (admin collection) and 'initial_requests' (completed by user)
      const [requestsSnap, initialSnap] = await Promise.all([
        getDocs(query(collection(db, 'requests'))),
        getDocs(query(collection(db, 'initial_requests'))),
      ]);

      // Map existing `requests` documents
      const listFromRequests = requestsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Request));

      // Normalize `initial_requests` into the same Request shape so admin can see them
      const listFromInitial = initialSnap.docs.map(d => {
        const data: any = d.data();
        // Map status: if user completed the form, surface as 'pending_review' for admins
        const statusMap: any = {
          completed: 'pending_review',
        };
        const mappedStatus = statusMap[data.status] || (data.status as any) || 'pending_review';

        // Ensure createdAt has toDate() API
        const createdAtVal = data.createdAt;
        const createdAtWrapper = {
          toDate: () => {
            if (!createdAtVal) return new Date();
            if (typeof createdAtVal.toDate === 'function') return createdAtVal.toDate();
            if (createdAtVal instanceof Date) return createdAtVal;
            return new Date(createdAtVal);
          }
        };

        return ({
          id: d.id,
          status: mappedStatus,
          createdAt: createdAtWrapper,
          applicantName: data.applicantName || data.name || '',
          applicantEmail: data.applicantEmail || data.email || '',
          rut: data.rut,
          institutionName: data.companyName || data.institutionName,
          accountType: data.accountType || 'INDIVIDUAL',
          country: data.country || '',
          city: data.city || '',
          entityType: data.entityType || 'natural',
          additionalData: {
            ...data
          },
          emailStatus: data.emailStatus,
          emailId: data.emailId,
          resendLastEvent: data.resendLastEvent,
        } as Request);
      });

      // Merge both lists, avoiding duplicates (prefer entries from `requests` when id collides)
      const mergedById: Record<string, Request> = {};
      for (const r of [...listFromInitial, ...listFromRequests]) {
        mergedById[r.id] = { ...(mergedById[r.id] || {}), ...r };
      }

      const mergedList = Object.values(mergedById).sort((a, b) => {
        const aTime = a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

      console.log('⚡ Cargando solicitudes (requests + initial_requests) - TOTAL:', mergedList.length);
      setRequests(mergedList);
      setError('');
    } catch (err: any) { 
        console.error("Error fetching requests: ", err);
        setError(`Error al cargar solicitudes: ${err.message}`); 
    } finally { 
        setIsLoading(false);
    }
  }, [showRequestHistory]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleImportEmailResult = async (emailId: string) => {
    try {
  // Limpieza: se eliminó debug de consola
      
      const importEmailResult = httpsCallable(functions, 'importEmailResult');
      const result = await importEmailResult({ emailId });
      
      const data = result.data as any;
      
      if (data.success) {
  // Limpieza: se eliminó debug de consola
        alert(`Estado del email actualizado: ${data.lastEvent || 'actualizado'}`);
        
        // Recargar las solicitudes para mostrar el estado actualizado
        fetchRequests();
      } else {
        console.error('❌ Error importando:', data.error);
        alert(`Error al importar resultado: ${data.error || 'Error desconocido'}`);
      }
    } catch (error) {
      console.error('❌ Error en importación:', error);
      alert('Error al importar el resultado del email');
    }
  };


  const handleAction = async (decision: string) => {
    if (!selectedRequest) return;

    const confirmationText = decision === 'approved' || decision === 'activated' ? 'aprobar' : 'rechazar';
    const userConfirmation = window.prompt(`Para confirmar la acción de ${confirmationText}, escribe "${confirmationText}" en el campo de abajo:`);

    if (!userConfirmation || userConfirmation.toLowerCase() !== confirmationText) {
      alert('Confirmación incorrecta o cancelada. La acción no se realizará.');
      return;
    }
    
    let callableFunction: any; // functions.HttpsCallable<any, any>;
    let body: any = { requestId: selectedRequest.id, adminId: 'admin@minreport.com' };
    let actionMessage = '';

    if (decision === 'rejected') {
      // Para solicitudes con email falso/inválido, usar razón automática
      if (selectedRequest.emailStatus === 'failed_invalid_email' || 
          selectedRequest.resendLastEvent === 'bounced' ||
          selectedRequest.resendLastEvent === 'complained' ||
          selectedRequest.resendLastEvent === 'failed') {
        body.reason = 'email falso';
        console.log('🚫 Usando razón automática para email falso:', body.reason);
      } else {
        const promptResult = window.prompt('Por favor, especifica el motivo del rechazo:');
        if (!promptResult) return; // User cancelled the prompt
        body.reason = promptResult;
      }
      actionMessage = 'rechazar';
    } else if (decision === 'approved') {
      actionMessage = 'aprobar';
    } else if (decision === 'activated') {
      actionMessage = 'activar';
    }

    if (selectedRequest.status === 'pending_review') {
      callableFunction = httpsCallable(functions, 'processInitialDecisionFunction');
      body.decision = decision;
    } else if (selectedRequest.status === 'pending_final_review') {
      callableFunction = httpsCallable(functions, 'processFinalDecisionFunction');
      body.decision = decision; // Agregar la decisión para el procesamiento final
    } else {
      alert('Acción no válida para el estado actual de la solicitud.');
      return;
    }

    setIsActionLoading(true);
    try {
      const result = await callableFunction(body);
      const { status, message } = result.data as { status: string, message: string };

      if (status !== 'success') {
        throw new Error(message || `Ocurrió un error al ${actionMessage} la solicitud.`);
      }
      alert(`Acción completada con éxito: ${message}`);
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
          const requestClarification = httpsCallable(functions, 'requestClarificationFunction');
          const result = await requestClarification({ requestId: selectedRequest.id, adminId: 'admin@minreport.com', message });
          const { status, message: resultMessage } = result.data as { status: string, message: string };

          if (status !== 'success') {
            throw new Error(resultMessage || 'Falló el envío de la aclaración.');
          }
          alert(`Solicitud de aclaración enviada: ${resultMessage}`);
      } catch (err: any) { 
          alert(`Error al enviar la solicitud de aclaración: ${err.message}`); 
      } finally { 
          setIsActionLoading(false); 
      }
  };

  // COLUMNAS ORIGINALES DEL PROCESO RESTAURADAS
  const columns: { title: string, statuses: RequestStatus[] }[] = [
    { title: 'Nuevas Solicitudes', statuses: ['pending_review', 'pending_additional_data', 'pending_final_review', 'rejected', 'activated'] },
    { title: 'Esperando Datos Adicionales', statuses: ['pending_additional_data'] },
    { title: 'Revisión Final', statuses: ['pending_final_review'] },
  ];

  if (isLoading) return <p>Cargando solicitudes...</p>;
  if (error) return <p className="error">{error}</p>;

  

// ... (rest of the file) ...

  return (
    <div className="subscriptions-board">
      <div className="view-toggle-buttons">
        <button 
          className={`button-toggle ${showRequestHistory ? 'active' : ''}`} 
          onClick={() => setShowRequestHistory(!showRequestHistory)}
        >
          <span className="material-symbols-outlined">history</span>
          {showRequestHistory ? 'Ver Solicitudes Pendientes' : 'Historial de Solicitudes'}
        </button>
      </div>

      {/* Historial de solicitudes deshabilitado temporalmente */}
      {showRequestHistory ? (
        <div className="columns-container">
          <div className="board-column">
            <h3>Solicitudes Archivadas ({requests.length})</h3>
            <div className="column-content">
              {requests.map(req => (
                <RequestCard key={req.id} request={req} onClick={() => setSelectedRequest(req)} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="columns-container">
          {columns.map((col, index) => {
            // PRIMERA COLUMNA (Nuevas Solicitudes): TODAS las solicitudes
            // OTRAS COLUMNAS: filtros normales por estado
            const filteredRequests = index === 0 
              ? requests  // TODAS LAS SOLICITUDES en primera columna
              : requests.filter(r => col.statuses.includes(r.status));
            
            console.log(`🔍 Debug - Columna "${col.title}" ${index === 0 ? '(TODAS)' : '(FILTRADA)'}:`, filteredRequests.length, 'requests');
            console.log('Solicitudes en esta columna:', filteredRequests.map(r => ({ name: r.applicantName, status: r.status, emailStatus: r.emailStatus })));
            
            return (
              <div key={col.title} className="board-column">
                <h3>{col.title} ({filteredRequests.length})</h3>
                <div className="column-content">
                  {filteredRequests.map(req => (
                    <RequestCard key={req.id} request={req} onClick={() => setSelectedRequest(req)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selectedRequest && 
        <DetailView 
          request={selectedRequest} 
          onClose={() => setSelectedRequest(null)} 
          onAction={handleAction}
          isActionLoading={isActionLoading}
          onRequestClarification={handleRequestClarification}
          onImportEmailResult={handleImportEmailResult}
          initialView={showRequestHistory ? 'history' : 'details'}
        />}
    </div>
  );
};

export default Subscriptions;

/* Estilos para icono de tipo de cuenta */
const styles = `
.account-type-icon {
  color: #4b5563;
  display: flex;
  align-items: center;
  margin-right: 8px;
}

.account-type-icon .material-symbols-outlined {
  font-size: 20px;
  font-weight: 500;
}
`;

// Insertar estilos en el head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style");
  styleSheet.type = "text/css";
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}
