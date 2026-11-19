import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../../components/common/HitlConfirmModal';
import { calculationEngine } from '../../core/services/calculation-engine';
import { dataService } from '../../core/services/DataService';
import { CopperGovernanceBanner, sanitizeDecimalText } from '../../core/utils/captureHelpers';
import type { StockpileAsset } from '../../core/types/GeolappTypes';
import { parseNullableNonNegativeNumber } from './desktopHelpers';

export type ClosureModalMode = 'CLOSE_SHIPMENT' | 'REOPEN_CYCLE' | 'DELETE_ASSET' | null;

export interface DesktopClosureModalProps {
    mode: ClosureModalMode;
    asset: StockpileAsset | null;
    onClose: () => void;
    onCompleted: (deletedAssetId?: string) => void;
}

export const DesktopClosureModal: React.FC<DesktopClosureModalProps> = ({
    mode,
    asset,
    onClose,
    onCompleted,
}) => {
    const { t } = useTranslation();

    const [dispatchRef, setDispatchRef] = useState('');
    const [shippedWeight, setShippedWeight] = useState('');
    const [reopenNote, setReopenNote] = useState('');
    const [awaitingHitl, setAwaitingHitl] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!mode || !asset) return;
        setDispatchRef(asset.dispatch_reference || '');
        setShippedWeight(asset.shipped_weight_t != null ? String(asset.shipped_weight_t) : '');
        setReopenNote('');
        setErrorMsg(null);
        setAwaitingHitl(mode === 'REOPEN_CYCLE' || mode === 'DELETE_ASSET');
    }, [mode, asset]);

    const governance = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset?.copper_domain,
                residenceDays: asset?.residence_days ?? null,
                moisturePct: asset?.moisture_pct ?? null,
                tmlLimitPct: asset?.tml_pct ?? null,
            }),
        [asset?.copper_domain, asset?.residence_days, asset?.moisture_pct, asset?.tml_pct]
    );

    if (!mode || !asset) return null;

    const handleFormContinue = (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'CLOSE_SHIPMENT') {
            if (governance.hasCriticalBlock) {
                setErrorMsg(t('lifecycle.imsbc_shipment_blocked'));
                return;
            }
            if (!dispatchRef.trim()) {
                setErrorMsg(t('lifecycle.dispatch_ref_required'));
                return;
            }
        }
        setErrorMsg(null);
        setAwaitingHitl(true);
    };

    const handleConfirmHitl = async () => {
        if (busy) return;
        setBusy(true);
        setErrorMsg(null);
        try {
            if (mode === 'CLOSE_SHIPMENT') {
                await dataService.closeAssetByShipment(asset.id, {
                    dispatchReference: dispatchRef.trim(),
                    shippedWeightT: parseNullableNonNegativeNumber(shippedWeight),
                    confirmationKeyword: 'ACTUALIZAR',
                });
                onCompleted();
            } else if (mode === 'REOPEN_CYCLE') {
                await dataService.reopenClosedAssetWithHitl(
                    asset.id,
                    'ACTUALIZAR',
                    reopenNote.trim() || undefined
                );
                onCompleted();
            } else if (mode === 'DELETE_ASSET') {
                await dataService.deleteAsset(asset.id);
                onCompleted(asset.id);
            }
            onClose();
        } catch (err: any) {
            setErrorMsg(err?.message || t('hitl.save_error', 'Error procesando operación.'));
            setAwaitingHitl(false);
        } finally {
            setBusy(false);
        }
    };

    const diffs: HitlComparisonDiffItem[] =
        mode === 'CLOSE_SHIPMENT'
            ? [
                  {
                      field: t('lifecycle.cycle_status_label', 'ESTADO'),
                      current: String(asset.status || 'ACTIVE'),
                      suggested: 'CLOSED (SHIPPED)',
                  },
                  {
                      field: t('lifecycle.dispatch_reference_label', 'DESPACHO'),
                      current: asset.dispatch_reference || '--',
                      suggested: dispatchRef.trim(),
                  },
              ]
            : mode === 'REOPEN_CYCLE'
              ? [
                    {
                        field: t('lifecycle.cycle_status_label', 'ESTADO'),
                        current: 'CLOSED',
                        suggested: 'ACTIVE',
                    },
                ]
              : [
                    {
                        field: t('registration.name_label', 'ACOPIO'),
                        current: asset.name,
                        suggested: t('common.delete_button', 'ELIMINAR'),
                    },
                ];

    if (awaitingHitl) {
        const isDelete = mode === 'DELETE_ASSET';
        return (
            <HitlConfirmModal
                open={true}
                title={
                    isDelete
                        ? t('common.delete_button', 'ELIMINAR ACOPIO')
                        : mode === 'REOPEN_CYCLE'
                          ? t('lifecycle.reopen_action', 'REABRIR CICLO')
                          : t('lifecycle.confirm_shipment_hitl', 'VERIFICAR EMBARQUE')
                }
                description={
                    isDelete
                        ? t(
                              'desktop.confirm_delete_desc',
                              'Escriba ELIMINAR para borrar este acopio de forma definitiva.'
                          )
                        : t(
                              'hitl.modal_description',
                              'Escriba ACTUALIZAR para confirmar el registro oficial.'
                          )
                }
                keyword={isDelete ? 'ELIMINAR' : 'ACTUALIZAR'}
                comparisonDiff={diffs}
                loading={busy}
                onConfirm={() => void handleConfirmHitl()}
                onCancel={onClose}
            />
        );
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('lifecycle.close_shipment_action', 'CERRAR POR EMBARQUE')}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-fib-21 select-none"
        >
            <div className="w-full max-w-lg bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] rounded-none shadow-none">
                <header className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between">
                    <h2 className="text-h2-section font-bold uppercase text-[#C68346]">
                        {t('lifecycle.close_shipment_action', 'CERRAR POR EMBARQUE')}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close_button', 'CERRAR')}
                        className="bg-transparent border-0 p-1 text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </header>

                <form
                    autoComplete="off"
                    spellCheck={false}
                    onSubmit={handleFormContinue}
                    className="p-fib-21 space-y-fib-13"
                >
                    <CopperGovernanceBanner result={governance} />

                    {errorMsg && (
                        <div className="p-fib-13 border border-red-500 bg-red-500/10 text-data-dense font-mono text-red-600 dark:text-red-400 rounded-none">
                            {errorMsg}
                        </div>
                    )}

                    <label className="block space-y-1">
                        <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] block">
                            {t('lifecycle.dispatch_reference_label', 'REFERENCIA DE DESPACHO')}
                        </span>
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={dispatchRef}
                            onChange={(e) => setDispatchRef(e.target.value)}
                            className="w-full h-10 px-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense rounded-none"
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] block">
                            {t('lifecycle.shipped_weight_label', 'TONELAJE DESPACHADO [t]')}
                        </span>
                        <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            value={shippedWeight}
                            onChange={(e) => setShippedWeight(sanitizeDecimalText(e.target.value))}
                            className="w-full h-10 px-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-data-dense rounded-none"
                        />
                    </label>

                    <div className="flex justify-end gap-fib-8 pt-fib-8">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-fib-21 py-2 border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy font-bold uppercase bg-transparent cursor-pointer rounded-none"
                        >
                            {t('common.cancel_button', 'CANCELAR')}
                        </button>
                        <button
                            type="submit"
                            disabled={governance.hasCriticalBlock}
                            className="px-fib-21 py-2 bg-[#C68346] text-white font-mono text-microcopy font-bold uppercase border-0 cursor-pointer disabled:opacity-40 rounded-none"
                        >
                            {t('common.continue_button', 'CONTINUAR')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
