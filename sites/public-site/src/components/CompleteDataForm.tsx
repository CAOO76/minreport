import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

// --- Helper Fu      const response = await fetch('http://localhost:9196/minreport-8f2a8/southamerica-west1/submitCompleteData', {ctions ---
const cleanAndFormatRut = (rut: string): string => {
  rut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  return rut.length > 1 ? `${rut.slice(0, -1)}-${rut.slice(-1)}` : rut;
};

const validateRut = (rut: string): boolean => {
  if (!/^[0-9]+[-|‐]{1}[0-9kK]{1}$/.test(rut)) return false;
  const [body, dv] = rut.split('-');
  if (body.length < 7) return false;
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const calculatedDv = 11 - (sum % 11);
  if (calculatedDv === 11) return dv === '0';
  if (calculatedDv === 10) return dv.toUpperCase() === 'K';
  return String(calculatedDv) === dv;
};

// --- Type Definitions ---
type AccountInfo = {
  accountType: 'INDIVIDUAL' | 'EMPRESARIAL' | 'EDUCACIONAL';
  country: string; // country code
};
type FormData = {
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  adminRole: string;
  run: string;
  commercialAddress: string;
};

// --- Main Component ---
const CompleteDataForm: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const [formData, setFormData] = useState<Partial<FormData>>({ run: '' });
  const [currentStep, setCurrentStep] = useState<'form' | 'review'>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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
        const response = await fetch('http://localhost:9196/minreport-8f2a8/southamerica-west1/validateDataToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: urlToken }),
        });
        const result = await response.json();
        if (!response.ok || !result.isValid) {
          throw new Error(result.message || 'Enlace inválido o expirado.');
        }
        setToken(urlToken);
        setAccountInfo({
          accountType: result.requestData.accountType,
          country: result.requestData.country,
        });
      } catch (err: any) {
        setMessage(err.message);
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    validateToken();
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRunChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleanedRun = e.target.value.replace(/[^0-9kK]/g, '').toUpperCase();
    setFormData((prev) => ({ ...prev, run: cleanedRun }));
    setRunError(null);
  };

  const handleRunBlur = () => {
    if (!formData.run) return;
    const formattedRun = cleanAndFormatRut(formData.run);
    setFormData((prev) => ({ ...prev, run: formattedRun }));
    if (formattedRun && !validateRut(formattedRun)) {
      setRunError('RUN inválido.');
    }
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (accountInfo?.accountType === 'INDIVIDUAL') {
      if (!formData.run || !validateRut(formData.run)) {
        setRunError('Por favor, ingresa un RUN válido.');
        return;
      }
    }
    setCurrentStep('review');
  };

  const handleSubmit = async () => {
    if (!token) return;
    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('http://localhost:9195/minreport-42b14/southamerica-west1/submitCompleteData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, formData }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage('¡Datos enviados con éxito! Tu solicitud pasará a la revisión final.');
      setIsError(false);
      setIsSubmitted(true);
    } catch (err: any) {
      setMessage(err.message);
      setIsError(true);
      setCurrentStep('form'); // Go back to form on error
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem' }}>
        <p>Validando enlace...</p>
      </div>
    );
  }

  if (isError || !accountInfo) {
    return (
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem' }}>
        <p style={{ color: 'red' }}>{message}</p>
        <Link to="/">Volver al inicio</Link>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem', textAlign: 'center' }}>
        <h2>¡Información Recibida!</h2>
        <p>
          Hemos guardado tus datos. Nuestro equipo realizará la revisión final y te notificaremos
          por correo cuando tu cuenta sea activada.
        </p>
        <Link to="/" style={{ marginTop: '2rem', display: 'inline-block' }}>
          Volver al inicio
        </Link>
      </div>
    );
  }

  const formStyle = {
    maxWidth: '600px',
    margin: '2rem auto',
    padding: '2rem',
    border: '1px solid #ddd',
    borderRadius: '8px'
  };

  const formGroupStyle = {
    marginBottom: '1.5rem'
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold'
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '1rem'
  };

  return (
    <div style={formStyle}>
      <h2>Completar Datos de la Cuenta</h2>

      {currentStep === 'form' && (
        <>
          <p>
            Por favor, completa la información requerida para finalizar el proceso de solicitud.
          </p>
          {message && (
            <p style={{ color: isError ? 'red' : 'green', marginBottom: '1rem' }}>{message}</p>
          )}
          <form onSubmit={handleReview}>
            <h3>Datos del Administrador de la Cuenta</h3>
            <div style={formGroupStyle}>
              <label style={labelStyle} htmlFor="adminName">Nombre Completo</label>
              <input
                style={inputStyle}
                type="text"
                name="adminName"
                value={formData.adminName || ''}
                onChange={handleChange}
                required
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle} htmlFor="adminEmail">Correo Electrónico</label>
              <input
                style={inputStyle}
                type="email"
                name="adminEmail"
                value={formData.adminEmail || ''}
                onChange={handleChange}
                required
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle} htmlFor="adminPhone">Celular del Administrador</label>
              <input
                style={inputStyle}
                type="tel"
                name="adminPhone"
                value={formData.adminPhone || ''}
                onChange={handleChange}
                placeholder="+56 9 1234 5678"
                required
              />
            </div>
            {accountInfo.accountType !== 'INDIVIDUAL' && (
              <div style={formGroupStyle}>
                <label style={labelStyle} htmlFor="adminRole">Cargo del Administrador</label>
                <input
                  style={inputStyle}
                  type="text"
                  name="adminRole"
                  value={formData.adminRole || ''}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            {accountInfo.accountType === 'INDIVIDUAL' ? (
              <div style={formGroupStyle}>
                <label style={labelStyle} htmlFor="run">RUN</label>
                <input
                  style={inputStyle}
                  type="text"
                  name="run"
                  value={formData.run || ''}
                  onChange={handleRunChange}
                  onBlur={handleRunBlur}
                  placeholder="12345678-9"
                  required
                />
                {runError && <p style={{ color: 'red', marginTop: '0.5rem' }}>{runError}</p>}
              </div>
            ) : (
              <>
                <h3>Dirección Comercial</h3>
                <div style={formGroupStyle}>
                  <label style={labelStyle} htmlFor="commercialAddress">Dirección Comercial</label>
                  <input
                    style={inputStyle}
                    type="text"
                    name="commercialAddress"
                    value={formData.commercialAddress || ''}
                    onChange={handleChange}
                    placeholder="Ingresa la dirección de tu empresa"
                    required
                  />
                  <small style={{ color: '#666' }}>
                    Ingresa la dirección completa de tu empresa
                  </small>
                </div>
              </>
            )}

            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <Link
                to="/"
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  color: '#333'
                }}
              >
                Cancelar
              </Link>
              <button
                type="submit"
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Revisar Datos →
              </button>
            </div>
          </form>
        </>
      )}

      {currentStep === 'review' && (
        <div>
          <h3>Revisa tus Datos</h3>
          <p>Verifica que la información sea correcta antes de enviar.</p>
          <div style={{ backgroundColor: '#f8f9fa', padding: '1rem', borderRadius: '4px', marginBottom: '2rem' }}>
            <h4>Datos del Administrador</h4>
            <p><strong>Nombre:</strong> {formData.adminName}</p>
            <p><strong>Email:</strong> {formData.adminEmail}</p>
            <p><strong>Celular:</strong> {formData.adminPhone}</p>
            {accountInfo.accountType !== 'INDIVIDUAL' && (
              <p><strong>Cargo:</strong> {formData.adminRole}</p>
            )}

            {accountInfo.accountType === 'INDIVIDUAL' ? (
              <p><strong>RUN:</strong> {formData.run}</p>
            ) : (
              <>
                <h4>Dirección Comercial</h4>
                <p><strong>Dirección:</strong> {formData.commercialAddress}</p>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => setCurrentStep('form')}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              ✏️ Editar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1
              }}
            >
              {isSubmitting ? 'Enviando...' : 'Confirmar y Enviar'} 📤
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompleteDataForm;