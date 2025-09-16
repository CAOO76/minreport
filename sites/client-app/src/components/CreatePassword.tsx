
import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { auth } from '../firebaseConfig'; // Assuming you have this export
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import './forms.css';

const CreatePassword = () => {
  const [searchParams] = useSearchParams();
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const code = searchParams.get('oobCode');
    if (!code) {
      setMessage('El enlace es inválido o está incompleto.');
      setIsError(true);
      setIsVerifying(false);
      return;
    }

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
  }, [searchParams]);

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
    if (!oobCode) return;

    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);

    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setMessage('¡Tu contraseña ha sido creada con éxito!');
      setIsSuccess(true);
    } catch (error) {
      setMessage('Ocurrió un error al crear la contraseña. Por favor, intenta solicitar un nuevo enlace.');
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isVerifying) {
    return <div className="form-container"><p>Verificando enlace...</p></div>;
  }

  if (isError && !isSuccess) {
    return <div className="form-container"><p className="error-message">{message}</p></div>;
  }

  if (isSuccess) {
    return (
        <div className="success-container">
            <span className="material-symbols-outlined success-icon">check_circle</span>
            <h2>¡Contraseña Creada!</h2>
            <p className="success-subtitle">{message}</p>
            <Link to="/login" className="button-primary icon-button" style={{ marginTop: '2rem', textDecoration: 'none' }}>
                <span className="material-symbols-outlined">login</span>
                Ir a Iniciar Sesión
            </Link>
        </div>
    );
  }

  return (
    <div className="form-container">
      <h2>Crear Nueva Contraseña</h2>
      <p>Ingresa una contraseña segura para tu nueva cuenta.</p>
      <form onSubmit={handleSubmit} className="form-layout">
        {message && <p className={`submit-message ${isError ? 'error' : 'success'}`}>{message}</p>}
        <div className="form-group">
          <label htmlFor="newPassword">Nueva Contraseña</label>
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
        </div>
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando...' : 'Guardar Contraseña'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreatePassword;
