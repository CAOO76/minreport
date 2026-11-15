/// <reference types="vite/client" />

declare module '@geolapp/GeolappModuleView' {
    import React from 'react';
    export interface GeolappAppProps {
        domainMode?: 'STOCKPILE';
        hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
        embedded?: boolean;
        tenantContext?: any;
        onTelemetryEvent?: (event: any) => void;
    }
    const GeolappModuleView: React.ComponentType<GeolappAppProps>;
    export default GeolappModuleView;
}
