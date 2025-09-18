import React, { useState } from 'react';
import './Developers.css';

// Simulación de datos. Esto vendrá de Firestore.
const fakeDevelopers = [
  {
    id: 'dev-1',
    developerName: 'Juan Perez',
    developerEmail: 'juan.perez@plugin-corp.com',
    companyName: 'Plugin Corp',
    status: 'active'
  },
  {
    id: 'dev-2',
    developerName: 'Ana Gomez',
    developerEmail: 'ana.gomez@external-devs.io',
    companyName: 'External Devs',
    status: 'pending_invitation'
  }
];

const Developers: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="developers-container">
      <header className="developers-header">
        <h1>Gestión de Desarrolladores</h1>
        <button onClick={() => setShowAddModal(true)} className="add-developer-btn">Añadir Desarrollador</button>
      </header>

      <div className="developers-list">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Empresa</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {fakeDevelopers.map(dev => (
              <tr key={dev.id}>
                <td>{dev.developerName}</td>
                <td>{dev.developerEmail}</td>
                <td>{dev.companyName}</td>
                <td><span className={`status-badge status-${dev.status}`}>{dev.status.replace('_', ' ')}</span></td>
                <td>
                  {dev.status === 'pending_invitation' && <button>Enviar Invitación</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Registrar Nuevo Desarrollador</h2>
            <form>
              <div className="form-group">
                <label htmlFor="devName">Nombre del Contacto</label>
                <input id="devName" type="text" autoComplete='off' />
              </div>
              <div className="form-group">
                <label htmlFor="devEmail">Email de Contacto</label>
                <input id="devEmail" type="email" autoComplete='off' />
              </div>
              <div className="form-group">
                <label htmlFor="devCompany">Nombre de la Empresa</label>
                <input id="devCompany" type="text" autoComplete='off' />
              </div>
              <div className="modal-actions">
                <button type="submit">Registrar</button>
                <button type="button" onClick={() => setShowAddModal(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Developers;
