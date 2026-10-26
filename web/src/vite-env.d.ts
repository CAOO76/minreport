/// <reference types="vite/client" />

declare module '@opermaq/OpermaqModuleView' {
    import React from 'react';
    export interface OpermaqModuleViewProps {
        tenantId?: string;
        role?: any;
        userId?: string;
        embedded?: boolean;
        onTelemetryEvent?: (event: any) => void;
    }
    const OpermaqModuleView: React.ComponentType<OpermaqModuleViewProps>;
    export default OpermaqModuleView;
}

declare module '@stockpile/StockpileModuleView' {
    import React from 'react';
    export interface StockpileAppProps {
        tenantContext?: any;
        embedded?: boolean;
        onTelemetryEvent?: (event: any) => void;
    }
    const StockpileModuleView: React.ComponentType<StockpileAppProps>;
    export default StockpileModuleView;
}