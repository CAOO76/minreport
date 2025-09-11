import { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';

interface AccountLogViewerProps {
  accountId: string;
  onClose: () => void;
}

interface AccountLog {
  id: string;
  action: string; // Ej: 'account_created', 'account_suspended', 'account_activated'
  timestamp: Date;
  details?: any; // Detalles adicionales de la acción
  performedBy?: string; // ID o nombre del administrador que realizó la acción
}

export const AccountLogViewer = ({ accountId, onClose }: AccountLogViewerProps) => {
  const [logs, setLogs] = useState<AccountLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      setIsLoading(true);
      try {
        const logsCollection = collection(db, 'account_logs');
        const q = query(
          logsCollection,
          where('accountId', '==', accountId),
          orderBy('timestamp', 'desc')
        );
        const querySnapshot = await getDocs(q);
        const logsList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp.toDate(),
        } as AccountLog));
        setLogs(logsList);
        setError(null);
      } catch (err) {
        console.error("Error fetching account logs:", err);
        setError('Error al cargar los logs de la cuenta.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogs();
  }, [accountId]);

  if (isLoading) {
    return (
      <div className="log-viewer-modal">
        <div className="log-viewer-content">
          <p>Cargando historial de la cuenta...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="log-viewer-modal">
        <div className="log-viewer-content">
          <p className="error-message">{error}</p>
          <button onClick={onClose}>Cerrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="log-viewer-modal">
      <div className="log-viewer-content">
        <h3>Historial de la Cuenta: {accountId}</h3>
        <button onClick={onClose} className="close-button">X</button>
        {logs.length > 0 ? (
          <ul className="log-list">
            {logs.map(log => (
              <li key={log.id} className="log-item">
                <strong>{log.action}</strong>
                <span>{log.timestamp.toLocaleString()}</span>
                {log.performedBy && <span> por {log.performedBy}</span>}
                {log.details && <pre>{JSON.stringify(log.details, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay registros de actividad para esta cuenta.</p>
        )}
      </div>
    </div>
  );
};
