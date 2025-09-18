import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import './DeveloperPortal.css';

const DeveloperPortal: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('validating'); // validating | valid | invalid
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setToken(urlToken);
      // TODO: Llamar a la Cloud Function `validateDeveloperToken`
      // Por ahora, simulamos una validación exitosa si el token existe.
      console.log(`Simulando validación para el token: ${urlToken}`);
      setStatus('valid');
    } else {
      setStatus('invalid');
    }
  }, [searchParams]);

  if (status === 'validating') {
    return <div className="portal-container"><h2>Validando acceso...</h2></div>;
  }

  if (status === 'invalid') {
    return <div className="portal-container"><h2>Acceso Denegado</h2><p>El enlace de acceso no es válido o ha expirado.</p></div>;
  }

  return (
    <div className="portal-container">
      <header className="portal-header">
        <h1>Portal de Desarrolladores MINREPORT</h1>
      </header>
      <main className="portal-content">
        <h2>¡Bienvenido!</h2>
        <p>Has accedido al portal de recursos para desarrolladores de plugins de MINREPORT.</p>
        
        <section className="portal-section">
          <h3>Primeros Pasos</h3>
          <p>Para comenzar, descarga nuestro SDK y consulta la documentación.</p>
          <a href="#" className="download-sdk-btn">Descargar Paquete SDK (@minreport/sdk)</a>
        </section>

        <section className="portal-section">
          <h3>Documentación</h3>
          <p>Consulta la documentación completa para aprender a crear, probar y publicar tu plugin.</p>
          {/* Enlace a la futura documentación */}
        </section>
      </main>
    </div>
  );
};

export default DeveloperPortal;
