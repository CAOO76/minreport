import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { OperationalDashboard } from './OperationalDashboard';
import { useMemo } from 'react';

// Componente Principal: Dispatcher
export const Dashboard = () => {
    const { currentAccount, profile, user } = useAuth();

    // Calcular el rol actual
    const currentRole = useMemo(() => {
        if (!currentAccount) return null;
        const membership = profile?.memberships?.find((m) => m.accountId === currentAccount.id);
        if (membership?.role) return membership.role;
        if (user && currentAccount.ownerId === user.uid) return 'OWNER';
        return null;
    }, [currentAccount, profile, user]);

    if (!currentAccount || !currentRole) {
        return null;
    }

    // Legacy billing-only roles redirigen a ficha de empresa
    const isB2BAdmin = currentRole === 'SUBSCRIPTION_ADMIN' || currentRole === 'BILLING_ONLY';
    if (isB2BAdmin) return <Navigate to="/b2b/empresa" replace />;

    // Resto de roles operativos/académicos (OWNER, ADMIN, OPERATOR, VIEWER, PROFESSOR, STUDENT)
    return <OperationalDashboard />;
};
