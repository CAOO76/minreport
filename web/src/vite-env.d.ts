/// <reference types="vite/client" />

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