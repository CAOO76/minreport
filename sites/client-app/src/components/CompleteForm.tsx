import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getFirestore, collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import '../styles/complete-form.css';

interface InitialRequest {
  id: string;
  applicantName: string;
  applicantEmail: string;
  accountType: string;
  token: string;
}

const CompleteForm = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialRequest, setInitialRequest] = useState<InitialRequest | null>(null);
  
  const [formData, setFormData] = useState({
    companyName: '',
    contactPhone: '',
    country: '',
    industry: '',
    employeeCount: '',
    additionalInfo: '',
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Validar token y cargar datos iniciales
  useEffect(() => {
    const validateAndLoadData = async () => {
      try {
        if (!token) {
          setError('Token no proporcionado. Por favor, verifica el enlace del email.');
          setLoading(false);
          return;
        }

        const db = getFirestore();
        const q = query(
          collection(db, 'initial_requests'),
          where('token', '==', token)
        );
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          setError('Token inválido o expirado. Por favor, solicita un nuevo acceso.');
          setLoading(false);
          return;
        }

        const doc = querySnapshot.docs[0];
        const data = doc.data() as any;
        
        setInitialRequest({
          id: doc.id,
          applicantName: data.applicantName,
          applicantEmail: data.applicantEmail,
          accountType: data.accountType,
          token: data.token,
        });
        
        setLoading(false);
      } catch (err) {
        console.error('Error validando token:', err);
        setError('Error al validar tu solicitud. Por favor, intenta nuevamente.');
        setLoading(false);
      }
    };

    validateAndLoadData();
  }, [token]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!initialRequest) {
      setError('Error: No se encontraron los datos iniciales.');
      return;
    }

    // Validar campos requeridos
    if (!formData.companyName || !formData.contactPhone || !formData.country) {
      setError('Por favor, completa los campos requeridos (empresa, teléfono, país).');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const db = getFirestore();
      const docRef = doc(db, 'initial_requests', initialRequest.id);
      
      await updateDoc(docRef, {
        // Datos iniciales
        applicantName: initialRequest.applicantName,
        applicantEmail: initialRequest.applicantEmail,
        accountType: initialRequest.accountType,
        
        // Datos completados
        companyName: formData.companyName.trim(),
        contactPhone: formData.contactPhone.trim(),
        country: formData.country,
        industry: formData.industry,
        employeeCount: formData.employeeCount,
        additionalInfo: formData.additionalInfo.trim(),
        
        // Metadata
        completedAt: new Date(),
        status: 'completed',
        token,
      });

      setSubmitSuccess(true);
      
      // Redirigir después de 3 segundos
      setTimeout(() => {
        window.location.href = 'http://localhost:5175/';
      }, 3000);
    } catch (err) {
      console.error('Error guardando formulario:', err);
      setError('Error al guardar tu solicitud. Por favor, intenta nuevamente.');
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="complete-form-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Validando tu solicitud...</p>
        </div>
      </div>
    );
  }

  if (error && !initialRequest) {
    return (
      <div className="complete-form-container">
        <div className="error-state">
          <span className="material-symbols-outlined error-icon">error</span>
          <h2>Error en tu Solicitud</h2>
          <p>{error}</p>
          <button
            type="button"
            className="button-primary"
            onClick={() => (window.location.href = 'http://localhost:5175/')}
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="complete-form-container">
        <div className="success-state">
          <span className="material-symbols-outlined success-icon">check_circle</span>
          <h2>¡Solicitud Completada!</h2>
          <p>Hemos recibido tu información. Nos pondremos en contacto pronto.</p>
          <p className="redirect-message">Redirigiendo en 3 segundos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="complete-form-container">
      <div className="form-wrapper">
        <div className="form-header">
          <h1>Completa tu Solicitud</h1>
          <p>Por favor, proporciona los siguientes detalles para activar tu cuenta.</p>
          
          <div className="applicant-info">
            <div className="info-item">
              <span className="label">Nombre:</span>
              <span className="value">{initialRequest?.applicantName}</span>
            </div>
            <div className="info-item">
              <span className="label">Email:</span>
              <span className="value">{initialRequest?.applicantEmail}</span>
            </div>
            <div className="info-item">
              <span className="label">Tipo de Cuenta:</span>
              <span className="value">
                {initialRequest?.accountType === 'EMPRESARIAL' && 'Empresarial'}
                {initialRequest?.accountType === 'EDUCACIONAL' && 'Educacional'}
                {initialRequest?.accountType === 'INDIVIDUAL' && 'Individual'}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="complete-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="companyName" className="required">
              Nombre de la Empresa/Organización
            </label>
            <input
              type="text"
              id="companyName"
              name="companyName"
              value={formData.companyName}
              onChange={handleInputChange}
              placeholder="Ej: Acme Corporation"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="contactPhone" className="required">
              Teléfono de Contacto
            </label>
            <input
              type="tel"
              id="contactPhone"
              name="contactPhone"
              value={formData.contactPhone}
              onChange={handleInputChange}
              placeholder="Ej: +1 (555) 123-4567"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="country" className="required">
              País
            </label>
            <select
              id="country"
              name="country"
              value={formData.country}
              onChange={handleInputChange}
              required
            >
              <option value="">Selecciona un país</option>
              <option value="AR">Argentina</option>
              <option value="BO">Bolivia</option>
              <option value="BR">Brasil</option>
              <option value="CL">Chile</option>
              <option value="CO">Colombia</option>
              <option value="EC">Ecuador</option>
              <option value="PE">Perú</option>
              <option value="PY">Paraguay</option>
              <option value="UY">Uruguay</option>
              <option value="VE">Venezuela</option>
              <option value="OTHER">Otro</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="industry">Industria</label>
            <select
              id="industry"
              name="industry"
              value={formData.industry}
              onChange={handleInputChange}
            >
              <option value="">Selecciona una industria</option>
              <option value="technology">Tecnología</option>
              <option value="finance">Finanzas</option>
              <option value="healthcare">Salud</option>
              <option value="education">Educación</option>
              <option value="retail">Retail</option>
              <option value="manufacturing">Manufactura</option>
              <option value="other">Otra</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="employeeCount">Número de Empleados</label>
            <select
              id="employeeCount"
              name="employeeCount"
              value={formData.employeeCount}
              onChange={handleInputChange}
            >
              <option value="">Selecciona un rango</option>
              <option value="1-10">1-10</option>
              <option value="11-50">11-50</option>
              <option value="51-200">51-200</option>
              <option value="201-500">201-500</option>
              <option value="500+">500+</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="additionalInfo">Información Adicional</label>
            <textarea
              id="additionalInfo"
              name="additionalInfo"
              value={formData.additionalInfo}
              onChange={handleInputChange}
              placeholder="Cuéntanos más sobre tu organización o proyecto..."
              rows={4}
            />
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="button-primary icon-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Completar Solicitud'}
              <span className="material-symbols-outlined">check</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CompleteForm;
