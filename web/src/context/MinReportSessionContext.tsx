import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

/**
 * CONTEXTO DE SESIÓN UNIFICADA WEB 3.0 (MINREPORT HOST)
 * Inyecta el estado del Tenant, permisos y gobernanza sobre los módulos:
 * OPERMAQ (Flota), STOCKPILE (Acopios) y MINING FLOW (Finanzas).
 */

export interface MinReportSession {
    uid: string;
    email: string;
    displayName: string;
    tenantId: string;
    tenantName: string;
    role: 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER' | 'STUDENT';
    classification: 'b2b' | 'edu' | 'personal';
    isEduSandbox: boolean;
    activeModules: {
        opermaq: boolean;
        stockpile: boolean;
    };
    permissions: {
        opermaq: {
            canInspect: boolean;
            canManageFleet: boolean;
            canViewVaults: boolean;
        };
        stockpile: {
            canScan: boolean;
            canCalculate: boolean;
            canExportReport: boolean;
        };
    };
}

interface MinReportSessionContextType {
    session: MinReportSession | null;
    isLoaded: boolean;
    hasModuleAccess: (moduleKey: 'opermaq' | 'stockpile') => boolean;
}

const MinReportSessionContext = createContext<MinReportSessionContextType>({
    session: null,
    isLoaded: false,
    hasModuleAccess: () => false
});

export const MinReportSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile, currentAccount, loading } = useAuth();

    const session = useMemo<MinReportSession | null>(() => {
        if (!user || !currentAccount) return null;

        const isEdu = currentAccount.type === 'EDUCATIONAL' || (currentAccount as any).classification === 'edu';
        const userMembership = profile?.memberships?.find((m: any) => m.accountId === currentAccount.id);
        const role = (userMembership?.role as any) || (currentAccount.ownerId === user.uid ? 'OWNER' : 'OPERATOR');

        // Gobernanza modular
        const contract = (currentAccount as any).contract;
        const rawActive = contract?.activeModules || {};
        const activeModules = {
            opermaq: rawActive.opermaq ?? true,
            stockpile: rawActive.stockpile ?? true
        };

        const isAdminOrOwner = role === 'OWNER' || role === 'ADMIN';

        return {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || (profile as any)?.fullName || user.email?.split('@')[0] || 'Usuario Faena',
            tenantId: currentAccount.id,
            tenantName: currentAccount.name,
            role,
            classification: isEdu ? 'edu' : 'b2b',
            isEduSandbox: isEdu,
            activeModules,
            permissions: {
                opermaq: {
                    canInspect: true,
                    canManageFleet: isAdminOrOwner || role === 'SUPERVISOR',
                    canViewVaults: true
                },
                stockpile: {
                    canScan: !isEdu, // Bloqueado escaneo en vivo para sandboxes edu
                    canCalculate: true,
                    canExportReport: isAdminOrOwner || role === 'SUPERVISOR'
                }
            }
        };
    }, [user, profile, currentAccount]);

    const hasModuleAccess = (moduleKey: 'opermaq' | 'stockpile'): boolean => {
        if (!session) return false;
        return session.activeModules[moduleKey] ?? true;
    };

    return (
        <MinReportSessionContext.Provider value={{ session, isLoaded: !loading, hasModuleAccess }}>
            {children}
        </MinReportSessionContext.Provider>
    );
};

export const useMinReportSession = () => useContext(MinReportSessionContext);
