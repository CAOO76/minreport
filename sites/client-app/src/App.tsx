import { BrowserRouter, Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import RequestAccess from './components/RequestAccess';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { auth } from './firebaseConfig';
import useAuth from '@minreport/core/hooks/useAuth';
import './App.css';
import { signOut, type User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import CompleteDataForm from './components/CompleteDataForm';
import ClarificationResponse from './components/ClarificationResponse';
import CreatePassword from './components/CreatePassword';
import { PluginViewer } from '@minreport/core';
import Sidebar from './components/Sidebar';
import Plugins from './pages/Plugins';
import DeveloperPortal from './pages/DeveloperPortal';

// Layout para usuarios no autenticados
const PublicLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="app-container-public">
    <header className="app-header">
      <nav className="main-nav">
        <a
          href="http://localhost:5176"
          className="header-icon-button"
          title="Ir a la página principal"
        >
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
const PrivateLayout = ({
  user,
  activePlugins,
  children,
}: {
  user: User;
  activePlugins: string[] | null;
  children: React.ReactNode;
}) => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content-area">
        <header className="app-header">
          <div />
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

// Wrapper component to prepare props for PluginViewer
const PluginPage = () => {
  const { pluginId } = useParams<{ pluginId: string }>();
  const { user, claims, activePlugins } = useAuth(auth);
  const [idToken, setIdToken] = useState<string | null>(null);

  // Example theme - this could come from a context
  const theme = {
    '--theme-primary-color': '#007bff',
    '--theme-font-family': 'Arial, sans-serif',
  };

  useEffect(() => {
    if (user) {
      user.getIdToken().then(setIdToken);
    }
  }, [user]);

  const onActionProxy = async (action: string, data: any): Promise<any> => {
    console.log(`[App] Proxying action from plugin ${pluginId}: ${action}`);
    try {
      const callable = httpsCallable(getFunctions(), action);
      const result = await callable({ pluginId, data });
      return result.data;
    } catch (error) {
      console.error(`[App] Error proxying action '${action}':`, error);
      throw error; // Re-throw to be caught by the SDK
    }
  };

  if (!pluginId) return <div>Error: Plugin ID is missing.</div>;
  if (!user || !claims || !idToken) return <div>Loading Session...</div>;

  // Check for plugin access
  if (!claims?.admin && (!activePlugins || !activePlugins.includes(pluginId))) {
    return <div>Access Denied: You do not have permission to use this plugin.</div>;
  }

  const serializableUser = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };

  return (
    <PluginViewer
      pluginId={pluginId}
      user={serializableUser}
      claims={claims}
      idToken={idToken}
      theme={theme}
      onActionProxy={onActionProxy}
    />
  );
};

function App() {
  const { user, loading: authLoading, activePlugins } = useAuth(auth);

  if (authLoading) {
    return <div className="loading-container">Cargando aplicación...</div>;
  }

  return (
    <BrowserRouter>
      {user ? (
        <PrivateLayout user={user} activePlugins={activePlugins}>
          <Routes>
            <Route path="/" element={<h1>Dashboard (Privado)</h1>} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/plugins/:pluginId" element={<PluginPage />} />
          </Routes>
        </PrivateLayout>
      ) : (
        <PublicLayout>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </PublicLayout>
      )}
    </BrowserRouter>
  );
}

export default App;
