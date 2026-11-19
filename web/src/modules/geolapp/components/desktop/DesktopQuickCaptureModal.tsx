import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StockpileAsset } from '../../core/types/GeolappTypes';
import { QuickStockpileCapture } from '../QuickStockpileCapture';

export interface DesktopQuickCaptureModalProps {
    open: boolean;
    existingAsset: StockpileAsset | null;
    onClose: () => void;
    onCompleted: (assetId: string) => void;
}

/**
 * En escritorio nunca crea un acopio nuevo; únicamente permite anexar mediciones
 * sobre un acopio ya levantado en terreno (`existingAsset` obligatorio).
 */
export const DesktopQuickCaptureModal: React.FC<DesktopQuickCaptureModalProps> = ({
    open,
    existingAsset,
    onClose,
    onCompleted,
}) => {
    const { t } = useTranslation();

    if (!open || !existingAsset) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('analytics.new_measurement_button', 'NUEVA MEDICIÓN')}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-fib-21 select-none"
        >
            <div className="w-full max-w-2xl h-[85vh] bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] flex flex-col overflow-hidden rounded-none shadow-none">
                <QuickStockpileCapture
                    existingAsset={existingAsset}
                    allowManualFallback={true}
                    initialMethod="manual"
                    onComplete={({ assetId }) => {
                        onCompleted(assetId);
                        onClose();
                    }}
                    onCancel={onClose}
                />
            </div>
        </div>
    );
};
