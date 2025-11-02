import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import { collection, getDocs } from 'firebase/firestore';
import './Plugins.css';
import useAuth from '@minreport/ui-components';

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const Plugins: React.FC = () => {
  const { user, activePlugins } = useAuth(auth);
  const [allPlugins, setAllPlugins] = useState<PluginMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAllPlugins = async () => {
      try {
        const pluginsCollectionRef = collection(db, 'plugins');
        const pluginsSnapshot = await getDocs(pluginsCollectionRef);
        const pluginsList = pluginsSnapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
          description: doc.data().description,
          icon: doc.data().icon || 'extension',
        }));
        setAllPlugins(pluginsList);
      } catch (error) {
        console.error('Error fetching all plugins metadata:', error);
        // No seteamos un error en la UI, simplemente no se mostrarán plugins.
      } finally {
        // Una vez que se han cargado los plugins (o ha fallado), dejamos de cargar.
        setIsLoading(false);
      }
    };

    fetchAllPlugins();
  }, []);

  // Esperamos tanto a la autenticación como a la carga de la lista de plugins
  if (isLoading) {
    return (
      <div className="plugins-page-container">
        <h1>Mis Plugins</h1>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="plugins-page-container">
        <h1>Mis Plugins</h1>
        <p>Error de autenticación.</p>
      </div>
    );
  }

  // Filtramos la lista de TODOS los plugins disponibles contra la lista de plugins ACTIVOS del usuario
  const pluginsToDisplay = allPlugins.filter((plugin) => (activePlugins || []).includes(plugin.id));

  return (
    <div className="plugins-page-container">
      <h1>Mis Plugins</h1>
      {pluginsToDisplay.length === 0 ? (
        <p className="no-plugins-message">Actualmente no tienes plugins activados o disponibles.</p>
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
import { Link } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import { collection, getDocs } from 'firebase/firestore';
import './Plugins.css';
import useAuth from '@minreport/ui-components';

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const Plugins: React.FC = () => {
  const { user, activePlugins } = useAuth(auth);
  const [allPlugins, setAllPlugins] = useState<PluginMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAllPlugins = async () => {
      try {
        const pluginsCollectionRef = collection(db, 'plugins');
        const pluginsSnapshot = await getDocs(pluginsCollectionRef);
        const pluginsList = pluginsSnapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
          description: doc.data().description,
          icon: doc.data().icon || 'extension',
        }));
        setAllPlugins(pluginsList);
      } catch (error) {
        console.error('Error fetching all plugins metadata:', error);
        // No seteamos un error en la UI, simplemente no se mostrarán plugins.
      } finally {
        // Una vez que se han cargado los plugins (o ha fallado), dejamos de cargar.
        setIsLoading(false);
      }
    };

    fetchAllPlugins();
  }, []);

  // Esperamos tanto a la autenticación como a la carga de la lista de plugins
  if (isLoading) {
    return (
      <div className="plugins-page-container">
        <h1>Mis Plugins</h1>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="plugins-page-container">
        <h1>Mis Plugins</h1>
        <p>Error de autenticación.</p>
      </div>
    );
  }

  // Filtramos la lista de TODOS los plugins disponibles contra la lista de plugins ACTIVOS del usuario
  const pluginsToDisplay = allPlugins.filter((plugin) => (activePlugins || []).includes(plugin.id));

  return (
    <div className="plugins-page-container">
      <h1>Mis Plugins</h1>
      {pluginsToDisplay.length === 0 ? (
        <p className="no-plugins-message">Actualmente no tienes plugins activados o disponibles.</p>
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
