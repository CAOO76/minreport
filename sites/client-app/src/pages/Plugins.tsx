import React from 'react';
import { Link } from 'react-router-dom';
import useAuth from '@minreport/core/hooks/useAuth'; // Adjust path as needed
import './Plugins.css'; // We will create this CSS file
import { getAuth } from 'firebase/auth'; // Import getAuth
import { auth } from '../firebaseConfig'; // Import auth instance

// Define a list of all possible plugins with their IDs, names, and descriptions
// This should ideally come from a central configuration or API
const ALL_AVAILABLE_PLUGINS_INFO = [
  { id: 'cash-flow', name: 'Flujo de Caja', description: 'Gestiona tus ingresos y gastos.', icon: 'account_balance_wallet' },
  { id: 'inventory', name: 'Gestor de Inventario', description: 'Controla tu stock y productos.', icon: 'inventory_2' },
  { id: 'reports', name: 'Reportes Fotográficos', description: 'Genera reportes visuales de tus proyectos.', icon: 'image' },
  // Add more plugin info here
];

const Plugins: React.FC = () => {
  const { activePlugins, loading, user } = useAuth(); // Get user from useAuth hook

  const handleForceTokenRefresh = async () => {
    if (user && auth) { // Ensure user and auth instance exist
      try {
        console.log('Intentando obtener token sin forzar refresh...');
        const idTokenResultNoForce = await user.getIdTokenResult(); // No force refresh
        console.log('Token sin forzar refresh. Claims:', idTokenResultNoForce.claims);

        console.log('Intentando obtener token forzando refresh (false)...');
        const idTokenResultFalse = await user.getIdTokenResult(false); // Explicitly false
        console.log('Token con force=false. Claims:', idTokenResultFalse.claims);

        console.log('Intentando obtener token forzando refresh (true)...');
        const idTokenResultTrue = await user.getIdTokenResult(true); // Force refresh
        console.log('Token con force=true. Claims:', idTokenResultTrue.claims);
        // Optionally, you might want to re-trigger useAuth's state update here
        // but useAuth should already be listening to onAuthStateChanged
      } catch (error: any) {
        console.error('Error al forzar actualización de token:', error);
      }
    }
  };

  if (loading) {
    return <p>Cargando plugins...</p>;
  }

  console.log('Plugins.tsx: activePlugins (from useAuth):', activePlugins);
  const userActivePlugins = activePlugins || [];
  console.log('Plugins.tsx: userActivePlugins (after || []):', userActivePlugins);
  const pluginsToDisplay = ALL_AVAILABLE_PLUGINS_INFO.filter(plugin =>
    userActivePlugins.includes(plugin.id)
  );
  console.log('Plugins.tsx: pluginsToDisplay (after filter):', pluginsToDisplay);

  return (
    <div className="plugins-page-container">
      <h1>Mis Plugins</h1>
      <button onClick={handleForceTokenRefresh}>Forzar Actualización de Token</button>

      {pluginsToDisplay.length === 0 ? (
        <p className="no-plugins-message">
          Actualmente no tienes plugins activados. Contacta con soporte para más información.
        </p>
      ) : (
        <div className="plugins-grid">
          {pluginsToDisplay.map((plugin) => (
            <Link to={`/plugins/${plugin.id}`} key={plugin.id} className="plugin-card">
              <span className="material-symbols-outlined plugin-icon">{plugin.icon}</span>
              <h2>{plugin.name}</h2>
              <p>{plugin.description}</p>
              <span className="material-symbols-outlined plugin-card-arrow">arrow_forward</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Plugins;