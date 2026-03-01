import { Navigate } from 'react-router-dom';
import LoadingScreen from '../components/common/LoadingScreen';
import { useAuth } from '../context/AuthContext';
import { GeneralAdminDashboard } from './b2b/GeneralAdminDashboard';
import { OperationalDashboard } from './OperationalDashboard';
import { useMemo } from 'react';

// Componente Principal: Dispatcher
export const Dashboard = () => {
    const { currentAccount, profile } = useAuth();

    // Calcular el rol actual
    const currentRole = useMemo(() => {
        if (!currentAccount || !profile?.memberships) return null;
        const membership = profile.memberships.find(m => m.accountId === currentAccount.id);
        return membership?.role || null;
    }, [currentAccount, profile]);

    // Si no hay cuenta o rol definido, muestra un Loading
    if (!currentAccount || !currentRole) {
        return <LoadingScreen />;
    }

    // Lógica de Despacho B2B
    // ── ENTIDADES B2B EXTERNAS ──
    const isB2BAdmin = currentRole === 'SUBSCRIPTION_ADMIN' || currentRole === 'BILLING_ONLY';
    if (isB2BAdmin) return <Navigate to="/b2b/empresa" replace />;
    if (currentRole === 'GENERAL_ADMIN') return <GeneralAdminDashboard />;

    // Default: Dashboard Operativo (ADMIN, OWNER, OPERATOR)
    // Se asume que si tiene rol operativo, debe ver el dashboard completo.
    return <OperationalDashboard />;
};
