import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import type { PillarId } from '../types/vault';
import { authFetch } from '../utils/authFetch';
import { cleanMachineryTypeLabel } from '../utils/opermaqDomainProjection';
import { SecureCasThumbnail } from './SecureCasThumbnail';

interface FleetUnitWorkspaceProps {
    tenantAssetId: string;
    globalAssetId: string;
    onBack: () => void;
}

interface PrivatePhotoRecord {
    sha256: string;
    url: string;
    caption?: string;
    width?: number;
    height?: number;
    uploadedAt?: string;
}

interface FleetUnitDetail {
    id: string;
    global_asset_id: string;
    make_oficial?: string;
    model_oficial?: string;
    make_model?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    short_description?: string;
    version?: string;
    identifier_type?: string;
    identifier_value?: string;
    serial_number: string;
    ownership_type?: string;
    horometer?: number;
    tenant_id?: string;
    tenantId?: string;
    private_photos: PrivatePhotoRecord[];
}

interface PublishedPillarItem {
    item_id: string;
    order: number;
    title: string;
    section: string;
    priority: string;
    content: string;
    figures: Array<{
        figure_id?: string;
        url?: string;
        caption?: string;
        kind?: string;
    }>;
    approved_at: string | null;
}

interface PublishedVaultPayload {
    id: string;
    make_oficial: string;
    model_oficial: string;
    make_model: string;
    tipo_equipo: string;
    categoria_equipo: string;
    caracteristicas_principales: string[];
    foto_url: string | null;
    official_url: string;
    is_sealed: boolean;
    published_pillars: Record<
        PillarId,
        {
            pillar_id: PillarId;
            published_count: number;
            items: PublishedPillarItem[];
        }
    >;
}

interface ClientContributionRecord {
    id: string;
    sanitized_filename: string;
    status: string;
    dedup_metrics?: {
        totalPages?: number;
        skippedUnchangedPages?: number;
        skippedSemanticDuplicates?: number;
        netNewItemsCount?: number;
    };
    created_at: string;
    reviewed_at: string | null;
}

const PILLAR_TABS: Array<{ id: PillarId; icon: string; labelKey: string }> = [
    { id: 'ficha_tecnica', icon: 'fact_check', labelKey: 'vault_dashboard.pillars.ficha_tecnica' },
    { id: 'manual_operaciones', icon: 'settings', labelKey: 'vault_dashboard.pillars.manual_operaciones' },
    { id: 'pauta_mantencion', icon: 'build', labelKey: 'vault_dashboard.pillars.pauta_mantencion' },
    { id: 'matriz_riesgos', icon: 'security', labelKey: 'vault_dashboard.pillars.matriz_riesgos' },
    { id: 'checklist_pre_op', icon: 'rule', labelKey: 'vault_dashboard.pillars.checklist_pre_op' },
];

function renderInlineMarkdown(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let keySeq = 0;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) {
            nodes.push(text.slice(lastIdx, match.index));
        }
        if (match[1]) {
            nodes.push(
                <strong key={`b-${keySeq++}`} className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    {match[2]}
                </strong>
            );
        } else if (match[3]) {
            nodes.push(
                <code
                    key={`c-${keySeq++}`}
                    className="px-[8px] py-0.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-[12px] text-[#0F172A] dark:text-[#F3F4F6] select-text"
                >
                    {match[4]}
                </code>
            );
        }
        lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
        nodes.push(text.slice(lastIdx));
    }

    return nodes;
}

function renderPublishedMarkdown(raw: string): React.ReactNode {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i++;
            continue;
        }

        // Bloque de tabla Markdown
        if (line.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }
            const parsedRows = tableLines
                .filter((row) => !/^\|[\s\-:|]+\|$/.test(row))
                .map((row) =>
                    row
                        .replace(/^\|/, '')
                        .replace(/\|$/, '')
                        .split('|')
                        .map((cell) => cell.trim())
                );

            if (parsedRows.length > 0) {
                const [headerRow, ...bodyRows] = parsedRows;
                blocks.push(
                    <div
                        key={`tbl-${i}`}
                        className="overflow-x-auto border border-[#E2E8F0] dark:border-[#12151C] rounded-none"
                    >
                        <table className="w-full text-left border-collapse font-mono tabular-nums text-[13px]">
                            <thead>
                                <tr className="bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                    {headerRow.map((h, hIdx) => (
                                        <th
                                            key={hIdx}
                                            className="px-[13px] py-[8px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]"
                                        >
                                            {renderInlineMarkdown(h)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {bodyRows.map((r, rIdx) => (
                                    <tr key={rIdx} className="bg-[#FFFFFF] dark:bg-[#000000]">
                                        {r.map((c, cIdx) => (
                                            <td
                                                key={cIdx}
                                                className="px-[13px] py-[8px] text-[#0F172A] dark:text-[#F3F4F6] align-top"
                                            >
                                                {renderInlineMarkdown(c)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }
            continue;
        }

        // Encabezados
        if (line.startsWith('### ')) {
            blocks.push(
                <h4
                    key={`h3-${i}`}
                    className="text-[13px] font-mono font-bold uppercase tracking-[0.04em] text-[#C68346] pt-[8px]"
                >
                    {renderInlineMarkdown(line.slice(4))}
                </h4>
            );
            i++;
            continue;
        }
        if (line.startsWith('## ') || line.startsWith('# ')) {
            const cleanHeading = line.replace(/^#{1,2}\s+/, '');
            blocks.push(
                <h3
                    key={`h2-${i}`}
                    className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] pt-[8px]"
                >
                    {renderInlineMarkdown(cleanHeading)}
                </h3>
            );
            i++;
            continue;
        }

        // Listas
        if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
            const listItems: string[] = [];
            while (
                i < lines.length &&
                (/^[-*]\s+/.test(lines[i].trim()) || /^\d+\.\s+/.test(lines[i].trim()))
            ) {
                listItems.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''));
                i++;
            }
            blocks.push(
                <ul key={`ul-${i}`} className="space-y-[8px] pl-[13px]">
                    {listItems.map((li, liIdx) => (
                        <li
                            key={liIdx}
                            className="text-[15px] leading-[1.45] text-[#475569] dark:text-[#8A93A6] flex items-start gap-[8px]"
                        >
                            <span className="text-[#C68346] font-mono select-none">-</span>
                            <span className="flex-1">{renderInlineMarkdown(li)}</span>
                        </li>
                    ))}
                </ul>
            );
            continue;
        }

        // Párrafo estándar
        blocks.push(
            <p
                key={`p-${i}`}
                className="text-[15px] leading-[1.45] text-[#475569] dark:text-[#8A93A6]"
            >
                {renderInlineMarkdown(line)}
            </p>
        );
        i++;
    }

    return <div className="space-y-[13px]">{blocks}</div>;
}

export const FleetUnitWorkspace: React.FC<FleetUnitWorkspaceProps> = ({
    tenantAssetId,
    globalAssetId,
    onBack,
}) => {
    const { t } = useTranslation();
    const { tenantId, capabilities } = useOpermaqContext();

    const [unit, setUnit] = useState<FleetUnitDetail | null>(null);
    const [publishedVault, setPublishedVault] = useState<PublishedVaultPayload | null>(null);
    const [contributions, setContributions] = useState<ClientContributionRecord[]>([]);
    const [activePillar, setActivePillar] = useState<PillarId>('ficha_tecnica');

    const [loading, setLoading] = useState<boolean>(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [copiedSerial, setCopiedSerial] = useState<boolean>(false);

    const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
    const [deletingPhotoSha, setDeletingPhotoSha] = useState<string | null>(null);

    const [uploadingPdf, setUploadingPdf] = useState<boolean>(false);
    const [pdfStatusNotice, setPdfStatusNotice] = useState<string | null>(null);

    const photoInputRef = useRef<HTMLInputElement | null>(null);
    const pdfInputRef = useRef<HTMLInputElement | null>(null);

    const canMutateUnit = capabilities.canManageFleet || capabilities.canCurateAI;

    const loadWorkspaceData = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        const headers = tenantId ? { 'X-Active-Account-Id': tenantId } : undefined;

        try {
            const unitRes = await authFetch(`${API_BASE_URL}/assets/unit/${encodeURIComponent(tenantAssetId)}`, {
                headers,
            });
            const unitJson = await unitRes.json().catch(() => ({}));
            if (!unitRes.ok || !unitJson?.unit) {
                throw new Error(unitJson?.error || t('vault_dashboard.load_error'));
            }

            const loadedUnit: FleetUnitDetail = unitJson.unit;
            setUnit(loadedUnit);

            const targetGlobalId = String(loadedUnit.global_asset_id || globalAssetId || '').trim();
            if (targetGlobalId) {
                const [pubRes, contribRes] = await Promise.all([
                    authFetch(`${API_BASE_URL}/vault/published/${encodeURIComponent(targetGlobalId)}`, {
                        headers,
                    }),
                    authFetch(`${API_BASE_URL}/vault/my-contributions/${encodeURIComponent(targetGlobalId)}`, {
                        headers,
                    }),
                ]);

                if (pubRes.ok) {
                    const pubJson = await pubRes.json().catch(() => null);
                    if (pubJson) setPublishedVault(pubJson);
                }

                if (contribRes.ok) {
                    const contribJson = await contribRes.json().catch(() => ({}));
                    setContributions(Array.isArray(contribJson?.items) ? contribJson.items : []);
                }
            }
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('vault_dashboard.load_error'));
        } finally {
            setLoading(false);
        }
    }, [tenantAssetId, globalAssetId, tenantId, t]);

    useEffect(() => {
        void loadWorkspaceData();
    }, [loadWorkspaceData]);

    const handleCopySerial = async (serial: string) => {
        if (!serial || serial.startsWith('[')) return;
        try {
            await navigator.clipboard.writeText(serial);
            setCopiedSerial(true);
            window.setTimeout(() => setCopiedSerial(false), 1600);
        } catch {
            // Clipboard restringido
        }
    };

    const handlePrivatePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !unit) return;

        setUploadingPhoto(true);
        setErrorMsg(null);
        try {
            let payloadBlob: File | Blob = file;
            try {
                const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_FIELD_EVIDENCE');
                payloadBlob = digested.blob;
            } catch {
                payloadBlob = file;
            }

            const form = new FormData();
            form.append('file', payloadBlob, file.name || 'equipo_flota.webp');

            const res = await authFetch(
                `${API_BASE_URL}/assets/${encodeURIComponent(unit.id)}/private-photo`,
                {
                    method: 'POST',
                    headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                    body: form,
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('common.error'));
            }

            setUnit((prev) =>
                prev
                    ? {
                        ...prev,
                        private_photos: Array.isArray(data.private_photos)
                            ? data.private_photos
                            : prev.private_photos,
                    }
                    : prev
            );
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleDeletePrivatePhoto = async (sha256: string) => {
        if (!unit || !sha256) return;
        setDeletingPhotoSha(sha256);
        setErrorMsg(null);
        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/${encodeURIComponent(unit.id)}/private-photo/${encodeURIComponent(sha256)}`,
                {
                    method: 'DELETE',
                    headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('common.error'));
            }
            setUnit((prev) =>
                prev
                    ? {
                        ...prev,
                        private_photos: Array.isArray(data.private_photos)
                            ? data.private_photos
                            : prev.private_photos.filter((p) => p.sha256 !== sha256),
                    }
                    : prev
            );
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setDeletingPhotoSha(null);
        }
    };

    const handleUploadClientPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !unit) return;

        const isPdf =
            file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            setErrorMsg(t('vault_manager.no_file_selected'));
            return;
        }

        const resolvedGlobalId = String(unit.global_asset_id || globalAssetId || '').trim();
        if (!resolvedGlobalId) return;

        setUploadingPdf(true);
        setPdfStatusNotice(null);
        setErrorMsg(null);

        try {
            const form = new FormData();
            form.append('file', file);
            form.append('globalAssetId', resolvedGlobalId);
            form.append('tenantAssetId', unit.id);

            const res = await authFetch(`${API_BASE_URL}/vault/client-contribute-pdf`, {
                method: 'POST',
                headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || data?.message || t('common.error'));
            }

            const totalPages = Number(data?.totalPages || 0);
            const skippedPages = Number(data?.skippedUnchangedPages || 0);
            const skippedSem = Number(data?.skippedSemanticDuplicates || 0);
            const netNew = Number(data?.netNewItemsCount || 0);

            setPdfStatusNotice(
                netNew > 0
                    ? `PDF evaluado (${totalPages} pág. · ${skippedPages + skippedSem} duplicadas omitidas · ${netNew} propuestas en revisión humana MINREPORT).`
                    : `${t('opermaq_domains.status_deduplicated')} (${totalPages} pág.).`
            );

            const contribRes = await authFetch(
                `${API_BASE_URL}/vault/my-contributions/${encodeURIComponent(resolvedGlobalId)}`,
                {
                    headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
                }
            );
            if (contribRes.ok) {
                const contribJson = await contribRes.json().catch(() => ({}));
                setContributions(Array.isArray(contribJson?.items) ? contribJson.items : []);
            }
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setUploadingPdf(false);
        }
    };

    const flatIconBtn =
        'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none';

    const formatContributionStatus = (status: string): string => {
        if (status === 'DEDUPLICATED_ALREADY_KNOWN') return t('opermaq_domains.status_deduplicated');
        if (status === 'APPROVED_CONSOLIDATED' || status === 'PARTIALLY_APPROVED') {
            return t('opermaq_domains.status_approved');
        }
        if (status === 'REJECTED') return t('opermaq_domains.status_rejected');
        return t('opermaq_domains.status_pending_human');
    };

    if (loading) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center p-[34px] gap-[13px] bg-[#FFFFFF] dark:bg-[#000000]">
                <span className="material-symbols-outlined animate-spin text-[28px] text-[#C68346]">
                    progress_activity
                </span>
                <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    {t('fleet.syncing')}
                </span>
            </div>
        );
    }

    const officialTitle =
        unit?.make_model ||
        `${unit?.make_oficial || publishedVault?.make_oficial || ''} ${unit?.model_oficial || publishedVault?.model_oficial || ''
            }`.trim() ||
        t('opermaq_domains.not_declared');

    const unitSerial = unit?.serial_number || unit?.identifier_value || t('opermaq_domains.pending_record');
    const effectiveOwnerTenant = unit?.tenant_id || unit?.tenantId || tenantId;
    const activePillarData = publishedVault?.published_pillars?.[activePillar];
    const activePillarItems = activePillarData?.items || [];

    return (
        <div className="h-full w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans select-none rounded-none shadow-none overflow-hidden">
            {/* Cabecera Técnica de Unidad de Flota */}
            <header className="px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-[13px] shrink-0">
                <div className="flex items-center gap-[13px] min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        title={t('opermaq_domains.unit_detail_back')}
                        aria-label={t('opermaq_domains.unit_detail_back')}
                        className={flatIconBtn}
                    >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <div className="min-w-0">
                        <div className="flex items-baseline gap-[8px] min-w-0">
                            <h1 className="text-[17px] font-semibold leading-tight text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {officialTitle}
                            </h1>
                            {unit?.version && unit.version !== 'ESTÁNDAR' && (
                                <span className="text-[11px] font-mono text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                    {unit.version}
                                </span>
                            )}
                        </div>
                        <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] truncate">
                            {cleanMachineryTypeLabel(unit?.tipo_equipo || publishedVault?.tipo_equipo)}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-[13px] shrink-0">
                    <div className="hidden sm:flex items-center gap-[8px]">
                        <span className="text-[13px] font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                            {unitSerial}
                        </span>
                        <button
                            type="button"
                            onClick={() => void handleCopySerial(unitSerial)}
                            title={copiedSerial ? t('opermaq_domains.copied') : t('opermaq_domains.copy_serial')}
                            aria-label={t('opermaq_domains.copy_serial')}
                            className={flatIconBtn}
                        >
                            <span className="material-symbols-outlined text-[15px]">
                                {copiedSerial ? 'check' : 'content_copy'}
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => void loadWorkspaceData()}
                        title={t('vault.refresh')}
                        aria-label={t('vault.refresh')}
                        className={flatIconBtn}
                    >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                    </button>
                </div>
            </header>

            {errorMsg && (
                <div className="px-[21px] py-[8px] border-b border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-[13px]">
                    <span className="text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6]">{errorMsg}</span>
                    <button
                        type="button"
                        onClick={() => setErrorMsg(null)}
                        aria-label={t('common.cancel')}
                        className={flatIconBtn}
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            )}

            {/* Macro-Layout Proporción Áurea (61.8% Informe 5 Pilares / 38.2% Unidad, Fotos Privadas y Aporte PDF) */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* ÁREA MAYOR (61.8%) — Informe Técnico Oficial de los 5 Pilares (Solo Lectura, APROBADO_HUMANO) */}
                <section className="w-full lg:w-[61.8%] h-full flex flex-col min-h-0 overflow-hidden bg-[#FFFFFF] dark:bg-[#000000]">
                    <div className="px-[21px] pt-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] shrink-0">
                        <div className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF] mb-[8px]">
                            {t('opermaq_domains.published_report_heading')}
                        </div>

                        <nav className="flex items-center gap-[8px] overflow-x-auto">
                            {PILLAR_TABS.map((pillar) => {
                                const count =
                                    publishedVault?.published_pillars?.[pillar.id]?.published_count || 0;
                                const isActive = activePillar === pillar.id;
                                return (
                                    <button
                                        key={pillar.id}
                                        type="button"
                                        onClick={() => setActivePillar(pillar.id)}
                                        className={`px-[13px] py-[8px] bg-transparent border-0 border-b-2 text-[12px] font-mono uppercase tracking-[0.03em] whitespace-nowrap flex items-center gap-[8px] transition-colors cursor-pointer rounded-none ${isActive
                                            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-bold'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                            }`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">{pillar.icon}</span>
                                        <span>{t(pillar.labelKey)}</span>
                                        <span className="tabular-nums text-[11px] text-[#94A3B8] dark:text-[#5A6072]">
                                            ({count})
                                        </span>
                                    </button>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="flex-1 overflow-y-auto p-[21px] sm:p-[34px]">
                        {activePillarItems.length === 0 ? (
                            <div className="p-[34px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-center rounded-none">
                                <p className="text-[13px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('opermaq_domains.pillar_unpublished')}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-[34px]">
                                {activePillarItems.map((item) => (
                                    <article
                                        key={item.item_id}
                                        className="pb-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] last:border-b-0 space-y-[13px]"
                                    >
                                        <header className="flex items-baseline justify-between gap-[13px]">
                                            <div className="flex items-baseline gap-[8px] min-w-0">
                                                <span className="text-[12px] font-mono tabular-nums font-bold text-[#C68346]">
                                                    {String(item.order).padStart(2, '0')}.
                                                </span>
                                                <h2 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {item.title}
                                                </h2>
                                            </div>
                                            <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072] shrink-0">
                                                {item.section}
                                            </span>
                                        </header>

                                        {renderPublishedMarkdown(item.content)}

                                        {Array.isArray(item.figures) && item.figures.length > 0 && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px] pt-[8px]">
                                                {item.figures.map((fig, fIdx) =>
                                                    fig.url ? (
                                                        <figure
                                                            key={fig.figure_id || fIdx}
                                                            className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[13px] space-y-[8px] rounded-none"
                                                        >
                                                            <SecureCasThumbnail
                                                                src={fig.url}
                                                                alt={fig.caption || item.title}
                                                                className="w-full h-44"
                                                                imgClassName="w-full h-full object-contain"
                                                            />
                                                            {fig.caption && (
                                                                <figcaption className="text-[12px] text-[#475569] dark:text-[#8A93A6]">
                                                                    {fig.caption}
                                                                </figcaption>
                                                            )}
                                                        </figure>
                                                    ) : null
                                                )}
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* ÁREA MENOR (38.2%) — Datos de Serie, Fotografías Privadas y Envío de PDF a Cuarentena */}
                <aside className="w-full lg:w-[38.2%] h-full overflow-y-auto border-t lg:border-t-0 lg:border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] space-y-[21px]">
                    {/* Bloque 1: Ficha Acreditativa de Unidad */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px]">
                            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                                {t('opermaq_domains.serial_label')}
                            </span>
                            <div className="flex items-center gap-[8px]">
                                <span className="text-[13px] font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                    {unitSerial}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void handleCopySerial(unitSerial)}
                                    title={t('opermaq_domains.copy_serial')}
                                    aria-label={t('opermaq_domains.copy_serial')}
                                    className={flatIconBtn}
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        {copiedSerial ? 'check' : 'content_copy'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                            <div>
                                <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('opermaq_domains.ownership_label')}
                                </dt>
                                <dd className="font-mono font-semibold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {unit?.ownership_type || t('opermaq_domains.not_declared')}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('opermaq_domains.horometer_label')}
                                </dt>
                                <dd className="font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                    {typeof unit?.horometer === 'number'
                                        ? `${unit.horometer.toLocaleString('es-CL')} hrs`
                                        : t('opermaq_domains.pending_record')}
                                </dd>
                            </div>
                        </dl>
                    </section>

                    {/* Bloque 2: Fotografías Privadas del Equipo (`TENANT_PRIVATE`) */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none">
                        <div className="flex items-start justify-between gap-[13px]">
                            <div className="space-y-1">
                                <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('opermaq_domains.private_photos_heading')}
                                </h2>
                                <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                                    {t('opermaq_domains.private_photos_scope')}
                                </p>
                            </div>
                            {canMutateUnit && (
                                <>
                                    <input
                                        ref={photoInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={handlePrivatePhotoSelect}
                                        autoComplete="off"
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        disabled={uploadingPhoto}
                                        onClick={() => photoInputRef.current?.click()}
                                        title={t('opermaq_domains.upload_private_photo')}
                                        aria-label={t('opermaq_domains.upload_private_photo')}
                                        className={flatIconBtn}
                                    >
                                        <span
                                            className={`material-symbols-outlined text-[20px] ${uploadingPhoto ? 'animate-spin text-[#C68346]' : ''
                                                }`}
                                        >
                                            {uploadingPhoto ? 'progress_activity' : 'add_a_photo'}
                                        </span>
                                    </button>
                                </>
                            )}
                        </div>

                        {!unit?.private_photos || unit.private_photos.length === 0 ? (
                            <div className="py-[13px] text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {t('opermaq_domains.no_private_photos')}
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-[8px]">
                                {unit.private_photos.map((photo) => (
                                    <div
                                        key={photo.sha256}
                                        className="relative group border border-[#E2E8F0] dark:border-[#12151C]"
                                    >
                                        <SecureCasThumbnail
                                            src={photo.url}
                                            alt={officialTitle}
                                            tenantId={effectiveOwnerTenant}
                                            className="w-full h-24 border-0"
                                        />
                                        {canMutateUnit && (
                                            <button
                                                type="button"
                                                disabled={deletingPhotoSha === photo.sha256}
                                                onClick={() => void handleDeletePrivatePhoto(photo.sha256)}
                                                title={t('actions.delete')}
                                                aria-label={t('actions.delete')}
                                                className="absolute top-1 right-1 bg-[#FFFFFF]/90 dark:bg-[#000000]/90 border-0 outline-none p-1 text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[15px]">
                                                    {deletingPhotoSha === photo.sha256
                                                        ? 'progress_activity'
                                                        : 'delete'}
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Bloque 3: Subida Exclusiva de PDF para Evaluación Anti-Duplicados y Revisión Humana */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none">
                        <div className="space-y-1">
                            <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                {t('opermaq_domains.client_pdf_heading')}
                            </h2>
                            <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                                {t('opermaq_domains.client_pdf_scope')}
                            </p>
                        </div>

                        {canMutateUnit && (
                            <div>
                                <input
                                    ref={pdfInputRef}
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    onChange={handleUploadClientPdf}
                                    autoComplete="off"
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    disabled={uploadingPdf}
                                    onClick={() => pdfInputRef.current?.click()}
                                    className="w-full h-9 px-[13px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-50 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none cursor-pointer transition-colors"
                                >
                                    {uploadingPdf
                                        ? t('opermaq_domains.uploading_pdf')
                                        : t('opermaq_domains.upload_pdf_btn')}
                                </button>
                            </div>
                        )}

                        {pdfStatusNotice && (
                            <div className="p-[8px] border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] text-[12px] font-mono text-[#0F172A] dark:text-[#F3F4F6]">
                                {pdfStatusNotice}
                            </div>
                        )}

                        {contributions.length > 0 && (
                            <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] space-y-[8px]">
                                <div className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('opermaq_domains.contributions_history')}
                                </div>
                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C]">
                                    {contributions.map((c) => (
                                        <div key={c.id} className="px-[8px] py-[8px] space-y-0.5">
                                            <div className="text-[12px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                {c.sanitized_filename}
                                            </div>
                                            <div className="text-[11px] font-mono tabular-nums text-[#00AEEF]">
                                                {formatContributionStatus(c.status)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default FleetUnitWorkspace;

