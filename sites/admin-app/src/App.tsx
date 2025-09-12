import { AdminPanel } from './components/AdminPanel';
import Login from './components/Login';
import useAuth from './hooks/useAuth';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { signOut } from 'firebase/auth';
import { auth } from './firebaseConfig';
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
    return <div className="loading-container">Cargando...</div>; // O un spinner de carga
  }

  if (!user || !isAdmin) {
    return (
      <main className="app-main">
        <Login />
      </main>
    );
  }

  return (
    <>
      <header className="app-header">
        <h1>Panel de Administración MINREPORT</h1>
        <div className="header-controls">
          <ThemeToggleButton />
          <button onClick={handleLogout} className="icon-button" aria-label="Cerrar Sesión">
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>
      <main className="app-main">
        <AdminPanel />
      </main>
    </>
  );
}

export default App;
