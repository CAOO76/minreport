import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig.ts';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';

type RequestStatus = 'pending_review' | 'pending_additional_data' | 'pending_final_review' | 'rejected' | 'activated' | 'expired';
type Request = { id: string; status: RequestStatus; createdAt: { toDate: () => Date; }; applicantName: string; applicantEmail: string; rut?: string; institutionName?: string; accountType: 'B2B' | 'EDUCACIONALES' | 'INDIVIDUAL'; country: string; city?: string; entityType: 'natural' | 'juridica'; additionalData?: any; };

const RequestHistoryTable: React.FC = () => {
  const [requests, setRequests] = useState<Request[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<keyof Request>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchHistoryRequests = async () => {
      setIsLoading(true);
      try {
        const q = query(
          collection(db, 'requests'),
          where('status', 'in', ['activated', 'rejected']),
          orderBy(sortColumn, sortDirection)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Request));
        setRequests(list);
        setError(null);
      } catch (err: any) {
        console.error("Error fetching history requests: ", err);
        setError(`Error al cargar el historial de solicitudes: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistoryRequests();
  }, [sortColumn, sortDirection]); // Re-fetch when sort changes

  const handleSort = (column: keyof Request) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const filteredRequests = requests.filter(request => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return (
      request.applicantName.toLowerCase().includes(lowerCaseSearchTerm) ||
      request.applicantEmail.toLowerCase().includes(lowerCaseSearchTerm) ||
      (request.institutionName && request.institutionName.toLowerCase().includes(lowerCaseSearchTerm)) ||
      (request.rut && request.rut.toLowerCase().includes(lowerCaseSearchTerm))
    );
  });

  if (isLoading) return <p>Cargando historial de solicitudes...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="request-history-table">
      <h2>Historial de Solicitudes</h2>
      <input 
        type="text" 
        placeholder="Buscar por nombre, email, institución o RUT..." 
        value={searchTerm} 
        onChange={(e) => setSearchTerm(e.target.value)} 
        className="search-input"
      />
      <table>
        <thead>
          <tr>
            <th onClick={() => handleSort('createdAt')}>Fecha <span className="material-symbols-outlined">{sortColumn === 'createdAt' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span></th>
            <th onClick={() => handleSort('applicantName')}>Solicitante <span className="material-symbols-outlined">{sortColumn === 'applicantName' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span></th>
            <th onClick={() => handleSort('accountType')}>Tipo de Cuenta <span className="material-symbols-outlined">{sortColumn === 'accountType' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span></th>
            <th onClick={() => handleSort('status')}>Estado <span className="material-symbols-outlined">{sortColumn === 'status' ? (sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span></th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filteredRequests.map(request => (
            <tr key={request.id}>
              <td>{request.createdAt.toDate().toLocaleDateString()}</td>
              <td>{request.applicantName}</td>
              <td>{request.accountType}</td>
              <td><span className={`status-badge status-${request.status}`}>{request.status.replace('_', ' ')}</span></td>
              <td>
                <button className="icon-button">
                  <span className="material-symbols-outlined">history</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RequestHistoryTable;