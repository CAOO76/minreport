import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import React from 'react';
import RequestAccess from './components/RequestAccess';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { auth } from './firebaseConfig';
import useAuth from '@minreport/core/hooks/useAuth';
import './App.css';
import { signOut, type User } from 'firebase/auth';
import CompleteDataForm from './components/CompleteDataForm';
import ClarificationResponse from './components/ClarificationResponse';
import CreatePassword from './components/CreatePassword';
import PluginViewer from './components/PluginViewer';
import Sidebar from './components/Sidebar'; // Importar Sidebar
import Plugins from './pages/Plugins'; // Importar la nueva página de plugins

// Layout para usuarios no autenticados
const PublicLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="app-container-public">
    <header className="app-header">
      <nav className="main-nav">
        <a href="http://localhost:5176" className="header-icon-button" title="Ir a la página principal">
          <span className="material-symbols-outlined">home</span>
        </a>
        <Link to="/request-access">Solicitar Acceso</Link>
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link to="/login" className="header-icon-button" title="Iniciar Sesión">
          <span className="material-symbols-outlined">login</span>
        </Link>
        <ThemeToggleButton />
      </div>
    </header>
    <main className="app-main">{children}</main>
  </div>
);

// Layout para usuarios autenticados
const PrivateLayout = ({ user, activePlugins, children }: { user: User, activePlugins: string[] | null, children: React.ReactNode }) => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  return (
    <div className="app-container">
      <Sidebar /> {/* Pasar activePlugins al Sidebar */}
      <div className="main-content-area">
        <header className="app-header">
          <div /> {/* Div vacío para empujar los otros elementos a la derecha */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="user-display-name">{user.displayName || user.email}</span>
            <ThemeToggleButton />
            <button onClick={handleLogout} className="header-icon-button" title="Cerrar Sesión">
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
};

function App() {
  const { user, loading: authLoading, activePlugins } = useAuth(auth); // Obtener activePlugins

  if (authLoading) {
    return <div className="loading-container">Cargando aplicación...</div>;
  }

  return (
    <BrowserRouter>
      {user ? (
        <PrivateLayout user={user} activePlugins={activePlugins}> {/* Pasar activePlugins */}
          <Routes>
            <Route path="/" element={<h1>Dashboard (Privado)</h1>} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/plugins/:pluginId" element={<PluginViewer activePlugins={activePlugins} />} /> {/* Pasar activePlugins al PluginViewer */}
            {/* Redirigir rutas públicas a la raíz si el usuario está logueado */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/request-access" element={<Navigate to="/" replace />} />
          </Routes>
        </PrivateLayout>
      ) : (
        <PublicLayout>
          <Routes>
            <Route path="/" element={
              <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                <h1>Portal de Clientes MINREPORT</h1>
                <p>Por favor, inicia sesión para ver el estado de tu solicitud o crear una nueva.</p>
              </div>
            } />
            <Route path="/request-access" element={<RequestAccess />} />
            <Route path="/complete-data" element={<CompleteDataForm />} />
            <Route path="/clarification-response" element={<ClarificationResponse />} />
            <Route path="/actions/create-password" element={<CreatePassword />} />
            <Route path="/login" element={<Login />} />
            {/* Si un usuario no logueado intenta ir a una ruta privada, lo mandamos al login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </PublicLayout>
      )}
    </BrowserRouter>
  );
}

export default App;