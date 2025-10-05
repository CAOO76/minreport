import React from 'react';
import { Link } from 'react-router-dom';
import './Welcome.css';

const Welcome: React.FC = () => {
  return (
    <div className="welcome-container">
      <div className="welcome-content">
        <div className="welcome-header">
          <span className="material-symbols-outlined welcome-icon">business</span>
          <h1>Portal de Clientes</h1>
          <p>Bienvenido al portal de acceso de MINREPORT</p>
        </div>

        <div className="welcome-actions">
          <Link to="/request-access" className="action-card request-card">
            <span className="material-symbols-outlined">person_add</span>
            <h3>Solicitar Acceso</h3>
            <p>¿Primera vez? Solicita acceso a la plataforma completando un breve formulario.</p>
          </Link>

          <Link to="/login" className="action-card login-card">
            <span className="material-symbols-outlined">login</span>
            <h3>Iniciar Sesión</h3>
            <p>¿Ya tienes cuenta? Accede a tu panel de administración.</p>
          </Link>
        </div>

        <div className="welcome-info">
          <div className="info-item">
            <span className="material-symbols-outlined">analytics</span>
            <div>
              <h4>Gestión de Proyectos</h4>
              <p>Administra y monitorea tus proyectos mineros</p>
            </div>
          </div>
          <div className="info-item">
            <span className="material-symbols-outlined">assessment</span>
            <div>
              <h4>Reportabilidad</h4>
              <p>Genera reportes detallados y análisis</p>
            </div>
          </div>
          <div className="info-item">
            <span className="material-symbols-outlined">security</span>
            <div>
              <h4>Seguridad</h4>
              <p>Información protegida y acceso controlado</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;