import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import PhoneInput from 'react-phone-number-input';
import { LoadScript, Autocomplete } from '@react-google-maps/api';
import 'react-phone-number-input/style.css';
import './forms.css';

const LIBRARIES: 'places'[] = ['places'];

// --- Helper Functions ---
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

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

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
        const response = await fetch('http://localhost:8082/validate-data-token', {
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

  const handleAutocompleteLoad = (autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  };

  const handlePlaceChanged = () => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      setFormData((prev) => ({ ...prev, commercialAddress: place.formatted_address || '' }));
    }
  };

  const handlePhoneChange = (value: string | undefined) => {
    if (value) {
      setFormData((prev) => ({ ...prev, adminPhone: value }));
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
      const response = await fetch('http://localhost:8082/submitAdditionalData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, additionalData: formData }),
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
      <div className="form-container">
        <p>Validando enlace...</p>
      </div>
    );
  }

  if (isError || !accountInfo) {
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
        <h2>¡Información Recibida!</h2>
        <p className="success-subtitle">
          Hemos guardado tus datos. Nuestro equipo realizará la revisión final y te notificaremos
          por correo cuando tu cuenta sea activada.
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
    <LoadScript
      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string}
      libraries={LIBRARIES}
    >
      <div className="form-container">
        <h2>Completar Datos de la Cuenta</h2>

        {currentStep === 'form' && (
          <>
            <p>
              Por favor, completa la información requerida para finalizar el proceso de solicitud.
            </p>
            {message && (
              <p className={`submit-message ${isError ? 'error' : 'success'}`}>{message}</p>
            )}
            <form onSubmit={handleReview} className="form-layout">
              <h3>Datos del Administrador de la Cuenta</h3>
              <div className="form-group">
                <label htmlFor="adminName">Nombre Completo</label>
                <input
                  type="text"
                  name="adminName"
                  value={formData.adminName || ''}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="adminEmail">Correo Electrónico</label>
                <input
                  type="email"
                  name="adminEmail"
                  value={formData.adminEmail || ''}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="adminPhone">Celular del Administrador</label>
                <PhoneInput
                  name="adminPhone"
                  defaultCountry={accountInfo.country as any}
                  value={formData.adminPhone}
                  onChange={handlePhoneChange}
                  required
                />
              </div>
              {accountInfo.accountType !== 'INDIVIDUAL' && (
                <div className="form-group">
                  <label htmlFor="adminRole">Cargo del Administrador</label>
                  <input
                    type="text"
                    name="adminRole"
                    value={formData.adminRole || ''}
                    onChange={handleChange}
                    required
                  />
                </div>
              )}

              {accountInfo.accountType === 'INDIVIDUAL' ? (
                <div className="form-group">
                  <label htmlFor="run">RUN</label>
                  <input
                    type="text"
                    name="run"
                    value={formData.run || ''}
                    onChange={handleRunChange}
                    onBlur={handleRunBlur}
                    required
                  />
                  {runError && <p className="error-message">{runError}</p>}
                </div>
              ) : (
                <>
                  <h3>Dirección Comercial</h3>
                  <div className="form-group">
                    <label htmlFor="commercialAddress">Dirección Comercial</label>
                    <Autocomplete
                      onLoad={handleAutocompleteLoad}
                      onPlaceChanged={handlePlaceChanged}
                      options={{ componentRestrictions: { country: accountInfo.country } }}
                    >
                      <input
                        type="text"
                        name="commercialAddress"
                        className="form-control"
                        placeholder="Ingresa la dirección de tu empresa"
                        defaultValue={formData.commercialAddress || ''}
                        required
                      />
                    </Autocomplete>
                    <small>
                      Comienza a escribir y selecciona una de las sugerencias de Google.
                    </small>
                  </div>
                </>
              )}

              <div className="form-actions">
                <Link
                  to="/"
                  className="button-secondary icon-button"
                  style={{ textDecoration: 'none' }}
                >
                  Cancelar
                </Link>
                <button type="submit" className="button-primary icon-button">
                  Revisar Datos <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              </div>
            </form>
          </>
        )}

        {currentStep === 'review' && (
          <div className="review-step">
            <h3>Revisa tus Datos</h3>
            <p>Verifica que la información sea correcta antes de enviar.</p>
            <div className="review-data-summary">
              <h4>Datos del Administrador</h4>
              <p>
                <strong>Nombre:</strong> <span>{formData.adminName}</span>
              </p>
              <p>
                <strong>Email:</strong> <span>{formData.adminEmail}</span>
              </p>
              <p>
                <strong>Celular:</strong> <span>{formData.adminPhone}</span>
              </p>
              {accountInfo.accountType !== 'INDIVIDUAL' && (
                <p>
                  <strong>Cargo:</strong> <span>{formData.adminRole}</span>
                </p>
              )}

              {accountInfo.accountType === 'INDIVIDUAL' ? (
                <p>
                  <strong>RUN:</strong> <span>{formData.run}</span>
                </p>
              ) : (
                <>
                  <h4>Dirección Comercial</h4>
                  <p>
                    <strong>Dirección:</strong> <span>{formData.commercialAddress}</span>
                  </p>
                </>
              )}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button-secondary icon-button"
                onClick={() => setCurrentStep('form')}
              >
                <span className="material-symbols-outlined">edit</span> Editar
              </button>
              <button
                type="button"
                className="button-primary icon-button"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Enviando...' : 'Confirmar y Enviar'}{' '}
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </LoadScript>
  );
};

export default CompleteDataForm;
