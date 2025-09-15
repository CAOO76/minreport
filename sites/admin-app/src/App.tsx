import { Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import useAuth from './hooks/useAuth';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
import { Sidebar } from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Subscriptions from './pages/Subscriptions';
import Accounts from './pages/Accounts';
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
          {/* Añadir una ruta para settings y una página 404 sería una buena práctica */}
        </Routes>
      </main>
    </div>
  );
}

export default App;