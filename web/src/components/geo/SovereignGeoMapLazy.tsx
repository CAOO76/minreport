import React, { Suspense } from 'react';
import { M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import type { SovereignGeoMapProps } from './SovereignGeoMap';

const LazySovereignGeoMap = React.lazy(() => import('./SovereignGeoMap'));

export const SovereignGeoMapLazy: React.FC<SovereignGeoMapProps> = (props) => {
    return (
        <Suspense fallback={<M3ModuleHudFallback label="CARTOGRAFÍA SOBERANA UTM" />}>
            <LazySovereignGeoMap {...props} />
        </Suspense>
    );
};

export default SovereignGeoMapLazy;
