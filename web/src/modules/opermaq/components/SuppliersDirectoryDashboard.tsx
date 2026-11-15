import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    type ManufacturerRecord,
    type SupplierContactContribution,
    type SupplierEntity,
} from '../../../contracts/manufacturers.contracts';
import { useMinReportSession } from '../../../context/MinReportSessionContext';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    buildManufacturersMap,
    FLAT_ICON_BTN_CLS,
    getCountryHeadingLabel,
    INPUT_BOX_CLS,
    INPUT_LINE_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
    SUPPLIER_COUNTRY_OPTIONS,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';
import { ManufacturerLogoBadge } from './ManufacturerLogoBadge';
import { SupplierCountryDiscoveryModal } from './SupplierCountryDiscoveryModal';
import { SupplierWorkspace } from './SupplierWorkspace';

const SUPPLIER_JUMP_STORAGE_KEY = 'opermaq_supplier_agenda_jump';

export const SuppliersDirectoryDashboard: React.FC = () => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const { capabilities, tenantId, isEduSandbox } = useOpermaqContext();

    const isEduReadOnly = Boolean(isEduSandbox || session?.isEduSandbox || session?.accountTier === 5);
    const isDevMaster = Boolean(capabilities.canCurateAI) && !isEduReadOnly;
    const defaultCountryIso2 = (session?.countryCode || 'CL').toUpperCase();
    const undeclaredLabel = t('suppliers_v2.undeclared_technical_data', '[Información técnica no declarada en ficha]');

    const [suppliers, setSuppliers] = useState<SupplierEntity[]>([]);
    const [manufacturers, setManufacturers] = useState<ManufacturerRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [countryFilter, setCountryFilter] = useState<string>('');
    const [selectedSupplier, setSelectedSupplier] = useState<SupplierEntity | null>(null);
    const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);

    // Buzón de moderación HITL (1º DEV)
    const [showInbox, setShowInbox] = useState(false);
    const [contributions, setContributions] = useState<SupplierContactContribution[]>([]);
    const [loadingInbox, setLoadingInbox] = useState(false);
    const [modConfirmWord, setModConfirmWord] = useState('');
    const [modBusyId, setModBusyId] = useState<string | null>(null);

    const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

    const manufacturersMap = useMemo(() => buildManufacturersMap(manufacturers), [manufacturers]);

    const loadDirectory = useCallback(async () => {
        setLoading(true);
        try {
            const [supRes, mfgRes] = await Promise.all([
                authFetch('/api/manufacturers/suppliers'),
                authFetch('/api/manufacturers'),
            ]);
            const supData = await supRes.json();
            const mfgData = await mfgRes.json();
            if (!supRes.ok) {
                throw new Error(supData.error || t('suppliers_v2.error_load_suppliers', 'Error al cargar distribuidores.'));
            }
            setSuppliers(Array.isArray(supData.suppliers) ? supData.suppliers : []);
            setManufacturers(mfgRes.ok && Array.isArray(mfgData.manufacturers) ? mfgData.manufacturers : []);
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_load_suppliers', 'Error al cargar distribuidores.'),
            });
        } finally {
            setLoading(false);
        }
    }, [t]);

    const loadContributions = useCallback(async () => {
        if (!isDevMaster || isEduReadOnly) return;
        setLoadingInbox(true);
        try {
            const res = await authFetch('/api/manufacturers/contributions?status=PENDING_REVIEW');
            const data = await res.json();
            if (res.ok && Array.isArray(data.contributions)) {
                setContributions(data.contributions);
            }
        } catch {
            // Fallo silencioso no bloqueante
        } finally {
            setLoadingInbox(false);
        }
    }, [isDevMaster, isEduReadOnly]);

    useEffect(() => {
        void loadDirectory();
    }, [loadDirectory]);

    useEffect(() => {
        if (isDevMaster && !isEduReadOnly) {
            void loadContributions();
        }
    }, [isDevMaster, isEduReadOnly, loadContributions]);

    // Salto contextual desde Fleet / ?supplier=
    useEffect(() => {
        if (suppliers.length === 0) return;
        let targetKeyOrName = '';
        try {
            const raw = sessionStorage.getItem(SUPPLIER_JUMP_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as { supplierKey?: string; tradeName?: string };
                targetKeyOrName = (parsed?.supplierKey || parsed?.tradeName || '').trim();
                sessionStorage.removeItem(SUPPLIER_JUMP_STORAGE_KEY);
            }
        } catch {
            // Ignorar JSON inválido
        }
        if (!targetKeyOrName && typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const supParam = params.get('supplier');
            if (supParam) targetKeyOrName = supParam.trim();
        }
        if (targetKeyOrName) {
            const q = targetKeyOrName.toLowerCase();
            const match = suppliers.find(
                (s) => s.supplierKey.toLowerCase() === q || s.tradeName.toLowerCase() === q
            );
            if (match) setSelectedSupplier(match);
        }
    }, [suppliers]);

    const groupedByCountry = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const cFilter = countryFilter.trim().toUpperCase();
        const filtered = suppliers.filter((s) => {
            if (cFilter && s.countryIso2.toUpperCase() !== cFilter) return false;
            if (!q) return true;
            const brandNames = (s.manufacturerKeys || [])
                .map((k) => manufacturersMap.get(k)?.officialName || k)
                .join(' ');
            return [
                s.tradeName,
                s.legalName || '',
                s.countryIso2,
                s.supplierTaxId || '',
                s.siiTaxProfile?.siiRutDisplay || '',
                brandNames,
                ...(s.contacts || []).map((c) => `${c.areaName} ${c.cityRegion || ''} ${c.contactLabel || ''}`),
            ]
                .join(' ')
                .toLowerCase()
                .includes(q);
        });

        const map = new Map<string, SupplierEntity[]>();
        for (const sup of filtered) {
            const code = (sup.countryIso2 || 'CL').toUpperCase();
            const list = map.get(code) || [];
            list.push(sup);
            map.set(code, list);
        }
        return Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([iso2, items]) => ({
                countryIso2: iso2,
                heading: getCountryHeadingLabel(iso2),
                items: items.sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es')),
            }));
    }, [suppliers, searchQuery, countryFilter, manufacturersMap]);

    const handleModerateContribution = async (contributionId: string, decision: 'APPROVE' | 'REJECT') => {
        if (!isDevMaster || isEduReadOnly) return;
        if (modConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setBanner({
                kind: 'err',
                msg: t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar moderación.'),
            });
            return;
        }
        setModBusyId(contributionId);
        setBanner(null);
        try {
            const res = await authFetch(`/api/manufacturers/contributions/${encodeURIComponent(contributionId)}/moderate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision, confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_moderation', 'Error al moderar aporte.'));
            }
            setModConfirmWord('');
            await Promise.all([loadContributions(), loadDirectory()]);
            setBanner({ kind: 'ok', msg: t('suppliers_v2.moderation_ok', 'Contribución procesada.') });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_moderation', 'Error al moderar aporte.'),
            });
        } finally {
            setModBusyId(null);
        }
    };

    const handleSupplierMutated = (updated: SupplierEntity) => {
        setSelectedSupplier(updated);
        setSuppliers((prev) => {
            const exists = prev.some((s) => s.supplierKey === updated.supplierKey);
            if (!exists) return [updated, ...prev];
            return prev.map((s) => (s.supplierKey === updated.supplierKey ? updated : s));
        });
    };

    if (selectedSupplier) {
        return (
            <SupplierWorkspace
                supplier={selectedSupplier}
                manufacturersMap={manufacturersMap}
                isDevMaster={isDevMaster}
                isEduSandbox={isEduReadOnly}
                tenantId={tenantId}
                onBack={() => setSelectedSupplier(null)}
                onSupplierMutated={handleSupplierMutated}
            />
        );
    }

    const totalVisibleCount = groupedByCountry.reduce((acc, g) => acc + g.items.length, 0);

    return (
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none overflow-hidden">
            <header className="h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
                <div className="flex items-center gap-fib-13 shrink-0">
                    <h2 className="text-data-dense font-mono font-bold uppercase tracking-[0.06em] text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('suppliers_v2.suppliers_title', 'PROVEEDORES')}
                    </h2>
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {totalVisibleCount}
                    </span>
                </div>

                <div className="flex items-center gap-[8px] flex-1 max-w-[420px]">
                    <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">search</span>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('suppliers_v2.search_suppliers_placeholder', 'Buscar proveedor, RUT, marca o área...')}
                        className={`${INPUT_LINE_CLS} border-b-0`}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>

                <div className="flex items-center gap-[13px] shrink-0">
                    <select
                        value={countryFilter}
                        onChange={(e) => setCountryFilter(e.target.value)}
                        aria-label={t('suppliers_v2.filter_country_aria', 'Filtrar por país ISO')}
                        className={`${INPUT_BOX_CLS} font-mono w-auto py-[4px] px-[8px]`}
                    >
                        <option value="">{t('suppliers_v2.all_countries', 'TODOS')}</option>
                        {SUPPLIER_COUNTRY_OPTIONS.map((c) => (
                            <option key={c.code} value={c.code}>
                                {c.code}
                            </option>
                        ))}
                    </select>

                    {isDevMaster && !isEduReadOnly && (
                        <button
                            type="button"
                            onClick={() => setShowInbox((prev) => !prev)}
                            title={t('suppliers_v2.inbox_moderation_tooltip', 'Buzón de aportes pendientes HITL')}
                            aria-label={t('suppliers_v2.inbox_moderation_tooltip', 'Buzón de aportes pendientes HITL')}
                            className={`${FLAT_ICON_BTN_CLS} gap-[4px] ${showInbox ? 'text-[#C68346]' : ''}`}
                        >
                            <span className="material-symbols-outlined text-[20px]">inbox</span>
                            {contributions.length > 0 && (
                                <span className="text-microcopy font-mono tabular-nums text-[#C68346]">
                                    {contributions.length}
                                </span>
                            )}
                        </button>
                    )}

                    {!isEduReadOnly && (
                        <button
                            type="button"
                            onClick={() => setShowDiscoveryModal(true)}
                            title={t('suppliers_v2.add_distributor_btn', 'Agregar distribuidor oficial por país')}
                            aria-label={t('suppliers_v2.add_distributor_btn', 'Agregar distribuidor oficial por país')}
                            className={`${FLAT_ICON_BTN_CLS} text-[#C68346] hover:text-[#C68346]`}
                        >
                            <span className="material-symbols-outlined text-[22px]">add</span>
                        </button>
                    )}
                </div>
            </header>

            {loading && <M3LinearProgress indeterminate tone="copper" />}

            <div className="flex-1 overflow-y-auto">
                {banner && (
                    <div
                        className={`mx-[21px] mt-[13px] p-[13px] border text-[0.8125rem] font-mono flex items-center justify-between gap-[13px] ${banner.kind === 'ok'
                            ? 'border-[#00AEEF] text-[#00AEEF]'
                            : 'border-[#C68346] text-[#C68346]'
                            } bg-[#F8FAFC] dark:bg-[#07090D]`}
                    >
                        <span>{banner.msg}</span>
                        <button type="button" onClick={() => setBanner(null)} className={FLAT_ICON_BTN_CLS}>
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                )}

                {/* Panel de Moderación HITL 1º DEV */}
                {showInbox && isDevMaster && !isEduReadOnly && (
                    <section className="mx-[21px] mt-[21px] p-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] space-y-[13px]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-[13px] pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {t('suppliers_v2.inbox_heading', 'APORTES B2B PENDIENTES DE MODERACIÓN')} ({contributions.length})
                            </span>
                            <div className="w-full sm:w-[220px]">
                                <label className={MICRO_LABEL_CLS}>
                                    {t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}
                                </label>
                                <input
                                    type="text"
                                    value={modConfirmWord}
                                    onChange={(e) => setModConfirmWord(e.target.value)}
                                    placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                        </div>

                        {loadingInbox ? (
                            <M3LinearProgress indeterminate tone="cyan" />
                        ) : contributions.length === 0 ? (
                            <p className="text-[0.8125rem] text-[#475569] dark:text-[#8A93A6]">
                                {t('suppliers_v2.inbox_empty', 'No existen contribuciones pendientes de revisión.')}
                            </p>
                        ) : (
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {contributions.map((c) => (
                                    <div
                                        key={c.contributionId}
                                        className="py-[13px] flex flex-col sm:flex-row sm:items-center justify-between gap-[13px]"
                                    >
                                        <div className="min-w-0 space-y-[4px]">
                                            <div className="text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {c.distributorName} · <span className="font-mono">{c.countryIso2}</span>
                                            </div>
                                            <div className="text-[0.8125rem] font-mono text-[#475569] dark:text-[#8A93A6]">
                                                {c.channelType} · {c.manufacturerKey || undeclaredLabel} · {c.roleEmail || c.portalUrl || c.phone || undeclaredLabel}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-[8px] shrink-0">
                                            <button
                                                type="button"
                                                disabled={
                                                    modBusyId === c.contributionId ||
                                                    modConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                }
                                                onClick={() => void handleModerateContribution(c.contributionId, 'REJECT')}
                                                className={BTN_OUTLINE_CLS}
                                            >
                                                {t('suppliers_v2.reject_btn', 'RECHAZAR')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={
                                                    modBusyId === c.contributionId ||
                                                    modConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                }
                                                onClick={() => void handleModerateContribution(c.contributionId, 'APPROVE')}
                                                className={BTN_COPPER_CLS}
                                            >
                                                {t('suppliers_v2.approve_btn', 'APROBAR')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* Listado Transversal por País ISO */}
                {groupedByCountry.length === 0 && !loading ? (
                    <div className="py-fib-89 px-fib-21 text-center space-y-fib-8">
                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('suppliers_v2.no_suppliers_found', 'No hay distribuidores registrados para este filtro.')}
                        </p>
                    </div>
                ) : (
                    <div className="p-fib-21 space-y-fib-21">
                        {groupedByCountry.map((grp) => (
                            <section key={grp.countryIso2} className="space-y-fib-8">
                                <header className="flex items-center justify-between pb-1.5 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {grp.heading}
                                    </span>
                                    <span className="text-microcopy font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                        {grp.items.length}
                                    </span>
                                </header>
                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {grp.items.map((sup) => {
                                        const taxDone = sup.taxReadiness?.score ?? 0;
                                        const taxTotal = sup.taxReadiness?.total ?? (sup.countryIso2 === 'CL' ? 6 : 4);
                                        const taxReady = Boolean(sup.taxReadiness?.isReady);
                                        return (
                                            <button
                                                key={sup.supplierKey}
                                                type="button"
                                                onClick={() => setSelectedSupplier(sup)}
                                                className="w-full text-left py-fib-13 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] px-fib-8 -mx-fib-8 transition-colors flex items-center justify-between gap-fib-13 cursor-pointer"
                                            >
                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex items-center gap-fib-13 flex-wrap">
                                                        <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {sup.tradeName}
                                                        </span>
                                                        {sup.legalName && sup.legalName !== sup.tradeName && (
                                                            <span className="text-data-dense text-[#475569] dark:text-[#8A93A6] truncate">
                                                                {sup.legalName}
                                                            </span>
                                                        )}
                                                        <div className="flex items-center gap-fib-8">
                                                            {(sup.manufacturerKeys || []).map((mfgKey) => {
                                                                const mfgRec = manufacturersMap.get(mfgKey);
                                                                return (
                                                                    <ManufacturerLogoBadge
                                                                        key={mfgKey}
                                                                        make={mfgRec?.officialName || mfgKey}
                                                                        recordOverride={mfgRec || null}
                                                                        variant="frameless"
                                                                        size="sm"
                                                                        showMonogramFallback
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-fib-13 text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] flex-wrap">
                                                        <span>
                                                            {sup.siiTaxProfile?.siiRutDisplay || sup.supplierTaxId || undeclaredLabel}
                                                        </span>
                                                        <span>·</span>
                                                        <span>
                                                            {(sup.contacts || []).length} {t('suppliers_v2.areas_short', 'ÁREAS')}
                                                        </span>
                                                        <span>·</span>
                                                        <span className={taxReady ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                                                            {sup.countryIso2 === 'CL' ? 'SII DTE' : 'TAX'} {taxDone}/{taxTotal}
                                                        </span>
                                                    </div>
                                                </div>
                                                <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                                    chevron_right
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            <SupplierCountryDiscoveryModal
                open={showDiscoveryModal}
                manufacturersList={manufacturers}
                defaultCountryIso2={countryFilter || defaultCountryIso2}
                isDevMaster={isDevMaster}
                isEduSandbox={isEduReadOnly}
                onClose={() => setShowDiscoveryModal(false)}
                onSaved={async () => {
                    await loadDirectory();
                }}
            />
        </div>
    );
};

export default SuppliersDirectoryDashboard;
