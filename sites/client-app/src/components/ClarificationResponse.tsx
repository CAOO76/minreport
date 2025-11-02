import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import './forms.css';

const ClarificationResponse: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState('');
  const [userReply, setUserReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (!urlToken) {
      setMessage('Enlace inválido: no se proporcionó un token.');
      setIsError(true);
      setIsLoading(false);
      return;
    }

    const validateToken = async () => {
      try {
        const response = await fetch('http://localhost:8082/validate-clarification-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: urlToken }),
        });
        const result = await response.json();
        if (!response.ok || !result.isValid) {
          throw new Error(result.message || 'Enlace inválido o expirado.');
        }
        setToken(urlToken);
        setAdminMessage(result.adminMessage);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Error desconocido');
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    validateToken();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !userReply) {
      alert('Por favor, escribe una respuesta.');
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('http://localhost:8082/submit-clarification-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userReply }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage('¡Respuesta enviada con éxito! Gracias por la aclaración.');
      setIsError(false);
      setIsSubmitted(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error desconocido');
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="form-container">
        <p>Validando enlace...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="form-container">
        <p style={{ color: 'red' }}>{message}</p>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="success-container">
        <span className="material-symbols-outlined success-icon">check_circle</span>
        <h2>¡Respuesta Enviada!</h2>
        <p className="success-subtitle">
          Gracias por tu aclaración. Nuestro equipo continuará con la revisión de tu solicitud.
        </p>
        <Link
          to="/"
          className="button-primary icon-button"
          style={{ marginTop: '2rem', textDecoration: 'none' }}
        >
          <span className="material-symbols-outlined">home</span>
          Volver al portal de clientes MINREPORT
        </Link>
      </div>
    );
  }

  return (
    <div className="form-container">
      <h2>Responder Aclaración</h2>
      <div className="admin-message-box">
        <p>
          <strong>
            Un administrador ha solicitado la siguiente aclaración sobre tu solicitud:
          </strong>
        </p>
        <blockquote>{adminMessage}</blockquote>
      </div>

      <form onSubmit={handleSubmit} className="form-layout">
        <div className="form-group">
          <label htmlFor="userReply">Tu Respuesta:</label>
          <textarea
            id="userReply"
            name="userReply"
            rows={6}
            value={userReply}
            onChange={(e) => setUserReply(e.target.value)}
            required
          />
        </div>

        <div className="form-actions">
          <Link to="/" className="button-secondary icon-button" style={{ textDecoration: 'none' }}>
            Cancelar
          </Link>
          <button type="submit" className="button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Enviando...' : 'Enviar Respuesta'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClarificationResponse;
