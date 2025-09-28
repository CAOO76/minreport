import React from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import './App.css';

function App() {
  const clientAccessUrl = import.meta.env.VITE_CLIENT_APP_URL || 'http://localhost:5175';

  return (
    <ThemeProvider>
      <div className="app">
        <div className="theme-toggle-container">
          <ThemeToggleButton />
        </div>
        <header className="app-header">
          <h1>MINREPORT</h1>
          <p>La plataforma integral para la gestión y reportabilidad de proyectos mineros.</p>
        </header>
        <a href={clientAccessUrl} className="access-button">
          <span className="material-symbols-outlined">login</span>
          Acceso Clientes
        </a>
      </div>
    </ThemeProvider>
  );
}

export default App;