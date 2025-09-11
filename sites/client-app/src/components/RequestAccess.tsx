import React, { useState } from 'react';
import './RequestAccess.css';

/**
 * Página para solicitar acceso a la plataforma MINREPORT.
 * Contiene el formulario de solicitud inicial.
 */
const RequestAccess: React.FC = () => {
  const [formData, setFormData] = useState({
    requesterName: '',
    requesterEmail: '',
    rut: '',
    institutionName: '',
    requestType: 'B2B',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Formulario enviado:', formData);
    // Aquí se integrará la llamada a la Cloud Function en la Task 11
    alert('Solicitud enviada. Revisa la consola para ver los datos.');
  };

  return (
    <div className="request-access-container">
      <h1 className="request-access-title">Solicitar Acceso a MINREPORT</h1>
      <p className="request-access-subtitle">Por favor, completa el siguiente formulario para solicitar acceso a la plataforma.</p>
      
      <form onSubmit={handleSubmit} className="request-access-form">
        <div className="request-access-form-group">
          <label htmlFor="requesterName" className="request-access-label">Nombre Completo:</label>
          <input
            type="text"
            id="requesterName"
            name="requesterName"
            value={formData.requesterName}
            onChange={handleChange}
            required
            className="request-access-input"
          />
        </div>

        <div className="request-access-form-group">
          <label htmlFor="requesterEmail" className="request-access-label">Correo Electrónico:</label>
          <input
            type="email"
            id="requesterEmail"
            name="requesterEmail"
            value={formData.requesterEmail}
            onChange={handleChange}
            required
            className="request-access-input"
          />
        </div>

        <div className="request-access-form-group">
          <label htmlFor="rut" className="request-access-label">RUT (Institución o Personal):</label>
          <input
            type="text"
            id="rut"
            name="rut"
            value={formData.rut}
            onChange={handleChange}
            required
            className="request-access-input"
          />
        </div>

        <div className="request-access-form-group">
          <label htmlFor="institutionName" className="request-access-label">Nombre de la Institución:</label>
          <input
            type="text"
            id="institutionName"
            name="institutionName"
            value={formData.institutionName}
            onChange={handleChange}
            required
            className="request-access-input"
          />
        </div>

        <div className="request-access-form-group">
          <label htmlFor="requestType" className="request-access-label">Tipo de Solicitud:</label>
          <select
            id="requestType"
            name="requestType"
            value={formData.requestType}
            onChange={handleChange}
            className="request-access-select"
          >
            <option value="B2B">B2B</option>
            <option value="EDUCACIONALES">Educacional</option>
          </select>
        </div>

        <button type="submit" className="request-access-button">
          Enviar Solicitud
          <span className="material-symbols-outlined" style={{ marginLeft: '8px' }}>send</span>
        </button>
      </form>
    </div>
  );
};

export default RequestAccess;
