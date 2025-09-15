
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Country, City }  from 'country-state-city';
import './RequestAccess.css';
import './forms.css';

// --- Constants ---
const ACCOUNT_TYPES = [
  { value: 'EMPRESARIAL', label: 'Empresarial', icon: 'business', description: 'Para empresas y organizaciones.' },
  { value: 'EDUCACIONAL', label: 'Educacional', icon: 'school', description: 'Para instituciones educativas.' },
  { value: 'INDIVIDUAL', label: 'Individual', icon: 'person', description: 'Para profesionales o personas naturales.' },
];

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
type AccountType = 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL' | null;
type FormData = {
  applicantName: string;
  applicantEmail: string;
  rut: string;
  institutionName: string;
  accountType: AccountType;
  country: string; // country code (e.g., 'CL')
  city: string;
};

// --- Success Component ---
const SuccessDisplay: React.FC<{ applicantName: string; institutionName: string; applicantEmail: string; accountType: AccountType; }> = 
({ applicantName, institutionName, applicantEmail, accountType }) => (
    <div className="success-container">
        <span className="material-symbols-outlined success-icon">check_circle</span>
        <h2>¡Gracias, {applicantName}!</h2>
        <p className="success-subtitle" dangerouslySetInnerHTML={{
            __html: `Hemos recibido correctamente tu solicitud para la cuenta ${accountType !== 'INDIVIDUAL' && institutionName ? `de <strong>${institutionName}</strong>` : '<strong>Individual</strong>'}.`
        }} />
        <div className="next-steps">
            <h4>Siguientes Pasos:</h4>
            <ol>
                <li>Nuestro equipo revisará tu solicitud. Este proceso suele tardar entre 24 y 48 horas hábiles.</li>
                <li>Recibirás un correo electrónico en <strong>{applicantEmail}</strong> con la decisión inicial.</li>
                <li>Si tu solicitud es pre-aprobada, el correo incluirá un enlace para que completes la información de tu cuenta.</li>
            </ol>
        </div>
        <Link to="/" className="button-primary icon-button" style={{ marginTop: '2rem', textDecoration: 'none' }}>
            <span className="material-symbols-outlined">home</span>
            Volver al portal de clientes MINREPORT
        </Link>
    </div>
);

// --- Main Component ---
const RequestAccess: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({ applicantName: '', applicantEmail: '', rut: '', institutionName: '', accountType: null, country: 'CL', city: '' });
  const [currentStep, setCurrentStep] = useState<'form' | 'review'>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [rutError, setRutError] = useState<string | null>(null);
  const [isSubmittedSuccessfully, setIsSubmittedSuccessfully] = useState(false);

  const countries = useMemo(() => Country.getAllCountries(), []);
  const cities = useMemo(() => formData.country ? City.getCitiesOfCountry(formData.country) : [], [formData.country]);

  const getEntityType = (accountType: AccountType) => accountType === 'INDIVIDUAL' ? 'natural' : 'juridica';

  const handleCancel = () => {
    setFormData({ applicantName: '', applicantEmail: '', rut: '', institutionName: '', accountType: null, country: 'CL', city: '' });
    setCurrentStep('form');
    setSubmitMessage(null);
    setIsError(false);
    setRutError(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, country: e.target.value, city: '' })); // Reset city on country change
  };

  const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleanedRut = e.target.value.replace(/[^0-9kK]/g, '').toUpperCase();
    setFormData(prev => ({ ...prev, rut: cleanedRut }));
    setRutError(null);
  };

  const handleRutBlur = () => {
    if (formData.accountType === 'INDIVIDUAL' || !formData.accountType) return;
    const formattedRut = cleanAndFormatRut(formData.rut);
    setFormData(prev => ({ ...prev, rut: formattedRut }));
    if (formattedRut && !validateRut(formattedRut)) {
      setRutError('RUT/RUN inválido.');
    }
  };

  const handleAccountTypeChange = (value: AccountType) => {
    setFormData(prev => ({ ...prev, accountType: value, rut: value === 'INDIVIDUAL' ? '' : prev.rut, institutionName: value === 'INDIVIDUAL' ? '' : prev.institutionName, city: '' }));
    setRutError(null);
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMessage(null);
    if (!formData.accountType) {
      alert('Por favor, selecciona un tipo de cuenta.');
      return;
    }
    if (formData.accountType !== 'INDIVIDUAL' && !validateRut(formData.rut)) {
      setRutError('Por favor, ingresa un RUT/RUN válido.');
      return;
    }
    if (formData.accountType === 'INDIVIDUAL' && !formData.city) {
        alert('Por favor, selecciona una ciudad.');
        return;
    }
    setCurrentStep('review');
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitMessage(null);
    setIsError(false);

    try {
      const response = await fetch('http://localhost:8082/requestAccess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, entityType: getEntityType(formData.accountType) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Ocurrió un error.');
      setIsSubmittedSuccessfully(true);
    } catch (error: any) {
      setSubmitMessage(error.message);
      setIsError(true);
      setCurrentStep('form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const rutLabel = formData.accountType === 'INDIVIDUAL' ? 'RUN del Solicitante:' : 'RUT de la Institución:';
  const selectedAccountTypeDetails = ACCOUNT_TYPES.find(type => type.value === formData.accountType);

  if (isSubmittedSuccessfully) {
    return <SuccessDisplay {...formData} />;
  }

  return (
    <div className="form-container">
      <h2>Solicitar Acceso a MINREPORT</h2>
      <p>Completa el siguiente formulario para solicitar tu cuenta.</p>
      
      {submitMessage && <p className={`submit-message ${isError ? 'error' : 'success'}`}>{submitMessage}</p>}

      {currentStep === 'form' && (
        <form onSubmit={handleReview} className="form-layout">
          {!formData.accountType ? (
            <>
              <h3>1. Selecciona tu Tipo de Cuenta</h3>
              <div className="account-type-selector">
                {ACCOUNT_TYPES.map(type => (
                  <div key={type.value} className={`account-type-option ${formData.accountType === type.value ? 'selected' : ''}`} onClick={() => handleAccountTypeChange(type.value as AccountType)}>
                    <span className="material-symbols-outlined">{type.icon}</span>
                    <span>{type.label}</span>
                    <p>{type.description}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="selected-account-type-display">
                <span className="material-symbols-outlined">{selectedAccountTypeDetails?.icon}</span>
                <div>
                  <h4>{selectedAccountTypeDetails?.label}</h4>
                  <p>{selectedAccountTypeDetails?.description}</p>
                </div>
                <button type="button" className="change-type-button" onClick={() => handleAccountTypeChange(null)}>Cambiar</button>
              </div>

              <h3>2. Completa tus Datos</h3>
              <div className="form-group">
                <label htmlFor="applicantName">Nombre Completo del Solicitante:</label>
                <input type="text" id="applicantName" name="applicantName" value={formData.applicantName} onChange={handleChange} required autoComplete="off" />
              </div>
              <div className="form-group">
                <label htmlFor="applicantEmail">Correo Electrónico del Solicitante:</label>
                <input type="email" id="applicantEmail" name="applicantEmail" value={formData.applicantEmail} onChange={handleChange} required autoComplete="off" />
              </div>
              
              {formData.accountType === 'INDIVIDUAL' ? (
                <>
                    <div className="form-group">
                        <label htmlFor="country">País:</label>
                        <select id="country" name="country" value={formData.country} onChange={handleCountryChange} required autoComplete="off">
                            {countries.map(c => <option key={c.isoCode} value={c.isoCode}>{c.name}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="city">Ciudad:</label>
                        <select id="city" name="city" value={formData.city} onChange={handleChange} required autoComplete="off" disabled={!formData.country || cities.length === 0}>
                            <option value="">{cities.length === 0 ? 'No hay ciudades para este país' : 'Selecciona una ciudad'}</option>
                            {cities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                    </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label htmlFor="institutionName">Nombre de la Institución / Razón Social:</label>
                    <input type="text" id="institutionName" name="institutionName" value={formData.institutionName} onChange={handleChange} required autoComplete="off" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="rut">{rutLabel}</label>
                    <input type="text" id="rut" name="rut" value={formData.rut} onChange={handleRutChange} onBlur={handleRutBlur} required autoComplete="off" />
                    {rutError && <p className="error-message">{rutError}</p>}
                  </div>
                  <div className="form-group">
                      <label htmlFor="country">País:</label>
                      <select id="country" name="country" value={formData.country} onChange={handleCountryChange} required autoComplete="off">
                          {countries.map(c => <option key={c.isoCode} value={c.isoCode}>{c.name}</option>)}
                      </select>
                  </div>
                </>
              )}

              <div className="form-actions">
                <button type="button" className="button-secondary icon-button" onClick={handleCancel}><span className="material-symbols-outlined">cancel</span> Cancelar</button>
                <button type="submit" className="button-primary icon-button">Revisar Datos <span className="material-symbols-outlined">arrow_forward</span></button>
              </div>
            </>
          )}
        </form>
      )}

      {currentStep === 'review' && (
        <div className="review-step">
          <h3>3. Revisa tus Datos</h3>
          <p>Verifica que la información sea correcta antes de enviar.</p>
          <div className="review-data-summary">
            <p><strong>Nombre Solicitante:</strong> <span>{formData.applicantName}</span></p>
            <p><strong>Email Solicitante:</strong> <span>{formData.applicantEmail}</span></p>
            {formData.accountType !== 'INDIVIDUAL' ? (
              <>
                <p><strong>Institución:</strong> <span>{formData.institutionName}</span></p>
                <p><strong>{rutLabel}</strong> <span>{formData.rut}</span></p>
              </>
            ) : (
                <p><strong>Ciudad:</strong> <span>{formData.city}</span></p>
            )}
            <p><strong>País:</strong> <span>{countries.find(c => c.isoCode === formData.country)?.name}</span></p>
            <p><strong>Tipo de Cuenta:</strong> <span>{selectedAccountTypeDetails?.label}</span></p>
          </div>
          <div className="form-actions">
            <button type="button" className="button-secondary icon-button" onClick={handleCancel}><span className="material-symbols-outlined">cancel</span> Cancelar</button>
            <button type="button" className="button-secondary icon-button" onClick={() => setCurrentStep('form')}><span className="material-symbols-outlined">edit</span> Editar</button>
            <button type="button" className="button-primary icon-button" onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? 'Enviando...' : 'Confirmar y Enviar Solicitud'} <span className="material-symbols-outlined">send</span></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestAccess;
