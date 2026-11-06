import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL, db } from '../firebase/config';
import {
    type OpermaqDomainMode,
    resolveEffectiveOpermaqDomain,
    useOpermaqContext,
} from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import {
    buildEquipmentShortDescription,
    groupEquipmentByBrandAndType,
    MISSING_TECH_SPEC,
    PENDING_RECORD_SPEC,
} from '../utils/opermaqDomainProjection';
import { CatalogHomologationHitlModal } from './CatalogHomologationHitlModal';
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
    pendingContributionsCount?: number;
    onOpenContributions?: () => void;
}

export const AssetList: React.FC<AssetListProps> = ({
    domainMode,
    onSelectCatalogAsset,
    onSelectFleetUnit,
    onSelectAsset,
    onNew,
    onAddNew,
    pendingContributionsCount = 0,
    onOpenContributions,
}) => {
    const handleAddNew = onNew || onAddNew;
    const { t } = useTranslation();
    const { tenantId, capabilities } = useOpermaqContext();

    // Regla Soberana: El CATÁLOGO maestro solo es accesible en `DEV` / `ADMIN` / `TEST-PILOT` (`canCurateAI`).
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
    const [homologatingAsset, setHomologatingAsset] = useState<CatalogListRow | null>(null);

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
                    }));

                setFleetRows(scoped);
                setFleetLoading(false);
                return;
            }
        } catch {
            // Fallback directo a Cloud Firestore filtrado estrictamente por tenant_id
        }

        try {
            const bySnakeQ = query(
                collection(db, 'tenant_assets'),
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
                });
            };

            snapSnake.forEach((docSnap) => pushDoc(docSnap.id, docSnap.data()));

            try {
                const byCamelQ = query(
                    collection(db, 'tenant_assets'),
                    where('tenantId', '==', activeTenantId)
                );
                const snapCamel = await getDocs(byCamelQ);
                snapCamel.forEach((docSnap) => pushDoc(docSnap.id, docSnap.data()));
            } catch {
                // Índice secundario camelCase opcional
            }

            setFleetRows(Array.from(map.values()));
        } catch (err: unknown) {
            setFleetRows([]);
            setFleetError(
                err instanceof Error ? err.message : 'No fue posible consultar la flota activa.'
            );
        } finally {
            setFleetLoading(false);
        }
    }, []);

    useEffect(() => {
        if (effectiveMode === 'FLEET') {
            void loadTenantFleet(tenantId);
        }
    }, [effectiveMode, tenantId, loadTenantFleet]);

    // Carga resiliente + suscripción en tiempo real al CATÁLOGO único (`global_asset_catalog`)
    useEffect(() => {
        if (effectiveMode !== 'CATALOG') {
            setCatalogRows([]);
            setCatalogLoading(false);
            return;
        }

        let cancelled = false;
        let hasRealtimeSnapshot = false;
        setCatalogLoading(true);

        const loadCatalogFromApi = async () => {
            try {
                const res = await authFetch(`${API_BASE_URL}/assets/catalog`, {
                    method: 'GET',
                });
                if (!res.ok || cancelled || hasRealtimeSnapshot) return;
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
                }));
                if (!cancelled && !hasRealtimeSnapshot) {
                    setCatalogRows(mapped);
                    setCatalogLoading(false);
                }
            } catch {
                // Silencioso: `onSnapshot` permanece como fuente primaria cuando Firebase Auth está activo
            }
        };

        void loadCatalogFromApi();

        const q = query(collection(db, 'global_asset_catalog'));
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                if (cancelled) return;
                hasRealtimeSnapshot = true;
                const list: CatalogListRow[] = [];
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (data.archived === true) return;
                    const makeOficial = String(data.make_oficial || data.make || MISSING_TECH_SPEC);
                    const modelOficial = String(data.model_oficial || data.model || '');
                    list.push({
                        id: docSnap.id,
                        make_oficial: makeOficial,
                        model_oficial: modelOficial,
                        tipo_equipo: String(
                            data.tipo_equipo || data.categoria_equipo || MISSING_TECH_SPEC
                        ),
                        categoria_equipo: data.categoria_equipo ? String(data.categoria_equipo) : undefined,
                        short_description: buildEquipmentShortDescription(data),
                        foto_url: data.foto_url ? String(data.foto_url) : undefined,
                    });
                });
                setCatalogRows(list);
                setCatalogLoading(false);
            },
            () => {
                if (!cancelled) {
                    setCatalogLoading(false);
                }
            }
        );

        return () => {
            cancelled = true;
            unsubscribe();
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
        return groupEquipmentByBrandAndType(filtered);
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
        return groupEquipmentByBrandAndType(filtered);
    }, [fleetRows, normalizedQuery]);

    const totalVisibleCount =
        effectiveMode === 'CATALOG'
            ? groupedCatalog.reduce((acc, g) => acc + g.items.length, 0)
            : groupedFleet.reduce((acc, g) => acc + g.items.length, 0);

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

    return (
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none rounded-none shadow-none">
            {/* Única Barra Superior Minimalista (Cero Duplicación, Cero Botones con Texto Adosado) */}
            <header className="h-12 px-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-[21px] shrink-0">
                <h1 className="text-[12px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
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

                    {effectiveMode === 'CATALOG' && capabilities.canCurateAI && onOpenContributions && (
                        <button
                            id="nav-contributions-queue"
                            type="button"
                            onClick={onOpenContributions}
                            title={t('opermaq_domains.hitl_queue_title')}
                            aria-label={t('opermaq_domains.hitl_queue_title')}
                            className={`${flatIconBtn} relative`}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                fact_check
                            </span>
                            {pendingContributionsCount > 0 && (
                                <span className="ml-0.5 text-[10px] font-mono tabular-nums font-bold text-[#00AEEF]">
                                    {pendingContributionsCount}
                                </span>
                            )}
                        </button>
                    )}

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
            <div className="flex-1 overflow-y-auto px-[21px] py-[21px]">
                {fleetError && effectiveMode === 'FLEET' && (
                    <div className="mb-[21px] py-[8px] border-b border-[#C68346] text-[12px] font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                        {fleetError}
                    </div>
                )}

                {isLoading ? (
                    <div className="h-56 flex items-center justify-center">
                        <span className="material-symbols-outlined animate-spin text-[24px] text-[#C68346]">
                            progress_activity
                        </span>
                    </div>
                ) : effectiveMode === 'FLEET' && !tenantId ? (
                    <div className="h-56 flex items-center justify-center text-[12px] font-mono text-[#475569] dark:text-[#8A93A6]">
                        {t('registration.error_select_tenant')}
                    </div>
                ) : totalVisibleCount === 0 ? (
                    <div className="h-56 flex items-center justify-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        {effectiveMode === 'CATALOG'
                            ? t('opermaq_domains.empty_catalog')
                            : t('opermaq_domains.empty_fleet')}
                    </div>
                ) : effectiveMode === 'CATALOG' ? (
                    <div className="space-y-[34px]">
                        {groupedCatalog.map((group) => (
                            <section key={group.groupKey} className="rounded-none shadow-none">
                                <div className="pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center gap-[8px] text-[11px] font-mono font-bold uppercase tracking-[0.05em]">
                                    <span className="text-[#C68346]">{group.brandLabel}</span>
                                    <span className="text-[#94A3B8] dark:text-[#5A6072]">·</span>
                                    <span className="text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                        {group.machineryTypeLabel}
                                    </span>
                                </div>

                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {group.items.map((asset) => {
                                        const officialName = `${asset.make_oficial} ${asset.model_oficial}`.trim();
                                        return (
                                            <div
                                                key={asset.id}
                                                onClick={() => {
                                                    if (onSelectCatalogAsset) onSelectCatalogAsset(asset.id);
                                                    else onSelectAsset?.(asset.id);
                                                }}
                                                className="py-[13px] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors cursor-pointer flex items-start sm:items-center gap-[13px] [content-visibility:auto]"
                                            >
                                                <SecureCasThumbnail
                                                    src={asset.foto_url}
                                                    alt={officialName}
                                                    fallbackIcon="front_loader"
                                                    className="w-10 h-10 shrink-0"
                                                />

                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[15px] font-semibold leading-snug text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                        {officialName}
                                                    </div>
                                                    <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                        {asset.short_description}
                                                    </div>
                                                </div>

                                                {capabilities.canCurateAI && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setHomologatingAsset(asset);
                                                        }}
                                                        title={t('opermaq_domains.homologate_btn_title')}
                                                        aria-label={t('opermaq_domains.homologate_btn_title')}
                                                        className={`${flatIconBtn} shrink-0`}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">
                                                            edit
                                                        </span>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-[34px]">
                        {groupedFleet.map((group) => (
                            <section key={group.groupKey} className="rounded-none shadow-none">
                                <div className="pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center gap-[8px] text-[11px] font-mono font-bold uppercase tracking-[0.05em]">
                                    <span className="text-[#C68346]">{group.brandLabel}</span>
                                    <span className="text-[#94A3B8] dark:text-[#5A6072]">·</span>
                                    <span className="text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                        {group.machineryTypeLabel}
                                    </span>
                                </div>

                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {group.items.map((unit) => {
                                        const officialName = `${unit.make_oficial} ${unit.model_oficial}`.trim();
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
                                                className="py-[13px] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors cursor-pointer flex items-start sm:items-center gap-[13px] [content-visibility:auto]"
                                            >
                                                <SecureCasThumbnail
                                                    src={unit.foto_url}
                                                    alt={officialName}
                                                    tenantId={ownerTenant}
                                                    fallbackIcon="front_loader"
                                                    className="w-10 h-10 shrink-0"
                                                />

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-baseline gap-[8px] min-w-0">
                                                        <span className="text-[15px] font-semibold leading-snug text-[#0F172A] dark:text-[#F3F4F6] whitespace-normal break-words">
                                                            {officialName}
                                                        </span>
                                                        {unit.version && unit.version !== 'ESTÁNDAR' && (
                                                            <span className="text-[11px] font-mono text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                                                {unit.version}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[13px] font-mono tabular-nums leading-[1.35] text-[#475569] dark:text-[#8A93A6] whitespace-normal break-words">
                                                        {unit.short_description}
                                                    </div>
                                                </div>

                                                {/* Número de Serie Acreditativo + Copia Plana */}
                                                <div
                                                    className="flex items-center gap-[8px] shrink-0"
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
                            </section>
                        ))}
                    </div>
                )}
            </div>

            {homologatingAsset && (
                <CatalogHomologationHitlModal
                    assetId={homologatingAsset.id}
                    makeOficial={homologatingAsset.make_oficial}
                    modelOficial={homologatingAsset.model_oficial}
                    onClose={() => setHomologatingAsset(null)}
                    onConsolidated={(updated) => {
                        setCatalogRows((prev) =>
                            prev.map((row) =>
                                row.id === updated.id
                                    ? {
                                          ...row,
                                          tipo_equipo: updated.tipo_equipo || row.tipo_equipo,
                                          short_description: updated.short_description,
                                      }
                                    : row
                            )
                        );
                        setHomologatingAsset(null);
                    }}
                />
            )}
        </div>
    );
};

export default AssetList;
