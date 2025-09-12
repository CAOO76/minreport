import React, { useState } from 'react';
import './RequestAccess.css';
import './forms.css'; // Importar los estilos de formulario comunes

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
    <div className="form-container"> {/* Usar form-container */}
      <h2>Solicitar Acceso a MINREPORT</h2> {/* Usar h2 directamente */}
      <p>Por favor, completa el siguiente formulario para solicitar acceso a la plataforma.</p> {/* Usar p directamente */}
      
      <form onSubmit={handleSubmit} className="form-layout"> {/* Usar form-layout */}
        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="requesterName">Nombre Completo:</label>
          <input
            type="text"
            id="requesterName"
            name="requesterName"
            value={formData.requesterName}
            onChange={handleChange}
            required
            autoComplete="off"
          />
        </div>

        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="requesterEmail">Correo Electrónico:</label>
          <input
            type="email"
            id="requesterEmail"
            name="requesterEmail"
            value={formData.requesterEmail}
            onChange={handleChange}
            required
            autoComplete="off"
          />
        </div>

        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="rut">RUT (Institución o Personal):</label>
          <input
            type="text"
            id="rut"
            name="rut"
            value={formData.rut}
            onChange={handleChange}
            required
            autoComplete="off"
          />
        </div>

        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="institutionName">Nombre de la Institución:</label>
          <input
            type="text"
            id="institutionName"
            name="institutionName"
            value={formData.institutionName}
            onChange={handleChange}
            required
            autoComplete="off"
          />
        </div>

        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="requestType">Tipo de Solicitud:</label>
          <select
            id="requestType"
            name="requestType"
            value={formData.requestType}
            onChange={handleChange}
            autoComplete="off"
          >
            <option value="B2B">B2B</option>
            <option value="EDUCACIONALES">Educacional</option>
          </select>
        </div>

        <button type="submit" className="button-primary icon-button">
          Enviar Solicitud
          <span className="material-symbols-outlined">send</span>
        </button>
      </form>
    </div>
  );
};

export default RequestAccess;
