import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import React from 'react';
import RequestAccess from './components/RequestAccess';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { auth } from './firebaseConfig';
import useAuth from '@minreport/core/hooks/useAuth';
import './App.css';
import { signOut } from 'firebase/auth';
import CompleteDataForm from './components/CompleteDataForm';
import ClarificationResponse from './components/ClarificationResponse';
import CreatePassword from './components/CreatePassword';

function App() {
  const { user, claims, loading: authLoading } = useAuth(auth);

  const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || 'http://localhost:5176';

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  if (authLoading) {
    return <div className="loading-container">Cargando aplicación...</div>;
  }

  return (
    <BrowserRouter>
      <header className="app-header">
        <nav className="main-nav">
          <a href={publicSiteUrl} className="header-icon-button" title="Ir a la página principal">
            <span className="material-symbols-outlined">home</span>
          </a>
          {!user && <Link to="/request-access">Solicitar Acceso</Link>}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {user ? (
            <button onClick={handleLogout} className="header-icon-button" title="Cerrar Sesión">
              <span className="material-symbols-outlined">logout</span>
            </button>
          ) : (
            <Link to="/login" className="header-icon-button" title="Iniciar Sesión">
              <span className="material-symbols-outlined">login</span>
            </Link>
          )}
          <ThemeToggleButton />
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <h1>Portal de Clientes MINREPORT</h1>
              {!user && <p>Por favor, inicia sesión para ver el estado de tu solicitud o crear una nueva.</p>}
            </div>
          } />
          <Route path="/request-access" element={<RequestAccess />} />
          <Route path="/complete-data" element={<CompleteDataForm />} />
          <Route path="/clarification-response" element={<ClarificationResponse />} />
          <Route path="/actions/create-password" element={<CreatePassword />} />
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;