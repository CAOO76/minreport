import React, { useState, useEffect } from 'react';
import './App.css';

// Orígenes esperados: el servidor de desarrollo de Vite y el emulador de hosting
const ALLOWED_ORIGINS = ['http://localhost:5175', 'http://127.0.0.1:5015'];

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // --- Medida de Seguridad #1: Validar el origen del mensaje ---
      if (!ALLOWED_ORIGINS.includes(event.origin)) {
        console.warn(`Mensaje bloqueado de origen desconocido: ${event.origin}`);
        return;
      }

      // --- Medida de Seguridad #2: Validar la estructura del mensaje ---
      if (event.data && event.data.type === 'MINREPORT_SESSION_DATA') {
        const sessionData = event.data.data;
        if (sessionData && sessionData.user && sessionData.user.email) {
          console.log('Datos de sesión recibidos del núcleo:', sessionData);
          setUser(sessionData.user);
          setError(null);
        } else {
          setError('Los datos de sesión recibidos no tienen el formato esperado o el usuario es nulo.');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="plugin-container">
      <header className="plugin-header">
        <h1>🔌 Plugin de Prueba</h1>
      </header>
      <main className="plugin-content">
        {error && <p className="status-error">Error: {error}</p>}
        {user ? (
          <p className="status-success">
            ¡Plugin conectado! Hola, <strong>{user.email}</strong>
          </p>
        ) : (
          <p className="status-waiting">Esperando datos del Núcleo...</p>
        )}
      </main>
    </div>
  );
};

export default App;