import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './PublicHeader.css';

const PublicHeader: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Cargar tema desde localStorage al iniciar
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    setIsDarkMode(shouldUseDark);
    document.documentElement.setAttribute('data-theme', shouldUseDark ? 'dark' : 'light');
  }, []);

  // Toggle tema
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    const themeValue = newTheme ? 'dark' : 'light';
    localStorage.setItem('theme', themeValue);
    document.documentElement.setAttribute('data-theme', themeValue);
  };

  return (
    <header className="public-header">
      <div className="header-brand">
        <Link to="/" className="brand-link">
          <span className="material-symbols-outlined brand-icon">analytics</span>
          <span className="brand-text">MinReport</span>
        </Link>
      </div>

      <nav className="header-nav">
        <a 
          href="http://localhost:5179" 
          className="nav-link"
          title="Ir a página principal"
        >
          <span className="material-symbols-outlined">home</span>
          <span className="nav-text">Inicio</span>
        </a>
        
        <Link 
          to="/request-access" 
          className="nav-link"
          title="Solicitar acceso"
        >
          <span className="material-symbols-outlined">person_add</span>
          <span className="nav-text">Solicitar Acceso</span>
        </Link>

        <Link 
          to="/login" 
          className="nav-link login-link"
          title="Iniciar sesión"
        >
          <span className="material-symbols-outlined">login</span>
          <span className="nav-text">Iniciar Sesión</span>
        </Link>
      </nav>

      <div className="header-actions">
        <button 
          className="theme-toggle"
          onClick={toggleTheme}
          title={isDarkMode ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          aria-label={isDarkMode ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        >
          <span className="material-symbols-outlined">
            {isDarkMode ? 'light_mode' : 'dark_mode'}
          </span>
        </button>
      </div>
    </header>
  );
};

export default PublicHeader;