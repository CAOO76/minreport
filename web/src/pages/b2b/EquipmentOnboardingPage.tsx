import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { getApiUrl } from '../../utils/network';
import { mediaDigestorClient } from '../../core/media/MediaDigestorClient';
import {
    CreateEquipmentOnboardingRequestSchema,
    type EquipmentOnboardingResource,
    type EquipmentOnboardingResourceKind,
} from '../../contracts';
import type { MediaDigestionProfile } from '../../contracts/media.contracts';
import CopyButton from '../../components/common/CopyButton';

const LBL = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const INP =
    'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-text';

interface EquipmentOnboardingRecord {
    id: string;
    tenantId: string;
    manufacturerRef: string;
    modelRef: string;
    equipmentCategory: string;
    versionOrSeries?: string;
    unitIdentifierType?: string;
    unitIdentifierValue?: string;
    ownershipType?: string;
    horometer?: number;
    operationalNotes?: string;
    status: 'PENDING_DEV_REVIEW' | 'NEEDS_INFO' | 'PUBLISHED' | 'REJECTED' | string;
    reviewNotes?: string;
    publishedGlobalAssetId?: string;
    publishedTenantAssetId?: string;
    totalOriginalBytes?: number;
    totalOptimizedBytes?: number;
    totalSavingsPct?: number;
    resources: EquipmentOnboardingResource[];
    createdAt?: number | string;
    updatedAt?: number | string;
}

const RESOURCE_KIND_KEYS: EquipmentOnboardingResourceKind[] = [
    'UNIT_PHOTO',
    'NAMEPLATE_PHOTO',
    'DIAGRAM_IMAGE',
    'TECHNICAL_MANUAL_PDF',
    'DATASHEET_PDF',
];

const M3LinearBar: React.FC<{ percent?: number; complete?: boolean; ariaLabel?: string }> = ({
    percent = 60,
    complete = false,
    ariaLabel,
}) => {
    const clamped = Math.max(8, Math.min(100, percent));
    return (
        <div
            className="w-full h-[4px] flex items-center gap-[4px]"
            role="progressbar"
            aria-label={ariaLabel}
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-full transition-all duration-300 ${complete ? 'bg-[#00AEEF]' : 'bg-[#C68346]'}`}
                style={{ width: `${clamped}%` }}
            />
            {clamped < 100 && (
                <div className="flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] relative flex justify-end items-center">
                    <span className="w-[4px] h-[4px] bg-[#C68346] block shrink-0" />
                </div>
            )}
        </div>
    );
};

function formatCasTelemetry(
    originalBytes: number,
    optimizedBytes: number,
    savingsPct: number
): string {
    const origMb = (Number(originalBytes || 0) / (1024 * 1024)).toFixed(2);
    const casMb = (Number(optimizedBytes || 0) / (1024 * 1024)).toFixed(2);
    const pct = Number(savingsPct || 0).toFixed(1);
    return `ORIG: ${origMb} MB -> CAS: ${casMb} MB (-${pct}%)`;
}

async function getAuthHeaders(tenantId?: string): Promise<Record<string, string>> {
    let token = '';
    if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
    } else if (typeof window !== 'undefined') {
        token = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token') || '';
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tenantId) headers['X-Active-Account-Id'] = tenantId;
    return headers;
}

function resolveApiResourceUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    if (
        rawUrl.startsWith('http://') ||
        rawUrl.startsWith('https://') ||
        rawUrl.startsWith('blob:')
    ) {
        return rawUrl;
    }
    if (rawUrl.startsWith('/api/')) {
        return getApiUrl(rawUrl);
    }
    return rawUrl;
}

const casThumbCache = new Map<string, string>();

const CasProtectedThumbnail: React.FC<{
    resource: EquipmentOnboardingResource;
    tenantId: string;
}> = ({ resource, tenantId }) => {
    const { t } = useTranslation();
    const [imgUrl, setImgUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState<boolean>(false);

    const isPdf =
        resource.mimeType.toLowerCase().includes('pdf') ||
        resource.extension.toLowerCase() === 'pdf';

    useEffect(() => {
        if (isPdf || !resource.downloadUrl) return;
        let active = true;
        setFailed(false);

        const raw = resource.downloadUrl.trim();
        if (raw.startsWith('data:') || raw.includes(';base64,')) {
            setFailed(true);
            return;
        }

        const cacheKey = `${tenantId}:${raw}`;
        const cached = casThumbCache.get(cacheKey);
        if (cached) {
            setImgUrl(cached);
            return;
        }

        const needsAuthFetch =
            raw.includes('/api/media/blob/tenant/') || raw.includes('/api/media/cas/');
        const resolved = resolveApiResourceUrl(raw);

        if (!needsAuthFetch) {
            setImgUrl(resolved);
            return;
        }

        (async () => {
            try {
                const headers = await getAuthHeaders(tenantId);
                const res = await fetch(resolved, { method: 'GET', headers });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const objUrl = URL.createObjectURL(blob);
                casThumbCache.set(cacheKey, objUrl);
                if (active) setImgUrl(objUrl);
            } catch {
                if (active) {
                    setFailed(true);
                    setImgUrl(null);
                }
            }
        })();

        return () => {
            active = false;
        };
    }, [isPdf, resource.downloadUrl, tenantId]);

    const handleOpenPdf = async () => {
        try {
            const headers = await getAuthHeaders(tenantId);
            const res = await fetch(resolveApiResourceUrl(resource.downloadUrl), {
                method: 'GET',
                headers,
            });
            if (!res.ok) return;
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            window.open(objUrl, '_blank', 'noopener,noreferrer');
        } catch {
            // Silencioso si no hay red
        }
    };

    if (isPdf) {
        return (
            <div className="w-14 h-14 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center shrink-0 rounded-none shadow-none">
                <button
                    type="button"
                    onClick={() => void handleOpenPdf()}
                    title={t('core_equipment_req.open_file', { filename: resource.originalFilename })}
                    aria-label={t('core_equipment_req.open_file', { filename: resource.originalFilename })}
                    className="bg-transparent border-0 outline-none p-1 text-[#C68346] hover:text-[#00AEEF] transition-colors cursor-pointer"
                >
                    <span className="material-symbols-outlined text-[24px]">picture_as_pdf</span>
                </button>
            </div>
        );
    }

    return (
        <div className="w-14 h-14 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center overflow-hidden shrink-0 rounded-none shadow-none select-none">
            {imgUrl && !failed ? (
                <img
                    src={imgUrl}
                    alt={resource.originalFilename}
                    loading="lazy"
                    draggable={false}
                    onError={() => setFailed(true)}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                    className="w-full h-full object-cover select-none pointer-events-none"
                />
            ) : (
                <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072] select-none pointer-events-none">
                    precision_manufacturing
                </span>
            )}
        </div>
    );
};

export const EquipmentOnboardingPage: React.FC = () => {
    const { t } = useTranslation();
    const undeclaredLabel = t(
        'core_equipment_req.undeclared',
        '[Información técnica no declarada en ficha]'
    );
    const { currentAccount } = useAuth();

    const [requests, setRequests] = useState<EquipmentOnboardingRecord[]>([]);
    const [loadingList, setLoadingList] = useState<boolean>(true);
    const [listError, setListError] = useState<string | null>(null);

    // Formulario de Solicitud de Equipo Nuevo
    const [manufacturerRef, setManufacturerRef] = useState<string>('');
    const [modelRef, setModelRef] = useState<string>('');
    const [equipmentCategory, setEquipmentCategory] = useState<string>('');
    const [versionOrSeries, setVersionOrSeries] = useState<string>('');
    const [unitIdentifierType, setUnitIdentifierType] = useState<
        'SERIE_CHASSIS' | 'PATENTE_PPU' | 'CODIGO_INTERNO'
    >('CODIGO_INTERNO');
    const [unitIdentifierValue, setUnitIdentifierValue] = useState<string>('');
    const [ownershipType, setOwnershipType] = useState<'PROPIO' | 'ARRENDADO' | 'CONTRATISTA'>('PROPIO');
    const [horometer, setHorometer] = useState<string>('0');
    const [operationalNotes, setOperationalNotes] = useState<string>('');

    // Digestión CAS de recursos
    const [selectedKind, setSelectedKind] = useState<EquipmentOnboardingResourceKind>('UNIT_PHOTO');
    const [stagedResources, setStagedResources] = useState<EquipmentOnboardingResource[]>([]);
    const [digestingFiles, setDigestingFiles] = useState<boolean>(false);
    const [digestProgressPct, setDigestProgressPct] = useState<number>(0);
    const [digestError, setDigestError] = useState<string | null>(null);

    // Envío de solicitud
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
    const [duplicateMatch, setDuplicateMatch] = useState<{
        message: string;
        globalAssetId: string;
    } | null>(null);

    const fetchRequests = useCallback(async () => {
        if (!currentAccount?.id) {
            setRequests([]);
            setLoadingList(false);
            return;
        }
        setLoadingList(true);
        setListError(null);
        try {
            const headers = await getAuthHeaders(currentAccount.id);
            const url = getApiUrl(
                `/api/equipment-onboarding?accountId=${encodeURIComponent(currentAccount.id)}`
            );
            const res = await fetch(url, { method: 'GET', headers });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    body?.error || t('core_equipment_req.err_http_load', { status: res.status })
                );
            }
            const items = Array.isArray(body?.requests) ? body.requests : [];
            setRequests(
                items.map((item: any) => ({
                    ...item,
                    id: String(item.id || item.requestId || ''),
                    resources: Array.isArray(item.resources) ? item.resources : [],
                }))
            );
        } catch (err: any) {
            setListError(err?.message || t('core_equipment_req.err_load_list'));
        } finally {
            setLoadingList(false);
        }
    }, [currentAccount?.id, t]);

    useEffect(() => {
        void fetchRequests();
    }, [fetchRequests]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0 || !currentAccount?.id) return;

        setDigestError(null);
        setDigestingFiles(true);
        setDigestProgressPct(10);

        const files = Array.from(fileList);
        const remainingSlots = Math.max(0, 12 - stagedResources.length);
        const batch = files.slice(0, remainingSlots);

        try {
            const uploaded: EquipmentOnboardingResource[] = [];
            for (let idx = 0; idx < batch.length; idx++) {
                const file = batch[idx];
                const mime = (file.type || '').toLowerCase();
                const nameLower = file.name.toLowerCase();
                const isPdf = mime.includes('pdf') || nameLower.endsWith('.pdf');

                let resolvedKind: EquipmentOnboardingResourceKind = selectedKind;
                let profile: MediaDigestionProfile = 'IMAGE_FIELD_EVIDENCE';

                if (isPdf) {
                    profile = 'PDF_HYBRID_OEM';
                    if (selectedKind !== 'TECHNICAL_MANUAL_PDF' && selectedKind !== 'DATASHEET_PDF') {
                        resolvedKind = 'TECHNICAL_MANUAL_PDF';
                    }
                } else {
                    if (selectedKind === 'TECHNICAL_MANUAL_PDF' || selectedKind === 'DATASHEET_PDF') {
                        resolvedKind = 'UNIT_PHOTO';
                    }
                    profile =
                        resolvedKind === 'NAMEPLATE_PHOTO' || resolvedKind === 'DIAGRAM_IMAGE'
                            ? 'IMAGE_TECHNICAL_HD'
                            : 'IMAGE_FIELD_EVIDENCE';
                }

                const { descriptor } = await mediaDigestorClient.digestAndUploadCas(file, {
                    scope: 'TENANT_PRIVATE',
                    tenantId: currentAccount.id,
                    profile,
                });

                if (
                    !descriptor.downloadUrl ||
                    descriptor.downloadUrl.startsWith('data:') ||
                    descriptor.downloadUrl.startsWith('blob:') ||
                    descriptor.downloadUrl.includes(';base64,')
                ) {
                    throw new Error(
                        t('core_equipment_req.err_cas_online_required', { filename: file.name })
                    );
                }

                const savingsPct = Math.round(descriptor.savingsRatio * 1000) / 10;

                uploaded.push({
                    sha256: descriptor.sha256,
                    kind: resolvedKind,
                    mimeType: descriptor.mimeType,
                    extension: descriptor.extension,
                    originalFilename: descriptor.originalFilename || file.name,
                    downloadUrl: descriptor.downloadUrl,
                    originalBytes: Math.max(1, descriptor.originalBytes),
                    optimizedBytes: Math.max(1, descriptor.optimizedBytes),
                    savingsPct,
                });

                setDigestProgressPct(Math.round(((idx + 1) / batch.length) * 100));
            }

            setStagedResources((prev) => [...prev, ...uploaded].slice(0, 12));
        } catch (err: any) {
            setDigestError(err?.message || t('core_equipment_req.err_digest'));
        } finally {
            setDigestingFiles(false);
            e.target.value = '';
        }
    };

    const handleRemoveStaged = (idx: number) => {
        setStagedResources((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleKindUpdate = (idx: number, nextKind: EquipmentOnboardingResourceKind) => {
        setStagedResources((prev) =>
            prev.map((item, i) => (i === idx ? { ...item, kind: nextKind } : item))
        );
    };

    const handleSubmitRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount?.id) return;

        setSubmitError(null);
        setSubmitSuccess(null);
        setDuplicateMatch(null);

        const rawPayload = {
            accountId: currentAccount.id,
            manufacturerRef: manufacturerRef.trim(),
            modelRef: modelRef.trim(),
            equipmentCategory: equipmentCategory.trim(),
            versionOrSeries: versionOrSeries.trim(),
            unitIdentifierType,
            unitIdentifierValue: unitIdentifierValue.trim(),
            ownershipType,
            horometer: Math.max(0, Number(horometer) || 0),
            operationalNotes: operationalNotes.trim(),
            resources: stagedResources,
        };

        const parsed = CreateEquipmentOnboardingRequestSchema.safeParse(rawPayload);
        if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            setSubmitError(
                `${firstIssue?.path?.join('.') || t('core_equipment_req.request_fallback')}: ${firstIssue?.message || t('core_equipment_req.err_incomplete_data')}`
            );
            return;
        }

        setSubmitting(true);
        try {
            const headers = await getAuthHeaders(currentAccount.id);
            const res = await fetch(getApiUrl('/api/equipment-onboarding'), {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(parsed.data),
            });

            const body = await res.json().catch(() => ({}));

            if (res.status === 409 && body?.alreadyInCatalog) {
                setDuplicateMatch({
                    message: body?.error || t('core_equipment_req.err_duplicate_catalog'),
                    globalAssetId: String(body?.globalAssetId || ''),
                });
                return;
            }

            if (!res.ok) {
                throw new Error(
                    body?.error || t('core_equipment_req.err_http_submit', { status: res.status })
                );
            }

            setSubmitSuccess(
                t('core_equipment_req.msg_submit_success', {
                    id: body?.requestId || t('core_equipment_req.registered_fallback'),
                })
            );
            setManufacturerRef('');
            setModelRef('');
            setEquipmentCategory('');
            setVersionOrSeries('');
            setUnitIdentifierValue('');
            setHorometer('0');
            setOperationalNotes('');
            setStagedResources([]);
            await fetchRequests();
        } catch (err: any) {
            setSubmitError(err?.message || t('core_equipment_req.err_submit'));
        } finally {
            setSubmitting(false);
        }
    };

    const statusBadgeClass = (status: string): string => {
        switch (status) {
            case 'PUBLISHED':
                return 'text-[#00AEEF]';
            case 'PENDING_DEV_REVIEW':
                return 'text-[#C68346]';
            case 'NEEDS_INFO':
                return 'text-[#C68346]';
            case 'REJECTED':
                return 'text-red-500';
            default:
                return 'text-[#475569] dark:text-[#8A93A6]';
        }
    };

    if (!currentAccount) return null;

    return (
        <div className="max-w-7xl mx-auto py-fib-21 px-fib-13 sm:px-fib-21 space-y-fib-21 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        {t('core_equipment_req.header_kicker')}
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_equipment_req.header_title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        {t('core_equipment_req.header_subtitle')}
                    </p>
                </div>

                <div className="flex items-center gap-fib-13">
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                        {t('core_equipment_req.tenant_prefix')}: {currentAccount.id}
                    </span>
                    <button
                        type="button"
                        onClick={() => void fetchRequests()}
                        title={t('core_equipment_req.btn_refresh')}
                        aria-label={t('core_equipment_req.btn_refresh')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>
            </header>

            {/* Macro-Layout Proporción Áurea: 61.8% Listado / 38.2% Formulario */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                {/* PANEL IZQUIERDO (61.8%) — HISTORIAL DE SOLICITUDES */}
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('core_equipment_req.list_title')}
                        </h2>
                        <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            {t('core_equipment_req.records_count', { count: requests.length })}
                        </span>
                    </div>

                    {loadingList && (
                        <div className="p-fib-21 space-y-fib-8">
                            <M3LinearBar percent={62} ariaLabel={t('core_equipment_req.loading_aria')} />
                            <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('core_equipment_req.loading_list')}
                            </p>
                        </div>
                    )}

                    {listError && !loadingList && (
                        <div className="p-fib-21 text-data-dense font-mono text-red-600 dark:text-red-400">
                            {listError}
                        </div>
                    )}

                    {!loadingList && requests.length === 0 && !listError && (
                        <div className="p-fib-34 text-center">
                            <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {undeclaredLabel}
                            </p>
                        </div>
                    )}

                    {!loadingList && requests.length > 0 && (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {requests.map((reqItem) => {
                                const totalOrig = Number(
                                    reqItem.totalOriginalBytes ??
                                        reqItem.resources.reduce((acc, r) => acc + Number(r.originalBytes || 0), 0)
                                );
                                const totalOpt = Number(
                                    reqItem.totalOptimizedBytes ??
                                        reqItem.resources.reduce((acc, r) => acc + Number(r.optimizedBytes || 0), 0)
                                );
                                const totalPct =
                                    typeof reqItem.totalSavingsPct === 'number'
                                        ? reqItem.totalSavingsPct
                                        : totalOrig > 0
                                            ? Math.max(0, Math.round(((totalOrig - totalOpt) / totalOrig) * 1000) / 10)
                                            : 0;

                                return (
                                    <article key={reqItem.id} className="p-fib-21 space-y-fib-13">
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-fib-8">
                                            <div>
                                                <div className="flex items-center gap-fib-8 flex-wrap">
                                                    <h3 className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {reqItem.manufacturerRef} {reqItem.modelRef}
                                                    </h3>
                                                    <span className={`text-microcopy font-mono uppercase ${statusBadgeClass(reqItem.status)}`}>
                                                        [{t(`core_equipment_req.statuses.${reqItem.status}`, reqItem.status)}]
                                                    </span>
                                                </div>
                                                <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                                    {reqItem.equipmentCategory}
                                                    {reqItem.versionOrSeries ? ` · ${reqItem.versionOrSeries}` : ''}
                                                    {reqItem.unitIdentifierValue
                                                        ? ` · ${reqItem.unitIdentifierType ? t(`core_equipment_req.id_types.${reqItem.unitIdentifierType}`, reqItem.unitIdentifierType) : 'ID'}: ${reqItem.unitIdentifierValue}`
                                                        : ''}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                <span className="select-text">{reqItem.id}</span>
                                                <CopyButton value={reqItem.id} title={t('core_equipment_req.copy_request_id')} />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13 text-data-dense font-mono tabular-nums border-y border-[#E2E8F0] dark:border-[#12151C] py-fib-8">
                                            <div>
                                                <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] block">
                                                    {t('core_equipment_req.label_cas_agg')}
                                                </span>
                                                <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {formatCasTelemetry(totalOrig, totalOpt, totalPct)}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] block">
                                                    {t('core_equipment_req.label_published_id')}
                                                </span>
                                                {reqItem.publishedGlobalAssetId ? (
                                                    <div className="flex items-center gap-1 text-[#00AEEF]">
                                                        <span className="select-text">{reqItem.publishedGlobalAssetId}</span>
                                                        <CopyButton
                                                            value={reqItem.publishedGlobalAssetId}
                                                            title={t('core_equipment_req.copy_catalog_id')}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                        {undeclaredLabel}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] block mb-fib-8">
                                                {t('core_equipment_req.label_review_notes')}
                                            </span>
                                            <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                                {reqItem.reviewNotes || undeclaredLabel}
                                            </p>
                                        </div>

                                        {reqItem.resources.length > 0 && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-8">
                                                {reqItem.resources.map((resItem, rIdx) => (
                                                    <div
                                                        key={`${resItem.sha256}_${rIdx}`}
                                                        className="flex items-center gap-fib-13 p-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]"
                                                    >
                                                        <CasProtectedThumbnail
                                                            resource={resItem}
                                                            tenantId={reqItem.tenantId || currentAccount.id}
                                                        />
                                                        <div className="min-w-0 flex-1 font-mono">
                                                            <p className="text-microcopy text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                                {resItem.originalFilename}
                                                            </p>
                                                            <p className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                                {t(`core_equipment_req.kinds.${resItem.kind}`, resItem.kind)}
                                                            </p>
                                                            <p className="text-microcopy text-[#00AEEF] tabular-nums">
                                                                {formatCasTelemetry(
                                                                    resItem.originalBytes,
                                                                    resItem.optimizedBytes,
                                                                    resItem.savingsPct
                                                                )}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* PANEL DERECHO (38.2%) — FORMULARIO SOLICITUD NUEVO EQUIPO */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                            {t('core_equipment_req.form_title')}
                        </h2>
                    </div>

                    <form
                        onSubmit={handleSubmitRequest}
                        autoComplete="off"
                        spellCheck={false}
                        className="p-fib-21 space-y-fib-13"
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div>
                                <label htmlFor="eq_req_manufacturer" className={LBL}>
                                    {t('core_equipment_req.label_manufacturer')}
                                </label>
                                <input
                                    id="eq_req_manufacturer"
                                    type="text"
                                    required
                                    minLength={2}
                                    value={manufacturerRef}
                                    onChange={(e) => setManufacturerRef(e.target.value)}
                                    placeholder={t('core_equipment_req.ph_manufacturer')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                            <div>
                                <label htmlFor="eq_req_model" className={LBL}>
                                    {t('core_equipment_req.label_model')}
                                </label>
                                <input
                                    id="eq_req_model"
                                    type="text"
                                    required
                                    minLength={1}
                                    value={modelRef}
                                    onChange={(e) => setModelRef(e.target.value)}
                                    placeholder={t('core_equipment_req.ph_model')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div>
                                <label htmlFor="eq_req_category" className={LBL}>
                                    {t('core_equipment_req.label_category')}
                                </label>
                                <input
                                    id="eq_req_category"
                                    type="text"
                                    required
                                    minLength={2}
                                    value={equipmentCategory}
                                    onChange={(e) => setEquipmentCategory(e.target.value)}
                                    placeholder={t('core_equipment_req.ph_category')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                            <div>
                                <label htmlFor="eq_req_version" className={LBL}>
                                    {t('core_equipment_req.label_version')}
                                </label>
                                <input
                                    id="eq_req_version"
                                    type="text"
                                    value={versionOrSeries}
                                    onChange={(e) => setVersionOrSeries(e.target.value)}
                                    placeholder={t('core_equipment_req.ph_version')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div>
                                <label htmlFor="eq_req_id_type" className={LBL}>
                                    {t('core_equipment_req.label_id_type')}
                                </label>
                                <select
                                    id="eq_req_id_type"
                                    value={unitIdentifierType}
                                    onChange={(e) =>
                                        setUnitIdentifierType(
                                            e.target.value as 'SERIE_CHASSIS' | 'PATENTE_PPU' | 'CODIGO_INTERNO'
                                        )
                                    }
                                    className={INP}
                                >
                                    <option value="CODIGO_INTERNO">{t('core_equipment_req.id_types.CODIGO_INTERNO')}</option>
                                    <option value="SERIE_CHASSIS">{t('core_equipment_req.id_types.SERIE_CHASSIS')}</option>
                                    <option value="PATENTE_PPU">{t('core_equipment_req.id_types.PATENTE_PPU')}</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="eq_req_id_value" className={LBL}>
                                    {t('core_equipment_req.label_id_value')}
                                </label>
                                <input
                                    id="eq_req_id_value"
                                    type="text"
                                    value={unitIdentifierValue}
                                    onChange={(e) => setUnitIdentifierValue(e.target.value)}
                                    placeholder={t('core_equipment_req.ph_id_value')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div>
                                <label htmlFor="eq_req_ownership" className={LBL}>
                                    {t('core_equipment_req.label_ownership')}
                                </label>
                                <select
                                    id="eq_req_ownership"
                                    value={ownershipType}
                                    onChange={(e) =>
                                        setOwnershipType(
                                            e.target.value as 'PROPIO' | 'ARRENDADO' | 'CONTRATISTA'
                                        )
                                    }
                                    className={INP}
                                >
                                    <option value="PROPIO">{t('core_equipment_req.ownership_types.PROPIO')}</option>
                                    <option value="ARRENDADO">{t('core_equipment_req.ownership_types.ARRENDADO')}</option>
                                    <option value="CONTRATISTA">{t('core_equipment_req.ownership_types.CONTRATISTA')}</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="eq_req_horometer" className={LBL}>
                                    {t('core_equipment_req.label_horometer')}
                                </label>
                                <input
                                    id="eq_req_horometer"
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    value={horometer}
                                    onChange={(e) => setHorometer(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${INP} tabular-nums`}
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="eq_req_notes" className={LBL}>
                                {t('core_equipment_req.label_notes')}
                            </label>
                            <textarea
                                id="eq_req_notes"
                                rows={2}
                                value={operationalNotes}
                                onChange={(e) => setOperationalNotes(e.target.value)}
                                placeholder={t('core_equipment_req.ph_notes')}
                                autoComplete="off"
                                spellCheck={false}
                                className={INP}
                            />
                        </div>

                        {/* DIGESTOR CAS OBLIGATORIO */}
                        <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                            <span className={LBL}>{t('core_equipment_req.label_cas_section')}</span>

                            <div>
                                <label htmlFor="eq_req_resource_kind" className={LBL}>
                                    {t('core_equipment_req.label_resource_kind')}
                                </label>
                                <select
                                    id="eq_req_resource_kind"
                                    value={selectedKind}
                                    onChange={(e) =>
                                        setSelectedKind(e.target.value as EquipmentOnboardingResourceKind)
                                    }
                                    className={INP}
                                >
                                    {RESOURCE_KIND_KEYS.map((k) => (
                                        <option key={k} value={k}>
                                            {t(`core_equipment_req.kinds.${k}`, k)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <label
                                htmlFor="eq_req_file_input"
                                className="block border border-dashed border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] p-fib-13 text-center cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors"
                            >
                                <span className="material-symbols-outlined text-[20px] text-[#C68346] block mb-1">
                                    upload_file
                                </span>
                                <span className="text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] block">
                                    {t('core_equipment_req.dropzone_title')}
                                </span>
                                <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] block mt-0.5">
                                    {t('core_equipment_req.dropzone_subtitle')}
                                </span>
                                <input
                                    id="eq_req_file_input"
                                    type="file"
                                    multiple
                                    accept="image/*,.pdf,application/pdf"
                                    aria-label={t('core_equipment_req.file_input_aria')}
                                    disabled={digestingFiles || stagedResources.length >= 12}
                                    onChange={handleFileChange}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="hidden"
                                />
                            </label>

                            {digestingFiles && (
                                <div className="space-y-fib-8">
                                    <M3LinearBar
                                        percent={digestProgressPct}
                                        ariaLabel={t('core_equipment_req.digesting_aria')}
                                    />
                                    <p className="text-microcopy font-mono uppercase text-[#C68346]">
                                        {t('core_equipment_req.digesting_msg', { pct: digestProgressPct })}
                                    </p>
                                </div>
                            )}

                            {digestError && (
                                <p className="text-data-dense font-mono text-red-600 dark:text-red-400">
                                    {digestError}
                                </p>
                            )}

                            {stagedResources.length > 0 && (
                                <div className="space-y-fib-8">
                                    {stagedResources.map((item, idx) => (
                                        <div
                                            key={`${item.sha256}_${idx}`}
                                            className="flex items-center gap-fib-8 p-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]"
                                        >
                                            <CasProtectedThumbnail
                                                resource={item}
                                                tenantId={currentAccount.id}
                                            />
                                            <div className="min-w-0 flex-1 font-mono space-y-1">
                                                <p className="text-microcopy text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                    {item.originalFilename}
                                                </p>
                                                <select
                                                    value={item.kind}
                                                    aria-label={t('core_equipment_req.aria_staged_kind', {
                                                        filename: item.originalFilename,
                                                    })}
                                                    onChange={(e) =>
                                                        handleKindUpdate(
                                                            idx,
                                                            e.target.value as EquipmentOnboardingResourceKind
                                                        )
                                                    }
                                                    className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] px-1 py-0.5 text-microcopy font-mono rounded-none"
                                                >
                                                    {RESOURCE_KIND_KEYS.filter((k) => {
                                                        const isPdf =
                                                            item.mimeType.toLowerCase().includes('pdf') ||
                                                            item.extension.toLowerCase() === 'pdf';
                                                        const isPdfKind =
                                                            k === 'TECHNICAL_MANUAL_PDF' || k === 'DATASHEET_PDF';
                                                        return isPdf ? isPdfKind : !isPdfKind;
                                                    }).map((k) => (
                                                        <option key={k} value={k}>
                                                            {t(`core_equipment_req.kinds.${k}`, k)}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-microcopy text-[#00AEEF] tabular-nums">
                                                    {formatCasTelemetry(
                                                        item.originalBytes,
                                                        item.optimizedBytes,
                                                        item.savingsPct
                                                    )}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveStaged(idx)}
                                                title={t('core_equipment_req.btn_remove_file')}
                                                aria-label={t('core_equipment_req.btn_remove_file')}
                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {duplicateMatch && (
                            <div className="p-fib-13 border border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] space-y-fib-8">
                                <p className="text-microcopy font-mono uppercase text-[#C68346]">
                                    {t('core_equipment_req.duplicate_title')}
                                </p>
                                <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                                    {duplicateMatch.message}
                                </p>
                                {duplicateMatch.globalAssetId && (
                                    <div className="flex items-center justify-between border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-8 font-mono text-data-dense">
                                        <span className="text-[#00AEEF] select-text">
                                            {duplicateMatch.globalAssetId}
                                        </span>
                                        <CopyButton
                                            value={duplicateMatch.globalAssetId}
                                            title={t('core_equipment_req.copy_global_asset_id')}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {submitError && (
                            <p className="text-data-dense font-mono text-red-600 dark:text-red-400">
                                {submitError}
                            </p>
                        )}

                        {submitSuccess && (
                            <p className="text-data-dense font-mono text-[#00AEEF]">{submitSuccess}</p>
                        )}

                        {submitting && <M3LinearBar percent={72} ariaLabel={t('core_equipment_req.submitting_aria')} />}

                        <button
                            type="submit"
                            disabled={submitting || digestingFiles || stagedResources.length === 0}
                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {submitting ? t('core_equipment_req.btn_submitting') : t('core_equipment_req.btn_submit')}
                        </button>
                    </form>
                </aside>
            </div>
        </div>
    );
};

export default EquipmentOnboardingPage;
