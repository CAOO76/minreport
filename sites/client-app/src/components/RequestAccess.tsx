import React, { useState } from 'react';
import { registerInitialRequest } from '../services/api-client';

import './RequestAccess.css';
import './forms.css';

const ACCOUNT_TYPES = [
  {
    value: 'EMPRESARIAL',
    label: 'Empresarial',
    icon: 'business',
    description: 'Para empresas y organizaciones.',
  },
  {
    value: 'EDUCACIONAL',
    label: 'Educacional',
    icon: 'school',
    description: 'Para instituciones educativas.',
  },
  {
    value: 'INDIVIDUAL',
    label: 'Individual',
    icon: 'person',
    description: 'Para profesionales o personas naturales.',
  },
];

// ...existing code...

const RequestAccess: React.FC = () => {
  const [formData, setFormData] = useState({
    applicantName: '',
    applicantEmail: '',
    accountType: '',
  });
  const [currentStep, setCurrentStep] = useState<'select' | 'form' | 'review' | 'success'>('select');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [resultData, setResultData] = useState<any>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === 'applicantEmail') {
      setSubmitMessage(null);
      setIsError(false);
    }
  };

  const handleAccountTypeSelect = (value: string) => {
    setFormData((prev) => ({ ...prev, accountType: value }));
    setCurrentStep('form');
  };

  const handleCancel = () => {
    window.location.href = 'http://localhost:5175/';
  };
  // ...existing code...

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitMessage(null);
    setIsError(false);
    if (!formData.applicantEmail || !formData.applicantName || !formData.accountType) {
      setSubmitMessage('Completa todos los campos obligatorios.');
      setIsError(true);
      setIsSubmitting(false);
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.applicantEmail)) {
      setSubmitMessage('El formato del correo electrónico no es válido.');
      setIsError(true);
      setIsSubmitting(false);
      return;
    }
    setCurrentStep('review');
    setIsSubmitting(false);
  };

    const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitMessage(null);
    setIsError(false);
    try {
      const result = await registerInitialRequest({
        applicantName: formData.applicantName,
        applicantEmail: formData.applicantEmail,
        accountType: formData.accountType,
      });
      
      console.log('📨 Response from registerInitialRequest:', result);
      
      // Verificar si la solicitud fue exitosa
      if (result && (result.success || result.message)) {
        setResultData(result);
        setCurrentStep('success');
      } else if (result && result.error) {
        // Si hay un error en la respuesta
        setSubmitMessage(result.error || 'Error al procesar la solicitud');
        setIsError(true);
      } else {
        setCurrentStep('success');
      }
    } catch (error) {
      let errorMessage = 'Ocurrió un error al enviar la solicitud.';
      if (error instanceof Error && error.message) errorMessage = error.message;
      console.error('❌ Error in handleSubmit:', error);
      setSubmitMessage(errorMessage);
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // handleCancel ya está definido arriba para navegación home, no es necesario redefinirlo aquí

  return (
    <div className="form-container">
      <h2>Solicitar Acceso a MINREPORT</h2>
      {submitMessage && (
        <div className={`submit-message ${isError ? 'error' : 'success'}`}>
          <p>{submitMessage}</p>
        </div>
      )}
      {currentStep === 'select' && (
        <div className="account-type-selector">
          {ACCOUNT_TYPES.map((type) => (
            <div
              key={type.value}
              className={`account-type-option ${formData.accountType === type.value ? 'selected' : ''}`}
              onClick={() => handleAccountTypeSelect(type.value)}
            >
              <span className="material-symbols-outlined">{type.icon}</span>
              <span>{type.label}</span>
              <p>{type.description}</p>
            </div>
          ))}
        </div>
      )}
      {currentStep === 'form' && (
        <form onSubmit={handleReview} className="form-layout">
          <div className="account-type-summary">
            <span className="material-symbols-outlined account-type-icon">
              {ACCOUNT_TYPES.find((t) => t.value === formData.accountType)?.icon}
            </span>
            <h3>{ACCOUNT_TYPES.find((t) => t.value === formData.accountType)?.label}</h3>
          </div>
          <div className="form-group">
            <label htmlFor="applicantName">Nombre Completo del Solicitante:</label>
            <input
              type="text"
              id="applicantName"
              name="applicantName"
              value={formData.applicantName}
              onChange={handleChange}
              required
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
              required
              autoComplete="off"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="button-secondary icon-button" onClick={handleCancel}>
              <span className="material-symbols-outlined">cancel</span> Cancelar
            </button>
            <button type="submit" className="button-primary icon-button">
              Revisar Datos <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </form>
      )}
      {currentStep === 'review' && (
        <div className="review-step">
          <div className="account-type-summary">
            <span className="material-symbols-outlined account-type-icon">
              {ACCOUNT_TYPES.find((t) => t.value === formData.accountType)?.icon}
            </span>
            <h3>{ACCOUNT_TYPES.find((t) => t.value === formData.accountType)?.label}</h3>
          </div>
          <h3>Revisa tus Datos</h3>
          <div className="review-data-summary">
            <p>
              <strong>Nombre Solicitante:</strong> <span>{formData.applicantName}</span>
            </p>
            <p>
              <strong>Email Solicitante:</strong> <span>{formData.applicantEmail}</span>
            </p>
            <p>
              <strong>Tipo de Cuenta:</strong>{' '}
              <span>{ACCOUNT_TYPES.find((t) => t.value === formData.accountType)?.label}</span>
            </p>
          </div>
          <div className="form-actions">
            <button type="button" className="button-secondary icon-button" onClick={handleCancel}>
              <span className="material-symbols-outlined">cancel</span> Cancelar
            </button>
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
              {isSubmitting ? 'Enviando...' : 'Confirmar y Enviar Solicitud'}{' '}
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      )}
      {currentStep === 'success' && (
        <div className="success-step">
          <div className="success-message">
            <span className="material-symbols-outlined success-icon">check_circle</span>
            <h2>¡Solicitud Enviada!</h2>
            <p>Recibirás un email para completar tu solicitud.</p>
            
            {resultData?.isDevelopment && resultData?.formUrl && (
              <div className="dev-info-box">
                <p className="dev-label">🔧 Modo Desarrollo - Link de Prueba:</p>
                <a 
                  href={resultData.formUrl}
                  className="dev-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {resultData.formUrl}
                </a>
                <p className="dev-note">En producción, este link llegará por email.</p>
              </div>
            )}
          </div>
          <div className="form-actions">
            {resultData?.isDevelopment && resultData?.formUrl && (
              <button
                type="button"
                className="button-primary icon-button"
                onClick={() => {
                  window.location.href = resultData.formUrl;
                }}
              >
                <span className="material-symbols-outlined">arrow_forward</span> Ir al Formulario
              </button>
            )}
            <button
              type="button"
              className="button-primary icon-button"
              onClick={() => {
                window.location.href = 'http://localhost:5175/';
              }}
            >
              <span className="material-symbols-outlined">home</span> Volver al Portal
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestAccess;

