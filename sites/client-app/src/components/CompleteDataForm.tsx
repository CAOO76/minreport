import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { State, City } from 'country-state-city';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import './forms.css';

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
    streetAddress: string;
    city: string;
    state: string;
    postalCode: string;
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

  const [formData, setFormData] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const states = useMemo(() => accountInfo?.country ? State.getStatesOfCountry(accountInfo.country) : [], [accountInfo]);
  const cities = useMemo(() => (accountInfo?.country && formData.state) ? City.getCitiesOfState(accountInfo.country, formData.state) : [], [accountInfo, formData.state]);

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
        setAccountInfo({ accountType: result.accountType, country: result.country });
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
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePhoneChange = (value: string | undefined) => {
      if (value) {
        setFormData(prev => ({ ...prev, adminPhone: value }));
      }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="form-container"><p>Validando enlace...</p></div>;
  }

  if (isError || !accountInfo) {
    return <div className="form-container"><p style={{ color: 'red' }}>{message}</p></div>;
  }

  if (isSubmitted) {
      return (
        <div className="success-container">
            <span className="material-symbols-outlined success-icon">check_circle</span>
            <h2>¡Información Recibida!</h2>
            <p className="success-subtitle">Hemos guardado tus datos. Nuestro equipo realizará la revisión final y te notificaremos por correo cuando tu cuenta sea activada.</p>
            <Link to="/" className="button-primary icon-button" style={{ marginTop: '2rem', textDecoration: 'none' }}>
                <span className="material-symbols-outlined">home</span>
                Volver al portal de clientes MINREPORT
            </Link>
        </div>
      );
  }

  return (
    <div className="form-container">
      <h2>Completar Datos de la Cuenta</h2>
      <p>Por favor, completa la información requerida para finalizar el proceso de solicitud.</p>
      
      <form onSubmit={handleSubmit} className="form-layout">
        <h3>Datos del Administrador de la Cuenta</h3>
        <div className="form-group">
          <label htmlFor="adminName">Nombre Completo</label>
          <input type="text" name="adminName" onChange={handleChange} required />
        </div>
        <div className="form-group">
          <label htmlFor="adminEmail">Correo Electrónico</label>
          <input type="email" name="adminEmail" onChange={handleChange} required />
        </div>
        <div className="form-group">
            <label htmlFor="adminPhone">Celular del Administrador</label>
            <PhoneInput name="adminPhone" defaultCountry={accountInfo.country as any} value={formData.adminPhone} onChange={handlePhoneChange} required />
        </div>
        {accountInfo.accountType !== 'INDIVIDUAL' && (
            <div className="form-group">
                <label htmlFor="adminRole">Cargo del Administrador</label>
                <input type="text" name="adminRole" onChange={handleChange} required />
            </div>
        )}

        {accountInfo.accountType === 'INDIVIDUAL' ? (
            <div className="form-group">
                <label htmlFor="run">RUN</label>
                <input type="text" name="run" onChange={handleChange} required />
            </div>
        ) : (
            <>
                <h3>Dirección Comercial</h3>
                <div className="form-group">
                    <label htmlFor="streetAddress">Dirección (Calle y Número)</label>
                    <input type="text" name="streetAddress" onChange={handleChange} required />
                </div>
                <div className="form-group">
                    <label>Región/Provincia/Estado</label>
                    <select name="state" value={formData.state} onChange={handleChange} required disabled={!states.length}>
                        <option value="">Selecciona una región</option>
                        {states.map(s => <option key={s.isoCode} value={s.isoCode}>{s.name}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Ciudad</label>
                    <select name="city" value={formData.city} onChange={handleChange} required disabled={!cities.length}>
                        <option value="">Selecciona una ciudad</option>
                        {cities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label htmlFor="postalCode">Código Postal</label>
                    <input type="text" name="postalCode" onChange={handleChange} required />
                </div>
            </>
        )}

        <div className="form-actions">
            <Link to="/" className="button-secondary icon-button" style={{textDecoration: 'none'}}>Cancelar</Link>
            <button type="submit" className="button-primary" disabled={isSubmitting}>{isSubmitting ? 'Enviando...' : 'Enviar Datos'}</button>
        </div>
      </form>
    </div>
  );
};

export default CompleteDataForm;