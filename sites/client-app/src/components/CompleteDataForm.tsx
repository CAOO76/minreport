import React, { useState } from 'react';
import { auth } from '../firebaseConfig';
import useAuth from '@minreport/core/hooks/useAuth';
import './forms.css';

// --- RUT/RUN Helper Functions (Copied from RequestAccess.tsx) ---
const cleanAndFormatRut = (rut: string): string => {
  rut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (rut.length > 1) {
    return rut.slice(0, -1) + '-' + rut.slice(-1);
  }
  return rut;
};

const validateRut = (rut: string): boolean => {
  if (!/^[0-9]+[-|‐]{1}[0-9kK]{1}$/.test(rut)) return false;
  let [body, dv] = rut.split('-');
  if (body.length < 7) return false; // RUT body must have at least 7 digits

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const calculatedDv = 11 - (sum % 11);

  if (calculatedDv === 11) return dv === '0';
  if (calculatedDv === 10) return dv === 'K';
  return String(calculatedDv) === dv;
};

const CompleteDataForm: React.FC = () => {
  const { user, claims } = useAuth(auth);
  const provisionalAccountType = claims?.accountType; // Get accountType from claims

  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [run, setRun] = useState(''); // For individual accounts
  const [institutionAddress, setInstitutionAddress] = useState('');
  const [institutionPhone, setInstitutionPhone] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRunChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleanedRun = e.target.value.replace(/[^0-9kK]/g, '').toUpperCase();
    setRun(cleanedRun);
    setRunError(null);
  };

  const handleRunBlur = () => {
    const formattedRun = cleanAndFormatRut(run);
    setRun(formattedRun);
    if (formattedRun && !validateRut(formattedRun)) {
      setRunError('RUN inválido.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);
    setRunError(null);

    if (provisionalAccountType === 'INDIVIDUAL' && !validateRut(run)) {
      setRunError('Por favor, ingresa un RUN válido.');
      setIsSubmitting(false);
      return;
    }

    try {
      if (!user) {
        throw new Error('No estás autenticado. Por favor, inicia sesión de nuevo.');
      }

      const additionalDataPayload: { [key: string]: any } = {
        designatedAdminName: adminName,
        designatedAdminEmail: adminEmail,
      };

      if (provisionalAccountType === 'INDIVIDUAL') {
        additionalDataPayload.run = run; // Add RUN for individual
      } else {
        additionalDataPayload.institutionAddress = institutionAddress;
        additionalDataPayload.institutionPhone = institutionPhone;
        additionalDataPayload.contactPhone = contactPhone;
      }

      const response = await fetch('http://localhost:8082/submitAdditionalData', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`, // Send token
        },
        body: JSON.stringify({
          additionalData: additionalDataPayload,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Ocurrió un error al enviar los datos.');
      }

      setMessage('Datos enviados con éxito. Un administrador revisará la información para la activación final de la cuenta.');
      setIsError(false);
      // Reset form fields
      setAdminName('');
      setAdminEmail('');
      setRun('');
      setInstitutionAddress('');
      setInstitutionPhone('');
      setContactPhone('');

    } catch (err: any) {
      setMessage(err.message);
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="form-container">
      <h2>Completar Datos de la Cuenta</h2>
      <p>
        Tu solicitud ha sido aprobada inicialmente. Por favor, designa quién será el
        administrador principal de la cuenta en la plataforma MINREPORT y completa los datos de contacto.
      </p>
      
      {message && <p style={{ color: isError ? 'red' : 'green' }}>{message}</p>}

      <form onSubmit={handleSubmit} className="form-layout">
        <h3>Administrador de la Cuenta</h3>
        <div className="form-group">
          <label htmlFor="adminName">Nombre Completo del Administrador:</label>
          <input
            type="text"
            id="adminName"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            required={true}
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="adminEmail">Correo Electrónico del Administrador:</label>
          <input
            type="email"
            id="adminEmail"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required={true}
            autoComplete="off"
          />
        </div>

        {provisionalAccountType === 'INDIVIDUAL' ? (
          <>
            <h3>Datos Adicionales (Persona Natural)</h3>
            <div className="form-group">
              <label htmlFor="run">RUN del Solicitante:</label>
              <input
                type="text"
                id="run"
                value={run}
                onChange={handleRunChange}
                onBlur={handleRunBlur}
                required={true}
                autoComplete="off"
              />
              {runError && <p className="error-message">{runError}</p>}
            </div>
          </>
        ) : (
          <>
            <h3>Datos de Contacto de la Institución</h3>
            <div className="form-group">
              <label htmlFor="institutionAddress">Dirección de la Institución:</label>
              <input
                type="text"
                id="institutionAddress"
                value={institutionAddress}
                onChange={(e) => setInstitutionAddress(e.target.value)}
                required={true}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="institutionPhone">Teléfono de la Institución:</label>
              <input
                type="tel"
                id="institutionPhone"
                value={institutionPhone}
                onChange={(e) => setInstitutionPhone(e.target.value)}
                required={true}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="contactPhone">Teléfono de Contacto del Solicitante:</label>
              <input
                type="tel"
                id="contactPhone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                required={true}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <button type="submit" className="button-primary" disabled={isSubmitting || !!message}>
          {isSubmitting ? 'Enviando...' : 'Enviar para Activación Final'}
        </button>
      </form>
    </div>
  );
};

export default CompleteDataForm;
