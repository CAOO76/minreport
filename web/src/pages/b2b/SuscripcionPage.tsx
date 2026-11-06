import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { CopyButton } from '../../components/common/CopyButton';

const UNDECLARED = '[Información técnica no declarada en ficha]';

export const SuscripcionPage: React.FC = () => {
    const { currentAccount } = useAuth();
    const { session } = useMinReportSession();
    const enabledModules = session?.activeModules ?? { opermaq: false, stockpile: false };
    const isEduSandbox = Boolean(session?.isEduSandbox);

    if (!currentAccount) return null;

    const contract = (currentAccount as any)?.contract || {};
    const planName = contract.planName || contract.plan || (currentAccount as any)?.subscriptionPlan || '';
    const contractStatus = contract.status || (currentAccount as any)?.status || '';
    const startDate = contract.startDate || contract.validFrom || '';
    const endDate = contract.endDate || contract.validUntil || '';
    const billingCycle = contract.billingCycle || '';
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

    const rows: Array<{ label: string; value: string; mono?: boolean; copyable?: boolean }> = [
        { label: 'ID Cuenta Titular', value: currentAccount.id || '', mono: true, copyable: Boolean(currentAccount.id) },
        { label: 'Código de Contrato', value: contractCode, mono: true, copyable: Boolean(contractCode) },
        { label: 'Plan Contratado', value: planName },
        { label: 'Estado Contractual', value: contractStatus },
        { label: 'Inicio de Vigencia', value: formatDateValue(startDate), mono: true },
        { label: 'Próximo Vencimiento', value: formatDateValue(endDate), mono: true },
        { label: 'Ciclo de Facturación', value: billingCycle },
        { label: 'Moneda Oficial', value: currency, mono: true },
        {
            label: 'Módulos Habilitados',
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
                        MINREPORT // FICHA CONTRACTUAL B2B
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        Condiciones de Suscripción
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        Informe técnico de vigencia contractual, alcance modular y registro de facturación de la cuenta activa.
                    </p>
                </div>
                {isEduSandbox && (
                    <span className="text-microcopy font-mono px-fib-13 py-fib-8 border border-[#00AEEF]/40 text-[#00AEEF] bg-[#00AEEF]/5 rounded-none">
                        ENTORNO ACADÉMICO SANDBOX (EDU)
                    </span>
                )}
            </header>

            {/* Macro-Layout Proporción Áurea: 61.8% Ficha Contractual / 38.2% Facturación y Gobernanza */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                {/* ÁREA MAYOR (61.8%): Condiciones del Contrato (Modo Informe Técnico) */}
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            Parámetros Oficiales del Contrato
                        </h2>
                        <span className="text-microcopy font-mono text-[#C68346]">
                            SOLO LECTURA
                        </span>
                    </div>
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {rows.map((row) => {
                            const hasValue = Boolean(row.value && row.value.trim());
                            return (
                                <div
                                    key={row.label}
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
                                                <CopyButton value={row.value} title={`Copiar ${row.label}`} />
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                            {UNDECLARED}
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
                                Historial de Facturación DTE
                            </h2>
                            <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {invoices.length} doc(s)
                            </span>
                        </div>

                        {invoices.length === 0 ? (
                            <div className="px-fib-21 py-fib-34 text-center">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {UNDECLARED}
                                </p>
                                <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] mt-fib-8">
                                    Sin documentos tributarios emitidos en el período actual.
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {invoices.map((inv) => (
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
                                                {inv.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-8">
                        <div className="flex items-center gap-fib-8">
                            <span className="material-symbols-outlined text-[18px] text-[#C68346]">gavel</span>
                            <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                Gobernanza Contractual
                            </span>
                        </div>
                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            Las modificaciones de alcance modular, cupos operativos o términos comerciales son gestionadas mediante orden contractual auditada por Administración MINREPORT.
                        </p>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default SuscripcionPage;
