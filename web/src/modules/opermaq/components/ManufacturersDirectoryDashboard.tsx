import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    type ManufacturerRecord,
    type ManufacturerRegisteredEquipmentItem,
    type SupplierEntity,
} from '../../../contracts/manufacturers.contracts';
import { useMinReportSession } from '../../../context/MinReportSessionContext';
import { CopyButton } from '../../../components/common/CopyButton';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildManufacturersMap,
    extractDomainHost,
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    FLAT_ICON_BTN_CLS,
    PILLAR_CALLOUT_CLS,
    getCountryHeadingLabel,
    INPUT_LINE_CLS,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';
import { ManufacturerDevCuratorPanel, type DevCuratorMode } from './ManufacturerDevCuratorPanel';
import { ManufacturerLogoBadge, invalidateManufacturerLogoCache } from './ManufacturerLogoBadge';
import { SupplierCountryDiscoveryModal } from './SupplierCountryDiscoveryModal';
import { SupplierWorkspace } from './SupplierWorkspace';

const JUMP_STORAGE_KEY = 'opermaq_manufacturer_jump_context';

export const ManufacturersDirectoryDashboard: React.FC = () => {
    const { t } = useTranslation();
    const { session } = useMinReportSession();
    const { capabilities, tenantId, isEduSandbox } = useOpermaqContext();

    const isEduReadOnly = Boolean(isEduSandbox || session?.isEduSandbox || session?.accountTier === 5);
    const isDevMaster = Boolean(capabilities.canCurateAI) && !isEduReadOnly;
    const defaultCountryIso2 = (session?.countryCode || 'CL').toUpperCase();
    const undeclaredLabel = t('suppliers_v2.undeclared_technical_data', '[Información técnica no declarada en ficha]');

    // Nivel 1: Listado de marcas
    const [manufacturers, setManufacturers] = useState<ManufacturerRecord[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [syncBusy, setSyncBusy] = useState(false);

    // Nivel 2: Espacio de marca seleccionada
    const [selectedMfgKey, setSelectedMfgKey] = useState<string | null>(null);
    const [selectedMfgDetail, setSelectedMfgDetail] = useState<ManufacturerRecord | null>(null);
    const [mfgSuppliers, setMfgSuppliers] = useState<SupplierEntity[]>([]);
    const [registeredEquipment, setRegisteredEquipment] = useState<ManufacturerRegisteredEquipmentItem[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [mfgPillar, setMfgPillar] = useState<'SUPPLIERS' | 'EQUIPMENT'>('SUPPLIERS');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [equipmentFilter, setEquipmentFilter] = useState('');
    const [autoDiscoverBusy, setAutoDiscoverBusy] = useState(false);

    // Nivel 3: Workspace de distribuidor seleccionado (inline)
    const [selectedSupplier, setSelectedSupplier] = useState<SupplierEntity | null>(null);

    // Modales / Curación DEV
    const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
    const [devMode, setDevMode] = useState<DevCuratorMode>(null);
    const [devTargetMfg, setDevTargetMfg] = useState<ManufacturerRecord | null>(null);
    const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

    const manufacturersMap = useMemo(() => buildManufacturersMap(manufacturers), [manufacturers]);

    const loadManufacturers = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await authFetch('/api/manufacturers');
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_load_manufacturers', 'Error al cargar fabricantes.'));
            }
            const rows: ManufacturerRecord[] = Array.isArray(data.manufacturers) ? data.manufacturers : [];
            setManufacturers(rows);
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_load_manufacturers', 'Error al cargar fabricantes.'),
            });
        } finally {
            setLoadingList(false);
        }
    }, [t]);

    const openManufacturerDetail = useCallback(
        async (manufacturerKey: string) => {
            setSelectedMfgKey(manufacturerKey);
            setSelectedSupplier(null);
            setLoadingDetail(true);
            setSupplierFilter('');
            setEquipmentFilter('');
            try {
                const [mfgRes, supRes] = await Promise.all([
                    authFetch(`/api/manufacturers/${encodeURIComponent(manufacturerKey)}`),
                    authFetch(`/api/manufacturers/suppliers?manufacturerKey=${encodeURIComponent(manufacturerKey)}`),
                ]);
                const mfgData = await mfgRes.json();
                const supData = await supRes.json();

                if (!mfgRes.ok) {
                    throw new Error(mfgData.error || t('suppliers_v2.error_load_manufacturer_detail', 'Error al cargar ficha OEM.'));
                }
                if (mfgData.manufacturer) {
                    setSelectedMfgDetail(mfgData.manufacturer);
                }
                setRegisteredEquipment(Array.isArray(mfgData.registeredEquipment) ? mfgData.registeredEquipment : []);
                setMfgSuppliers(supRes.ok && Array.isArray(supData.suppliers) ? supData.suppliers : []);
            } catch (err: unknown) {
                setBanner({
                    kind: 'err',
                    msg: err instanceof Error ? err.message : t('suppliers_v2.error_load_manufacturer_detail', 'Error al cargar ficha OEM.'),
                });
            } finally {
                setLoadingDetail(false);
            }
        },
        [t]
    );

    useEffect(() => {
        void loadManufacturers();
    }, [loadManufacturers]);

    // Salto contextual ligero desde Fleet / Catálogo (?make= o sessionStorage)
    useEffect(() => {
        if (manufacturers.length === 0) return;
        let requestedMake = '';
        try {
            const rawJump = sessionStorage.getItem(JUMP_STORAGE_KEY);
            if (rawJump) {
                const parsed = JSON.parse(rawJump) as { make?: string };
                if (parsed?.make) requestedMake = parsed.make.trim();
                sessionStorage.removeItem(JUMP_STORAGE_KEY);
            }
        } catch {
            // Ignorar storage inválido
        }
        if (!requestedMake && typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const makeParam = params.get('make');
            if (makeParam) requestedMake = makeParam.trim();
        }
        if (requestedMake) {
            const norm = requestedMake.toLowerCase();
            const match = manufacturers.find(
                (m) =>
                    m.manufacturerKey.toLowerCase() === norm ||
                    m.officialName.toLowerCase() === norm ||
                    m.aliases?.some((a) => a.toLowerCase() === norm)
            );
            if (match && selectedMfgKey !== match.manufacturerKey) {
                void openManufacturerDetail(match.manufacturerKey);
            }
        }
    }, [manufacturers]); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredManufacturers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const sorted = [...manufacturers].sort((a, b) => a.officialName.localeCompare(b.officialName, 'es'));
        if (!q) return sorted;
        return sorted.filter((m) =>
            [m.officialName, m.legalCorporateName || '', m.hqCountryIso2 || '', m.officialWebsiteUrl || '', ...(m.aliases || [])]
                .join(' ')
                .toLowerCase()
                .includes(q)
        );
    }, [manufacturers, searchQuery]);

    const suppliersGroupedByCountry = useMemo(() => {
        const q = supplierFilter.trim().toLowerCase();
        const filtered = mfgSuppliers.filter((s) => {
            if (!q) return true;
            return [
                s.tradeName,
                s.legalName || '',
                s.countryIso2,
                s.supplierTaxId || '',
                s.siiTaxProfile?.siiRutDisplay || '',
                ...(s.contacts || []).map((c) => `${c.areaName} ${c.contactLabel || ''} ${c.cityRegion || ''}`),
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
            .map(([countryIso2, items]) => ({
                countryIso2,
                heading: getCountryHeadingLabel(countryIso2),
                items: items.sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es')),
            }));
    }, [mfgSuppliers, supplierFilter]);

    const equipmentGroupedByType = useMemo(() => {
        const q = equipmentFilter.trim().toLowerCase();
        const filtered = registeredEquipment.filter((eq) => {
            if (!q) return true;
            return [eq.model, eq.equipmentType, eq.category || '', eq.shortDescription || '']
                .join(' ')
                .toLowerCase()
                .includes(q);
        });
        const map = new Map<string, ManufacturerRegisteredEquipmentItem[]>();
        for (const item of filtered) {
            const key = (item.equipmentType || t('suppliers_v2.untyped_equipment', 'Sin tipo declarado')).trim();
            const list = map.get(key) || [];
            list.push(item);
            map.set(key, list);
        }
        return Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0], 'es'))
            .map(([equipmentType, items]) => ({
                equipmentType,
                items: items.sort((a, b) => a.model.localeCompare(b.model, 'es')),
            }));
    }, [registeredEquipment, equipmentFilter, t]);

    const handleSyncExisting = async () => {
        if (!isDevMaster || isEduReadOnly) return;
        setSyncBusy(true);
        setBanner(null);
        try {
            const res = await authFetch('/api/manufacturers/sync-existing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_sync_manufacturers', 'Error al sincronizar marcas.'));
            }
            invalidateManufacturerLogoCache();
            if (Array.isArray(data.manufacturers)) {
                setManufacturers(data.manufacturers);
            } else {
                await loadManufacturers();
            }
            setBanner({
                kind: 'ok',
                msg: t('suppliers_v2.sync_manufacturers_ok', 'Sincronización OEM ejecutada ({{count}} registros).', {
                    count: data.syncedCount ?? 0,
                }),
            });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_sync_manufacturers', 'Error al sincronizar.'),
            });
        } finally {
            setSyncBusy(false);
        }
    };

    const handleAutoDiscoverBrand = async (mfg: ManufacturerRecord) => {
        if (!isDevMaster || isEduReadOnly) return;
        setAutoDiscoverBusy(true);
        setBanner(null);
        try {
            const res = await authFetch(`/api/manufacturers/${encodeURIComponent(mfg.manufacturerKey)}/auto-discover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ overwriteExisting: false }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_ai_brand', 'Error al investigar marca.'));
            }
            invalidateManufacturerLogoCache(mfg.officialName);
            await openManufacturerDetail(mfg.manufacturerKey);
            await loadManufacturers();
            setBanner({ kind: 'ok', msg: t('suppliers_v2.ai_brand_updated', 'Ficha técnica OEM enriquecida.') });
        } catch (err: unknown) {
            setBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_ai_brand', 'Error al investigar marca.'),
            });
        } finally {
            setAutoDiscoverBusy(false);
        }
    };

    const handleSupplierMutated = (updated: SupplierEntity) => {
        setSelectedSupplier(updated);
        setMfgSuppliers((prev) => {
            const exists = prev.some((s) => s.supplierKey === updated.supplierKey);
            if (!exists) return [updated, ...prev];
            return prev.map((s) => (s.supplierKey === updated.supplierKey ? updated : s));
        });
    };

    // Nivel 3 inline: Workspace del Distribuidor seleccionado
    if (selectedSupplier) {
        return (
            <SupplierWorkspace
                supplier={selectedSupplier}
                manufacturersMap={manufacturersMap}
                activeManufacturerKey={selectedMfgKey}
                isDevMaster={isDevMaster}
                isEduSandbox={isEduReadOnly}
                tenantId={tenantId}
                onBack={() => setSelectedSupplier(null)}
                onSelectManufacturer={(mfgKey) => {
                    setSelectedSupplier(null);
                    void openManufacturerDetail(mfgKey);
                }}
                onSupplierMutated={handleSupplierMutated}
            />
        );
    }

    const activeMfg =
        selectedMfgDetail || (selectedMfgKey ? manufacturersMap.get(selectedMfgKey) || null : null);

    // Nivel 2: Espacio de Marca (Sidebar Compacto OEM + Área Principal de 2 Pilares con Scroll Independiente)
    if (selectedMfgKey && activeMfg) {
        const hasLogoAsset = Boolean(activeMfg.logoSvg?.downloadUrl);
        const corpContacts = activeMfg.officialContacts;
        const hasAnyCorpData = Boolean(
            activeMfg.legalCorporateName ||
                activeMfg.hqCountryIso2 ||
                activeMfg.officialWebsiteUrl ||
                corpContacts?.dealerLocatorUrl ||
                corpContacts?.officialPartsUrl ||
                corpContacts?.corporateEmail ||
                corpContacts?.corporatePhone
        );

        const openCatalogAsset = (catalogId?: string | null) => {
            if (!catalogId || !capabilities.canCurateAI) return;
            try {
                sessionStorage.setItem('opermaq_jump_catalog_asset_id', catalogId);
            } catch {
                // Ignorar storage restringido
            }
            window.dispatchEvent(
                new CustomEvent('opermaq:open-catalog-asset', {
                    detail: { catalogId },
                })
            );
        };

        return (
            <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none overflow-hidden">
                {/* Barra superior única Nivel 2 */}
                <header className="h-12 px-fib-13 sm:px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
                    <div className="flex items-center gap-fib-13 min-w-0">
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedMfgKey(null);
                                setSelectedMfgDetail(null);
                                setMfgSuppliers([]);
                                setRegisteredEquipment([]);
                            }}
                            title={t('common.back', 'Volver')}
                            aria-label={t('common.back', 'Volver a fabricantes')}
                            className={FLAT_ICON_BTN_CLS}
                        >
                            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                        </button>
                        <h2 className="text-h2-section font-bold uppercase tracking-[-0.01em] text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {activeMfg.officialName}
                        </h2>
                        {activeMfg.hqCountryIso2 && (
                            <span className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] hidden sm:inline shrink-0">
                                {activeMfg.hqCountryIso2}
                            </span>
                        )}
                    </div>

                    {isDevMaster && !isEduReadOnly && (
                        <div className="flex items-center gap-fib-8 shrink-0">
                            <button
                                type="button"
                                disabled={autoDiscoverBusy}
                                onClick={() => void handleAutoDiscoverBrand(activeMfg)}
                                title={t('suppliers_v2.ai_enrich_brand', 'Enriquecer datos OEM con IA')}
                                aria-label={t('suppliers_v2.ai_enrich_brand', 'Enriquecer datos OEM con IA')}
                                className={FLAT_ICON_BTN_CLS}
                            >
                                <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">auto_fix_high</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setDevTargetMfg(activeMfg);
                                    setDevMode('edit-brand');
                                }}
                                title={t('common.edit', 'Editar fabricante')}
                                aria-label={t('common.edit', 'Editar fabricante')}
                                className={FLAT_ICON_BTN_CLS}
                            >
                                <span className="material-symbols-outlined text-[20px]">edit</span>
                            </button>
                        </div>
                    )}
                </header>

                {(loadingDetail || autoDiscoverBusy) && <M3LinearProgress indeterminate tone="copper" />}

                {banner && (
                    <div
                        className={`mx-fib-21 mt-fib-13 p-fib-13 border text-data-dense font-mono flex items-center justify-between gap-fib-13 shrink-0 ${
                            banner.kind === 'ok'
                                ? 'border-[#00AEEF] text-[#00AEEF]'
                                : 'border-[#C68346] text-[#C68346]'
                        } bg-[#F8FAFC] dark:bg-[#07090D]`}
                    >
                        <span>{banner.msg}</span>
                        <button
                            type="button"
                            onClick={() => setBanner(null)}
                            aria-label={t('common.close', 'Cerrar')}
                            className={FLAT_ICON_BTN_CLS}
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                )}

                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                    {/* Sidebar Compacto OEM (Paridad VaultCatalogSidebar) */}
                    <aside className="w-full lg:w-[290px] xl:w-[320px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] lg:overflow-y-auto p-fib-21 space-y-fib-21 bg-[#F8FAFC]/50 dark:bg-[#07090D]/60">
                        {hasLogoAsset && (
                            <div className="pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                <ManufacturerLogoBadge
                                    make={activeMfg.officialName}
                                    recordOverride={activeMfg}
                                    variant="frameless"
                                    size="lg"
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-fib-13 pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {t('suppliers_v2.oem_identity_heading', 'IDENTIDAD OEM')}
                            </span>
                        </div>

                        {!hasAnyCorpData ? (
                            <div className="space-y-fib-13">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {undeclaredLabel}
                                </p>
                                {isDevMaster && !isEduReadOnly && (
                                    <button
                                        type="button"
                                        disabled={autoDiscoverBusy}
                                        onClick={() => void handleAutoDiscoverBrand(activeMfg)}
                                        className={`${BTN_OUTLINE_CLS} w-full`}
                                    >
                                        {t('suppliers_v2.btn_investigate_oem_ai', 'INVESTIGAR FICHA OEM CON IA')}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <dl className="space-y-fib-13 text-data-dense">
                                <div>
                                    <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('suppliers_v2.legal_name_label', 'RAZÓN SOCIAL')}
                                    </dt>
                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-[2px]">
                                        {activeMfg.legalCorporateName || (
                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">{undeclaredLabel}</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('suppliers_v2.hq_country_label', 'SEDE CENTRAL')}
                                    </dt>
                                    <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-[2px]">
                                        {activeMfg.hqCountryIso2 ? (
                                            getCountryHeadingLabel(activeMfg.hqCountryIso2)
                                        ) : (
                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">{undeclaredLabel}</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('suppliers_v2.website_label', 'SITIO WEB OFICIAL')}
                                    </dt>
                                    <dd className="mt-[2px] flex items-center gap-[6px]">
                                        {activeMfg.officialWebsiteUrl ? (
                                            <>
                                                <a
                                                    href={activeMfg.officialWebsiteUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-mono text-data-dense text-[#00AEEF] hover:underline truncate select-text"
                                                >
                                                    {extractDomainHost(activeMfg.officialWebsiteUrl)}
                                                </a>
                                                <CopyButton value={activeMfg.officialWebsiteUrl} />
                                            </>
                                        ) : (
                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">{undeclaredLabel}</span>
                                        )}
                                    </dd>
                                </div>

                                {corpContacts?.dealerLocatorUrl && (
                                    <div>
                                        <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('suppliers_v2.dealer_locator_label', 'LOCALIZADOR DISTRIBUIDORES')}
                                        </dt>
                                        <dd className="mt-[2px] flex items-center gap-[6px]">
                                            <a
                                                href={corpContacts.dealerLocatorUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-mono text-data-dense text-[#00AEEF] hover:underline truncate select-text"
                                            >
                                                {extractDomainHost(corpContacts.dealerLocatorUrl)}
                                            </a>
                                            <CopyButton value={corpContacts.dealerLocatorUrl} />
                                        </dd>
                                    </div>
                                )}

                                {corpContacts?.officialPartsUrl && (
                                    <div>
                                        <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('suppliers_v2.parts_portal_label', 'PORTAL DE REPUESTOS')}
                                        </dt>
                                        <dd className="mt-[2px] flex items-center gap-[6px]">
                                            <a
                                                href={corpContacts.officialPartsUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-mono text-data-dense text-[#00AEEF] hover:underline truncate select-text"
                                            >
                                                {extractDomainHost(corpContacts.officialPartsUrl)}
                                            </a>
                                            <CopyButton value={corpContacts.officialPartsUrl} />
                                        </dd>
                                    </div>
                                )}

                                {corpContacts?.corporateEmail && (
                                    <div>
                                        <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('suppliers_v2.corp_email_label', 'CORREO CORPORATIVO')}
                                        </dt>
                                        <dd className="mt-[2px] flex items-center gap-[6px]">
                                            <span className="font-mono text-data-dense select-text truncate">
                                                {corpContacts.corporateEmail}
                                            </span>
                                            <CopyButton value={corpContacts.corporateEmail} />
                                        </dd>
                                    </div>
                                )}

                                {corpContacts?.corporatePhone && (
                                    <div>
                                        <dt className="text-microcopy font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('suppliers_v2.corp_phone_label', 'TELÉFONO CORPORATIVO')}
                                        </dt>
                                        <dd className="mt-[2px] flex items-center gap-[6px]">
                                            <span className="font-mono tabular-nums text-data-dense select-text">
                                                {corpContacts.corporatePhone}
                                            </span>
                                            <CopyButton value={corpContacts.corporatePhone} />
                                        </dd>
                                    </div>
                                )}
                            </dl>
                        )}
                    </aside>

                    {/* Área Principal — Barra de 2 Pilares con Callout 0ms + Scroll Independiente */}
                    <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#000000]">
                        <nav
                            aria-label={t('suppliers_v2.mfg_pillars_aria', 'Pilares del fabricante')}
                            className="h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] shrink-0"
                        >
                            <div className="flex items-center gap-fib-21 h-full">
                                <button
                                    type="button"
                                    onClick={() => setMfgPillar('SUPPLIERS')}
                                    title={t('suppliers_v2.pillar_distributors_tooltip', 'Distribuidores oficiales por país')}
                                    aria-label={t('suppliers_v2.pillar_distributors_tooltip', 'Distribuidores oficiales por país')}
                                    className={`group relative min-w-[48px] h-full px-fib-13 border-0 border-b-2 bg-transparent cursor-pointer inline-flex items-center justify-center rounded-none transition-colors ${
                                        mfgPillar === 'SUPPLIERS'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[22px]">storefront</span>
                                    <span aria-hidden="true" className={PILLAR_CALLOUT_CLS}>
                                        {t('suppliers_v2.pillar_distributors_tooltip', 'Distribuidores oficiales por país')}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMfgPillar('EQUIPMENT')}
                                    title={t('suppliers_v2.pillar_equipment_tooltip', 'Equipos registrados en catálogo')}
                                    aria-label={t('suppliers_v2.pillar_equipment_tooltip', 'Equipos registrados en catálogo')}
                                    className={`group relative min-w-[48px] h-full px-fib-13 border-0 border-b-2 bg-transparent cursor-pointer inline-flex items-center justify-center rounded-none transition-colors ${
                                        mfgPillar === 'EQUIPMENT'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[22px]">precision_manufacturing</span>
                                    <span aria-hidden="true" className={PILLAR_CALLOUT_CLS}>
                                        {t('suppliers_v2.pillar_equipment_tooltip', 'Equipos registrados en catálogo')}
                                    </span>
                                </button>
                            </div>

                            <div className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] shrink-0 hidden sm:block">
                                {mfgSuppliers.length} {t('suppliers_v2.distributors_short', 'DISTRIBUIDORES')} ·{' '}
                                {registeredEquipment.length} {t('suppliers_v2.equipments_short', 'EQUIPOS')}
                            </div>
                        </nav>

                        <div className="flex-1 overflow-y-auto p-fib-21">
                            {mfgPillar === 'SUPPLIERS' ? (
                                <div className="space-y-fib-21">
                                    <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                        <h3 className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                            {t('suppliers_v2.pillar_distributors_heading', 'DISTRIBUIDORES OFICIALES POR PAÍS')}
                                        </h3>

                                        <div className="flex items-center gap-fib-13 flex-1 max-w-md justify-end">
                                            <div className="relative flex-1 flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346]">
                                                <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                                                    search
                                                </span>
                                                <input
                                                    type="text"
                                                    value={supplierFilter}
                                                    onChange={(e) => setSupplierFilter(e.target.value)}
                                                    placeholder={t('suppliers_v2.filter_distributors_placeholder', 'Filtrar distribuidor, país o RUT...')}
                                                    className={`${INPUT_LINE_CLS} border-b-0 pl-fib-8`}
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                />
                                                {supplierFilter && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSupplierFilter('')}
                                                        aria-label={t('common.clear', 'Limpiar filtro')}
                                                        className={FLAT_ICON_BTN_CLS}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                    </button>
                                                )}
                                            </div>

                                            {!isEduReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDiscoveryModal(true)}
                                                    title={t('suppliers_v2.add_distributor_btn', 'Agregar distribuidor oficial por país')}
                                                    aria-label={t('suppliers_v2.add_distributor_btn', 'Agregar distribuidor oficial por país')}
                                                    className={`${FLAT_ICON_BTN_CLS} group relative min-w-[44px] min-h-[44px] text-[#C68346] hover:text-[#C68346]`}
                                                >
                                                    <span className="material-symbols-outlined text-[24px]">add</span>
                                                    <span aria-hidden="true" className={PILLAR_CALLOUT_CLS}>
                                                        {t('suppliers_v2.add_distributor_btn', 'Agregar distribuidor oficial por país')}
                                                    </span>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {suppliersGroupedByCountry.length === 0 ? (
                                        <div className="py-fib-55 text-center space-y-fib-13">
                                            <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'suppliers_v2.no_distributors_for_brand',
                                                    'Sin distribuidores oficiales vinculados para esta marca.'
                                                )}
                                            </p>
                                            {!isEduReadOnly && (
                                                <div className="pt-fib-8">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDiscoveryModal(true)}
                                                        className={BTN_COPPER_CLS}
                                                    >
                                                        {t('suppliers_v2.btn_add_distributor_by_country', 'AGREGAR DISTRIBUIDOR POR PAÍS')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-fib-21">
                                            {suppliersGroupedByCountry.map((group) => (
                                                <section key={group.countryIso2} className="space-y-fib-8">
                                                    <header className="flex items-center justify-between pb-[6px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                                        <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                                            {group.heading}
                                                        </span>
                                                        <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                            {group.items.length}
                                                        </span>
                                                    </header>
                                                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                        {group.items.map((sup) => {
                                                            const taxDone = sup.taxReadiness?.score ?? 0;
                                                            const taxTotal = sup.taxReadiness?.total ?? (sup.countryIso2 === 'CL' ? 6 : 4);
                                                            const taxReady = Boolean(sup.taxReadiness?.isReady);
                                                            const taxIdDisplay = sup.siiTaxProfile?.siiRutDisplay || sup.supplierTaxId;
                                                            const areaNames = Array.from(
                                                                new Set((sup.contacts || []).map((c) => c.areaName).filter(Boolean))
                                                            );
                                                            const areasSummary =
                                                                areaNames.length > 0
                                                                    ? areaNames.slice(0, 3).join(' · ')
                                                                    : `${(sup.contacts || []).length} ${t('suppliers_v2.areas_short', 'ÁREAS')}`;
                                                            return (
                                                                <button
                                                                    key={sup.supplierKey}
                                                                    type="button"
                                                                    onClick={() => setSelectedSupplier(sup)}
                                                                    className="w-full text-left py-fib-13 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] px-fib-8 -mx-fib-8 transition-colors flex items-center justify-between gap-fib-13 cursor-pointer"
                                                                >
                                                                    <div className="min-w-0 space-y-[4px]">
                                                                        <div className="flex items-center gap-fib-8 flex-wrap">
                                                                            <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                                {sup.tradeName}
                                                                            </span>
                                                                            {sup.legalName && sup.legalName !== sup.tradeName && (
                                                                                <span className="text-data-dense text-[#475569] dark:text-[#8A93A6] truncate">
                                                                                    {sup.legalName}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-fib-13 text-data-dense font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] flex-wrap">
                                                                            {taxIdDisplay && <span>{taxIdDisplay}</span>}
                                                                            {taxIdDisplay && <span>·</span>}
                                                                            <span>{areasSummary}</span>
                                                                            <span>·</span>
                                                                            <span className={taxReady ? 'text-[#00AEEF]' : 'text-[#C68346]'}>
                                                                                {sup.countryIso2 === 'CL' ? 'SII' : 'TAX'} {taxDone}/{taxTotal}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072] shrink-0">
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
                            ) : (
                                <div className="space-y-fib-21">
                                    <div className="flex flex-wrap items-center justify-between gap-fib-13 pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                                        <h3 className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                            {t('suppliers_v2.pillar_equipment_heading', 'EQUIPOS REGISTRADOS EN CATÁLOGO')}
                                        </h3>

                                        <div className="relative flex-1 max-w-md flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346]">
                                            <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                                                search
                                            </span>
                                            <input
                                                type="text"
                                                value={equipmentFilter}
                                                onChange={(e) => setEquipmentFilter(e.target.value)}
                                                placeholder={t('suppliers_v2.filter_equipment_placeholder', 'Filtrar modelo, tipo o familia...')}
                                                className={`${INPUT_LINE_CLS} border-b-0 pl-fib-8`}
                                                autoComplete="off"
                                                spellCheck={false}
                                            />
                                            {equipmentFilter && (
                                                <button
                                                    type="button"
                                                    onClick={() => setEquipmentFilter('')}
                                                    aria-label={t('common.clear', 'Limpiar filtro')}
                                                    className={FLAT_ICON_BTN_CLS}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {equipmentGroupedByType.length === 0 ? (
                                        <div className="py-fib-55 text-center">
                                            <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                                                {t(
                                                    'suppliers_v2.no_equipment_for_brand',
                                                    'No hay equipos registrados en catálogo maestro para este fabricante.'
                                                )}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-fib-21">
                                            {equipmentGroupedByType.map((grp) => (
                                                <section key={grp.equipmentType} className="space-y-fib-8">
                                                    <header className="flex items-center justify-between pb-[6px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                                        <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                                            {grp.equipmentType}
                                                        </span>
                                                        <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                            {grp.items.length}
                                                        </span>
                                                    </header>
                                                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                        {grp.items.map((eq) => {
                                                            const canJump = Boolean(eq.catalogId && capabilities.canCurateAI);
                                                            const rowBody = (
                                                                <>
                                                                    <div className="min-w-0">
                                                                        <div className="text-body-main font-mono font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                            {eq.model}
                                                                        </div>
                                                                        {eq.shortDescription && (
                                                                            <div className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-[2px]">
                                                                                {eq.shortDescription}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-fib-13 shrink-0">
                                                                        {eq.category && (
                                                                            <span className="text-microcopy font-mono uppercase tracking-[0.04em] text-[#475569] dark:text-[#8A93A6]">
                                                                                {eq.category}
                                                                            </span>
                                                                        )}
                                                                        {canJump && (
                                                                            <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">
                                                                                chevron_right
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </>
                                                            );
                                                            return canJump ? (
                                                                <button
                                                                    key={eq.catalogId || `${eq.equipmentType}_${eq.model}`}
                                                                    type="button"
                                                                    onClick={() => openCatalogAsset(eq.catalogId)}
                                                                    className="w-full text-left py-fib-13 px-fib-8 -mx-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8 cursor-pointer"
                                                                >
                                                                    {rowBody}
                                                                </button>
                                                            ) : (
                                                                <div
                                                                    key={eq.catalogId || `${eq.equipmentType}_${eq.model}`}
                                                                    className="py-fib-13 flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8"
                                                                >
                                                                    {rowBody}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </main>
                </div>

                <SupplierCountryDiscoveryModal
                    open={showDiscoveryModal}
                    manufacturer={activeMfg}
                    defaultCountryIso2={defaultCountryIso2}
                    isDevMaster={isDevMaster}
                    isEduSandbox={isEduReadOnly}
                    onClose={() => setShowDiscoveryModal(false)}
                    onSaved={async () => {
                        await openManufacturerDetail(activeMfg.manufacturerKey);
                        await loadManufacturers();
                    }}
                />

                {devMode && (
                    <ManufacturerDevCuratorPanel
                        mode={devMode}
                        manufacturer={devTargetMfg}
                        onClose={() => setDevMode(null)}
                        onMutated={async (opts) => {
                            invalidateManufacturerLogoCache();
                            setDevMode(null);
                            if (opts?.message) {
                                setBanner({ kind: 'ok', msg: opts.message });
                            }
                            if (selectedMfgKey) {
                                await openManufacturerDetail(selectedMfgKey);
                            }
                            await loadManufacturers();
                        }}
                        onError={(msg) => setBanner({ kind: 'err', msg })}
                    />
                )}
            </div>
        );
    }

    // Nivel 1: Listado Limpio de Marcas / Fabricantes (Paridad exacta AssetList.tsx)
    return (
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none overflow-hidden">
            <header className="h-12 px-fib-13 sm:px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13 sm:gap-fib-21 bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
                <div className="flex items-center gap-fib-13 shrink-0">
                    <h1 className="text-data-dense font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('suppliers_v2.manufacturers_title', 'FABRICANTES')}
                    </h1>
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {filteredManufacturers.length}
                    </span>
                </div>

                <div className="flex items-center justify-end gap-fib-13 flex-1 max-w-md">
                    <div className="relative flex-1 flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346]">
                        <span className="material-symbols-outlined text-[18px] text-[#94A3B8] dark:text-[#5A6072]">search</span>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('suppliers_v2.search_brands_placeholder', 'Buscar fabricante, sede o dominio...')}
                            className={`${INPUT_LINE_CLS} border-b-0 pl-fib-8`}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label={t('common.clear', 'Limpiar filtro')}
                                className={FLAT_ICON_BTN_CLS}
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        )}
                    </div>

                    {isDevMaster && !isEduReadOnly && (
                        <div className="flex items-center gap-[4px] shrink-0">
                            <button
                                type="button"
                                disabled={syncBusy}
                                onClick={() => void handleSyncExisting()}
                                title={t('suppliers_v2.sync_brands_tooltip', 'Detectar y registrar marcas desde catálogo existente')}
                                aria-label={t('suppliers_v2.sync_brands_tooltip', 'Detectar y registrar marcas desde catálogo existente')}
                                className={`${FLAT_ICON_BTN_CLS} min-w-[44px] min-h-[44px]`}
                            >
                                <span className="material-symbols-outlined text-[20px]">sync</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setDevTargetMfg(null);
                                    setDevMode('create-brand');
                                }}
                                title={t('suppliers_v2.create_brand_tooltip', 'Registrar nuevo fabricante OEM')}
                                aria-label={t('suppliers_v2.create_brand_tooltip', 'Registrar nuevo fabricante OEM')}
                                className={`${FLAT_ICON_BTN_CLS} min-w-[44px] min-h-[44px] text-[#C68346] hover:text-[#C68346]`}
                            >
                                <span className="material-symbols-outlined text-[24px]">add</span>
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {(loadingList || syncBusy) && <M3LinearProgress indeterminate tone="copper" />}

            {banner && (
                <div
                    className={`mx-fib-21 mt-fib-13 p-fib-13 border text-data-dense font-mono flex items-center justify-between gap-fib-13 shrink-0 ${
                        banner.kind === 'ok'
                            ? 'border-[#00AEEF] text-[#00AEEF]'
                            : 'border-[#C68346] text-[#C68346]'
                    } bg-[#F8FAFC] dark:bg-[#07090D]`}
                >
                    <span>{banner.msg}</span>
                    <button
                        type="button"
                        onClick={() => setBanner(null)}
                        aria-label={t('common.close', 'Cerrar')}
                        className={FLAT_ICON_BTN_CLS}
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-fib-13 sm:px-fib-21 py-fib-13">
                {filteredManufacturers.length === 0 && !loadingList ? (
                    <div className="py-fib-89 px-fib-21 text-center space-y-fib-8">
                        <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                            {t('suppliers_v2.no_manufacturers_found', 'No hay fabricantes registrados para este criterio.')}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {filteredManufacturers.map((mfg) => {
                            const verifiedMeta = [
                                mfg.hqCountryIso2 ? getCountryHeadingLabel(mfg.hqCountryIso2) : null,
                                extractDomainHost(mfg.officialWebsiteUrl),
                            ]
                                .filter(Boolean)
                                .join(' · ');
                            const eqCount = mfg.equipmentCount ?? 0;
                            const supCount = mfg.linkedSuppliersCount ?? 0;

                            return (
                                <button
                                    key={mfg.manufacturerKey}
                                    type="button"
                                    onClick={() => void openManufacturerDetail(mfg.manufacturerKey)}
                                    className="w-full text-left py-fib-13 px-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors flex items-center justify-between gap-fib-21 cursor-pointer"
                                >
                                    <div className="flex items-center gap-fib-21 min-w-0">
                                        <div className="w-[88px] sm:w-[116px] shrink-0 flex items-center">
                                            <ManufacturerLogoBadge
                                                make={mfg.officialName}
                                                recordOverride={mfg}
                                                variant="frameless"
                                                size="sm"
                                                showMonogramFallback={true}
                                                className="max-w-[84px] sm:max-w-[108px]"
                                            />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-h2-section font-semibold uppercase tracking-[-0.01em] text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                {mfg.officialName}
                                            </div>
                                            {verifiedMeta && (
                                                <div className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] mt-[2px] truncate">
                                                    {verifiedMeta}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-fib-21 shrink-0">
                                        <div className="hidden sm:flex items-center gap-fib-13 font-mono tabular-nums text-data-dense">
                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                {eqCount} {t('suppliers_v2.equipments_short', 'EQUIPOS')}
                                            </span>
                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">·</span>
                                            <span className={supCount > 0 ? 'text-[#00AEEF]' : 'text-[#475569] dark:text-[#8A93A6]'}>
                                                {supCount} {t('suppliers_v2.distributors_short', 'DISTRIBUIDORES')}
                                            </span>
                                        </div>
                                        <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072]">
                                            chevron_right
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {devMode && (
                <ManufacturerDevCuratorPanel
                    mode={devMode}
                    manufacturer={devTargetMfg}
                    onClose={() => setDevMode(null)}
                    onMutated={async (opts) => {
                        invalidateManufacturerLogoCache();
                        setDevMode(null);
                        if (opts?.message) {
                            setBanner({ kind: 'ok', msg: opts.message });
                        }
                        await loadManufacturers();
                        if (opts?.selectKey) {
                            await openManufacturerDetail(opts.selectKey);
                        }
                    }}
                    onError={(msg) => setBanner({ kind: 'err', msg })}
                />
            )}
        </div>
    );
};

export default ManufacturersDirectoryDashboard;
