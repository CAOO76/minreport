import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import {
    STANDARD_SUPPLY_COST_CENTERS,
    SUPPLY_CATEGORIES,
    SUPPLY_UNITS_SI,
    formatClp,
    type ProcurementBucket,
    type PurchaseLineDestination,
    type SiiDteType,
    type SupplyCategoryCode,
    type SupplyPurchaseLineDraft,
    type SupplyUnitSi,
} from '../types';

export function createEmptyLine(
    defaultDestination: PurchaseLineDestination,
    defaultCategory: SupplyCategoryCode = 'OTROS_OPERACIONAL'
): SupplyPurchaseLineDraft {
    return {
        lineId: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        rawDescription: '',
        categoryCode: defaultCategory,
        qty: 1,
        unitSi: 'un',
        unitPriceClp: 0,
        subtotalClp: 0,
        destination: defaultDestination,
    };
}

export function mapBucketToCategory(bucket?: ProcurementBucket | null): SupplyCategoryCode {
    switch (bucket) {
        case 'VERDULERIA':
        case 'SUPERMERCADO':
            return 'VIVERES_ALIMENTACION';
        case 'AGUA_POTABLE':
            return 'AGUA_POTABLE_BEBESTIBLE';
        case 'AGUA_INDUSTRIAL_ALJIBE':
            return 'AGUA_INDUSTRIAL';
        case 'GAS_GLP_DOMESTICO':
            return 'GAS_DOMESTICO_GLP';
        case 'GASES_INDUSTRIALES':
            return 'GASES_INDUSTRIALES';
        case 'COMBUSTIBLE_GRANEL':
            return 'COMBUSTIBLE_FLOTA_PROD';
        case 'REPUESTOS_LUBRICANTES':
            return 'REPUESTOS_MAQUINARIA';
        case 'FERRETERIA_INSUMOS':
            return 'FERRETERIA_CONSTRUCCION';
        case 'PERFORACION_FORTIFICACION':
            return 'PERFORACION_ACEROS';
        case 'EPP_SEGURIDAD':
            return 'EPP_SEGURIDAD';
        case 'CONTROLADOS_DGMN':
            return 'QUIMICOS_REGULADOS';
        case 'ACTIVOS_CAPEX':
            return 'ACTIVO_EQUIPAMIENTO';
        case 'ASEO_HIGIENE':
            return 'ASEO_HIGIENE';
        case 'MANTENCION_CAMP':
            return 'MANTENCION_CAMP';
        default:
            return 'OTROS_OPERACIONAL';
    }
}

export interface ReceiptLinesEditorProps {
    lines: SupplyPurchaseLineDraft[];
    documentType: SiiDteType;
    onAddLine: () => void;
    onUpdateLine: (lineId: string, patch: Partial<SupplyPurchaseLineDraft>) => void;
    onRemoveLine: (lineId: string) => void;
}

export const ReceiptLinesEditor: React.FC<ReceiptLinesEditorProps> = ({
    lines,
    documentType,
    onAddLine,
    onUpdateLine,
    onRemoveLine,
}) => {
    const { t } = useTranslation();

    return (
        <div className="space-y-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
            <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#475569] dark:text-[#8A93A6]">
                    {t('supply.scanner.lines_title')} ({lines.length})
                </span>
                <button
                    type="button"
                    onClick={onAddLine}
                    aria-label={t('supply.scanner.add_item')}
                    title={t('supply.scanner.add_item')}
                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center gap-fib-8 text-[14px] font-semibold text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                    <span>{t('supply.scanner.add_item')}</span>
                </button>
            </div>

            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-b border-[#E2E8F0] dark:border-[#12151C]">
                {lines.map((line, idx) => (
                    <div
                        key={line.lineId}
                        className={cn(
                            'py-fib-13 grid grid-cols-1 md:grid-cols-12 gap-fib-8 items-center border-l-[3px] pl-fib-8',
                            line.destination === 'CAPEX_ASSET' &&
                                documentType !== 33 &&
                                documentType !== 34
                                ? 'border-[#C68346]'
                                : 'border-transparent'
                        )}
                    >
                        <input
                            type="text"
                            aria-label={`${t('supply.backlog.sku_name')} #${idx + 1}`}
                            value={line.rawDescription}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, { rawDescription: e.target.value })
                            }
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={t('supply.backlog.sku_name')}
                            className="md:col-span-3 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                        <select
                            aria-label={`${t('supply.backlog.category')} #${idx + 1}`}
                            value={line.categoryCode}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, {
                                    categoryCode: e.target.value as SupplyCategoryCode,
                                })
                            }
                            className="md:col-span-2 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            {SUPPLY_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                    {t(`supply.categories.${cat}`)}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={`${t('supply.backlog.cost_center')} #${idx + 1}`}
                            value={line.costCenter || ''}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, {
                                    costCenter: e.target.value || undefined,
                                })
                            }
                            className="md:col-span-1 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[14px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            <option value="">Área</option>
                            {STANDARD_SUPPLY_COST_CENTERS.map((cc) => (
                                <option key={cc} value={cc}>
                                    {cc}
                                </option>
                            ))}
                        </select>
                        <input
                            type="number"
                            aria-label={`${t('supply.backlog.qty')} #${idx + 1}`}
                            step="any"
                            min={0}
                            value={line.qty}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, { qty: Number(e.target.value) || 0 })
                            }
                            autoComplete="off"
                            spellCheck={false}
                            className="md:col-span-1 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                        <select
                            aria-label={`${t('supply.backlog.unit')} #${idx + 1}`}
                            value={line.unitSi}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, {
                                    unitSi: e.target.value as SupplyUnitSi,
                                })
                            }
                            className="md:col-span-1 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            {SUPPLY_UNITS_SI.map((u) => (
                                <option key={u} value={u}>
                                    {u}
                                </option>
                            ))}
                        </select>
                        <input
                            type="number"
                            aria-label={`${t('supply.scanner.total_clp')} #${idx + 1}`}
                            min={0}
                            value={line.unitPriceClp}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, {
                                    unitPriceClp: Number(e.target.value) || 0,
                                })
                            }
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="CLP"
                            className="md:col-span-1 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[15px] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                        <select
                            aria-label={`${t('supply.scanner.destination_label')} #${idx + 1}`}
                            value={line.destination}
                            onChange={(e) =>
                                onUpdateLine(line.lineId, {
                                    destination: e.target.value as PurchaseLineDestination,
                                })
                            }
                            className="md:col-span-2 min-h-[48px] px-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                        >
                            <option value="STOCK_IN_TRANSIT">
                                {t('supply.destinations.STOCK_IN_TRANSIT')}
                            </option>
                            <option value="STOCK_IN_WAREHOUSE">
                                {t('supply.destinations.STOCK_IN_WAREHOUSE')}
                            </option>
                            <option value="CAPEX_ASSET">
                                {t('supply.destinations.CAPEX_ASSET')}
                            </option>
                            <option value="DIRECT_EXPENSE">
                                {t('supply.destinations.DIRECT_EXPENSE')}
                            </option>
                        </select>
                        <div className="md:col-span-1 flex items-center justify-end gap-fib-8">
                            <span className="font-mono text-[15px] font-semibold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                {formatClp(line.subtotalClp)}
                            </span>
                            {lines.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => onRemoveLine(line.lineId)}
                                    aria-label={t('supply.common.remove')}
                                    title={t('supply.common.remove')}
                                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        delete
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ReceiptLinesEditor;
