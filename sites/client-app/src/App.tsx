import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import React from 'react';
import RequestAccess from './components/RequestAccess';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { auth } from './firebaseConfig';
import useAuth from '@minreport/core/hooks/useAuth';
import './App.css';
import { signOut } from 'firebase/auth';
import CompleteDataForm from './components/CompleteDataForm';

/**
 * A component to handle routing logic for provisional users.
 */
const ProvisionalRouteGuard: React.FC<{ claims: any, children: React.ReactElement }> = ({ claims, children }) => {
  const location = useLocation();

  if (claims?.status === 'provisional' && location.pathname !== '/complete-data') {
    // If user is provisional and not on the completion page, redirect them there.
    return <Navigate to="/complete-data" replace />;
  }
  
  if (claims?.status !== 'provisional' && location.pathname === '/complete-data') {
    // If user is NOT provisional but tries to access completion page, redirect away.
    return <Navigate to="/" replace />;
  }

  return children; // Otherwise, render the requested routes.
};

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
          {/* Hide request access if user is logged in */}
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
        <ProvisionalRouteGuard claims={claims}>
          <Routes>
            <Route path="/" element={
              <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                <h1>Portal de Clientes MINREPORT</h1>
                {!user && <p>Por favor, inicia sesión para ver el estado de tu solicitud o crear una nueva.</p>}
              </div>
            } />
            <Route path="/request-access" element={<RequestAccess />} />
            <Route path="/complete-data" element={<CompleteDataForm />} />
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          </Routes>
        </ProvisionalRouteGuard>
      </main>
    </BrowserRouter>
  );
}

export default App;