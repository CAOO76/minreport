import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom'; // Removed useNavigate
import './forms.css';

const AdditionalDataForm: React.FC = () => {
  const location = useLocation();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isValidToken, setIsValidToken] = useState(false);
  const [loadingValidation, setLoadingValidation] = useState(true);

  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const reqId = queryParams.get('requestId');
    const tok = queryParams.get('token');

    if (reqId && tok) {
      setRequestId(reqId);
      setToken(tok);
      // Here, you would typically make an API call to validate the token
      // For now, we'll assume it's valid if present.
      setIsValidToken(true);
    } else {
      setIsValidToken(false);
      setError('Faltan parámetros de validación (requestId o token).');
    }
    setLoadingValidation(false);
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!requestId || !token) {
      setError('Error: Faltan datos de la solicitud.');
      return;
    }

    try {
      const response = await fetch('https://request-registration-service-493995072778.southamerica-west1.run.app/submitAdditionalData', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          token,
          additionalData: {
            companyName,
            companyAddress,
            companyPhone,
            contactPerson,
            contactPhone,
            contactEmail,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al enviar los datos adicionales.');
      }

      setSuccess('Datos adicionales enviados con éxito. ¡Gracias!');
      // Optionally redirect after success
      // navigate('/registration-complete');

    } catch (err: any) {
      console.error('Error al enviar los datos adicionales:', err);
      setError(err.message || 'Error al enviar los datos adicionales.');
    }
  };

  if (loadingValidation) {
    return (
      <div className="form-container">
        <h2>Cargando...</h2>
        <p>Validando su enlace de registro.</p>
      </div>
    );
  }

  if (!isValidToken) {
    return (
      <div className="form-container">
        <h2>Enlace Inválido o Expirado</h2>
        <p>{error || 'El enlace para completar sus datos es inválido o ha expirado. Por favor, contacte a soporte.'}</p>
      </div>
    );
  }

  return (
    <div className="form-container">
      <h2>Completa tus Datos Adicionales</h2>
      <p>Por favor, proporciona la información detallada de tu institución para finalizar el proceso de registro.</p>
      
      {error && <p className="error-message">{error}</p>}
      {success && <p className="success-message">{success}</p>}

      <form onSubmit={handleSubmit} className="form-layout">
        <h3>Información de la Institución</h3>
        <div className="form-group">
          <label htmlFor="companyName">Nombre de la Institución:</label>
          <input
            type="text"
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="companyAddress">Dirección de la Institución:</label>
          <input
            type="text"
            id="companyAddress"
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="companyPhone">Teléfono de la Institución:</label>
          <input
            type="tel"
            id="companyPhone"
            value={companyPhone}
            onChange={(e) => setCompanyPhone(e.target.value)}
            required
            autoComplete="off"
          />
        </div>

        <h3>Información de Contacto Principal</h3>
        <div className="form-group">
          <label htmlFor="contactPerson">Nombre de la Persona de Contacto:</label>
          <input
            type="text"
            id="contactPerson"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="contactPhone">Teléfono de Contacto:</label>
          <input
            type="tel"
            id="contactPhone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="contactEmail">Correo Electrónico de Contacto:</label>
          <input
            type="email"
            id="contactEmail"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </div>

        <button type="submit" className="button-primary">Enviar Datos Adicionales</button>
      </form>
    </div>
  );
};

export default AdditionalDataForm;
