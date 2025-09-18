import React from 'react';
import './PluginsManagement.css';

const PluginsManagement: React.FC = () => {
  // Lógica futura para interactuar con Firestore

  return (
    <div className="plugins-management-container">
      <header className="plugins-management-header">
        <h1>Gestión de Plugins</h1>
        <button className="add-plugin-btn">Añadir Nuevo Plugin</button>
      </header>
      
      <div className="plugins-list">
        {/* Aquí se renderizará la lista de plugins desde Firestore */}
        <div className="plugin-item">
          <div className="plugin-info">
            <span className="plugin-name">Plugin de Prueba (test-plugin)</span>
            <span className="plugin-version">v1.0.0</span>
            <span className="plugin-url">http://localhost:5177</span>
          </div>
          <div className="plugin-actions">
            <button>Editar</button>
            <button className="delete-btn">Desactivar</button>
          </div>
        </div>
        {/* ... más plugins ... */}
      </div>
    </div>
  );
};

export default PluginsManagement;