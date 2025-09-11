import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import RequestAccess from './components/RequestAccess';
import AdditionalDataForm from './components/AdditionalDataForm';
import Login from './components/Login';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <nav className="main-nav">
          <Link to="/">Inicio</Link>
          <Link to="/request-access">Solicitar Acceso</Link>
          <Link to="/complete-registration">Completar Registro</Link>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/login">Iniciar Sesión</Link>
          <ThemeToggleButton />
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <h1>Bienvenido a MINREPORT</h1>
              <p>Plataforma de planificación, gestión, control y reportabilidad de proyectos mineros.</p>
            </div>
          } />
          <Route path="/request-access" element={<RequestAccess />} />
          <Route path="/complete-registration" element={<AdditionalDataForm />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;



