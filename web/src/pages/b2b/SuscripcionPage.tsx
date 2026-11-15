import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { CopyButton } from '../../components/common/CopyButton';

export const SuscripcionPage: React.FC = () => {
    const { t } = useTranslation();
    const undeclaredLabel = t('core_suscripcion.undeclared', '[Información técnica no declarada en ficha]');
    const { currentAccount } = useAuth();
    const { session } = useMinReportSession();
    const enabledModules = session?.activeModules ?? { opermaq: false, stockpile: false };
    const isEduSandbox = Boolean(session?.isEduSandbox);

    if (!currentAccount) return null;

    const contract = (currentAccount as any)?.contract || {};
    const planName = contract.planName || contract.plan || (currentAccount as any)?.subscriptionPlan || '';
    const contractStatusRaw = String(contract.status || (currentAccount as any)?.status || '').trim();
    const contractStatus = contractStatusRaw
        ? t(`core_suscripcion.statuses.${contractStatusRaw.toUpperCase()}`, contractStatusRaw)
        : '';
    const startDate = contract.startDate || contract.validFrom || '';
    const endDate = contract.endDate || contract.validUntil || '';
    const billingCycleRaw = String(contract.billingCycle || '').trim();
    const billingCycle = billingCycleRaw
        ? t(`core_suscripcion.cycles.${billingCycleRaw.toUpperCase()}`, billingCycleRaw)
        : '';
    const currency = contract.currency || '';
    const contractCode = contract.contractId || contract.code || '';
    const invoices: Array<{ id: string; period: string; amount: string; status: string; issuedAt?: string }> =
        Array.isArray(contract.invoices) ? contract.invoices : [];

    const activeModulesList = [
        enabledModules.opermaq ? 'OPERMAQ' : null,
        enabledModules.stockpile ? 'STOCKPILE CONTROL' : null,
    ].filter(Boolean) as string[];

    const formatDateValue = (raw: any): string => {
        if (!raw) return '';
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'number') return new Date(raw).toISOString().slice(0, 10);
        if (typeof raw?.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
        return '';
    };

    const rows: Array<{ key: string; label: string; value: string; mono?: boolean; copyable?: boolean }> = [
        {
            key: 'account_id',
            label: t('core_suscripcion.field_account_id'),
            value: currentAccount.id || '',
            mono: true,
            copyable: Boolean(currentAccount.id),
        },
        {
            key: 'contract_code',
            label: t('core_suscripcion.field_contract_code'),
            value: contractCode,
            mono: true,
            copyable: Boolean(contractCode),
        },
        { key: 'plan', label: t('core_suscripcion.field_plan'), value: planName },
        { key: 'status', label: t('core_suscripcion.field_status'), value: contractStatus },
        { key: 'start_date', label: t('core_suscripcion.field_start_date'), value: formatDateValue(startDate), mono: true },
        { key: 'end_date', label: t('core_suscripcion.field_end_date'), value: formatDateValue(endDate), mono: true },
        { key: 'billing_cycle', label: t('core_suscripcion.field_billing_cycle'), value: billingCycle },
        { key: 'currency', label: t('core_suscripcion.field_currency'), value: currency, mono: true },
        {
            key: 'modules',
            label: t('core_suscripcion.field_modules'),
            value: activeModulesList.length > 0 ? activeModulesList.join(' · ') : '',
            mono: true,
        },
    ];

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        {t('core_suscripcion.header_kicker')}
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_suscripcion.header_title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        {t('core_suscripcion.header_subtitle')}
                    </p>
                </div>
                {isEduSandbox && (
                    <span className="text-microcopy font-mono px-fib-13 py-fib-8 border border-[#00AEEF]/40 text-[#00AEEF] bg-[#00AEEF]/5 rounded-none">
                        {t('core_suscripcion.edu_badge')}
                    </span>
                )}
            </header>

            {/* Macro-Layout Proporción Áurea: 61.8% Ficha Contractual / 38.2% Facturación y Gobernanza */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                {/* ÁREA MAYOR (61.8%): Condiciones del Contrato (Modo Informe Técnico) */}
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('core_suscripcion.sec_contract_params')}
                        </h2>
                        <span className="text-microcopy font-mono text-[#C68346]">
                            {t('core_suscripcion.read_only')}
                        </span>
                    </div>
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {rows.map((row) => {
                            const hasValue = Boolean(row.value && row.value.trim());
                            return (
                                <div
                                    key={row.key}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8 px-fib-21 py-fib-13"
                                >
                                    <span className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                        {row.label}
                                    </span>
                                    {hasValue ? (
                                        <div className="inline-flex items-center gap-fib-8">
                                            <span
                                                className={`text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] ${
                                                    row.mono ? 'font-mono tabular-nums' : ''
                                                } ${row.copyable ? 'select-text' : ''}`}
                                            >
                                                {row.value}
                                            </span>
                                            {row.copyable && (
                                                <CopyButton
                                                    value={row.value}
                                                    title={t('core_suscripcion.copy_field', { field: row.label })}
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            {undeclaredLabel}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ÁREA MENOR (38.2%): Historial de Facturación y Gobernanza Comercial */}
                <aside className="space-y-fib-21">
                    <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between">
                            <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('core_suscripcion.sec_invoices')}
                            </h2>
                            <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {t('core_suscripcion.docs_count', { count: invoices.length })}
                            </span>
                        </div>

                        {invoices.length === 0 ? (
                            <div className="px-fib-21 py-fib-34 text-center">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {undeclaredLabel}
                                </p>
                                <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] mt-fib-8">
                                    {t('core_suscripcion.no_invoices_desc')}
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {invoices.map((inv) => {
                                    const invStatusRaw = String(inv.status || '').trim();
                                    const invStatusLabel = invStatusRaw
                                        ? t(`core_suscripcion.statuses.${invStatusRaw.toUpperCase()}`, invStatusRaw)
                                        : undeclaredLabel;
                                    return (
                                        <div key={inv.id} className="px-fib-21 py-fib-13 flex items-center justify-between gap-fib-8">
                                            <div>
                                                <p className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                    {inv.id}
                                                </p>
                                                <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                    {inv.period}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-data-dense font-mono font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {inv.amount}
                                                </p>
                                                <span className="text-microcopy font-mono text-[#00AEEF]">
                                                    {invStatusLabel}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-8">
                        <div className="flex items-center gap-fib-8">
                            <span className="material-symbols-outlined text-[18px] text-[#C68346]">gavel</span>
                            <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                {t('core_suscripcion.sec_governance_title')}
                            </span>
                        </div>
                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            {t('core_suscripcion.sec_governance_desc')}
                        </p>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default SuscripcionPage;
