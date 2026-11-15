import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    type AiSupplierSuggestion,
    type ManufacturerRecord,
    type SupplierEntity,
} from '../../../contracts/manufacturers.contracts';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    FLAT_ICON_BTN_CLS,
    INPUT_BOX_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
    SUPPLIER_COUNTRY_OPTIONS,
    extractDomainHost,
    inferContributionChannelFromArea,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';
import { M3Switch } from './M3Switch';
import { ManufacturerLogoBadge } from './ManufacturerLogoBadge';

export interface SupplierCountryDiscoveryModalProps {
    open: boolean;
    manufacturer?: ManufacturerRecord | null;
    manufacturersList?: ManufacturerRecord[];
    defaultCountryIso2?: string;
    isDevMaster: boolean;
    isEduSandbox: boolean;
    onClose: () => void;
    onSaved: (suppliers?: SupplierEntity[]) => Promise<void> | void;
}

export const SupplierCountryDiscoveryModal: React.FC<SupplierCountryDiscoveryModalProps> = ({
    open,
    manufacturer = null,
    manufacturersList = [],
    defaultCountryIso2 = 'CL',
    isDevMaster,
    isEduSandbox,
    onClose,
    onSaved,
}) => {
    const { t } = useTranslation();

    const [mode, setMode] = useState<'AI_COUNTRY' | 'DIRECT'>('AI_COUNTRY');
    const [countryIso2, setCountryIso2] = useState(defaultCountryIso2 || 'CL');
    const [selectedMfgKey, setSelectedMfgKey] = useState(manufacturer?.manufacturerKey || '');
    const [cityRegionQuery, setCityRegionQuery] = useState('');
    const [focusQuery, setFocusQuery] = useState('');

    // Estado IA por País
    const [discovering, setDiscovering] = useState(false);
    const [suggestions, setSuggestions] = useState<AiSupplierSuggestion[]>([]);
    const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
    const [groundingSources, setGroundingSources] = useState<Array<{ title: string; uri: string }>>([]);
    const [hasSearchedAi, setHasSearchedAi] = useState(false);

    // Estado Registro Directo
    const [directTradeName, setDirectTradeName] = useState('');
    const [directLegalName, setDirectLegalName] = useState('');
    const [directTaxId, setDirectTaxId] = useState('');
    const [directWebsiteUrl, setDirectWebsiteUrl] = useState('');
    const [directAreaName, setDirectAreaName] = useState('');
    const [directRoleEmail, setDirectRoleEmail] = useState('');
    const [directPhone, setDirectPhone] = useState('');

    // Aporte comunitario 4º B2B (Área abierta Zero-Preset)
    const [contribAreaName, setContribAreaName] = useState('');
    const [contribNotes, setContribNotes] = useState('');

    const [confirmWord, setConfirmWord] = useState('');
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [infoMsg, setInfoMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setCountryIso2((defaultCountryIso2 || 'CL').toUpperCase());
        setSelectedMfgKey(manufacturer?.manufacturerKey || '');
        setCityRegionQuery('');
        setFocusQuery('');
        setSuggestions([]);
        setSelectedIds({});
        setGroundingSources([]);
        setHasSearchedAi(false);
        setDirectTradeName('');
        setDirectLegalName('');
        setDirectTaxId('');
        setDirectWebsiteUrl('');
        setDirectAreaName('');
        setDirectRoleEmail('');
        setDirectPhone('');
        setContribAreaName('');
        setContribNotes('');
        setConfirmWord('');
        setErrorMsg(null);
        setInfoMsg(null);
    }, [open, manufacturer?.manufacturerKey, defaultCountryIso2]);

    useEffect(() => {
        if (!open) return;
        const handleEsc = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape' && !busy && !discovering) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [open, busy, discovering, onClose]);

    if (!open) return null;

    const effectiveMfgKey = manufacturer?.manufacturerKey || selectedMfgKey || '';

    const handleDiscoverAi = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        setDiscovering(true);
        setErrorMsg(null);
        setInfoMsg(null);
        setHasSearchedAi(true);
        try {
            const res = await authFetch('/api/manufacturers/suppliers/discover-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    countryIso2,
                    regionQuery: cityRegionQuery.trim() || undefined,
                    manufacturerKey: effectiveMfgKey || undefined,
                    queryFocus: focusQuery.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_ai_discovery', 'Error al investigar distribuidor por país.'));
            }
            const list: AiSupplierSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
            setSuggestions(list);
            const nextSel: Record<string, boolean> = {};
            for (const s of list) nextSel[s.suggestionId] = true;
            setSelectedIds(nextSel);
            setGroundingSources(Array.isArray(data.groundingSources) ? data.groundingSources : []);
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_ai_discovery', 'Error en búsqueda IA.'));
        } finally {
            setDiscovering(false);
        }
    };

    const handleApproveAi = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        const selected = suggestions.filter((s) => selectedIds[s.suggestionId]);
        if (selected.length === 0) {
            setErrorMsg(t('suppliers_v2.error_select_suggestion', 'Selecciona al menos un candidato para consolidar.'));
            return;
        }
        if (confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setErrorMsg(t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar la operación.'));
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        try {
            const res = await authFetch('/api/manufacturers/suppliers/approve-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    suggestions: selected,
                    confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_save_supplier', 'No fue posible consolidar el distribuidor.'));
            }
            await onSaved(Array.isArray(data.suppliers) ? data.suppliers : []);
            onClose();
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_save_supplier', 'Error al guardar.'));
        } finally {
            setBusy(false);
        }
    };

    const handleDirectCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        if (directTradeName.trim().length < 2) {
            setErrorMsg(t('suppliers_v2.error_trade_name', 'Ingresa el nombre comercial del distribuidor.'));
            return;
        }
        if (confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setErrorMsg(t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar la operación.'));
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        try {
            const res = await authFetch('/api/manufacturers/suppliers/direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tradeName: directTradeName.trim(),
                    legalName: directLegalName.trim() || undefined,
                    countryIso2,
                    supplierTaxId: directTaxId.trim() || null,
                    officialWebsiteUrl: directWebsiteUrl.trim() || null,
                    manufacturerKeys: effectiveMfgKey ? [effectiveMfgKey] : [],
                    initialContact:
                        directAreaName.trim().length >= 2
                            ? {
                                  areaName: directAreaName.trim(),
                                  roleEmail: directRoleEmail.trim() || null,
                                  phone: directPhone.trim() || null,
                                  cityRegion: cityRegionQuery.trim() || null,
                              }
                            : undefined,
                    confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_save_supplier', 'Error al registrar distribuidor.'));
            }
            await onSaved(data.supplier ? [data.supplier] : []);
            onClose();
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_save_supplier', 'Error al registrar.'));
        } finally {
            setBusy(false);
        }
    };

    const handleSubmitContribution = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isEduSandbox) return;
        if (directTradeName.trim().length < 2) {
            setErrorMsg(t('suppliers_v2.error_trade_name', 'Ingresa el nombre comercial del distribuidor.'));
            return;
        }
        const cleanArea = contribAreaName.trim();
        const combinedNotes = cleanArea
            ? `[Área: ${cleanArea}]${contribNotes.trim() ? ` ${contribNotes.trim()}` : ''}`.slice(0, 800)
            : contribNotes.trim() || null;

        setBusy(true);
        setErrorMsg(null);
        try {
            const res = await authFetch('/api/manufacturers/contributions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manufacturerKey: effectiveMfgKey || null,
                    distributorName: directTradeName.trim(),
                    channelType: inferContributionChannelFromArea(cleanArea || contribNotes),
                    countryIso2,
                    cityRegion: cityRegionQuery.trim() || countryIso2,
                    phone: directPhone.trim() || null,
                    roleEmail: directRoleEmail.trim() || null,
                    portalUrl: directWebsiteUrl.trim() || null,
                    notes: combinedNotes,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_save_supplier', 'Error al enviar aporte.'));
            }
            setInfoMsg(t('suppliers_v2.contribution_sent_ok', 'Aporte enviado a moderación bajo Ley N° 21.719.'));
            await onSaved();
            onClose();
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_save_supplier', 'Error de red.'));
        } finally {
            setBusy(false);
        }
    };

    const brandUrl = manufacturer?.officialContacts?.dealerLocatorUrl || manufacturer?.officialWebsiteUrl || null;
    const brandHost = extractDomainHost(brandUrl);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={
                manufacturer
                    ? t('suppliers_v2.modal_title_brand_dealer', 'DISTRIBUIDOR OFICIAL POR PAÍS')
                    : t('suppliers_v2.modal_title_global_supplier', 'PROVEEDOR POR PAÍS')
            }
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-fib-21"
        >
            <div className="w-full max-w-[760px] max-h-[90vh] flex flex-col bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                {/* Cabecera */}
                <div className="flex items-center justify-between h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] shrink-0">
                    <div className="flex items-center gap-fib-13 min-w-0">
                        <span className="material-symbols-outlined text-[20px] text-[#C68346]">add</span>
                        <span className="text-data-dense font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {manufacturer
                                ? t('suppliers_v2.modal_title_brand_dealer', 'DISTRIBUIDOR OFICIAL POR PAÍS')
                                : t('suppliers_v2.modal_title_global_supplier', 'PROVEEDOR POR PAÍS')}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy || discovering}
                        aria-label={t('common.close', 'Cerrar')}
                        className={FLAT_ICON_BTN_CLS}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="overflow-y-auto p-fib-21 space-y-fib-21">
                    {/* Contexto de Marca OEM */}
                    {manufacturer ? (
                        <div className="flex items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="flex items-center gap-fib-13 min-w-0">
                                <ManufacturerLogoBadge
                                    make={manufacturer.officialName}
                                    recordOverride={manufacturer}
                                    variant="frameless"
                                    size="sm"
                                />
                                <div className="min-w-0">
                                    <div className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                        {manufacturer.officialName}
                                    </div>
                                    {brandHost && (
                                        <div className="text-microcopy font-mono text-[#00AEEF] truncate">
                                            {brandHost}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : manufacturersList.length > 0 ? (
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.optional_brand_label', 'MARCA OEM VINCULADA (OPCIONAL)')}
                            </label>
                            <select
                                value={selectedMfgKey}
                                onChange={(e) => setSelectedMfgKey(e.target.value)}
                                className={INPUT_BOX_CLS}
                            >
                                <option value="">
                                    {t('suppliers_v2.independent_specialist_option', 'Especialista Independiente / Multimarca')}
                                </option>
                                {manufacturersList.map((m) => (
                                    <option key={m.manufacturerKey} value={m.manufacturerKey}>
                                        {m.officialName}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}

                    {/* Selector de País + Ciudad/Zona opcional */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.country_operation_label', 'PAÍS DE OPERACIÓN')}
                            </label>
                            <select
                                value={countryIso2}
                                onChange={(e) => setCountryIso2(e.target.value)}
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
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.city_zone_optional_label', 'CIUDAD / ZONA MINERA (OPCIONAL)')}
                            </label>
                            <input
                                type="text"
                                value={cityRegionQuery}
                                onChange={(e) => setCityRegionQuery(e.target.value)}
                                placeholder={t('suppliers_v2.city_zone_placeholder', 'ej. Antofagasta, Santiago, Arequipa')}
                                className={INPUT_BOX_CLS}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    {errorMsg && (
                        <div className="p-fib-13 border border-[#C68346] text-data-dense font-mono text-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D]">
                            {errorMsg}
                        </div>
                    )}
                    {infoMsg && (
                        <div className="p-fib-13 border border-[#00AEEF] text-data-dense font-mono text-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D]">
                            {infoMsg}
                        </div>
                    )}

                    {isEduSandbox ? (
                        <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                            {t('suppliers_v2.edu_readonly_notice', 'Cuenta 5º EDU en modo solo lectura.')}
                        </div>
                    ) : isDevMaster ? (
                        <div className="space-y-fib-21">
                            {/* Pestañas planas sin redondeo */}
                            <div className="flex items-center gap-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                <button
                                    type="button"
                                    onClick={() => setMode('AI_COUNTRY')}
                                    className={`min-h-[44px] pb-fib-8 text-data-dense font-mono font-bold uppercase tracking-[0.05em] border-b-2 rounded-none cursor-pointer transition-colors ${
                                        mode === 'AI_COUNTRY'
                                            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                            : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    {t('suppliers_v2.tab_ai_country', 'IA POR PAÍS')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('DIRECT')}
                                    className={`min-h-[44px] pb-fib-8 text-data-dense font-mono font-bold uppercase tracking-[0.05em] border-b-2 rounded-none cursor-pointer transition-colors ${
                                        mode === 'DIRECT'
                                            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]'
                                            : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    {t('suppliers_v2.tab_direct_register', 'REGISTRO DIRECTO')}
                                </button>
                            </div>

                            {mode === 'AI_COUNTRY' ? (
                                <div className="space-y-fib-21">
                                    <form onSubmit={handleDiscoverAi} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.focus_optional_label', 'ENFOQUE OPERACIONAL (OPCIONAL)')}
                                            </label>
                                            <input
                                                type="text"
                                                value={focusQuery}
                                                onChange={(e) => setFocusQuery(e.target.value)}
                                                placeholder={t('suppliers_v2.focus_placeholder', 'ej. gran minería, repuestos OEM, camiones CAEX')}
                                                className={INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div className="flex items-center justify-end gap-fib-13">
                                            <button type="submit" disabled={discovering} className={BTN_COPPER_CLS}>
                                                {t('suppliers_v2.btn_discover_country_ai', 'INVESTIGAR DISTRIBUIDOR OFICIAL')}
                                            </button>
                                        </div>
                                    </form>

                                    {discovering && <M3LinearProgress indeterminate tone="copper" />}

                                    {!discovering && hasSearchedAi && suggestions.length === 0 && !errorMsg && (
                                        <div className="py-fib-21 text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] border-t border-[#E2E8F0] dark:border-[#12151C]">
                                            {t('suppliers_v2.ai_empty_result', 'Sin distribuidores verificados con grounding web para los parámetros indicados.')}
                                        </div>
                                    )}

                                    {suggestions.length > 0 && (
                                        <form onSubmit={handleApproveAi} autoComplete="off" spellCheck={false} className="space-y-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-13">
                                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C]">
                                                {suggestions.map((sug) => (
                                                    <div key={sug.suggestionId} className="p-fib-13 flex items-start justify-between gap-fib-13">
                                                        <div className="min-w-0 space-y-[4px]">
                                                            <div className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {sug.tradeName}
                                                            </div>
                                                            <div className="text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                                {sug.countryIso2} · {sug.legalName || sug.tradeName}
                                                                {sug.supplierTaxId ? ` · TAX ${sug.supplierTaxId}` : ''}
                                                            </div>
                                                            {sug.officialWebsiteUrl && (
                                                                <div className="text-data-dense font-mono text-[#00AEEF] truncate">
                                                                    {sug.officialWebsiteUrl}
                                                                </div>
                                                            )}
                                                            {(sug.contacts?.length || 0) > 0 && (
                                                                <div className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                                                    {t('suppliers_v2.detected_areas_prefix', 'Áreas detectadas')}:{' '}
                                                                    {sug.contacts.map((c) => c.areaName).join(' · ')}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <M3Switch
                                                            checked={Boolean(selectedIds[sug.suggestionId])}
                                                            onChange={(val) =>
                                                                setSelectedIds((prev) => ({
                                                                    ...prev,
                                                                    [sug.suggestionId]: val,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                ))}
                                            </div>

                                            {groundingSources.length > 0 && (
                                                <div className="space-y-[4px]">
                                                    <div className={MICRO_LABEL_CLS}>
                                                        {t('suppliers_v2.grounding_sources', 'FUENTES WEB VERIFICADAS')}
                                                    </div>
                                                    <div className="space-y-[4px]">
                                                        {groundingSources.map((src) => (
                                                            <a
                                                                key={src.uri}
                                                                href={src.uri}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="block text-data-dense font-mono text-[#00AEEF] hover:underline truncate"
                                                            >
                                                                {src.title || src.uri}
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13 pt-fib-8">
                                                <div className="sm:w-[220px]">
                                                    <label className={MICRO_LABEL_CLS}>
                                                        {t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={confirmWord}
                                                        onChange={(e) => setConfirmWord(e.target.value)}
                                                        placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                                        className={MONO_INPUT_BOX_CLS}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                    />
                                                </div>
                                                <button
                                                    type="submit"
                                                    disabled={
                                                        busy ||
                                                        confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                    }
                                                    className={BTN_COPPER_CLS}
                                                >
                                                    {t('suppliers_v2.btn_approve_ai', 'CONSOLIDAR EN DIRECTORIO')}
                                                </button>
                                            </div>
                                        </form>
                                    )}
                                </div>
                            ) : (
                                <form onSubmit={handleDirectCreate} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.trade_name_label', 'NOMBRE COMERCIAL *')}
                                            </label>
                                            <input
                                                type="text"
                                                value={directTradeName}
                                                onChange={(e) => setDirectTradeName(e.target.value)}
                                                placeholder="ej. Finning Chile"
                                                className={INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.legal_name_label', 'RAZÓN SOCIAL LEGAL')}
                                            </label>
                                            <input
                                                type="text"
                                                value={directLegalName}
                                                onChange={(e) => setDirectLegalName(e.target.value)}
                                                placeholder="ej. Finning Chile S.A."
                                                className={INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {countryIso2 === 'CL'
                                                    ? t('suppliers_v2.rut_cl_label', 'RUT TRIBUTARIO')
                                                    : t('suppliers_v2.tax_id_label', 'ID TRIBUTARIO / VAT')}
                                            </label>
                                            <input
                                                type="text"
                                                value={directTaxId}
                                                onChange={(e) => setDirectTaxId(e.target.value)}
                                                placeholder={countryIso2 === 'CL' ? '96.515.490-0' : 'TAX-ID'}
                                                className={MONO_INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.website_label', 'SITIO WEB OFICIAL HTTPS')}
                                            </label>
                                            <input
                                                type="url"
                                                value={directWebsiteUrl}
                                                onChange={(e) => setDirectWebsiteUrl(e.target.value)}
                                                placeholder="https://..."
                                                className={MONO_INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.initial_area_optional', 'ÁREA COMERCIAL INICIAL')}
                                            </label>
                                            <input
                                                type="text"
                                                value={directAreaName}
                                                onChange={(e) => setDirectAreaName(e.target.value)}
                                                placeholder={t('suppliers_v2.open_area_placeholder', 'ej. Repuestos, Lubricantes...')}
                                                className={INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.role_email_label', 'CORREO DE ROL')}
                                            </label>
                                            <input
                                                type="email"
                                                value={directRoleEmail}
                                                onChange={(e) => setDirectRoleEmail(e.target.value)}
                                                placeholder="ventas@..."
                                                className={MONO_INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.phone_label', 'MESA CENTRAL / TELÉFONO')}
                                            </label>
                                            <input
                                                type="text"
                                                value={directPhone}
                                                onChange={(e) => setDirectPhone(e.target.value)}
                                                placeholder="+56 2 ..."
                                                className={MONO_INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                    </div>

                                    {busy && <M3LinearProgress indeterminate tone="copper" />}

                                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13 pt-fib-8">
                                        <div className="sm:w-[220px]">
                                            <label className={MICRO_LABEL_CLS}>
                                                {t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}
                                            </label>
                                            <input
                                                type="text"
                                                value={confirmWord}
                                                onChange={(e) => setConfirmWord(e.target.value)}
                                                placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                                className={MONO_INPUT_BOX_CLS}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div className="flex items-center gap-fib-13">
                                            <button type="button" onClick={onClose} className={BTN_OUTLINE_CLS}>
                                                {t('common.cancel', 'Cancelar')}
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={
                                                    busy ||
                                                    confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                                }
                                                className={BTN_COPPER_CLS}
                                            >
                                                {t('suppliers_v2.btn_register_direct', 'REGISTRAR DISTRIBUIDOR')}
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            )}
                        </div>
                    ) : (
                        /* Modo Aporte Moderado 4º B2B (Área abierta Zero-Preset) */
                        <form onSubmit={handleSubmitContribution} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                            <div className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                {t(
                                    'suppliers_v2.contribution_ley21719_note',
                                    'Sugerencia moderada por ingeniería bajo Ley N° 21.719 (sanitización automática de PII).'
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>
                                        {t('suppliers_v2.trade_name_label', 'NOMBRE COMERCIAL *')}
                                    </label>
                                    <input
                                        type="text"
                                        value={directTradeName}
                                        onChange={(e) => setDirectTradeName(e.target.value)}
                                        placeholder="ej. Finning Chile"
                                        className={INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>
                                        {t('suppliers_v2.area_name_label', 'ÁREA COMERCIAL *')}
                                    </label>
                                    <input
                                        type="text"
                                        list="b2b-open-areas-datalist"
                                        value={contribAreaName}
                                        onChange={(e) => setContribAreaName(e.target.value)}
                                        placeholder={t('suppliers_v2.open_area_placeholder', 'ej. Repuestos, Venta de Equipos Nuevos, Lubricantes...')}
                                        className={INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <datalist id="b2b-open-areas-datalist">
                                        <option value={t('suppliers_v2.area_suggest_parts', 'Repuestos')} />
                                        <option value={t('suppliers_v2.area_suggest_new_eq', 'Venta de Equipos Nuevos')} />
                                        <option value={t('suppliers_v2.area_suggest_used_eq', 'Equipos Usados')} />
                                        <option value={t('suppliers_v2.area_suggest_service', 'Servicio Técnico y Garantía')} />
                                        <option value={t('suppliers_v2.area_suggest_lubricants', 'Lubricantes')} />
                                        <option value={t('suppliers_v2.area_suggest_rental', 'Arriendo de Maquinaria')} />
                                    </datalist>
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>
                                        {t('suppliers_v2.role_email_label', 'CORREO DE ROL')}
                                    </label>
                                    <input
                                        type="email"
                                        value={directRoleEmail}
                                        onChange={(e) => setDirectRoleEmail(e.target.value)}
                                        placeholder="contacto@..."
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>
                                        {t('suppliers_v2.website_label', 'PORTAL HTTPS')}
                                    </label>
                                    <input
                                        type="url"
                                        value={directWebsiteUrl}
                                        onChange={(e) => setDirectWebsiteUrl(e.target.value)}
                                        placeholder="https://..."
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>
                                    {t('suppliers_v2.notes_label', 'DETALLE / ÁREA DE NEGOCIO')}
                                </label>
                                <textarea
                                    rows={2}
                                    value={contribNotes}
                                    onChange={(e) => setContribNotes(e.target.value)}
                                    className={INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            {busy && <M3LinearProgress indeterminate tone="copper" />}
                            <div className="flex items-center justify-end gap-fib-13">
                                <button type="button" onClick={onClose} className={BTN_OUTLINE_CLS}>
                                    {t('common.cancel', 'Cancelar')}
                                </button>
                                <button type="submit" disabled={busy} className={BTN_COPPER_CLS}>
                                    {t('suppliers_v2.btn_send_contribution', 'ENVIAR SUGERENCIA')}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
