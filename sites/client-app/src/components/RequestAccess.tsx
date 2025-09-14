import React, { useState } from 'react';
import './RequestAccess.css';
import './forms.css';

// Lista de países para el selector
const COUNTRIES = [
  'Chile',
  'Argentina',
  'Perú',
  'Colombia',
  'México',
  'Otro',
];

// Tipos de cuenta con sus íconos y descripciones
const ACCOUNT_TYPES = [
  { value: 'EMPRESARIAL', label: 'Empresarial', icon: 'business', description: 'Para empresas y organizaciones.' },
  { value: 'EDUCACIONAL', label: 'Educacional', icon: 'school', description: 'Para instituciones educativas.' },
  { value: 'INDIVIDUAL', label: 'Individual', icon: 'person', description: 'Para profesionales o personas naturales.' },
];

// --- RUT/RUN Helper Functions ---
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

// --- Form Data Type ---
type AccountType = 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL' | null;

type FormData = {
  applicantName: string;
  applicantEmail: string;
  rut: string;
  institutionName: string;
  accountType: AccountType;
  country: string;
};

const getEntityType = (accountType: AccountType) => {
  return accountType === 'INDIVIDUAL' ? 'natural' : 'juridica';
};

const RequestAccess: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    applicantName: '',
    applicantEmail: '',
    rut: '',
    institutionName: '',
    accountType: null, // Initialize as null
    country: COUNTRIES[0],
  });
  const [currentStep, setCurrentStep] = useState<'form' | 'review'>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [rutError, setRutError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
  };

  const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleanedRut = e.target.value.replace(/[^0-9kK]/g, '').toUpperCase();
    setFormData(prevData => ({ ...prevData, rut: cleanedRut }));
    setRutError(null); // Clear error on change
  };

  const handleRutBlur = () => {
    if (formData.accountType === 'INDIVIDUAL' || !formData.accountType) return; // No RUT validation for individual or if no account type selected
    const formattedRut = cleanAndFormatRut(formData.rut);
    setFormData(prevData => ({ ...prevData, rut: formattedRut }));
    if (formattedRut && !validateRut(formattedRut)) {
      setRutError('RUT/RUN inválido.');
    }
  };

  const handleAccountTypeChange = (value: AccountType) => {
    setFormData(prevData => ({
      ...prevData,
      accountType: value,
      rut: value === 'INDIVIDUAL' ? '' : prevData.rut, // Clear RUT if individual
      institutionName: value === 'INDIVIDUAL' ? '' : prevData.institutionName, // Clear institution name if individual
    }));
    setRutError(null); // Clear RUT error if account type changes
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMessage(null); // Clear previous messages on review

    if (!formData.accountType) {
      // This case should ideally not happen if the form is structured correctly
      // but as a safeguard:
      alert('Por favor, selecciona un tipo de cuenta.');
      return;
    }

    if (formData.accountType !== 'INDIVIDUAL' && !validateRut(formData.rut)) {
      setRutError('Por favor, ingresa un RUT/RUN válido.');
      return;
    }

    setCurrentStep('review');
  };

  const handleEdit = () => {
    setCurrentStep('form');
  };

  const handleCancel = () => {
    setFormData({
      applicantName: '',
      applicantEmail: '',
      rut: '',
      institutionName: '',
      accountType: null, // Reset to null
      country: COUNTRIES[0],
    });
    setCurrentStep('form');
    setSubmitMessage(null);
    setIsError(false);
    setRutError(null);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitMessage(null);
    setIsError(false);

    if (!formData.accountType) {
      alert('Por favor, selecciona un tipo de cuenta.');
      setIsSubmitting(false);
      return;
    }

    if (formData.accountType !== 'INDIVIDUAL' && !validateRut(formData.rut)) {
      setRutError('Por favor, ingresa un RUT/RUN válido.');
      setIsSubmitting(false);
      return;
    }

    try {
      const dataToSend = {
        ...formData,
        entityType: getEntityType(formData.accountType), // Derive entityType
      };

      const response = await fetch('http://localhost:8082/requestAccess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Ocurrió un error al enviar la solicitud.');
      }

      setSubmitMessage('¡Solicitud enviada con éxito! Nuestro equipo la revisará pronto.');
      setIsError(false);
      // No reset form here, user might want to see the success message
    } catch (error: any) {
      setSubmitMessage(error.message);
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const rutLabel = formData.accountType === 'INDIVIDUAL' ? 'RUN del Solicitante:' : 'RUT de la Institución:';
  const selectedAccountTypeDetails = ACCOUNT_TYPES.find(type => type.value === formData.accountType);

  return (
    <div className="form-container">
      <h2>Solicitar Acceso a MINREPORT</h2>
      <p>Completa el siguiente formulario para solicitar tu cuenta. Todos los campos son obligatorios.</p>
      
      {submitMessage && (
        <p className={`submit-message ${isError ? 'error' : 'success'}`}>
          {submitMessage}
        </p>
      )}

      {currentStep === 'form' && (
        <form onSubmit={handleReview} className="form-layout">
          {!formData.accountType ? (
            <>
              <h3>Selecciona tu Tipo de Cuenta</h3>
              <div className="account-type-selector">
                {ACCOUNT_TYPES.map(type => (
                  <div
                    key={type.value}
                    className={`account-type-option ${formData.accountType === type.value ? 'selected' : ''}`}
                    onClick={() => handleAccountTypeChange(type.value as AccountType)}
                  >
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
              </div>

              <h3>Datos del Solicitante</h3>
              <div className="form-group">
                <label htmlFor="applicantName">Nombre Completo del Solicitante:</label>
                <input
                  type="text"
                  id="applicantName"
                  name="applicantName"
                  value={formData.applicantName}
                  onChange={handleChange}
                  required={true}
                  autoComplete="off"
                />
              </div>

              <div className="form-group">
                <label htmlFor="applicantEmail">Correo Electrónico del Solicitante:</label>
                <input
                  type="email"
                  id="applicantEmail"
                  name="applicantEmail"
                  value={formData.applicantEmail}
                  onChange={handleChange}
                  required={true}
                  autoComplete="off"
                />
              </div>
              
              {formData.accountType !== 'INDIVIDUAL' && (
                <>
                  <h3>Datos de la Institución</h3>
                  <div className="form-group">
                    <label htmlFor="institutionName">Nombre de la Institución / Razón Social:</label>
                    <input
                      type="text"
                      id="institutionName"
                      name="institutionName"
                      value={formData.institutionName}
                      onChange={handleChange}
                      required={true}
                      autoComplete="off"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="rut">{rutLabel}</label>
                    <input
                      type="text"
                      id="rut"
                      name="rut"
                      value={formData.rut}
                      onChange={handleRutChange}
                      onBlur={handleRutBlur}
                      required={true}
                      autoComplete="off"
                    />
                    {rutError && <p className="error-message">{rutError}</p>}
                  </div>
                </>
              )}

              <div className="form-group">
                <label htmlFor="country">País:</label>
                <select
                  id="country"
                  name="country"
                  value={formData.country}
                  onChange={handleChange}
                  required={true}
                  autoComplete="off"
                >
                  {COUNTRIES.map(country => (
                    <option key={country} value={country}>{country}</option>
                  ))}
                </select>
              </div>

              <div className="form-actions">
                <button type="submit" className="button-primary icon-button">
                  Revisar Datos
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
                <button type="button" className="button-secondary icon-button" onClick={handleCancel}>
                  <span className="material-symbols-outlined">cancel</span>
                  Cancelar Solicitud
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {currentStep === 'review' && (
        <div className="review-step">
          <h3>Revisa tus Datos</h3>
          <p>Por favor, verifica que la información sea correcta antes de enviar tu solicitud.</p>
          <div className="selected-account-type-display">
            <span className="material-symbols-outlined">{selectedAccountTypeDetails?.icon}</span>
            <div>
              <h4>{selectedAccountTypeDetails?.label}</h4>
              <p>{selectedAccountTypeDetails?.description}</p>
            </div>
          </div>
          <div className="review-data-summary">
            <p><strong>Nombre Solicitante:</strong> <span>{formData.applicantName}</span></p>
            <p><strong>Email Solicitante:</strong> <span>{formData.applicantEmail}</span></p>
            <p><strong>Tipo de Entidad:</strong> <span>{getEntityType(formData.accountType) === 'natural' ? 'Persona Natural' : 'Persona Jurídica'}</span></p>
            {formData.accountType !== 'INDIVIDUAL' && (
              <>
                <p><strong>Nombre Institución / Razón Social:</strong> <span>{formData.institutionName}</span></p>
                <p><strong>{rutLabel}:</strong> <span>{formData.rut}</span></p>
              </>
            )}
            <p><strong>País:</strong> <span>{formData.country}</span></p>
            <p><strong>Tipo de Cuenta:</strong> <span>{ACCOUNT_TYPES.find(t => t.value === formData.accountType)?.label}</span></p>
          </div>
          <div className="form-actions">
            <button type="button" className="button-secondary icon-button" onClick={handleEdit}>
              <span className="material-symbols-outlined">edit</span>
              Editar
            </button>
            <button type="button" className="button-secondary icon-button" onClick={handleCancel}>
              <span className="material-symbols-outlined">cancel</span>
              Cancelar Solicitud
            </button>
            <button type="button" className="button-primary icon-button" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Enviando...' : 'Enviar Solicitud'}
              {!isSubmitting && <span className="material-symbols-outlined">send</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestAccess;