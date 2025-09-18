import React, { useState, useEffect } from 'react';
import { initialize, getSession, MinreportUser, requestNavigation, showNotification } from '@minreport/sdk';
import './App.css';

// Orígenes permitidos para la comunicación con el núcleo.
const ALLOWED_CORE_ORIGINS = ['http://localhost:5175', 'http://127.0.0.1:5015'];

const App: React.FC = () => {
  const [user, setUser] = useState<MinreportUser | null>(null);
  const [status, setStatus] = useState('Initializing SDK...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('Plugin cargado. Inicializando SDK de MINREPORT...');
    
    initialize(ALLOWED_CORE_ORIGINS)
      .then(session => {
        console.log('SDK inicializado exitosamente.', session);
        if (session.user) {
          setUser(session.user);
          setStatus(`¡Plugin conectado! Hola, ${session.user.email}`);
          setError(null);
        } else {
          setError('La sesión fue recibida pero no contiene un usuario.');
          setStatus('Error de conexión');
        }
      })
      .catch(err => {
        console.error('Error al inicializar el SDK:', err);
        setError(err.message);
        setStatus('Error al conectar con el núcleo');
      });

  }, []);

  const handleNavigate = () => {
    console.log('Solicitando navegación a /subscriptions');
    requestNavigation('/subscriptions');
  };

  const handleNotify = () => {
    console.log('Solicitando mostrar notificación');
    showNotification('success', '¡El plugin ha enviado una notificación al núcleo!');
  };

  return (
    <div className="plugin-container">
      <header className="plugin-header">
        <h1>🔌 Plugin de Prueba (usando SDK)</h1>
      </header>
      <main className="plugin-content">
        {error ? (
          <p className="status-error">Error: {error}</p>
        ) : (
          <p className={user ? 'status-success' : 'status-waiting'}>
            {status}
          </p>
        )}
        {user && (
          <div className="plugin-actions">
            <p>Prueba la comunicación con el núcleo:</p>
            <button onClick={handleNavigate}>Navegar a "Solicitudes"</button>
            <button onClick={handleNotify}>Mostrar Notificación</button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;