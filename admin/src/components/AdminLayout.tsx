import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';

const AdminLayout: React.FC = () => {
    const navigate = useNavigate();

    const handleLogout = () => {
        // Here you would typically clear any auth tokens or user session data
        localStorage.removeItem('admin_token');
        navigate('/login');
    };

    const menuItems = [
        { label: 'Inbox', path: '/', icon: 'inbox' },
        { label: 'UI/UX', path: '/branding', icon: 'palette' }
    ];

    const navLinkBaseClasses = 'flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 mb-4';
    const activeNavLinkClasses = 'bg-blue-600 text-white shadow-lg shadow-blue-900/50';
    const inactiveNavLinkClasses = 'text-slate-400 hover:bg-slate-800 hover:text-white';

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Sidebar */}
            <aside className="w-20 bg-slate-900 flex flex-col items-center py-6">
                {/* Logo */}
                <div className="w-12 h-12 flex items-center justify-center rounded-full mb-8">
                    <span className="font-bold text-xl text-white">MR</span>
                </div>

                {/* Navigation */}
                <nav className="flex flex-col items-center">
                    {menuItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            title={item.label}
                            className={({ isActive }) => 
                                `${navLinkBaseClasses} ${isActive ? activeNavLinkClasses : inactiveNavLinkClasses}`
                            }
                            end={item.path === '/'}
                        >
                            <span className="material-symbols-rounded text-2xl">{item.icon}</span>
                        </NavLink>
                    ))}
                </nav>

                {/* Footer */}
                <div className="mt-auto">
                     <button
                        onClick={handleLogout}
                        title="Logout"
                        className={`${navLinkBaseClasses} ${inactiveNavLinkClasses}`}
                    >
                        <span className="material-symbols-rounded text-2xl">logout</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 h-full overflow-auto bg-slate-50 p-8">
                <Outlet />
            </main>
        </div>
    );
};

export default AdminLayout;
