import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    type AiSupplierContactHint,
    type ManufacturerRecord,
    type SupplierContactEntry,
    type SupplierEntity,
    type TenantPrivateSupplierContact,
} from '../../../contracts/manufacturers.contracts';
import { CopyButton } from '../../../components/common/CopyButton';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    extractDomainHost,
    FLAT_ICON_BTN_CLS,
    getCountryHeadingLabel,
    groupSupplierContactsByOpenArea,
    INPUT_BOX_CLS,
    INPUT_LINE_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
    PILLAR_CALLOUT_CLS,
    SUPPLIER_COUNTRY_OPTIONS,
    type MergedContactItem,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';
import { M3Switch } from './M3Switch';
import { ManufacturerLogoBadge } from './ManufacturerLogoBadge';
import { SupplierContactAreaModal } from './SupplierContactAreaModal';
import { SupplierSiiTaxPillarPanel } from './SupplierSiiTaxPillarPanel';

export interface SupplierWorkspaceProps {
    supplier: SupplierEntity;
    manufacturersMap: Map<string, ManufacturerRecord>;
    activeManufacturerKey?: string | null;
    isDevMaster: boolean;
    isEduSandbox: boolean;
    tenantId?: string | null;
    onBack: () => void;
    onSelectManufacturer?: (mfgKey: string) => void;
    onSupplierMutated: (updated: SupplierEntity) => void;
}

export const SupplierWorkspace: React.FC<SupplierWorkspaceProps> = ({
    supplier: initialSupplier,
    manufacturersMap,
    activeManufacturerKey = null,
    isDevMaster,
    isEduSandbox,
    tenantId,
    onBack,
    onSelectManufacturer,
    onSupplierMutated,
}) => {
    const { t } = useTranslation();
    const undeclaredLabel = t('suppliers_v2.undeclared_technical_data', '[Información técnica no declarada en ficha]');

    const [supplier, setSupplier] = useState<SupplierEntity>(initialSupplier);
    const [activePillar, setActivePillar] = useState<'CONTACTS' | 'TAX'>('CONTACTS');
    const [privateContacts, setPrivateContacts] = useState<TenantPrivateSupplierContact[]>([]);
    const [loadingAgenda, setLoadingAgenda] = useState(false);
    const [agendaSearch, setAgendaSearch] = useState('');
    const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

    // Edición corporativa sidebar (1º DEV)
    const [editingCorp, setEditingCorp] = useState(false);
    const [corpTradeName, setCorpTradeName] = useState('');
    const [corpLegalName, setCorpLegalName] = useState('');
    const [corpCountry, setCorpCountry] = useState('CL');
    const [corpTaxId, setCorpTaxId] = useState('');
    const [corpWebsite, setCorpWebsite] = useState('');
    const [corpConfirmWord, setCorpConfirmWord] = useState('');
    const [corpBusy, setCorpBusy] = useState(false);

    // Modal + Contacto / Área abierta
    const [contactModalOpen, setContactModalOpen] = useState(false);
    const [editingGlobalContact, setEditingGlobalContact] = useState<SupplierContactEntry | null>(null);
    const [editingPrivateContact, setEditingPrivateContact] = useState<TenantPrivateSupplierContact | null>(null);

    // Confirmación eliminación contacto global
    const [pendingDeleteGlobal, setPendingDeleteGlobal] = useState<SupplierContactEntry | null>(null);
    const [deleteConfirmWord, setDeleteConfirmWord] = useState('');
    const [deleteBusy, setDeleteBusy] = useState(false);

    // Descubrimiento IA de áreas comerciales (1º DEV)
    const [discoveringAreas, setDiscoveringAreas] = useState(false);
    const [areaSuggestions, setAreaSuggestions] = useState<AiSupplierContactHint[]>([]);
    const [selectedAreaIdxs, setSelectedAreaIdxs] = useState<Record<number, boolean>>({});
    const [areaSources, setAreaSources] = useState<Array<{ title: string; uri: string }>>([]);
    const [areaAiSearched, setAreaAiSearched] = useState(false);
    const [areaConfirmWord, setAreaConfirmWord] = useState('');
    const [savingAiAreas, setSavingAiAreas] = useState(false);

    useEffect(() => {
        setSupplier(initialSupplier);
        setEditingCorp(false);
        setPendingDeleteGlobal(null);
        setAreaSuggestions([]);
        setAreaAiSearched(false);
        setAreaSources([]);
    }, [initialSupplier]);

    const hydrateCorpForm = useCallback((s: SupplierEntity) => {
        setCorpTradeName(s.tradeName);
        setCorpLegalName(s.legalName);
        setCorpCountry(s.countryIso2 || 'CL');
        setCorpTaxId(s.siiTaxProfile?.siiRutDisplay || s.supplierTaxId || '');
        setCorpWebsite(s.officialWebsiteUrl || '');
        setCorpConfirmWord('');
    }, []);

    useEffect(() => {
        hydrateCorpForm(supplier);
    }, [supplier, hydrateCorpForm]);

    const fetchWorkspaceData = useCallback(async () => {
        setLoadingAgenda(true);
        try {
            const [supRes, privRes] = await Promise.all([
                authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}`).catch(() => null),
                !isEduSandbox && tenantId
                    ? authFetch(`/api/manufacturers/contacts/private?supplierKey=${encodeURIComponent(supplier.supplierKey)}`).catch(
                        () => null
                    )
                    : Promise.resolve(null),
            ]);

            if (supRes && supRes.ok) {
                const sData = await supRes.json();
                if (sData?.supplier) {
                    setSupplier(sData.supplier);
                    onSupplierMutated(sData.supplier);
                }
            }
            if (privRes && privRes.ok) {
                const pData = await privRes.json();
                if (Array.isArray(pData?.contacts)) {
                    setPrivateContacts(pData.contacts);
                }
            } else {
                setPrivateContacts([]);
            }
        } finally {
            setLoadingAgenda(false);
        }
    }, [supplier.supplierKey, isEduSandbox, tenantId, onSupplierMutated]);

    useEffect(() => {
        void fetchWorkspaceData();
    }, [supplier.supplierKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const existingAreas = useMemo(() => {
        const set = new Set<string>();
        for (const c of supplier.contacts || []) {
            if (c.areaName) set.add(c.areaName);
        }
        for (const p of privateContacts) {
            if (p.areaName) set.add(p.areaName);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    }, [supplier.contacts, privateContacts]);

    const groupedAreas = useMemo(
        () => groupSupplierContactsByOpenArea(supplier, privateContacts, agendaSearch),
        [supplier, privateContacts, agendaSearch]
    );

    const handleSaveCorpSidebar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        if (corpConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setBanner({ kind: 'err', msg: t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar.') });
            return;
        }
        setCorpBusy(true);
        setBanner(null);
        try {
            const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tradeName: corpTradeName.trim(),
                    legalName: corpLegalName.trim(),
                    countryIso2: corpCountry,
                    supplierTaxId: corpTaxId.trim() || null,
                    officialWebsiteUrl: corpWebsite.trim() || null,
                    confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_save_supplier', 'Error al actualizar distribuidor.'));
            }
            if (data.supplier) {
                setSupplier(data.supplier);
                onSupplierMutated(data.supplier);
            }
            setEditingCorp(false);
            setBanner({ kind: 'ok', msg: t('suppliers_v2.corp_updated_ok', 'Ficha corporativa actualizada.') });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_save_supplier', 'Error al guardar.'),
            });
        } finally {
            setCorpBusy(false);
        }
    };

    const handleDiscoverAreasAi = async () => {
        if (!isDevMaster || isEduSandbox) return;
        setDiscoveringAreas(true);
        setAreaAiSearched(true);
        setBanner(null);
        try {
            const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/discover-areas-ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ countryIso2: supplier.countryIso2 }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_ai_discovery', 'Error al investigar áreas.'));
            }
            const list: AiSupplierContactHint[] = Array.isArray(data.suggestions) ? data.suggestions : [];
            setAreaSuggestions(list);
            const sel: Record<number, boolean> = {};
            list.forEach((_, idx) => {
                sel[idx] = true;
            });
            setSelectedAreaIdxs(sel);
            setAreaSources(Array.isArray(data.groundingSources) ? data.groundingSources : []);
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_ai_discovery', 'Error IA.'),
            });
        } finally {
            setDiscoveringAreas(false);
        }
    };

    const handleApproveAiAreas = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        const chosen = areaSuggestions.filter((_, idx) => selectedAreaIdxs[idx]);
        if (chosen.length === 0) return;
        if (areaConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setBanner({ kind: 'err', msg: t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar.') });
            return;
        }
        setSavingAiAreas(true);
        setBanner(null);
        try {
            let latest = supplier;
            for (const item of chosen) {
                const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/contacts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        areaName: item.areaName,
                        contactLabel: item.contactLabel || null,
                        phone: item.phone || null,
                        roleEmail: item.roleEmail || null,
                        portalUrl: item.portalUrl || null,
                        cityRegion: item.cityRegion || null,
                        notes: item.notes || null,
                        manufacturerKeys: supplier.manufacturerKeys,
                        isOfficialDealer: supplier.manufacturerKeys.length > 0,
                        confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Error guardando área IA.');
                if (data.supplier) latest = data.supplier;
            }
            setSupplier(latest);
            onSupplierMutated(latest);
            setAreaSuggestions([]);
            setAreaAiSearched(false);
            setAreaConfirmWord('');
            setBanner({ kind: 'ok', msg: t('suppliers_v2.contact_saved_ok', 'Áreas comerciales consolidadas.') });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_save_contact', 'Error al guardar áreas.'),
            });
        } finally {
            setSavingAiAreas(false);
        }
    };

    const handleDeleteContactItem = async (item: MergedContactItem) => {
        if (isEduSandbox) return;
        if (item.scope === 'TENANT_PRIVATE' && item.privateContact) {
            try {
                const res = await authFetch(`/api/manufacturers/contacts/private/${item.privateContact.contactId}`, {
                    method: 'DELETE',
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || 'Error eliminando contacto privado.');
                }
                setPrivateContacts((prev) => prev.filter((p) => p.contactId !== item.privateContact!.contactId));
                setBanner({ kind: 'ok', msg: t('suppliers_v2.contact_deleted_ok', 'Contacto privado eliminado.') });
            } catch (err: unknown) {
                setBanner({
                    kind: 'err',
                    msg: err instanceof Error ? err.message : t('suppliers_v2.error_delete_contact', 'Error eliminando.'),
                });
            }
            return;
        }
        if (item.scope === 'GLOBAL' && item.globalContact && isDevMaster) {
            setPendingDeleteGlobal(item.globalContact);
            setDeleteConfirmWord('');
        }
    };

    const confirmDeleteGlobalContact = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pendingDeleteGlobal || !isDevMaster) return;
        if (deleteConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) return;
        setDeleteBusy(true);
        try {
            const res = await authFetch(
                `/api/manufacturers/suppliers/${supplier.supplierKey}/contacts/${pendingDeleteGlobal.contactId}`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD }),
                }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al eliminar contacto.');
            if (data.supplier) {
                setSupplier(data.supplier);
                onSupplierMutated(data.supplier);
            }
            setPendingDeleteGlobal(null);
            setDeleteConfirmWord('');
            setBanner({ kind: 'ok', msg: t('suppliers_v2.contact_deleted_ok', 'Contacto eliminado de agenda.') });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_delete_contact', 'Error al eliminar.'),
            });
        } finally {
            setDeleteBusy(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none overflow-hidden">
            {/* Barra superior Nivel 3 */}
            <header className="h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
                <div className="flex items-center gap-[13px] min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('common.back', 'Volver')}
                        aria-label={t('common.back', 'Volver')}
                        className={FLAT_ICON_BTN_CLS}
                    >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <h2 className="text-body-main font-semibold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] truncate">
                        {supplier.tradeName}
                    </h2>
                    <span className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] hidden sm:inline">
                        {getCountryHeadingLabel(supplier.countryIso2)}
                    </span>
                </div>

                {(supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId) && (
                    <div className="flex items-center gap-[6px] shrink-0">
                        <span className="text-[0.8125rem] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                            {supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId}
                        </span>
                        <CopyButton value={supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId || ''} />
                    </div>
                )}
            </header>

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

            {/* Macro-Layout Áureo Desacoplado (Columna Ficha Compacta + Área Principal Scrollable) */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* Columna Menor — Ficha Corporativa & Marcas */}
                <aside className="w-full lg:w-[290px] xl:w-[320px] shrink-0 p-fib-21 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] lg:overflow-y-auto space-y-fib-21">
                    <div className="flex items-center justify-between gap-[13px] pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                            {t('suppliers_v2.corp_identity_heading', 'IDENTIDAD CORPORATIVA')}
                        </span>
                        {isDevMaster && !isEduSandbox && (
                            <button
                                type="button"
                                onClick={() => setEditingCorp((prev) => !prev)}
                                title={t('common.edit', 'Editar')}
                                aria-label={t('common.edit', 'Editar distribuidor')}
                                className={FLAT_ICON_BTN_CLS}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${editingCorp ? 'text-[#C68346]' : ''}`}>
                                    {editingCorp ? 'close' : 'edit'}
                                </span>
                            </button>
                        )}
                    </div>

                    {!editingCorp ? (
                        <div className="space-y-[21px]">
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                <div className="py-[10px]">
                                    <div className={MICRO_LABEL_CLS}>{t('suppliers_v2.legal_name_label', 'RAZÓN SOCIAL')}</div>
                                    <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                        {supplier.legalName || undeclaredLabel}
                                    </div>
                                </div>
                                <div className="py-[10px]">
                                    <div className={MICRO_LABEL_CLS}>{t('suppliers_v2.country_label', 'PAÍS')}</div>
                                    <div className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                        {getCountryHeadingLabel(supplier.countryIso2)}
                                    </div>
                                </div>
                                <div className="py-[10px] flex items-center justify-between gap-[8px]">
                                    <div className="min-w-0">
                                        <div className={MICRO_LABEL_CLS}>{t('suppliers_v2.tax_id_label', 'ID TRIBUTARIO / RUT')}</div>
                                        <div className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                            {supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId || undeclaredLabel}
                                        </div>
                                    </div>
                                    {(supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId) && (
                                        <CopyButton value={supplier.siiTaxProfile?.siiRutDisplay || supplier.supplierTaxId || ''} />
                                    )}
                                </div>
                                <div className="py-[10px] flex items-center justify-between gap-[8px]">
                                    <div className="min-w-0">
                                        <div className={MICRO_LABEL_CLS}>{t('suppliers_v2.website_label', 'SITIO WEB OFICIAL')}</div>
                                        {supplier.officialWebsiteUrl ? (
                                            <a
                                                href={supplier.officialWebsiteUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title={supplier.officialWebsiteUrl}
                                                className="text-data-dense font-mono text-[#00AEEF] hover:underline break-words"
                                            >
                                                {extractDomainHost(supplier.officialWebsiteUrl)}
                                            </a>
                                        ) : (
                                            <div className="text-data-dense text-[#94A3B8] dark:text-[#5A6072]">{undeclaredLabel}</div>
                                        )}
                                    </div>
                                    {supplier.officialWebsiteUrl && <CopyButton value={supplier.officialWebsiteUrl} />}
                                </div>
                            </div>

                            {/* Marcas OEM representadas */}
                            <div className="pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] space-y-[13px]">
                                <div className={MICRO_LABEL_CLS}>
                                    {t('suppliers_v2.represented_brands_heading', 'MARCAS OEM REPRESENTADAS')}
                                </div>
                                {supplier.manufacturerKeys.length === 0 ? (
                                    <div className="text-[0.8125rem] font-mono text-[#475569] dark:text-[#8A93A6]">
                                        {t('suppliers_v2.independent_specialist_tag', '[Especialista Independiente / Multimarca]')}
                                    </div>
                                ) : (
                                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {supplier.manufacturerKeys.map((mfgKey) => {
                                            const oem = manufacturersMap.get(mfgKey);
                                            const label = oem?.officialName || mfgKey.toUpperCase();
                                            return (
                                                <button
                                                    key={mfgKey}
                                                    type="button"
                                                    onClick={() => onSelectManufacturer && onSelectManufacturer(mfgKey)}
                                                    className="w-full py-[8px] flex items-center justify-between gap-[13px] text-left bg-transparent border-0 cursor-pointer hover:text-[#C68346] transition-colors"
                                                >
                                                    <div className="flex items-center gap-fib-13 min-w-0">
                                                        <ManufacturerLogoBadge
                                                            make={label}
                                                            recordOverride={oem || null}
                                                            variant="frameless"
                                                            size="sm"
                                                            showMonogramFallback
                                                        />
                                                        <span className="text-data-dense font-semibold truncate">{label}</span>
                                                    </div>
                                                    <span className="material-symbols-outlined text-[16px] text-[#94A3B8]">
                                                        chevron_right
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSaveCorpSidebar} autoComplete="off" spellCheck={false} className="space-y-[13px]">
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.trade_name_label', 'NOMBRE COMERCIAL')}</label>
                                <input
                                    type="text"
                                    value={corpTradeName}
                                    onChange={(e) => setCorpTradeName(e.target.value)}
                                    className={INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.legal_name_label', 'RAZÓN SOCIAL')}</label>
                                <input
                                    type="text"
                                    value={corpLegalName}
                                    onChange={(e) => setCorpLegalName(e.target.value)}
                                    className={INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.country_label', 'PAÍS')}</label>
                                <select
                                    value={corpCountry}
                                    onChange={(e) => setCorpCountry(e.target.value)}
                                    className={`${INPUT_BOX_CLS} font-mono`}
                                >
                                    {SUPPLIER_COUNTRY_OPTIONS.map((c) => (
                                        <option key={c.code} value={c.code}>
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.tax_id_label', 'ID TRIBUTARIO / RUT')}</label>
                                <input
                                    type="text"
                                    value={corpTaxId}
                                    onChange={(e) => setCorpTaxId(e.target.value)}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.website_label', 'SITIO WEB HTTPS')}</label>
                                <input
                                    type="url"
                                    value={corpWebsite}
                                    onChange={(e) => setCorpWebsite(e.target.value)}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}</label>
                                <input
                                    type="text"
                                    value={corpConfirmWord}
                                    onChange={(e) => setCorpConfirmWord(e.target.value)}
                                    placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            {corpBusy && <M3LinearProgress indeterminate tone="copper" />}
                            <div className="flex items-center justify-end gap-[13px] pt-[8px]">
                                <button type="button" onClick={() => setEditingCorp(false)} className={BTN_OUTLINE_CLS}>
                                    {t('common.cancel', 'Cancelar')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={
                                        corpBusy ||
                                        corpConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                    }
                                    className={BTN_COPPER_CLS}
                                >
                                    {t('common.save', 'GUARDAR')}
                                </button>
                            </div>
                        </form>
                    )}
                </aside>

                {/* Columna Mayor — Barra de 2 Pilares (Solo Iconos con Callout 0ms + Encabezado Explícito) */}
                <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <nav
                        aria-label={t('suppliers_v2.pillars_nav_aria', 'Pilares del distribuidor')}
                        className="h-11 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] shrink-0"
                    >
                        <button
                            type="button"
                            onClick={() => setActivePillar('CONTACTS')}
                            aria-label={t('suppliers_v2.pillar_contacts_tooltip', 'Agenda comercial por área')}
                            className={`group relative h-full min-w-[48px] px-fib-8 border-0 border-b-2 bg-transparent cursor-pointer inline-flex items-center justify-center rounded-none transition-colors ${activePillar === 'CONTACTS'
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">contacts</span>
                            <span className={PILLAR_CALLOUT_CLS}>
                                {t('suppliers_v2.pillar_contacts_tooltip', 'Agenda comercial por área')}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActivePillar('TAX')}
                            aria-label={t('suppliers_v2.pillar_tax_tooltip', 'Facturación electrónica SII y reglas B2B')}
                            className={`group relative h-full min-w-[48px] px-fib-8 border-0 border-b-2 bg-transparent cursor-pointer inline-flex items-center justify-center rounded-none transition-colors ${activePillar === 'TAX'
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">receipt_long</span>
                            <span className={PILLAR_CALLOUT_CLS}>
                                {t('suppliers_v2.pillar_tax_tooltip', 'Facturación electrónica SII y reglas B2B')}
                            </span>
                        </button>
                    </nav>

                    <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                        <div className="pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13">
                            <h3 className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {activePillar === 'CONTACTS'
                                    ? t('suppliers_v2.pillar_contacts_heading', 'AGENDA COMERCIAL POR ÁREA')
                                    : t('suppliers_v2.pillar_tax_heading', 'FACTURACIÓN ELECTRÓNICA Y REGLAS B2B')}
                            </h3>
                        </div>
                        {activePillar === 'CONTACTS' ? (
                            <div className="space-y-fib-21">
                                {/* Barra de herramientas Agenda */}
                                <div className="flex items-center justify-between gap-[13px] pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                    <div className="flex items-center gap-[8px] flex-1 min-w-0">
                                        <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                                            search
                                        </span>
                                        <input
                                            type="text"
                                            value={agendaSearch}
                                            onChange={(e) => setAgendaSearch(e.target.value)}
                                            placeholder={t('suppliers_v2.search_agenda_placeholder', 'Filtrar área, ciudad, correo...')}
                                            className={INPUT_LINE_CLS.replace('border-b ', '')}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                        {agendaSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setAgendaSearch('')}
                                                aria-label={t('common.clear', 'Limpiar filtro')}
                                                className={FLAT_ICON_BTN_CLS}
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-[13px] shrink-0">
                                        {isDevMaster && !isEduSandbox && (
                                            <button
                                                type="button"
                                                onClick={() => void handleDiscoverAreasAi()}
                                                disabled={discoveringAreas}
                                                title={t('suppliers_v2.btn_discover_areas_ai', 'Investigar áreas comerciales con IA')}
                                                aria-label={t('suppliers_v2.btn_discover_areas_ai', 'Investigar áreas comerciales con IA')}
                                                className={FLAT_ICON_BTN_CLS}
                                            >
                                                <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                                                    travel_explore
                                                </span>
                                            </button>
                                        )}
                                        {!isEduSandbox && (isDevMaster || Boolean(tenantId)) && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingGlobalContact(null);
                                                    setEditingPrivateContact(null);
                                                    setContactModalOpen(true);
                                                }}
                                                title={t('suppliers_v2.btn_add_contact_area', 'Agregar contacto comercial')}
                                                aria-label={t('suppliers_v2.btn_add_contact_area', 'Agregar contacto comercial')}
                                                className={FLAT_ICON_BTN_CLS}
                                            >
                                                <span className="material-symbols-outlined text-[22px] text-[#C68346]">add</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {(loadingAgenda || discoveringAreas) && <M3LinearProgress indeterminate tone="copper" />}

                                {/* Bandeja comparativa IA de áreas descubiertas (1º DEV) */}
                                {(areaSuggestions.length > 0 || (!discoveringAreas && areaAiSearched && areaSuggestions.length === 0)) && (
                                    <div className="p-[13px] border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] space-y-[13px]">
                                        <div className="flex items-center justify-between gap-[13px]">
                                            <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                                {t('suppliers_v2.ai_areas_tray_title', 'SUGERENCIAS IA POR ÁREA (APROBACIÓN HITL)')}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setAreaSuggestions([]);
                                                    setAreaAiSearched(false);
                                                }}
                                                className={FLAT_ICON_BTN_CLS}
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        </div>

                                        {areaSuggestions.length === 0 ? (
                                            <div className="text-[0.8125rem] font-mono text-[#475569] dark:text-[#8A93A6]">
                                                {t('suppliers_v2.ai_areas_empty', 'Sin áreas adicionales verificadas en fuentes públicas.')}
                                            </div>
                                        ) : (
                                            <form onSubmit={handleApproveAiAreas} autoComplete="off" spellCheck={false} className="space-y-[13px]">
                                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                                    {areaSuggestions.map((sug, idx) => (
                                                        <div key={`${sug.areaName}_${idx}`} className="p-[13px] flex items-start justify-between gap-[13px]">
                                                            <div className="min-w-0 space-y-[4px]">
                                                                <div className="text-data-dense font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                    {sug.areaName}
                                                                </div>
                                                                <div className="text-[0.8125rem] text-[#475569] dark:text-[#8A93A6]">
                                                                    {[sug.contactLabel, sug.cityRegion].filter(Boolean).join(' · ') || 'Ventanilla Comercial'}
                                                                </div>
                                                                <div className="text-[0.8125rem] font-mono tabular-nums text-[#00AEEF]">
                                                                    {[sug.roleEmail, sug.phone, sug.portalUrl].filter(Boolean).join(' · ')}
                                                                </div>
                                                            </div>
                                                            <M3Switch
                                                                checked={Boolean(selectedAreaIdxs[idx])}
                                                                onChange={(val) =>
                                                                    setSelectedAreaIdxs((prev) => ({
                                                                        ...prev,
                                                                        [idx]: val,
                                                                    }))
                                                                }
                                                            />
                                                        </div>
                                                    ))}
                                                </div>

                                                {areaSources.length > 0 && (
                                                    <div className="space-y-[4px]">
                                                        <div className={MICRO_LABEL_CLS}>{t('suppliers_v2.grounding_sources', 'FUENTES WEB VERIFICADAS')}</div>
                                                        {areaSources.map((src) => (
                                                            <a
                                                                key={src.uri}
                                                                href={src.uri}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="block text-microcopy font-mono text-[#00AEEF] hover:underline truncate"
                                                            >
                                                                {src.title || src.uri}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}

                                                {savingAiAreas && <M3LinearProgress indeterminate tone="copper" />}

                                                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-[13px]">
                                                    <div className="sm:w-[200px]">
                                                        <input
                                                            type="text"
                                                            value={areaConfirmWord}
                                                            onChange={(e) => setAreaConfirmWord(e.target.value)}
                                                            placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                                            className={MONO_INPUT_BOX_CLS}
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                        />
                                                    </div>
                                                    <button
                                                        type="submit"
                                                        disabled={
                                                            savingAiAreas ||
                                                            areaConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                        }
                                                        className={BTN_COPPER_CLS}
                                                    >
                                                        {t('suppliers_v2.btn_approve_ai', 'CONSOLIDAR EN AGENDA')}
                                                    </button>
                                                </div>
                                            </form>
                                        )}
                                    </div>
                                )}

                                {/* Confirmación inline de eliminación contacto global */}
                                {pendingDeleteGlobal && (
                                    <form
                                        onSubmit={confirmDeleteGlobalContact}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="p-[13px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col sm:flex-row sm:items-center justify-between gap-[13px]"
                                    >
                                        <span className="text-[0.8125rem] font-mono text-[#C68346]">
                                            {t('suppliers_v2.confirm_delete_global_contact', 'Eliminar contacto global')}:{' '}
                                            {pendingDeleteGlobal.areaName}
                                        </span>
                                        <div className="flex items-center gap-[8px]">
                                            <input
                                                type="text"
                                                value={deleteConfirmWord}
                                                onChange={(e) => setDeleteConfirmWord(e.target.value)}
                                                placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                                className={`${MONO_INPUT_BOX_CLS} w-[140px]`}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                            <button
                                                type="submit"
                                                disabled={
                                                    deleteBusy ||
                                                    deleteConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                }
                                                className={BTN_COPPER_CLS}
                                            >
                                                {t('common.delete', 'ELIMINAR')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPendingDeleteGlobal(null)}
                                                className={BTN_OUTLINE_CLS}
                                            >
                                                {t('common.cancel', 'Cancelar')}
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {/* Listado ordenado agrupado por área abierta */}
                                {groupedAreas.length === 0 ? (
                                    <div className="py-fib-34 text-center space-y-fib-13">
                                        <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                            {t('suppliers_v2.no_contacts_registered', '[Sin contactos comerciales registrados en agenda]')}
                                        </p>
                                        {!isEduSandbox && (
                                            <div className="pt-fib-8">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingGlobalContact(null);
                                                        setEditingPrivateContact(null);
                                                        setContactModalOpen(true);
                                                    }}
                                                    className={BTN_COPPER_CLS}
                                                >
                                                    {t('suppliers_v2.btn_add_contact_commercial', 'AGREGAR CONTACTO COMERCIAL')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-fib-21">
                                        {groupedAreas.map((group) => (
                                            <section key={group.areaKey} className="space-y-fib-8">
                                                <div className="flex items-center justify-between pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                                    <h3 className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                                        {group.areaName}
                                                    </h3>
                                                    <span className="text-microcopy font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                                        {group.items.length}
                                                    </span>
                                                </div>

                                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                    {group.items.map((item) => {
                                                        const canEditItem =
                                                            !isEduSandbox &&
                                                            ((item.scope === 'GLOBAL' && isDevMaster) ||
                                                                (item.scope === 'TENANT_PRIVATE' && Boolean(tenantId)));
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className="py-fib-13 flex items-start justify-between gap-fib-13"
                                                            >
                                                                <div className="min-w-0 space-y-1">
                                                                    <div className="flex items-center gap-fib-8 flex-wrap">
                                                                        <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                            {item.contactLabel || item.cityRegion || item.areaName}
                                                                        </span>
                                                                        <span
                                                                            className={`text-microcopy font-mono uppercase tracking-[0.05em] ${item.scope === 'GLOBAL'
                                                                                    ? 'text-[#475569] dark:text-[#8A93A6]'
                                                                                    : 'text-[#00AEEF]'
                                                                                }`}
                                                                        >
                                                                            {item.scope === 'GLOBAL'
                                                                                ? t('suppliers_v2.tag_global', 'GLOBAL')
                                                                                : t('suppliers_v2.tag_private', 'PRIVADO B2B')}
                                                                        </span>
                                                                        {item.cityRegion && item.contactLabel && (
                                                                            <span className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                                                                · {item.cityRegion}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex flex-wrap items-center gap-x-fib-21 gap-y-1 text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                                        {item.phone && (
                                                                            <span className="inline-flex items-center gap-1 select-text">
                                                                                <span>{item.phone}</span>
                                                                                <CopyButton value={item.phone} />
                                                                            </span>
                                                                        )}
                                                                        {item.roleEmail && (
                                                                            <span className="inline-flex items-center gap-1 select-text">
                                                                                <span>{item.roleEmail}</span>
                                                                                <CopyButton value={item.roleEmail} />
                                                                            </span>
                                                                        )}
                                                                        {item.portalUrl && (
                                                                            <span className="inline-flex items-center gap-1">
                                                                                <a
                                                                                    href={item.portalUrl}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    title={item.portalUrl}
                                                                                    className="text-[#00AEEF] hover:underline truncate max-w-[260px]"
                                                                                >
                                                                                    {extractDomainHost(item.portalUrl)}
                                                                                </a>
                                                                                <CopyButton value={item.portalUrl} />
                                                                            </span>
                                                                        )}
                                                                        {!item.phone && !item.roleEmail && !item.portalUrl && (
                                                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                                                {undeclaredLabel}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {item.notes && (
                                                                        <div className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                                                            {item.notes}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {canEditItem && (
                                                                    <div className="flex items-center gap-fib-8 shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                if (item.scope === 'GLOBAL' && item.globalContact) {
                                                                                    setEditingPrivateContact(null);
                                                                                    setEditingGlobalContact(item.globalContact);
                                                                                    setContactModalOpen(true);
                                                                                } else if (
                                                                                    item.scope === 'TENANT_PRIVATE' &&
                                                                                    item.privateContact
                                                                                ) {
                                                                                    setEditingGlobalContact(null);
                                                                                    setEditingPrivateContact(item.privateContact);
                                                                                    setContactModalOpen(true);
                                                                                }
                                                                            }}
                                                                            title={t('common.edit', 'Editar')}
                                                                            aria-label={t('common.edit', 'Editar')}
                                                                            className={FLAT_ICON_BTN_CLS}
                                                                        >
                                                                            <span className="material-symbols-outlined text-[16px]">
                                                                                edit
                                                                            </span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => void handleDeleteContactItem(item)}
                                                                            title={t('common.delete', 'Eliminar')}
                                                                            aria-label={t('common.delete', 'Eliminar')}
                                                                            className={FLAT_ICON_BTN_CLS}
                                                                        >
                                                                            <span className="material-symbols-outlined text-[16px]">
                                                                                delete
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <SupplierSiiTaxPillarPanel
                                supplier={supplier}
                                isDevMaster={isDevMaster}
                                isEduSandbox={isEduSandbox}
                                tenantId={tenantId}
                                onSupplierUpdated={(updated) => {
                                    setSupplier(updated);
                                    onSupplierMutated(updated);
                                }}
                            />
                        )}
                    </div>
                </main>
            </div>

            <SupplierContactAreaModal
                open={contactModalOpen}
                supplier={supplier}
                existingAreas={existingAreas}
                editingGlobalContact={editingGlobalContact}
                editingPrivateContact={editingPrivateContact}
                isDevMaster={isDevMaster}
                isEduSandbox={isEduSandbox}
                tenantId={tenantId}
                activeManufacturerKey={activeManufacturerKey}
                onClose={() => {
                    setContactModalOpen(false);
                    setEditingGlobalContact(null);
                    setEditingPrivateContact(null);
                }}
                onSaved={async ({ updatedSupplier, message } = {}) => {
                    if (updatedSupplier) {
                        setSupplier(updatedSupplier);
                        onSupplierMutated(updatedSupplier);
                    }
                    await fetchWorkspaceData();
                    if (message) setBanner({ kind: 'ok', msg: message });
                }}
            />
        </div>
    );
};
