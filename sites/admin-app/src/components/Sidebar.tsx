import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const navItems = [
  { to: '/', icon: 'dashboard', label: 'Dashboard' },
  { to: '/subscriptions', icon: 'assignment_ind', label: 'Solicitudes' },
  { to: '/accounts', icon: 'manage_accounts', label: 'Cuentas' },
  { to: '/plugin-sandbox', icon: 'widgets', label: 'Sandbox de Plugins' }, // Nuevo elemento para Sandbox
  { to: '/developers', icon: 'integration_instructions', label: 'Desarrolladores' },
  { to: '/settings', icon: 'settings', label: 'Configuración' },
];

export const Sidebar = () => {
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h2>MINREPORT</h2>
      </div>
      <ul className="sidebar-nav">
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink 
              to={item.to} 
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
              end // Use 'end' for the dashboard route to prevent it from being active for all routes
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};
