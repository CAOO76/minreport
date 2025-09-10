import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import RequestAccess from './components/RequestAccess';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc' }}>
        <Link to="/">Inicio</Link> |
        <Link to="/request-access">Solicitar Acceso</Link>
      </nav>
      <Routes>
        <Route path="/" element={
          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <h1>Bienvenido a MINREPORT</h1>
            <p>Plataforma de planificación, gestión, control y reportabilidad de proyectos mineros.</p>
            <p>Haz clic en "Solicitar Acceso" para comenzar.</p>
            <img src="/vite.svg" className="logo" alt="Vite logo" style={{ width: '100px', height: '100px' }} />
          </div>
        } />
        <Route path="/request-access" element={<RequestAccess />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
