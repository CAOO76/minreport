import React from 'react';
import { StockpileDossierView } from './StockpileDossierView';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';

interface StockpileSummaryProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onSelectMeasurement: (m: StockpileMeasurement) => void;
    onBack: () => void;
    onNewMeasurement: () => void;
    onAddAsset?: () => void;
    onEditAsset?: () => void;
}

export const StockpileSummary: React.FC<StockpileSummaryProps> = ({
    asset,
    measurements,
    onSelectMeasurement,
    onBack,
    onNewMeasurement,
}) => (
    <StockpileDossierView
        asset={asset}
        measurements={measurements}
        onSelectMeasurement={onSelectMeasurement}
        onBack={onBack}
        onNewMeasurement={onNewMeasurement}
    />
);
