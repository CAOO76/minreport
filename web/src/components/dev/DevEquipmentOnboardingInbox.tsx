import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { getApiUrl } from '../../utils/network';
import {
    PublishEquipmentOnboardingSchema,
    ReviewEquipmentOnboardingSchema,
    type EquipmentOnboardingResource,
} from '../../contracts';
import M3Switch from '../common/M3Switch';
import CopyButton from '../common/CopyButton';

const LBL = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const INP =
    'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-text';

interface DevOnboardingRequestItem {
    id: string;
    tenantId: string;
    accountId?: string;
    requestedByUid?: string;
    requestedByEmail?: string;
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

const M3LinearBar: React.FC<{ percent?: number; complete?: boolean; ariaLabel?: string }> = ({
    percent = 65,
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

async function resolveDevToken(): Promise<string> {
    if (auth.currentUser) {
        try {
            const fresh = await auth.currentUser.getIdToken();
            if (fresh) return fresh;
        } catch {
            // Continuar a localStorage
        }
    }
    if (typeof window !== 'undefined') {
        return localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token') || '';
    }
    return '';
}

function resolveApiResourceUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('blob:')) {
        return rawUrl;
    }
    if (rawUrl.startsWith('/api/')) {
        return getApiUrl(rawUrl);
    }
    return rawUrl;
}

function getCasTelemetryVars(
    originalBytes: number,
    optimizedBytes: number,
    savingsPct: number
): { origMb: string; casMb: string; pct: string } {
    const origMb = (Number(originalBytes || 0) / (1024 * 1024)).toFixed(2);
    const casMb = (Number(optimizedBytes || 0) / (1024 * 1024)).toFixed(2);
    const pct = Number(savingsPct || 0).toFixed(1);
    return { origMb, casMb, pct };
}

const devCasThumbCache = new Map<string, string>();

const DevCasProtectedThumbnail: React.FC<{
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

        const cacheKey = `dev:${tenantId}:${raw}`;
        const cached = devCasThumbCache.get(cacheKey);
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
                const token = await resolveDevToken();
                const headers: Record<string, string> = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                if (tenantId) headers['X-Active-Account-Id'] = tenantId;
                const res = await fetch(resolved, { method: 'GET', headers });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const objUrl = URL.createObjectURL(blob);
                devCasThumbCache.set(cacheKey, objUrl);
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
            const token = await resolveDevToken();
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            if (tenantId) headers['X-Active-Account-Id'] = tenantId;
            const res = await fetch(resolveApiResourceUrl(resource.downloadUrl), {
                method: 'GET',
                headers,
            });
            if (!res.ok) return;
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            window.open(objUrl, '_blank', 'noopener,noreferrer');
        } catch {
            // Silencioso
        }
    };

    if (isPdf) {
        const openPdfLabel = t('core_dev_eq_inbox.cas.open_pdf', { filename: resource.originalFilename });
        return (
            <div className="w-12 h-12 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center shrink-0 rounded-none shadow-none">
                <button
                    type="button"
                    onClick={() => void handleOpenPdf()}
                    title={openPdfLabel}
                    aria-label={openPdfLabel}
                    className="bg-transparent border-0 outline-none p-1 text-[#C68346] hover:text-[#00AEEF] transition-colors cursor-pointer"
                >
                    <span className="material-symbols-outlined text-[22px]">picture_as_pdf</span>
                </button>
            </div>
        );
    }

    return (
        <div className="w-12 h-12 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center overflow-hidden shrink-0 rounded-none shadow-none select-none">
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

function parseCsvList(raw: string): string[] {
    return raw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
}

export const DevEquipmentOnboardingInbox: React.FC = () => {
    const { t } = useTranslation();
    const [requests, setRequests] = useState<DevOnboardingRequestItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [selectedId, setSelectedId] = useState<string>('');

    // Modo de dictamen en panel derecho (38.2%)
    const [actionMode, setActionMode] = useState<'PUBLISH' | 'REVIEW'>('PUBLISH');

    // Campos de publicación en Catálogo Maestro
    const [existingGlobalAssetId, setExistingGlobalAssetId] = useState<string>('');
    const [makeOficial, setMakeOficial] = useState<string>('');
    const [modelOficial, setModelOficial] = useState<string>('');
    const [tipoEquipo, setTipoEquipo] = useState<string>('');
    const [categoriaEquipo, setCategoriaEquipo] = useState<string>('');
    const [version, setVersion] = useState<string>('ESTÁNDAR');
    const [ambienteInput, setAmbienteInput] = useState<string>('RAJO ABIERTO, ALTA MONTAÑA');
    const [contextoInput, setContextoInput] = useState<string>('EXTRACCIÓN, PRODUCCIÓN');
    const [caracteristicasInput, setCaracteristicasInput] = useState<string>(
        'ESTRUCTURA INDUSTRIAL, OPERACIÓN CONTINUA'
    );
    const [autoRegisterFleetUnit, setAutoRegisterFleetUnit] = useState<boolean>(true);
    const [publishReviewNotes, setPublishReviewNotes] = useState<string>('');

    // Campos de observación/rechazo
    const [reviewStatus, setReviewStatus] = useState<'NEEDS_INFO' | 'REJECTED'>('NEEDS_INFO');
    const [reviewNotes, setReviewNotes] = useState<string>('');

    // Confirmación HITL obligatoria ("ACTUALIZAR")
    const [confirmWord, setConfirmWord] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [actionFeedback, setActionFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
        null
    );

    const fetchInbox = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const token = await resolveDevToken();
            if (!token) {
                throw new Error(t('core_dev_eq_inbox.errors.token_missing'));
            }
            const querySuffix =
                statusFilter !== 'ALL' ? `?status=${encodeURIComponent(statusFilter)}` : '';
            const res = await fetch(getApiUrl(`/api/equipment-onboarding${querySuffix}`), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || t('core_dev_eq_inbox.errors.load_inbox_http', { status: res.status }));
            }
            const rows: DevOnboardingRequestItem[] = (
                Array.isArray(body?.requests) ? body.requests : []
            ).map((r: any) => ({
                ...r,
                id: String(r.id || r.requestId || ''),
                tenantId: String(r.tenantId || r.accountId || ''),
                resources: Array.isArray(r.resources) ? r.resources : [],
            }));
            setRequests(rows);
            setSelectedId((prev) => {
                if (prev && rows.some((item) => item.id === prev)) return prev;
                return rows[0]?.id || '';
            });
        } catch (err: any) {
            setLoadError(err?.message || t('core_dev_eq_inbox.errors.load_requests_failed'));
        } finally {
            setLoading(false);
        }
    }, [statusFilter, t]);

    useEffect(() => {
        void fetchInbox();
    }, [fetchInbox]);

    const selectedRequest = useMemo(
        () => requests.find((item) => item.id === selectedId) || null,
        [requests, selectedId]
    );

    useEffect(() => {
        if (!selectedRequest) return;
        setExistingGlobalAssetId(selectedRequest.publishedGlobalAssetId || '');
        setMakeOficial(selectedRequest.manufacturerRef || '');
        setModelOficial(selectedRequest.modelRef || '');
        setTipoEquipo(selectedRequest.equipmentCategory || '');
        setCategoriaEquipo(selectedRequest.equipmentCategory || '');
        setVersion(selectedRequest.versionOrSeries || 'ESTÁNDAR');
        setAutoRegisterFleetUnit(true);
        setPublishReviewNotes('');
        setReviewNotes('');
        setConfirmWord('');
        setActionFeedback(null);
    }, [selectedRequest?.id]);

    const handlePublish = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRequest) return;
        setActionFeedback(null);

        const rawPayload = {
            confirmationKeyword: confirmWord.trim(),
            existingGlobalAssetId: existingGlobalAssetId.trim(),
            makeOficial: makeOficial.trim(),
            modelOficial: modelOficial.trim(),
            tipoEquipo: tipoEquipo.trim(),
            categoriaEquipo: categoriaEquipo.trim(),
            version: version.trim() || 'ESTÁNDAR',
            ambienteOperativo: parseCsvList(ambienteInput),
            contextoOperativo: parseCsvList(contextoInput),
            caracteristicasPrincipales: parseCsvList(caracteristicasInput),
            autoRegisterFleetUnit,
            reviewNotes: publishReviewNotes.trim(),
        };

        const parsed = PublishEquipmentOnboardingSchema.safeParse(rawPayload);
        if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            setActionFeedback({
                type: 'err',
                text: `${firstIssue?.path?.join('.') || t('core_dev_eq_inbox.errors.curation_fallback_field')}: ${firstIssue?.message || t('core_dev_eq_inbox.errors.publish_validation_fallback')}`,
            });
            return;
        }

        setSubmitting(true);
        try {
            const token = await resolveDevToken();
            if (!token) throw new Error(t('core_dev_eq_inbox.errors.token_absent'));
            const res = await fetch(
                getApiUrl(`/api/equipment-onboarding/${encodeURIComponent(selectedRequest.id)}/publish`),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(parsed.data),
                }
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || t('core_dev_eq_inbox.errors.publish_http', { status: res.status }));
            }
            const publishedText = t('core_dev_eq_inbox.feedback.published_ok', {
                assetId: body?.publishedGlobalAssetId || 'OK',
            });
            const fleetSuffix = body?.publishedTenantAssetId
                ? ` · ${t('core_dev_eq_inbox.feedback.fleet_unit_suffix', { unitId: body.publishedTenantAssetId })}`
                : '';
            setActionFeedback({
                type: 'ok',
                text: `${publishedText}${fleetSuffix}`,
            });
            setConfirmWord('');
            await fetchInbox();
        } catch (err: any) {
            setActionFeedback({
                type: 'err',
                text: err?.message || t('core_dev_eq_inbox.errors.publish_failed'),
            });
        } finally {
            setSubmitting(false);
        }
    };

    const handleReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRequest) return;
        setActionFeedback(null);

        const rawPayload = {
            confirmationKeyword: confirmWord.trim(),
            status: reviewStatus,
            reviewNotes: reviewNotes.trim(),
        };

        const parsed = ReviewEquipmentOnboardingSchema.safeParse(rawPayload);
        if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            setActionFeedback({
                type: 'err',
                text: `${firstIssue?.path?.join('.') || t('core_dev_eq_inbox.errors.review_fallback_field')}: ${firstIssue?.message || t('core_dev_eq_inbox.errors.review_validation_fallback')}`,
            });
            return;
        }

        setSubmitting(true);
        try {
            const token = await resolveDevToken();
            if (!token) throw new Error(t('core_dev_eq_inbox.errors.token_absent'));
            const res = await fetch(
                getApiUrl(`/api/equipment-onboarding/${encodeURIComponent(selectedRequest.id)}/review`),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(parsed.data),
                }
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || t('core_dev_eq_inbox.errors.review_http', { status: res.status }));
            }
            setActionFeedback({
                type: 'ok',
                text: t('core_dev_eq_inbox.feedback.reviewed_ok', {
                    status: body?.status || reviewStatus,
                }),
            });
            setConfirmWord('');
            await fetchInbox();
        } catch (err: any) {
            setActionFeedback({
                type: 'err',
                text: err?.message || t('core_dev_eq_inbox.errors.review_failed'),
            });
        } finally {
            setSubmitting(false);
        }
    };

    const undeclaredValue = t('core_dev_eq_inbox.common.undeclared_tech_value');

    return (
        <div className="h-full w-full flex flex-col space-y-fib-21 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Barra de Filtro y Control */}
            <div className="flex flex-wrap items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                <div className="flex flex-wrap items-center gap-fib-8">
                    {(['ALL', 'PENDING_DEV_REVIEW', 'NEEDS_INFO', 'PUBLISHED', 'REJECTED'] as const).map(
                        (st) => (
                            <button
                                key={st}
                                type="button"
                                onClick={() => setStatusFilter(st)}
                                className={`px-fib-13 py-fib-8 text-microcopy font-mono uppercase border rounded-none shadow-none cursor-pointer transition-colors ${
                                    statusFilter === st
                                        ? 'border-[#C68346] bg-[#C68346] text-white'
                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#475569] dark:text-[#8A93A6] hover:border-[#C68346]'
                                }`}
                            >
                                {t(`core_dev_eq_inbox.status_filter.${st}`)}
                            </button>
                        )
                    )}
                </div>

                <div className="flex items-center gap-fib-13">
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {t('core_dev_eq_inbox.inbox.request_count', { count: requests.length })}
                    </span>
                    <button
                        type="button"
                        onClick={() => void fetchInbox()}
                        title={t('core_dev_eq_inbox.inbox.reload_title')}
                        aria-label={t('core_dev_eq_inbox.inbox.reload_title')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>
            </div>

            {/* Macro-Layout Proporción Áurea: 61.8% Bandeja / 38.2% Curación HITL */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start flex-1 min-h-0">
                {/* PANEL IZQUIERDO (61.8%) — BANDEJA DE SOLICITUDES */}
                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('core_dev_eq_inbox.inbox.panel_heading')}
                        </h2>
                    </div>

                    {loading && (
                        <div className="p-fib-21 space-y-fib-8">
                            <M3LinearBar percent={65} ariaLabel={t('core_dev_eq_inbox.inbox.loading_progress_aria')} />
                            <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('core_dev_eq_inbox.inbox.loading_msg')}
                            </p>
                        </div>
                    )}

                    {loadError && !loading && (
                        <div className="p-fib-21 text-data-dense font-mono text-red-600 dark:text-red-400">
                            {loadError}
                        </div>
                    )}

                    {!loading && requests.length === 0 && !loadError && (
                        <div className="p-fib-34 text-center">
                            <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {undeclaredValue}
                            </p>
                        </div>
                    )}

                    {!loading && requests.length > 0 && (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {requests.map((item) => {
                                const isSelected = item.id === selectedId;
                                const totalOrig = Number(
                                    item.totalOriginalBytes ??
                                        item.resources.reduce((acc, r) => acc + Number(r.originalBytes || 0), 0)
                                );
                                const totalOpt = Number(
                                    item.totalOptimizedBytes ??
                                        item.resources.reduce((acc, r) => acc + Number(r.optimizedBytes || 0), 0)
                                );
                                const totalPct =
                                    typeof item.totalSavingsPct === 'number'
                                        ? item.totalSavingsPct
                                        : totalOrig > 0
                                            ? Math.max(0, Math.round(((totalOrig - totalOpt) / totalOrig) * 1000) / 10)
                                            : 0;

                                return (
                                    <article
                                        key={item.id}
                                        onClick={() => setSelectedId(item.id)}
                                        className={`p-fib-21 space-y-fib-13 cursor-pointer transition-colors border-l-2 ${
                                            isSelected
                                                ? 'border-l-[#C68346] bg-[#FFFFFF] dark:bg-[#000000]'
                                                : 'border-l-transparent hover:bg-[#FFFFFF]/70 dark:hover:bg-[#000000]/50'
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-fib-8">
                                            <div>
                                                <div className="flex items-center gap-fib-8 flex-wrap">
                                                    <h3 className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {item.manufacturerRef} {item.modelRef}
                                                    </h3>
                                                    <span
                                                        className={`text-microcopy font-mono uppercase ${
                                                            item.status === 'PUBLISHED'
                                                                ? 'text-[#00AEEF]'
                                                                : item.status === 'REJECTED'
                                                                    ? 'text-red-500'
                                                                    : 'text-[#C68346]'
                                                        }`}
                                                    >
                                                        [{t(`core_dev_eq_inbox.status.${item.status}`, { defaultValue: item.status })}]
                                                    </span>
                                                </div>
                                                <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                                    {item.equipmentCategory}
                                                    {item.versionOrSeries ? ` · ${item.versionOrSeries}` : ''}
                                                    {` · ${t('core_dev_eq_inbox.inbox.tenant_prefix')}: ${item.tenantId}`}
                                                </p>
                                                <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_dev_eq_inbox.inbox.requester_label')} {item.requestedByEmail || undeclaredValue}
                                                    {item.unitIdentifierValue
                                                        ? ` · ${item.unitIdentifierType || t('core_dev_eq_inbox.inbox.default_id_label')}: ${item.unitIdentifierValue}`
                                                        : ''}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                <span className="select-text">{item.id}</span>
                                                <CopyButton value={item.id} title={t('core_dev_eq_inbox.inbox.copy_request_id')} />
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-fib-8 text-microcopy font-mono tabular-nums border-y border-[#E2E8F0] dark:border-[#12151C] py-fib-8">
                                            <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {t('core_dev_eq_inbox.cas.telemetry', getCasTelemetryVars(totalOrig, totalOpt, totalPct))}
                                            </span>
                                            {item.publishedGlobalAssetId && (
                                                <span className="inline-flex items-center gap-1 text-[#00AEEF]">
                                                    <span className="select-text">{item.publishedGlobalAssetId}</span>
                                                    <CopyButton
                                                        value={item.publishedGlobalAssetId}
                                                        title={t('core_dev_eq_inbox.inbox.copy_catalog_id')}
                                                    />
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                            {item.operationalNotes || undeclaredValue}
                                        </p>

                                        {item.resources.length > 0 && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-8">
                                                {item.resources.map((resItem, idx) => (
                                                    <div
                                                        key={`${resItem.sha256}_${idx}`}
                                                        className="flex items-center gap-fib-8 p-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]"
                                                    >
                                                        <DevCasProtectedThumbnail
                                                            resource={resItem}
                                                            tenantId={item.tenantId}
                                                        />
                                                        <div className="min-w-0 flex-1 font-mono">
                                                            <p className="text-microcopy text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                                {resItem.originalFilename}
                                                            </p>
                                                            <p className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                                {t(`core_dev_eq_inbox.resource_kind.${resItem.kind}`, { defaultValue: resItem.kind })}
                                                            </p>
                                                            <p className="text-microcopy text-[#00AEEF] tabular-nums">
                                                                {t(
                                                                    'core_dev_eq_inbox.cas.telemetry',
                                                                    getCasTelemetryVars(
                                                                        resItem.originalBytes,
                                                                        resItem.optimizedBytes,
                                                                        resItem.savingsPct
                                                                    )
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

                {/* PANEL DERECHO (38.2%) — CURACIÓN Y DICTAMEN DEV */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                            {t('core_dev_eq_inbox.curation.panel_heading')}
                        </h2>
                    </div>

                    {!selectedRequest ? (
                        <div className="p-fib-21">
                            <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {undeclaredValue} — {t('core_dev_eq_inbox.curation.select_prompt')}
                            </p>
                        </div>
                    ) : (
                        <div className="p-fib-21 space-y-fib-13">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 space-y-1">
                                <div className="flex items-center justify-between text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                    <span className="select-text">{selectedRequest.id}</span>
                                    <CopyButton value={selectedRequest.id} title={t('core_dev_eq_inbox.inbox.copy_request_id')} />
                                </div>
                                <p className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {selectedRequest.manufacturerRef} {selectedRequest.modelRef}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-fib-8">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActionMode('PUBLISH');
                                        setActionFeedback(null);
                                    }}
                                    className={`py-fib-8 px-fib-8 text-microcopy font-mono uppercase border rounded-none shadow-none cursor-pointer transition-colors ${
                                        actionMode === 'PUBLISH'
                                            ? 'border-[#C68346] bg-[#C68346] text-white'
                                            : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    {t('core_dev_eq_inbox.curation.mode_publish')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActionMode('REVIEW');
                                        setActionFeedback(null);
                                    }}
                                    className={`py-fib-8 px-fib-8 text-microcopy font-mono uppercase border rounded-none shadow-none cursor-pointer transition-colors ${
                                        actionMode === 'REVIEW'
                                            ? 'border-[#C68346] bg-[#C68346] text-white'
                                            : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    {t('core_dev_eq_inbox.curation.mode_review')}
                                </button>
                            </div>

                            {actionMode === 'PUBLISH' ? (
                                <form
                                    onSubmit={handlePublish}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="space-y-fib-13"
                                >
                                    <div>
                                        <label htmlFor="dev-eq-existing-global-id" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.existing_global_id_label')}
                                        </label>
                                        <input
                                            id="dev-eq-existing-global-id"
                                            type="text"
                                            aria-label={t('core_dev_eq_inbox.curation.existing_global_id_label')}
                                            value={existingGlobalAssetId}
                                            onChange={(e) => setExistingGlobalAssetId(e.target.value)}
                                            placeholder={t('core_dev_eq_inbox.curation.existing_global_id_placeholder')}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                        <div>
                                            <label htmlFor="dev-eq-make-oficial" className={LBL}>
                                                {t('core_dev_eq_inbox.curation.make_label')}
                                            </label>
                                            <input
                                                id="dev-eq-make-oficial"
                                                type="text"
                                                required
                                                minLength={2}
                                                aria-label={t('core_dev_eq_inbox.curation.make_label')}
                                                value={makeOficial}
                                                onChange={(e) => setMakeOficial(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={INP}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="dev-eq-model-oficial" className={LBL}>
                                                {t('core_dev_eq_inbox.curation.model_label')}
                                            </label>
                                            <input
                                                id="dev-eq-model-oficial"
                                                type="text"
                                                required
                                                minLength={1}
                                                aria-label={t('core_dev_eq_inbox.curation.model_label')}
                                                value={modelOficial}
                                                onChange={(e) => setModelOficial(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={INP}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                        <div>
                                            <label htmlFor="dev-eq-tipo-equipo" className={LBL}>
                                                {t('core_dev_eq_inbox.curation.type_label')}
                                            </label>
                                            <input
                                                id="dev-eq-tipo-equipo"
                                                type="text"
                                                required
                                                minLength={3}
                                                aria-label={t('core_dev_eq_inbox.curation.type_label')}
                                                value={tipoEquipo}
                                                onChange={(e) => setTipoEquipo(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={INP}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="dev-eq-categoria-equipo" className={LBL}>
                                                {t('core_dev_eq_inbox.curation.category_label')}
                                            </label>
                                            <input
                                                id="dev-eq-categoria-equipo"
                                                type="text"
                                                required
                                                minLength={3}
                                                aria-label={t('core_dev_eq_inbox.curation.category_label')}
                                                value={categoriaEquipo}
                                                onChange={(e) => setCategoriaEquipo(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={INP}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-version" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.version_label')}
                                        </label>
                                        <input
                                            id="dev-eq-version"
                                            type="text"
                                            required
                                            aria-label={t('core_dev_eq_inbox.curation.version_label')}
                                            value={version}
                                            onChange={(e) => setVersion(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-ambiente" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.environment_label')}
                                        </label>
                                        <input
                                            id="dev-eq-ambiente"
                                            type="text"
                                            required
                                            aria-label={t('core_dev_eq_inbox.curation.environment_label')}
                                            value={ambienteInput}
                                            onChange={(e) => setAmbienteInput(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-contexto" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.context_label')}
                                        </label>
                                        <input
                                            id="dev-eq-contexto"
                                            type="text"
                                            required
                                            aria-label={t('core_dev_eq_inbox.curation.context_label')}
                                            value={contextoInput}
                                            onChange={(e) => setContextoInput(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-caracteristicas" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.features_label')}
                                        </label>
                                        <textarea
                                            id="dev-eq-caracteristicas"
                                            rows={2}
                                            required
                                            aria-label={t('core_dev_eq_inbox.curation.features_label')}
                                            value={caracteristicasInput}
                                            onChange={(e) => setCaracteristicasInput(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                        <span className="text-microcopy font-mono uppercase">
                                            {t('core_dev_eq_inbox.curation.auto_register_fleet_label')}
                                        </span>
                                        <M3Switch
                                            checked={autoRegisterFleetUnit}
                                            onChange={setAutoRegisterFleetUnit}
                                            aria-label={t('core_dev_eq_inbox.curation.aria_auto_register_fleet')}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-publish-notes" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.publish_notes_label')}
                                        </label>
                                        <textarea
                                            id="dev-eq-publish-notes"
                                            rows={2}
                                            aria-label={t('core_dev_eq_inbox.curation.publish_notes_label')}
                                            value={publishReviewNotes}
                                            onChange={(e) => setPublishReviewNotes(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    {actionFeedback && (
                                        <p
                                            className={`text-data-dense font-mono ${
                                                actionFeedback.type === 'ok'
                                                    ? 'text-[#00AEEF]'
                                                    : 'text-red-600 dark:text-red-400'
                                            }`}
                                        >
                                            {actionFeedback.text}
                                        </p>
                                    )}

                                    {submitting && <M3LinearBar percent={76} ariaLabel={t('core_dev_eq_inbox.curation.submitting_progress_aria')} />}

                                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                        <label htmlFor="dev-eq-confirm-publish" className={LBL}>
                                            {t('core_dev_eq_inbox.curation.hitl_publish_prefix')}{' '}
                                            <span className="text-[#C68346]">ACTUALIZAR</span>{' '}
                                            {t('core_dev_eq_inbox.curation.hitl_publish_suffix')}
                                        </label>
                                        <input
                                            id="dev-eq-confirm-publish"
                                            type="text"
                                            aria-label={t('core_dev_eq_inbox.curation.hitl_publish_aria')}
                                            value={confirmWord}
                                            onChange={(e) => setConfirmWord(e.target.value)}
                                            placeholder="ACTUALIZAR"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                        <button
                                            type="submit"
                                            disabled={submitting || confirmWord.trim() !== 'ACTUALIZAR'}
                                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {submitting
                                                ? t('core_dev_eq_inbox.curation.publishing')
                                                : t('core_dev_eq_inbox.curation.publish_submit')}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form
                                    onSubmit={handleReview}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="space-y-fib-13"
                                >
                                    <div>
                                        <label htmlFor="dev-eq-review-status" className={LBL}>
                                            {t('core_dev_eq_inbox.review.verdict_label')}
                                        </label>
                                        <select
                                            id="dev-eq-review-status"
                                            aria-label={t('core_dev_eq_inbox.review.verdict_label')}
                                            value={reviewStatus}
                                            onChange={(e) =>
                                                setReviewStatus(e.target.value as 'NEEDS_INFO' | 'REJECTED')
                                            }
                                            className={INP}
                                        >
                                            <option value="NEEDS_INFO">{t('core_dev_eq_inbox.review.option_needs_info')}</option>
                                            <option value="REJECTED">{t('core_dev_eq_inbox.review.option_rejected')}</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label htmlFor="dev-eq-review-notes" className={LBL}>
                                            {t('core_dev_eq_inbox.review.notes_label')}
                                        </label>
                                        <textarea
                                            id="dev-eq-review-notes"
                                            rows={4}
                                            required
                                            minLength={5}
                                            aria-label={t('core_dev_eq_inbox.review.notes_label')}
                                            value={reviewNotes}
                                            onChange={(e) => setReviewNotes(e.target.value)}
                                            placeholder={t('core_dev_eq_inbox.review.notes_placeholder')}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                    </div>

                                    {actionFeedback && (
                                        <p
                                            className={`text-data-dense font-mono ${
                                                actionFeedback.type === 'ok'
                                                    ? 'text-[#00AEEF]'
                                                    : 'text-red-600 dark:text-red-400'
                                            }`}
                                        >
                                            {actionFeedback.text}
                                        </p>
                                    )}

                                    {submitting && <M3LinearBar percent={76} ariaLabel={t('core_dev_eq_inbox.curation.submitting_progress_aria')} />}

                                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                        <label htmlFor="dev-eq-confirm-review" className={LBL}>
                                            {t('core_dev_eq_inbox.review.hitl_review_prefix')}{' '}
                                            <span className="text-[#C68346]">ACTUALIZAR</span>{' '}
                                            {t('core_dev_eq_inbox.review.hitl_review_suffix')}
                                        </label>
                                        <input
                                            id="dev-eq-confirm-review"
                                            type="text"
                                            aria-label={t('core_dev_eq_inbox.review.hitl_review_aria')}
                                            value={confirmWord}
                                            onChange={(e) => setConfirmWord(e.target.value)}
                                            placeholder="ACTUALIZAR"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={INP}
                                        />
                                        <button
                                            type="submit"
                                            disabled={submitting || confirmWord.trim() !== 'ACTUALIZAR'}
                                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {submitting
                                                ? t('core_dev_eq_inbox.review.submitting')
                                                : t('core_dev_eq_inbox.review.submit')}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default DevEquipmentOnboardingInbox;
