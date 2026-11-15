import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import type { AssetPhysicalTraits } from '../../../contracts';
import { ManufacturerLogoBadge, useResolvedManufacturerName } from './ManufacturerLogoBadge';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { API_BASE_URL, db } from '../firebase/config';
import {
    type OpermaqDomainMode,
    resolveEffectiveOpermaqDomain,
    useOpermaqContext,
} from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildEquipmentShortDescription,
    groupEquipmentHierarchyByBrandAndType,
    MISSING_TECH_SPEC,
    PENDING_RECORD_SPEC,
    resolveModelWithinBrandLabel,
} from '../utils/opermaqDomainProjection';
import { M3CircularProgress } from './M3ProgressIndicator';
import { SecureCasThumbnail } from './SecureCasThumbnail';

export type { OpermaqDomainMode };
export type AssetListDomainMode = 'CATALOG' | 'FLEET';

interface CatalogListRow {
    id: string;
    make_oficial: string;
    model_oficial: string;
    tipo_equipo: string;
    categoria_equipo?: string;
    short_description: string;
    foto_url?: string;
    physical_traits?: AssetPhysicalTraits;
}

interface FleetListRow {
    id: string;
    tenant_id?: string;
    tenantId?: string;
    global_asset_id: string;
    make_oficial: string;
    model_oficial: string;
    version?: string;
    tipo_equipo: string;
    categoria_equipo?: string;
    short_description: string;
    serial_number: string;
    identifier_type?: string;
    identifier_value?: string;
    ownership_type?: string;
    foto_url?: string;
    primary_private_photo_url?: string | null;
    catalog_foto_url?: string | null;
    horometer?: number;
    odometer_km?: number;
    cycles_count?: number;
    calibration_due_date?: string;
    physical_traits?: AssetPhysicalTraits;
    archived?: boolean;
}

export interface AssetListProps {
    domainMode: AssetListDomainMode;
    onSelectCatalogAsset?: (globalAssetId: string) => void;
    onSelectFleetUnit?: (unit: { id: string; globalAssetId: string }) => void;
    /** Compatibilidad con llamadas previas */
    onSelectAsset?: (assetId: string) => void;
    onNew?: () => void;
    onAddNew?: () => void;
}

const BrandSectionHeader: React.FC<{ brandLabel: string }> = ({ brandLabel }) => {
    const displayBrand = useResolvedManufacturerName(brandLabel) || brandLabel;
    return (
        <div className="pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13">
            <ManufacturerLogoBadge make={brandLabel} variant="frameless" size="md" />
            <h2 className="font-sans text-h1-header font-semibold uppercase tracking-[-0.01em] leading-[1.25] text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                {displayBrand}
            </h2>
        </div>
    );
};

const SubgroupSectionHeader: React.FC<{ title: string; count: number }> = ({ title, count }) => (
    <div className="pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-baseline justify-between gap-fib-13">
        <h3 className="font-mono text-microcopy font-bold uppercase tracking-[0.05em] text-[#C68346] whitespace-normal break-words">
            {title}
        </h3>
        <span className="font-mono tabular-nums text-microcopy text-[#475569] dark:text-[#8A93A6] shrink-0">
            {count}
        </span>
    </div>
);

export const AssetList: React.FC<AssetListProps> = ({
    domainMode,
    onSelectCatalogAsset,
    onSelectFleetUnit,
    onSelectAsset,
    onNew,
    onAddNew,
}) => {
    const handleAddNew = onNew || onAddNew;
    const { t } = useTranslation();
    const { tenantId, capabilities, isEduSandbox } = useOpermaqContext();

    // Regla Soberana: El CATÁLOGO maestro es accesible en `1º DEV` / `2º ADMIN` / `3º TEST-PILOT`.
    const resolvedDomain = resolveEffectiveOpermaqDomain(domainMode, capabilities);
    const effectiveMode: AssetListDomainMode = resolvedDomain === 'CATALOG' ? 'CATALOG' : 'FLEET';

    const canRegister =
        effectiveMode === 'CATALOG'
            ? capabilities.canCurateAI
            : capabilities.canManageFleet || capabilities.canCurateAI;

    const [catalogRows, setCatalogRows] = useState<CatalogListRow[]>([]);
    const [fleetRows, setFleetRows] = useState<FleetListRow[]>([]);
    const [catalogLoading, setCatalogLoading] = useState<boolean>(effectiveMode === 'CATALOG');
    const [fleetLoading, setFleetLoading] = useState<boolean>(effectiveMode === 'FLEET');
    const [fleetError, setFleetError] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

    // Carga aislada de FLOTA (`tenant_assets`) — exclusivamente los equipos registrados por el usuario/cliente
    const loadTenantFleet = useCallback(async (activeTenantId: string) => {
        setFleetRows([]);
        setFleetError('');

        if (!activeTenantId) {
            setFleetLoading(false);
            return;
        }

        setFleetLoading(true);
        try {
            const response = await authFetch(`${API_BASE_URL}/assets/my-fleet`, {
                method: 'GET',
                headers: {
                    'X-Active-Account-Id': activeTenantId,
                },
            });

            if (response.ok) {
                const payload = await response.json();
                const rawItems: any[] = Array.isArray(payload?.items) ? payload.items : [];
                const scoped: FleetListRow[] = rawItems
                    .filter((item) => {
                        if (item.archived === true) return false;
                        const docTenant = item.tenant_id || item.tenantId || '';
                        return !docTenant || docTenant === activeTenantId;
                    })
                    .map((item) => ({
                        id: String(item.id),
                        tenant_id: item.tenant_id,
                        tenantId: item.tenantId,
                        global_asset_id: String(item.global_asset_id || item.globalAssetId || ''),
                        make_oficial: String(item.make_oficial || MISSING_TECH_SPEC),
                        model_oficial: String(item.model_oficial || ''),
                        version: item.version ? String(item.version) : undefined,
                        tipo_equipo: String(item.tipo_equipo || item.categoria_equipo || MISSING_TECH_SPEC),
                        categoria_equipo: item.categoria_equipo ? String(item.categoria_equipo) : undefined,
                        short_description: buildEquipmentShortDescription(item),
                        serial_number: String(
                            item.serial_number || item.identifier_value || PENDING_RECORD_SPEC
                        ),
                        identifier_type: item.identifier_type ? String(item.identifier_type) : undefined,
                        identifier_value: item.identifier_value ? String(item.identifier_value) : undefined,
                        ownership_type: item.ownership_type ? String(item.ownership_type) : undefined,
                        primary_private_photo_url: item.primary_private_photo_url || null,
                        catalog_foto_url: item.catalog_foto_url || null,
                        foto_url:
                            item.primary_private_photo_url ||
                            item.foto_url ||
                            item.catalog_foto_url ||
                            undefined,
                        horometer: typeof item.horometer === 'number' ? item.horometer : undefined,
                        odometer_km: typeof item.odometer_km === 'number' ? item.odometer_km : undefined,
                        cycles_count: typeof item.cycles_count === 'number' ? item.cycles_count : undefined,
                        calibration_due_date: item.calibration_due_date ? String(item.calibration_due_date) : undefined,
                        physical_traits: item.physical_traits || undefined,
                    }));

                setFleetRows(scoped);
                void syncQueueEngine.saveOfflineKnowledge(`opermaq_fleet_${activeTenantId}`, scoped);
                setFleetLoading(false);
                return;
            }
        } catch {
            // Fallback Offline-First / Firestore filtrado estrictamente por tenant_id y sandbox EDU
        }

        try {
            const fleetColName = isEduSandbox ? 'edu_sandbox_fleet' : 'tenant_assets';
            const bySnakeQ = query(
                collection(db, fleetColName),
                where('tenant_id', '==', activeTenantId)
            );
            const snapSnake = await getDocs(bySnakeQ);
            const map = new Map<string, FleetListRow>();

            const pushDoc = (docId: string, raw: Record<string, any>) => {
                if (raw.archived === true || map.has(docId)) return;
                map.set(docId, {
                    id: docId,
                    tenant_id: raw.tenant_id,
                    tenantId: raw.tenantId,
                    global_asset_id: String(raw.global_asset_id || raw.globalAssetId || ''),
                    make_oficial: String(raw.make_oficial || MISSING_TECH_SPEC),
                    model_oficial: String(raw.model_oficial || ''),
                    version: raw.version ? String(raw.version) : undefined,
                    tipo_equipo: String(raw.tipo_equipo || raw.categoria_equipo || MISSING_TECH_SPEC),
                    categoria_equipo: raw.categoria_equipo ? String(raw.categoria_equipo) : undefined,
                    short_description: buildEquipmentShortDescription(raw),
                    serial_number: String(
                        raw.serial_number || raw.identifier_value || PENDING_RECORD_SPEC
                    ),
                    identifier_type: raw.identifier_type ? String(raw.identifier_type) : undefined,
                    identifier_value: raw.identifier_value ? String(raw.identifier_value) : undefined,
                    ownership_type: raw.ownership_type ? String(raw.ownership_type) : undefined,
                    foto_url: raw.primary_private_photo_url || raw.foto_url || undefined,
                    horometer: typeof raw.horometer === 'number' ? raw.horometer : undefined,
                    odometer_km: typeof raw.odometer_km === 'number' ? raw.odometer_km : undefined,
                    cycles_count: typeof raw.cycles_count === 'number' ? raw.cycles_count : undefined,
                    calibration_due_date: raw.calibration_due_date ? String(raw.calibration_due_date) : undefined,
                    physical_traits: raw.physical_traits || undefined,
                });
            };

            snapSnake.forEach((docSnap) => pushDoc(docSnap.id, docSnap.data()));

            try {
                const byCamelQ = query(
                    collection(db, fleetColName),
                    where('tenantId', '==', activeTenantId)
                );
                const snapCamel = await getDocs(byCamelQ);
                snapCamel.forEach((docSnap) => pushDoc(docSnap.id, docSnap.data()));
            } catch {
                // Índice secundario camelCase opcional
            }

            const resolvedRows = Array.from(map.values());
            if (resolvedRows.length > 0) {
                setFleetRows(resolvedRows);
                void syncQueueEngine.saveOfflineKnowledge(`opermaq_fleet_${activeTenantId}`, resolvedRows);
            } else {
                const cachedOffline = await syncQueueEngine.getOfflineKnowledge<FleetListRow[]>(
                    `opermaq_fleet_${activeTenantId}`
                );
                setFleetRows(
                    Array.isArray(cachedOffline)
                        ? cachedOffline.map((row) => ({
                              ...row,
                              short_description: buildEquipmentShortDescription(row),
                          }))
                        : []
                );
            }
        } catch (err: unknown) {
            const cachedOffline = await syncQueueEngine
                .getOfflineKnowledge<FleetListRow[]>(`opermaq_fleet_${activeTenantId}`)
                .catch(() => null);
            if (Array.isArray(cachedOffline) && cachedOffline.length > 0) {
                setFleetRows(
                    cachedOffline.map((row) => ({
                        ...row,
                        short_description: buildEquipmentShortDescription(row),
                    }))
                );
            } else {
                setFleetRows([]);
                setFleetError(
                    err instanceof Error ? err.message : 'No fue posible consultar la flota activa.'
                );
            }
        } finally {
            setFleetLoading(false);
        }
    }, [isEduSandbox]);

    useEffect(() => {
        if (effectiveMode === 'FLEET') {
            void loadTenantFleet(tenantId);
        }
    }, [effectiveMode, tenantId, loadTenantFleet]);

    // Carga proyectada y en caché RAM del CATÁLOGO único (`GET /api/assets/catalog`) — cero lectura de colección completa en cliente
    useEffect(() => {
        if (effectiveMode !== 'CATALOG') {
            setCatalogRows([]);
            setCatalogLoading(false);
            return;
        }

        let cancelled = false;
        setCatalogLoading(true);

        const loadCatalogFromApi = async () => {
            try {
                const res = await authFetch(`${API_BASE_URL}/assets/catalog`, {
                    method: 'GET',
                });
                if (res.ok && !cancelled) {
                    const payload = await res.json().catch(() => ({}));
                    const rawItems: any[] = Array.isArray(payload?.items) ? payload.items : [];
                    const mapped: CatalogListRow[] = rawItems.map((item) => ({
                        id: String(item.id),
                        make_oficial: String(item.make_oficial || item.make || MISSING_TECH_SPEC),
                        model_oficial: String(item.model_oficial || item.model || ''),
                        tipo_equipo: String(
                            item.tipo_equipo || item.categoria_equipo || MISSING_TECH_SPEC
                        ),
                        categoria_equipo: item.categoria_equipo
                            ? String(item.categoria_equipo)
                            : undefined,
                        short_description: buildEquipmentShortDescription(item),
                        foto_url: item.foto_url ? String(item.foto_url) : undefined,
                        physical_traits: item.physical_traits || undefined,
                    }));
                    if (!cancelled) {
                        setCatalogRows(mapped);
                        void syncQueueEngine.saveOfflineKnowledge('opermaq_catalog_index_v3', mapped);
                        setCatalogLoading(false);
                    }
                    return;
                }
            } catch {
                // Fallback a caché local IndexedDB si se encuentra sin conexión
            }

            if (!cancelled) {
                const cachedCatalog = await syncQueueEngine
                    .getOfflineKnowledge<CatalogListRow[]>('opermaq_catalog_index_v3')
                    .catch(() => null);
                if (!cancelled) {
                    setCatalogRows(
                        Array.isArray(cachedCatalog)
                            ? cachedCatalog.map((row) => ({
                                  ...row,
                                  short_description: buildEquipmentShortDescription(row),
                              }))
                            : []
                    );
                    setCatalogLoading(false);
                }
            }
        };

        void loadCatalogFromApi();

        return () => {
            cancelled = true;
        };
    }, [effectiveMode]);

    const normalizedQuery = searchTerm.trim().toLowerCase();

    const groupedCatalog = useMemo(() => {
        const filtered = !normalizedQuery
            ? catalogRows
            : catalogRows.filter((row) =>
                [
                    row.make_oficial,
                    row.model_oficial,
                    row.tipo_equipo,
                    row.categoria_equipo,
                    row.short_description,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(normalizedQuery)
            );
        return groupEquipmentHierarchyByBrandAndType(filtered);
    }, [catalogRows, normalizedQuery]);

    const groupedFleet = useMemo(() => {
        const filtered = !normalizedQuery
            ? fleetRows
            : fleetRows.filter((row) =>
                [
                    row.make_oficial,
                    row.model_oficial,
                    row.tipo_equipo,
                    row.categoria_equipo,
                    row.short_description,
                    row.serial_number,
                    row.identifier_value,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(normalizedQuery)
            );
        return groupEquipmentHierarchyByBrandAndType(filtered);
    }, [fleetRows, normalizedQuery]);

    const totalVisibleCount =
        effectiveMode === 'CATALOG'
            ? groupedCatalog.reduce((acc, g) => acc + g.totalCount, 0)
            : groupedFleet.reduce((acc, g) => acc + g.totalCount, 0);

    const isLoading = effectiveMode === 'CATALOG' ? catalogLoading : fleetLoading;

    const handleCopySerial = async (e: React.MouseEvent, rowId: string, serialValue: string) => {
        e.stopPropagation();
        if (!serialValue || serialValue.startsWith('[')) return;
        try {
            await navigator.clipboard.writeText(serialValue);
            setCopiedRowId(rowId);
            window.setTimeout(() => {
                setCopiedRowId((prev) => (prev === rowId ? null : prev));
            }, 1500);
        } catch {
            // Ignorar si clipboard bloqueado
        }
    };

    const flatIconBtn =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none flex items-center justify-center';

    const renderConciseDescription = (shortDesc: string) => {
        const trimmed = String(shortDesc || '').trim();
        if (!trimmed || trimmed === MISSING_TECH_SPEC || trimmed.startsWith('[')) {
            return (
                <div className="mt-[2px] text-[0.8125rem] font-mono leading-[1.35] text-[#94A3B8] dark:text-[#5A6072]">
                    {trimmed || MISSING_TECH_SPEC}
                </div>
            );
        }

        const segments = trimmed
            .split(' · ')
            .map((seg) => seg.trim())
            .filter(Boolean);

        return (
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] mt-[2px] text-[0.8125rem] sm:text-[0.875rem] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6]">
                {segments.map((seg, idx) => (
                    <React.Fragment key={`${idx}-${seg}`}>
                        {idx > 0 && (
                            <span className="text-[#94A3B8] dark:text-[#5A6072]" aria-hidden="true">
                                ·
                            </span>
                        )}
                        <span className="whitespace-nowrap max-w-full truncate">{seg}</span>
                    </React.Fragment>
                ))}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none rounded-none shadow-none">
            {/* Única Barra Superior Minimalista (Cero Duplicación, Cero Botones con Texto Adosado) */}
            <header className="h-12 px-[13px] sm:px-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-[13px] sm:gap-[21px] shrink-0">
                <h1 className="text-[0.8125rem] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
                    {effectiveMode === 'CATALOG'
                        ? t('opermaq_domains.catalog_title')
                        : t('opermaq_domains.fleet_title')}
                </h1>

                <div className="flex items-center justify-end gap-[13px] flex-1 max-w-md">
                    <div className="relative flex-1 flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346] rounded-none">
                        <span className="material-symbols-outlined text-[16px] text-[#94A3B8] dark:text-[#5A6072]">
                            search
                        </span>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={
                                effectiveMode === 'CATALOG'
                                    ? t('opermaq_domains.search_catalog')
                                    : t('opermaq_domains.search_fleet')
                            }
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full h-8 px-[8px] bg-transparent text-[13px] font-sans text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] outline-none rounded-none select-text"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                title={t('registration.clear_search')}
                                aria-label={t('registration.clear_search')}
                                className={flatIconBtn}
                            >
                                <span className="material-symbols-outlined text-[15px]">close</span>
                            </button>
                        )}
                    </div>

                    {canRegister && handleAddNew && (
                        <button
                            id="btn-opermaq-add"
                            type="button"
                            onClick={handleAddNew}
                            title={
                                effectiveMode === 'CATALOG'
                                    ? t('opermaq_domains.register_catalog')
                                    : t('opermaq_domains.register_unit')
                            }
                            aria-label={
                                effectiveMode === 'CATALOG'
                                    ? t('opermaq_domains.register_catalog')
                                    : t('opermaq_domains.register_unit')
                            }
                            className="bg-transparent border-0 outline-none p-1 text-[#C68346] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-[22px]">add</span>
                        </button>
                    )}
                </div>
            </header>

            {/* Lista Limpia Ordenada por Marca y Tipo de Maquinaria (Cero Cajas, Cero Adornos) */}
            <div className="flex-1 overflow-y-auto px-[13px] sm:px-[21px] py-[21px]">
                {fleetError && effectiveMode === 'FLEET' && (
                    <div className="mb-[21px] py-[8px] border-b border-[#C68346] text-[0.8125rem] font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                        {fleetError}
                    </div>
                )}

                {isLoading ? (
                    <div className="h-56 flex items-center justify-center">
                        <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                    </div>
                ) : effectiveMode === 'FLEET' && !tenantId ? (
                    <div className="h-56 flex items-center justify-center text-[0.8125rem] font-mono text-[#475569] dark:text-[#8A93A6]">
                        {t('registration.error_select_tenant')}
                    </div>
                ) : totalVisibleCount === 0 ? (
                    <div className="h-56 flex items-center justify-center text-[0.8125rem] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        {effectiveMode === 'CATALOG'
                            ? t('opermaq_domains.empty_catalog')
                            : t('opermaq_domains.empty_fleet')}
                    </div>
                ) : effectiveMode === 'CATALOG' ? (
                    <div className="space-y-fib-55">
                        {groupedCatalog.map((brandGroup) => (
                            <section key={brandGroup.brandKey} className="rounded-none shadow-none">
                                <BrandSectionHeader brandLabel={brandGroup.brandLabel} />

                                <div className="mt-fib-21 space-y-fib-21">
                                    {brandGroup.subgroups.map((sub) => (
                                        <div key={sub.typeKey}>
                                            <SubgroupSectionHeader title={sub.machineryTypeLabel} count={sub.items.length} />

                                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                {sub.items.map((asset) => {
                                                    const modelLabel = resolveModelWithinBrandLabel(
                                                        asset.make_oficial,
                                                        asset.model_oficial
                                                    );
                                                    const fullAlt = `${asset.make_oficial} ${asset.model_oficial}`.trim();
                                                    return (
                                                        <div
                                                            key={asset.id}
                                                            onClick={() => {
                                                                if (onSelectCatalogAsset) onSelectCatalogAsset(asset.id);
                                                                else onSelectAsset?.(asset.id);
                                                            }}
                                                            className="py-fib-13 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors cursor-pointer flex items-start sm:items-center gap-fib-13 [content-visibility:auto]"
                                                        >
                                                            <SecureCasThumbnail
                                                                src={asset.foto_url}
                                                                alt={fullAlt}
                                                                fallbackIcon={
                                                                    asset.physical_traits?.material_symbol_icon ||
                                                                    'precision_manufacturing'
                                                                }
                                                                className="w-10 h-10 shrink-0"
                                                            />

                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-sans text-body-main font-semibold leading-snug text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                    {modelLabel}
                                                                </div>
                                                                {renderConciseDescription(asset.short_description)}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-fib-55">
                        {groupedFleet.map((brandGroup) => (
                            <section key={brandGroup.brandKey} className="rounded-none shadow-none">
                                <BrandSectionHeader brandLabel={brandGroup.brandLabel} />

                                <div className="mt-fib-21 space-y-fib-21">
                                    {brandGroup.subgroups.map((sub) => (
                                        <div key={sub.typeKey}>
                                            <SubgroupSectionHeader title={sub.machineryTypeLabel} count={sub.items.length} />

                                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                                {sub.items.map((unit) => {
                                                    const modelLabel = resolveModelWithinBrandLabel(
                                                        unit.make_oficial,
                                                        unit.model_oficial
                                                    );
                                                    const fullAlt = `${unit.make_oficial} ${unit.model_oficial}`.trim();
                                                    const ownerTenant = unit.tenant_id || unit.tenantId || tenantId;
                                                    return (
                                                        <div
                                                            key={unit.id}
                                                            onClick={() => {
                                                                if (onSelectFleetUnit) {
                                                                    onSelectFleetUnit({
                                                                        id: unit.id,
                                                                        globalAssetId: unit.global_asset_id,
                                                                    });
                                                                } else {
                                                                    onSelectAsset?.(unit.global_asset_id || unit.id);
                                                                }
                                                            }}
                                                            className="py-fib-13 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors cursor-pointer flex items-start sm:items-center gap-fib-13 [content-visibility:auto]"
                                                        >
                                                            <SecureCasThumbnail
                                                                src={unit.foto_url}
                                                                alt={fullAlt}
                                                                tenantId={ownerTenant}
                                                                fallbackIcon={
                                                                    unit.physical_traits?.material_symbol_icon ||
                                                                    'precision_manufacturing'
                                                                }
                                                                className="w-10 h-10 shrink-0"
                                                            />

                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex flex-wrap items-baseline gap-fib-8 min-w-0">
                                                                    <span className="font-sans text-body-main font-semibold leading-snug text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                                        {modelLabel}
                                                                    </span>
                                                                    {unit.version && unit.version !== 'ESTÁNDAR' && (
                                                                        <span className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                                                            {unit.version}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {/* Fila compacta móvil (< sm) para N° de Serie + Copia sin aplastar el título ni la descripción */}
                                                                <div
                                                                    className="flex sm:hidden items-center gap-fib-8 mt-[2px] min-w-0"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <span className="text-[0.8125rem] font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text truncate">
                                                                        {unit.serial_number}
                                                                    </span>

                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) =>
                                                                            void handleCopySerial(e, unit.id, unit.serial_number)
                                                                        }
                                                                        title={
                                                                            copiedRowId === unit.id
                                                                                ? t('opermaq_domains.copied')
                                                                                : t('opermaq_domains.copy_serial')
                                                                        }
                                                                        aria-label={t('opermaq_domains.copy_serial')}
                                                                        className={flatIconBtn}
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">
                                                                            {copiedRowId === unit.id ? 'check' : 'content_copy'}
                                                                        </span>
                                                                    </button>
                                                                </div>

                                                                {renderConciseDescription(unit.short_description)}
                                                            </div>

                                                            {/* Columna derecha escritorio/tablet (sm+): Número de Serie Acreditativo + Copia Plana */}
                                                            <div
                                                                className="hidden sm:flex items-center gap-fib-8 shrink-0"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <span className="text-[13px] font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                                    {unit.serial_number}
                                                                </span>

                                                                <button
                                                                    type="button"
                                                                    onClick={(e) =>
                                                                        void handleCopySerial(e, unit.id, unit.serial_number)
                                                                    }
                                                                    title={
                                                                        copiedRowId === unit.id
                                                                            ? t('opermaq_domains.copied')
                                                                            : t('opermaq_domains.copy_serial')
                                                                    }
                                                                    aria-label={t('opermaq_domains.copy_serial')}
                                                                    className={flatIconBtn}
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">
                                                                        {copiedRowId === unit.id ? 'check' : 'content_copy'}
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AssetList;
