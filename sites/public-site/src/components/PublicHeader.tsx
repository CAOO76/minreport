import React, { useState, useEffect } from 'react';
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

  const handleClientAccess = () => {
  window.location.href = 'http://localhost:5175';
  };

  return (
    <header className="public-header">
      <div className="header-brand">
        <div className="brand-link">
          <span className="material-symbols-outlined brand-icon">analytics</span>
          <span className="brand-text">MinReport</span>
        </div>
      </div>
      
      <nav className="header-nav">
        <button 
          onClick={handleClientAccess}
          className="nav-button client-access"
          title="Portal de Clientes"
        >
          <span className="material-symbols-outlined">business</span>
          <span className="nav-text">Portal Clientes</span>
        </button>
      </nav>

      <div className="header-actions">
        <button 
          onClick={toggleTheme} 
          className="theme-toggle"
          aria-label="Cambiar tema"
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