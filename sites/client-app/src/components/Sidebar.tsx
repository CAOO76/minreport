import React from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <NavLink to="/" className="sidebar-link" title="Dashboard">
          <span className="material-symbols-outlined">dashboard</span>
          <span className="sidebar-link-text">Dashboard</span>
        </NavLink>

        <NavLink to="/plugins" className="sidebar-link" title="Plugins">
          <span className="material-symbols-outlined">extension</span>
          <span className="sidebar-link-text">Plugins</span>
        </NavLink>
      </nav>
    </aside>
  );
};

export default Sidebar;