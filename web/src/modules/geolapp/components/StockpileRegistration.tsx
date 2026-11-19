import React from 'react';
import { QuickStockpileCapture } from './QuickStockpileCapture';

interface StockpileRegistrationProps {
    onSuccess: (assetId: string) => void;
    onCancel: () => void;
}

export const StockpileRegistration: React.FC<StockpileRegistrationProps> = ({
    onSuccess,
    onCancel,
}) => {
    return (
        <QuickStockpileCapture
            onComplete={({ assetId }) => onSuccess(assetId)}
            onCancel={onCancel}
        />
    );
};
