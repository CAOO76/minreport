import React, { useState, useEffect } from 'react';
import * as sdk from '@minreport/sdk';
import './App.css'; // Asumiremos que este archivo existirá para el theming
import { DataForm } from './DataForm';

// Orígenes permitidos para la comunicación con el núcleo de MINREPORT.
// En un entorno real, esto vendría de una variable de entorno.
const ALLOWED_CORE_ORIGINS = ['http://localhost:5175'];

const App: React.FC = () => {
  const [session, setSession] = useState<sdk.MinreportSession | null>(null);
  const [status, setStatus] = useState('Initializing SDK...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[Plugin] Component mounted. Initializing SDK...');

    sdk.init(ALLOWED_CORE_ORIGINS)
      .then((sessionData: sdk.MinreportSession) => {
        console.log('[Plugin] SDK initialized successfully!', sessionData);
        setSession(sessionData);
        setStatus(`Connected as ${sessionData.user.email}`);
        setError(null);
      })
      .catch((err: any) => {
        console.error('[Plugin] SDK initialization failed:', err);
        setError(err.message);
        setStatus('SDK Connection Failed');
      });
  }, []); // El array vacío asegura que esto se ejecute solo una vez.

  // TODO: Aquí irá el componente DataForm que crearemos en el siguiente paso.

  return (
    <div className="plugin-container">
      <header className="plugin-header">
        <h1>🔌 Plugin de Prueba (SDK v2)</h1>
      </header>
      <main className="plugin-content">
        <h2>Estado de Conexión</h2>
        {error ? (
          <p className="status-error">{status}: {error}</p>
        ) : (
          <p className={session ? 'status-success' : 'status-waiting'}>
            {status}
          </p>
        )}
        {session && (
          <div>
            <h3>Datos de Sesión Recibidos:</h3>
            <pre><code>{JSON.stringify(session.user, null, 2)}</code></pre>
            <hr />
            <DataForm />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
