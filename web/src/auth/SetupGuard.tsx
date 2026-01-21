import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // Assuming AuthContext exists

export const SetupGuard = ({ children }: { children: React.ReactNode }) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) return null; // Or a loader

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // If setup is not completed and we are not already on the setup page
    if (!user.is_setup_completed && location.pathname !== '/setup') {
        return <Navigate to="/setup" replace />;
    }

    // If setup is completed and we try to access /setup
    if (user.is_setup_completed && location.pathname === '/setup') {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};
