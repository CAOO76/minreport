import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import RequestAccess from './components/RequestAccess';
import AdditionalDataForm from './components/AdditionalDataForm';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import useUserRequestStatus from './hooks/useUserRequestStatus'; // Keep this import
import { auth } from './firebaseConfig'; // Import auth
import useAuth from '@minreport/core/hooks/useAuth'; // Import the shared useAuth hook
import './App.css';
import { signOut } from 'firebase/auth'; // Import signOut

function App() {
  const { status, loading: statusLoading } = useUserRequestStatus(); // Removed requestUser
  const { user, loading: authLoading } = useAuth(auth); // Use the shared useAuth hook

  const overallLoading = statusLoading || authLoading; // Combine loading states

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      alert("Error al cerrar sesión. Por favor, inténtalo de nuevo.");
    }
  };

  if (overallLoading) {
    return <div className="loading-container">Cargando aplicación...</div>;
  }

  return (
    <BrowserRouter>
      <header className="app-header">
        <nav className="main-nav">
          <Link to="/">Inicio</Link>
          <Link to="/request-access">Solicitar Acceso</Link>
          {/* Mostrar el enlace a Completar Registro solo si el usuario está logueado */}
          {user && <Link to="/complete-registration">Completar Registro</Link>}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Conditionally render Login/Logout link */}
          {user ? (
            <button onClick={handleLogout} className="button-primary">Cerrar Sesión</button> // Use button-primary for styling
          ) : (
            <Link to="/login">Iniciar Sesión</Link>
          )}
          <ThemeToggleButton />
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <h1>Bienvenido a MINREPORT</h1>
              <p>Plataforma de planificación, gestión, control y reportabilidad de proyectos mineros.</p>
              {user && <p>¡Has iniciado sesión como: {user.email}!</p>} {/* Show welcome message */}
            </div>
          } />
          <Route path="/request-access" element={<RequestAccess />} />
          <Route
            path="/complete-registration"
            element={
              user ? (
                status === 'pending_additional_data' ? (
                  <AdditionalDataForm />
                ) : (
                  <div className="form-container">
                    <h2>Estado de tu Solicitud</h2>
                    <p>Tu solicitud se encuentra en estado: <strong>{status || 'No encontrada'}</strong>.</p>
                    {status === 'approved' && <p>¡Tu cuenta ha sido aprobada! Puedes iniciar sesión.</p>}
                    {status === 'rejected' && <p>Tu solicitud ha sido rechazada. Por favor, contacta a soporte.</p>}
                    {status === 'pending_review' && <p>Tu solicitud está pendiente de revisión por un administrador.</p>}
                    {!status && <p>No se encontró ninguna solicitud asociada a tu cuenta.</p>}
                  </div>
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          {/* Redirect from /login if user is already authenticated */}
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;