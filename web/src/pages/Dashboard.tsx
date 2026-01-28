
import { MinReport } from '@minreport/sdk';
import { useAuth } from '../context/AuthContext';
import { BillingManagementDashboard } from './b2b/BillingManagementDashboard';
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

    // Si no hay cuenta o rol definido, muestra un SDKLoading
    if (!currentAccount || !currentRole) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <MinReport.UI.SDKLoading size={40} />
            </div>
        );
    }

    // Lógica de Despacho B2B
    // 'BILLING_ONLY' -> Dashboard de Gestión (Sin mapas/SDK)
    if (currentRole === 'BILLING_ONLY') {
        return <BillingManagementDashboard />;
    }

    // Default: Dashboard Operativo (ADMIN, OWNER, OPERATOR)
    // Se asume que si tiene rol operativo, debe ver el dashboard completo.
    return <OperationalDashboard />;
};
