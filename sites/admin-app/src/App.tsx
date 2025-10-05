import { Routes, Route } from 'react-router-dom';
import { auth } from './firebaseConfig.ts';
import { signOut } from 'firebase/auth';
import Login from './components/Login.tsx';
import useAuth from './hooks/useAuth.ts';
import { ThemeToggleButton } from './components/ThemeToggleButton.tsx';
import { Sidebar } from './components/Sidebar.tsx'; // Verificar que Sidebar no tenga rutas/plugins
import Dashboard from './pages/Dashboard.tsx';
import Subscriptions from './pages/Subscriptions.tsx';
import Accounts from './pages/Accounts.tsx';
import AccountDetails from './pages/AccountDetails.tsx'; // Importar el nuevo componente
// ...existing code...
import './App.css';

function App() {
  const { user, isAdmin, loading } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      alert("Error al cerrar sesión. Por favor, inténtalo de nuevo.");
    }
  };

  if (loading) {
    return <div className="loading-container">Cargando...</div>;
  }

  if (!user || !isAdmin) {
    return (
      <div className="login-page-wrapper">
        <Login />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <header className="app-header">
        <h1>Panel de Administración</h1>
        <div className="header-controls">
          <ThemeToggleButton />
          <button onClick={handleLogout} className="icon-button" aria-label="Cerrar Sesión">
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:accountId" element={<AccountDetails />} /> {/* Nueva ruta para detalles de cuenta */}
            {/* ...existing code... */}
          {/* Eliminar rutas de plugins si existen */}
        </Routes>
      </main>
    </div>
  );
}

export default App;