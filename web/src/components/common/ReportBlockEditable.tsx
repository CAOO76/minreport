import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import CopyButton from './CopyButton';

export const UNDECLARED_TECH_VALUE = '[Información técnica no declarada en ficha]';

export interface ReportBlockEditableProps {
    title: string;
    code?: string;
    isEditing: boolean;
    canEdit?: boolean;
    onToggleEdit: () => void;
    editAriaLabel?: string;
    headerActions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

export const ReportBlockEditable: React.FC<ReportBlockEditableProps> = ({
    title,
    code,
    isEditing,
    canEdit = true,
    onToggleEdit,
    editAriaLabel,
    headerActions,
    children,
    className,
}) => {
    const { t } = useTranslation();
    const resolvedLabel =
        editAriaLabel ||
        (isEditing
            ? t('core_common.report_close_edit', { title, defaultValue: `Cerrar edición: ${title}` })
            : t('core_common.report_edit_block', { title, defaultValue: `Editar bloque: ${title}` }));

    return (
        <section
            className={cn(
                'bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none',
                isEditing && 'border-[#C68346] dark:border-[#C68346]',
                className
            )}
        >
            <header className="flex items-center justify-between gap-fib-13 px-fib-21 py-fib-13 bg-[#F8FAFC] dark:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex items-center gap-fib-13 min-w-0">
                    {code && (
                        <span className="font-mono text-microcopy uppercase tabular-nums text-[#C68346] shrink-0">
                            {code}
                        </span>
                    )}
                    <h2 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {title}
                    </h2>
                </div>
                <div className="flex items-center gap-fib-8 shrink-0">
                    {headerActions}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={onToggleEdit}
                            aria-label={resolvedLabel}
                            title={resolvedLabel}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {isEditing ? 'close' : 'edit'}
                            </span>
                        </button>
                    )}
                </div>
            </header>
            <div className="p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D]">{children}</div>
        </section>
    );
};

export interface ReportFieldRowProps {
    label: string;
    value?: string | number | null;
    mono?: boolean;
    copyable?: boolean;
    fallback?: string;
    className?: string;
}

export const ReportFieldRow: React.FC<ReportFieldRowProps> = ({
    label,
    value,
    mono = true,
    copyable = false,
    fallback,
    className,
}) => {
    const { t } = useTranslation();
    const resolvedFallback =
        fallback ?? t('core_common.undeclared_tech_value', UNDECLARED_TECH_VALUE);
    const rawStr = value === null || value === undefined ? '' : String(value).trim();
    const hasValue = rawStr.length > 0;

    return (
        <div
            className={cn(
                'flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] last:border-b-0',
                className
            )}
        >
            <span className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] shrink-0">
                {label}
            </span>
            <div className="flex items-center gap-fib-8 min-w-0 sm:justify-end">
                <span
                    className={cn(
                        'text-data-dense tabular-nums break-words',
                        mono && 'font-mono',
                        hasValue
                            ? 'text-[#0F172A] dark:text-[#F3F4F6] select-text'
                            : 'text-[#94A3B8] dark:text-[#5A6072] select-none'
                    )}
                >
                    {hasValue ? rawStr : resolvedFallback}
                </span>
                {copyable && hasValue && <CopyButton value={rawStr} />}
            </div>
        </div>
    );
};

export default ReportBlockEditable;
