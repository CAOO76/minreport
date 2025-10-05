import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { auth } from '../firebaseConfig'; // Assuming you have this export
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { apiCall, getApiUrl } from '../config/api';
import './forms.css';

const CreatePassword = () => {
  const [searchParams] = useSearchParams();
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [activationToken, setActivationToken] = useState<string | null>(null);
  const [flowType, setFlowType] = useState<'reset' | 'setup'>('reset');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const code = searchParams.get('oobCode');
    const token = searchParams.get('token');
    
    if (token) {
      // Flujo de configuración inicial de cuenta
      setFlowType('setup');
      setActivationToken(token);
      validateActivationToken(token);
    } else if (code) {
      // Flujo de reset de contraseña tradicional
      setFlowType('reset');
      verifyPasswordResetCode(auth, code)
        .then(() => {
          setOobCode(code);
          setIsVerifying(false);
        })
        .catch(() => {
          setMessage('El enlace es inválido, ha expirado o ya fue utilizado.');
          setIsError(true);
          setIsVerifying(false);
        });
    } else {
      setMessage('El enlace es inválido o está incompleto.');
      setIsError(true);
      setIsVerifying(false);
    }
  }, [searchParams]);

  const validateActivationToken = async (token: string) => {
    try {
      const result = await apiCall('VALIDATE_ACTIVATION_TOKEN', { token });
      
      if (result.success) {
        setIsVerifying(false);
      } else {
        setMessage(result.error || 'Token de activación inválido o expirado.');
        setIsError(true);
        setIsVerifying(false);
      }
    } catch (error) {
      setMessage('Error al validar el token de activación.');
      setIsError(true);
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage('Las contraseñas no coinciden.');
      setIsError(true);
      return;
    }
    if (newPassword.length < 6) {
      setMessage('La contraseña debe tener al menos 6 caracteres.');
      setIsError(true);
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);

    try {
      if (flowType === 'setup' && activationToken) {
        // Flujo de configuración inicial de cuenta
        const result = await apiCall('SETUP_ACCOUNT_PASSWORD', { 
          token: activationToken, 
          password: newPassword 
        });
        
        if (result.success) {
          setMessage('¡Tu cuenta ha sido configurada con éxito! Ya puedes iniciar sesión.');
          setIsSuccess(true);
        } else {
          setMessage(result.error || 'Error al configurar la cuenta.');
          setIsError(true);
        }
      } else if (flowType === 'reset' && oobCode) {
        // Flujo de reset de contraseña tradicional
        await confirmPasswordReset(auth, oobCode, newPassword);
        setMessage('¡Tu contraseña ha sido actualizada con éxito!');
        setIsSuccess(true);
      } else {
        setMessage('Error: Tipo de operación no válido.');
        setIsError(true);
      }
    } catch (error) {
      const errorMessage = flowType === 'setup' 
        ? 'Ocurrió un error al configurar la cuenta. Por favor, solicita un nuevo enlace de activación.'
        : 'Ocurrió un error al actualizar la contraseña. Por favor, intenta solicitar un nuevo enlace.';
      setMessage(errorMessage);
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isVerifying) {
    return (
      <div className="form-container">
        <p>Verificando enlace...</p>
      </div>
    );
  }

  if (isError && !isSuccess) {
    return (
      <div className="form-container">
        <p className="error-message">{message}</p>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="success-container">
        <span className="material-symbols-outlined success-icon">check_circle</span>
        <h2>{flowType === 'setup' ? '¡Cuenta Configurada!' : '¡Contraseña Actualizada!'}</h2>
        <p className="success-subtitle">{message}</p>
        <Link
          to="/login"
          className="button-primary icon-button"
          style={{ marginTop: '2rem', textDecoration: 'none' }}
        >
          <span className="material-symbols-outlined">login</span>
          Ir a Iniciar Sesión
        </Link>
      </div>
    );
  }

  return (
    <div className="form-container">
      <h2>{flowType === 'setup' ? 'Configurar Tu Cuenta' : 'Crear Nueva Contraseña'}</h2>
      <p>{flowType === 'setup' 
        ? 'Tu cuenta ha sido aprobada. Configura una contraseña segura para acceder al sistema.' 
        : 'Ingresa una contraseña segura para tu cuenta.'}</p>
      <form onSubmit={handleSubmit} className="form-layout">
        {message && <p className={`submit-message ${isError ? 'error' : 'success'}`}>{message}</p>}
        
        {flowType === 'setup' && (
          <div className="password-requirements">
            <h4>Requisitos de contraseña:</h4>
            <ul>
              <li>Mínimo 6 caracteres</li>
              <li>Se recomienda incluir letras, números y símbolos</li>
              <li>Evita usar información personal</li>
            </ul>
          </div>
        )}
        
        <div className="form-group">
          <label htmlFor="newPassword">{flowType === 'setup' ? 'Contraseña' : 'Nueva Contraseña'}</label>
          <input
            type="password"
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirmar Contraseña</label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
          {confirmPassword && newPassword && (
            <span className={newPassword === confirmPassword ? "password-match" : "password-mismatch"}>
              {newPassword === confirmPassword ? "✓ Las contraseñas coinciden" : "✗ Las contraseñas no coinciden"}
            </span>
          )}
        </div>
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando...' : (flowType === 'setup' ? 'Configurar Cuenta' : 'Guardar Contraseña')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreatePassword;
