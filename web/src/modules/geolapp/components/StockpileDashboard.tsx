import React from 'react';
import { StockpileDossierView } from './StockpileDossierView';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';

interface StockpileDashboardProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onBack: () => void;
    onNewMeasurement: () => void;
    onSelectMeasurement: (m: StockpileMeasurement) => void;
}

export const StockpileDashboard: React.FC<StockpileDashboardProps> = ({
    asset,
    measurements,
    onBack,
    onNewMeasurement,
    onSelectMeasurement,
}) => (
    <StockpileDossierView
        asset={asset}
        measurements={measurements}
        onBack={onBack}
        onNewMeasurement={onNewMeasurement}
        onSelectMeasurement={onSelectMeasurement}
    />
);
