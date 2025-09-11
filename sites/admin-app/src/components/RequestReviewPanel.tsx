
import { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, query, where } from 'firebase/firestore';
import './RequestReviewPanel.css';

// Basado en DATA_CONTRACT.md
type Request = {
  id: string;
  institutionName: string;
  applicantName: string;
  applicantEmail: string;
  accountType: 'B2B' | 'EDUCATIONAL';
  status: 'pending_review' | 'pending_additional_data' | 'rejected' | 'approved';
  createdAt: Date;
  // Agrega otros campos que esperas de la solicitud
};

export function RequestReviewPanel() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRequests = async () => {
      setIsLoading(true);
      try {
        const requestsCollection = collection(db, 'requests');
        const q = query(requestsCollection, where('status', '==', 'pending_review'));
        const querySnapshot = await getDocs(q);
        const requestsList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          // Firestore Timestamps deben ser convertidos a Date
          createdAt: doc.data().createdAt.toDate(),
        } as Request));
        setRequests(requestsList);
        setError(null);
      } catch (err) {
        console.error("Error fetching requests:", err);
        setError('Error al cargar las solicitudes. Verifique la consola.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRequests();
  }, []);

  const handleSelectRequest = (request: Request) => {
    setSelectedRequest(request);
  };

  const handleBackToList = () => {
    setSelectedRequest(null);
  };

  if (isLoading) {
    return <div className="panel-container">Cargando solicitudes...</div>;
  }

  if (error) {
    return <div className="panel-container error">{error}</div>;
  }

  return (
    <div className="panel-container">
      <header className="panel-header">
        <h1>Panel de Revisión</h1>
        <p>Solicitudes pendientes de aprobación inicial.</p>
      </header>
      {selectedRequest ? (
        <div className="detail-view">
          <button onClick={handleBackToList} className="back-button">&larr; Volver a la lista</button>
          <h2>Detalle de la Solicitud</h2>
          <div className="detail-grid">
            <p><strong>ID:</strong> {selectedRequest.id}</p>
            <p><strong>Institución:</strong> {selectedRequest.institutionName}</p>
            <p><strong>Solicitante:</strong> {selectedRequest.applicantName}</p>
            <p><strong>Email:</strong> {selectedRequest.applicantEmail}</p>
            <p><strong>Tipo de Cuenta:</strong> {selectedRequest.accountType}</p>
            <p><strong>Estado:</strong> {selectedRequest.status}</p>
            <p><strong>Fecha:</strong> {selectedRequest.createdAt.toLocaleString()}</p>
          </div>
          <div className="action-buttons">
            <button className="approve">Aprobar</button>
            <button className="reject">Rechazar</button>
          </div>
        </div>
      ) : (
        <div className="list-view">
          {requests.length > 0 ? (
            <ul className="requests-list">
              {requests.map(req => (
                <li key={req.id} onClick={() => handleSelectRequest(req)}>
                  <div className="request-item-header">
                    <strong>{req.institutionName}</strong>
                    <span>{req.accountType}</span>
                  </div>
                  <div className="request-item-body">
                    <span>{req.applicantName}</span>
                    <span className="date">{req.createdAt.toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No hay solicitudes pendientes.</p>
          )}
        </div>
      )}
    </div>
  );
}
