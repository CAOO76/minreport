import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssetPhysicalTraits } from '../../../contracts';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import type { PillarId } from '../types/vault';
import { authFetch } from '../utils/authFetch';
import { cleanMachineryTypeLabel } from '../utils/opermaqDomainProjection';
import {
    createUndeclaredContentRegex,
    PENDING_CONTENT_HIGHLIGHT_CLASS,
} from '../utils/pendingContentDetector';
import {
    normalizeProceduralStepsToMarkdownTable,
    stripRedundantNarrativeInTabularPillar,
} from '../utils/proceduralTableNormalizer';
import { M3CircularProgress } from './M3ProgressIndicator';
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
    original_bytes?: number;
    optimized_bytes?: number;
    savings_pct?: number;
    originalBytes?: number;
    optimizedBytes?: number;
    savingsPct?: number;
    uploadedAt?: string;
}

interface TenantCustomOverridesRecord {
    faena_name?: string;
    altitude_masl?: number;
    internal_radio_channel?: string;
    max_ramp_speed_kmh?: number;
    emergency_protocol_notes?: string;
    custom_pm_derating_factor?: number;
    custom_checklist_additions?: string[];
    private_operational_notes?: string;
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
    odometer_km?: number;
    cycles_count?: number;
    calibration_due_date?: string;
    physical_traits?: AssetPhysicalTraits;
    tenant_custom_overrides?: TenantCustomOverridesRecord;
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

const PILLAR_TABS: Array<{ id: PillarId; labelKey: string }> = [
    { id: 'ficha_tecnica', labelKey: 'vault_dashboard.pillars.ficha_tecnica' },
    { id: 'manual_operaciones', labelKey: 'vault_dashboard.pillars.manual_operaciones' },
    { id: 'pauta_mantencion', labelKey: 'vault_dashboard.pillars.pauta_mantencion' },
    { id: 'matriz_riesgos', labelKey: 'vault_dashboard.pillars.matriz_riesgos' },
    { id: 'checklist_pre_op', labelKey: 'vault_dashboard.pillars.checklist_pre_op' },
];

function formatCasBytesCompact(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function highlightUndeclaredInFleetText(text: string, baseKey: string): React.ReactNode[] {
    const regex = createUndeclaredContentRegex();
    let match: RegExpExecArray | null = regex.exec(text);
    if (!match) return [text];

    const out: React.ReactNode[] = [];
    let last = 0;
    let seq = 0;
    while (match !== null) {
        if (match.index > last) {
            out.push(text.slice(last, match.index));
        }
        const mText = match[0];
        out.push(
            <mark key={`${baseKey}-u-${seq++}`} className={PENDING_CONTENT_HIGHLIGHT_CLASS}>
                {mText}
            </mark>
        );
        last = match.index + mText.length;
        match = regex.exec(text);
    }
    if (last < text.length) {
        out.push(text.slice(last));
    }
    return out;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
    const cleanText = text
        .replace(/\[[sS][íÍiI][mM][bB][oO][lL][oO]:\s*[a-zA-Z0-9_-]+\]/g, '')
        .replace(/\s+([.,;:?!)\]])/g, '$1')
        .replace(/([(\[])\s+/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    const nodes: React.ReactNode[] = [];
    const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let keySeq = 0;

    while ((match = regex.exec(cleanText)) !== null) {
        if (match.index > lastIdx) {
            nodes.push(...highlightUndeclaredInFleetText(cleanText.slice(lastIdx, match.index), `p-${keySeq++}`));
        }
        if (match[1]) {
            nodes.push(
                <strong key={`b-${keySeq++}`} className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    {highlightUndeclaredInFleetText(match[2], `b-u-${keySeq}`)}
                </strong>
            );
        } else if (match[3]) {
            nodes.push(
                <code
                    key={`c-${keySeq++}`}
                    className="px-[8px] py-0.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-[12px] text-[#0F172A] dark:text-[#F3F4F6] select-text"
                >
                    {highlightUndeclaredInFleetText(match[4], `c-u-${keySeq}`)}
                </code>
            );
        }
        lastIdx = regex.lastIndex;
    }

    if (lastIdx < cleanText.length) {
        nodes.push(...highlightUndeclaredInFleetText(cleanText.slice(lastIdx), `end-${keySeq}`));
    }

    return nodes;
}

function renderPublishedMarkdown(raw: string, pillarId?: PillarId): React.ReactNode {
    const normalizedTables = normalizeProceduralStepsToMarkdownTable(raw.replace(/\r\n/g, '\n'), {
        pillarId,
    });
    const cleanText = stripRedundantNarrativeInTabularPillar(normalizedTables, pillarId);
    const lines = cleanText.split('\n');
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
                const normHeader = headerRow.map((h) => h.toUpperCase().replace(/\s+/g, ' ').trim());
                const indexColIdx = normHeader.findIndex(
                    (h) => h === 'N°' || h === 'Nº' || h === 'NRO' || h === '#' || h === 'PASO'
                );
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
                                            className={`px-[13px] py-[8px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] ${
                                                hIdx === indexColIdx ? 'text-center whitespace-nowrap' : 'text-left'
                                            }`}
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
                                                className={`px-[13px] py-[8px] align-top ${
                                                    cIdx === indexColIdx
                                                        ? 'text-center font-bold text-[#C68346] whitespace-nowrap'
                                                        : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                }`}
                                            >
                                                {cIdx === indexColIdx
                                                    ? c.replace(/^\*\*|\*\*$/g, '')
                                                    : renderInlineMarkdown(c)}
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
        if (line.startsWith('#### ')) {
            blocks.push(
                <h5
                    key={`h4-${i}`}
                    className="text-[12px] font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] pt-[8px]"
                >
                    {renderInlineMarkdown(line.slice(5))}
                </h5>
            );
            i++;
            continue;
        }
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
    const [pendingDeletePhotoSha, setPendingDeletePhotoSha] = useState<string | null>(null);
    const [confirmDeletePhotoWord, setConfirmDeletePhotoWord] = useState<string>('');

    const [isConfirmingDeleteUnit, setIsConfirmingDeleteUnit] = useState<boolean>(false);
    const [confirmDeleteUnitWord, setConfirmDeleteUnitWord] = useState<string>('');
    const [deletingUnit, setDeletingUnit] = useState<boolean>(false);

    const [isEditingOverrides, setIsEditingOverrides] = useState<boolean>(false);
    const [savingOverrides, setSavingOverrides] = useState<boolean>(false);
    const [overridesStatusNotice, setOverridesStatusNotice] = useState<string | null>(null);
    const [overrideFaenaName, setOverrideFaenaName] = useState<string>('');
    const [overrideAltitudeMasl, setOverrideAltitudeMasl] = useState<string>('');
    const [overrideRadioChannel, setOverrideRadioChannel] = useState<string>('');
    const [overrideMaxRampSpeed, setOverrideMaxRampSpeed] = useState<string>('');
    const [overrideNotes, setOverrideNotes] = useState<string>('');
    const [confirmOverridesWord, setConfirmOverridesWord] = useState<string>('');

    const [uploadingPdf, setUploadingPdf] = useState<boolean>(false);
    const [pdfStatusNotice, setPdfStatusNotice] = useState<string | null>(null);

    const photoInputRef = useRef<HTMLInputElement | null>(null);
    const pdfInputRef = useRef<HTMLInputElement | null>(null);

    const canMutateUnit = capabilities.canManageFleet || capabilities.canCurateAI;
    const unitCacheKey = `opermaq_unit_detail_${tenantId || 'default'}_${tenantAssetId}`;

    const loadWorkspaceData = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        const headers = tenantId ? { 'X-Active-Account-Id': tenantId } : undefined;

        let hydratedUnit: FleetUnitDetail | null = null;
        try {
            hydratedUnit = await syncQueueEngine.getOfflineKnowledge<FleetUnitDetail>(unitCacheKey);
            if (!hydratedUnit && tenantId) {
                const cachedFleet = await syncQueueEngine.getOfflineKnowledge<FleetUnitDetail[]>(
                    `opermaq_fleet_${tenantId}`
                );
                const match = Array.isArray(cachedFleet)
                    ? cachedFleet.find((u) => u && u.id === tenantAssetId) || null
                    : null;
                if (match) {
                    hydratedUnit = {
                        ...match,
                        private_photos: Array.isArray(match.private_photos) ? match.private_photos : [],
                    };
                }
            }
            if (hydratedUnit) {
                setUnit(hydratedUnit);
            }
            const cachedGlobalId = String(
                hydratedUnit?.global_asset_id || globalAssetId || ''
            ).trim();
            if (cachedGlobalId) {
                const [cachedVault, cachedContribs] = await Promise.all([
                    syncQueueEngine.getOfflineKnowledge<PublishedVaultPayload>(
                        `opermaq_published_vault_${cachedGlobalId}`
                    ),
                    syncQueueEngine.getOfflineKnowledge<ClientContributionRecord[]>(
                        `opermaq_unit_contribs_${tenantId || 'default'}_${cachedGlobalId}`
                    ),
                ]);
                if (cachedVault) setPublishedVault(cachedVault);
                if (Array.isArray(cachedContribs)) setContributions(cachedContribs);
            }
        } catch {
            // Continuar con carga de red si IndexedDB no está disponible
        }

        if (typeof navigator !== 'undefined' && !navigator.onLine && hydratedUnit) {
            setLoading(false);
            return;
        }

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
            void syncQueueEngine.saveOfflineKnowledge(unitCacheKey, loadedUnit);

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
                    if (pubJson) {
                        setPublishedVault(pubJson);
                        void syncQueueEngine.saveOfflineKnowledge(
                            `opermaq_published_vault_${targetGlobalId}`,
                            pubJson
                        );
                    }
                }

                if (contribRes.ok) {
                    const contribJson = await contribRes.json().catch(() => ({}));
                    const contribItems: ClientContributionRecord[] = Array.isArray(contribJson?.items)
                        ? contribJson.items
                        : [];
                    setContributions(contribItems);
                    void syncQueueEngine.saveOfflineKnowledge(
                        `opermaq_unit_contribs_${tenantId || 'default'}_${targetGlobalId}`,
                        contribItems
                    );
                }
            }
        } catch (err: unknown) {
            if (!hydratedUnit) {
                setErrorMsg(err instanceof Error ? err.message : t('vault_dashboard.load_error'));
            }
        } finally {
            setLoading(false);
        }
    }, [tenantAssetId, globalAssetId, tenantId, unitCacheKey, t]);

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

    const handleOpenEditOverrides = () => {
        const cur = unit?.tenant_custom_overrides;
        setOverrideFaenaName(cur?.faena_name || '');
        setOverrideAltitudeMasl(
            typeof cur?.altitude_masl === 'number' ? String(cur.altitude_masl) : ''
        );
        setOverrideRadioChannel(cur?.internal_radio_channel || '');
        setOverrideMaxRampSpeed(
            typeof cur?.max_ramp_speed_kmh === 'number' ? String(cur.max_ramp_speed_kmh) : ''
        );
        setOverrideNotes(cur?.private_operational_notes || '');
        setConfirmOverridesWord('');
        setOverridesStatusNotice(null);
        setIsEditingOverrides(true);
    };

    const handleSaveOverrides = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!unit || confirmOverridesWord.trim() !== 'ACTUALIZAR') return;

        setSavingOverrides(true);
        setErrorMsg(null);
        setOverridesStatusNotice(null);

        const effectiveTenant = unit.tenant_id || unit.tenantId || tenantId || undefined;
        const parsedAlt =
            overrideAltitudeMasl.trim() !== ''
                ? Math.max(0, Math.min(6000, Number(overrideAltitudeMasl) || 0))
                : undefined;
        const parsedSpeed =
            overrideMaxRampSpeed.trim() !== ''
                ? Math.max(5, Math.min(120, Number(overrideMaxRampSpeed) || 5))
                : undefined;

        const nextOverrides: TenantCustomOverridesRecord = {
            ...unit.tenant_custom_overrides,
            ...(overrideFaenaName.trim() ? { faena_name: overrideFaenaName.trim() } : { faena_name: undefined }),
            ...(typeof parsedAlt === 'number' ? { altitude_masl: parsedAlt } : { altitude_masl: undefined }),
            ...(overrideRadioChannel.trim()
                ? { internal_radio_channel: overrideRadioChannel.trim() }
                : { internal_radio_channel: undefined }),
            ...(typeof parsedSpeed === 'number'
                ? { max_ramp_speed_kmh: parsedSpeed }
                : { max_ramp_speed_kmh: undefined }),
            ...(overrideNotes.trim()
                ? { private_operational_notes: overrideNotes.trim() }
                : { private_operational_notes: undefined }),
        };

        const payload: Record<string, unknown> = {
            confirm_word: 'ACTUALIZAR',
            ...(overrideFaenaName.trim() ? { faena_name: overrideFaenaName.trim() } : {}),
            ...(typeof parsedAlt === 'number' ? { altitude_masl: parsedAlt } : {}),
            ...(overrideRadioChannel.trim() ? { internal_radio_channel: overrideRadioChannel.trim() } : {}),
            ...(typeof parsedSpeed === 'number' ? { max_ramp_speed_kmh: parsedSpeed } : {}),
            ...(overrideNotes.trim() ? { private_operational_notes: overrideNotes.trim() } : {}),
        };

        const applyLocalOverrides = (queuedOffline: boolean) => {
            const nextUnit: FleetUnitDetail = {
                ...unit,
                tenant_custom_overrides: nextOverrides,
            };
            setUnit(nextUnit);
            void syncQueueEngine.saveOfflineKnowledge(unitCacheKey, nextUnit);
            setIsEditingOverrides(false);
            setConfirmOverridesWord('');
            setOverridesStatusNotice(
                queuedOffline
                    ? t('opermaq_domains.overrides_queued_offline')
                    : t('opermaq_domains.overrides_saved_notice')
            );
        };

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            try {
                await syncQueueEngine.enqueueApiMutation(
                    `/api/assets/${unit.id}/overrides`,
                    payload,
                    'OPERMAQ_OVERRIDE_SYNC',
                    effectiveTenant,
                    'PATCH'
                );
                applyLocalOverrides(true);
            } catch (err: unknown) {
                setErrorMsg(err instanceof Error ? err.message : t('common.error'));
            } finally {
                setSavingOverrides(false);
            }
            return;
        }

        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/${encodeURIComponent(unit.id)}/overrides`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(effectiveTenant ? { 'X-Active-Account-Id': effectiveTenant } : {}),
                    },
                    body: JSON.stringify(payload),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || data?.error || t('common.error'));
            }
            applyLocalOverrides(false);
        } catch (err: unknown) {
            const isNetworkFailure =
                (typeof navigator !== 'undefined' && !navigator.onLine) || err instanceof TypeError;
            if (isNetworkFailure) {
                try {
                    await syncQueueEngine.enqueueApiMutation(
                        `/api/assets/${unit.id}/overrides`,
                        payload,
                        'OPERMAQ_OVERRIDE_SYNC',
                        effectiveTenant,
                        'PATCH'
                    );
                    applyLocalOverrides(true);
                    return;
                } catch (queueErr: unknown) {
                    setErrorMsg(queueErr instanceof Error ? queueErr.message : t('common.error'));
                    return;
                }
            }
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setSavingOverrides(false);
        }
    };

    const handlePrivatePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !unit) return;

        setUploadingPhoto(true);
        setErrorMsg(null);
        const clientOriginalBytes = file.size;
        let clientOptimizedBytes = file.size;
        let clientSavingsPct = 0;
        let preflightSha256 = '';

        try {
            let payloadBlob: File | Blob = file;
            try {
                const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_FIELD_EVIDENCE');
                payloadBlob = digested.blob;
                clientOptimizedBytes = digested.optimizedBytes;
                clientSavingsPct = Math.max(0, Number((digested.savingsRatio * 100).toFixed(1)));
                preflightSha256 = digested.sha256;
            } catch {
                payloadBlob = file;
            }

            const form = new FormData();
            form.append('file', payloadBlob, file.name || 'equipo_flota.webp');
            form.append('clientOriginalBytes', String(clientOriginalBytes));
            if (preflightSha256) {
                form.append('sha256', preflightSha256);
            }

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

            const rawPhotos: PrivatePhotoRecord[] = Array.isArray(data.private_photos)
                ? data.private_photos
                : unit.private_photos;
            const enrichedPhotos = rawPhotos.map((p, idx) => {
                const isTarget =
                    (preflightSha256 && p.sha256 === preflightSha256) ||
                    (!preflightSha256 && idx === rawPhotos.length - 1);
                if (!isTarget) return p;
                return {
                    ...p,
                    original_bytes: p.original_bytes ?? p.originalBytes ?? clientOriginalBytes,
                    optimized_bytes: p.optimized_bytes ?? p.optimizedBytes ?? clientOptimizedBytes,
                    savings_pct: p.savings_pct ?? p.savingsPct ?? clientSavingsPct,
                };
            });

            const nextUnit: FleetUnitDetail = {
                ...unit,
                private_photos: enrichedPhotos,
            };
            setUnit(nextUnit);
            void syncQueueEngine.saveOfflineKnowledge(unitCacheKey, nextUnit);
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleDeletePrivatePhoto = async (sha256: string) => {
        if (!unit || !sha256 || confirmDeletePhotoWord.trim() !== 'ACTUALIZAR') return;
        setDeletingPhotoSha(sha256);
        setErrorMsg(null);
        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/${encodeURIComponent(unit.id)}/private-photo/${encodeURIComponent(sha256)}?confirmWord=ACTUALIZAR`,
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                    },
                    body: JSON.stringify({ confirmWord: 'ACTUALIZAR' }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || data?.error || t('common.error'));
            }
            const nextPhotos = Array.isArray(data.private_photos)
                ? data.private_photos
                : unit.private_photos.filter((p) => p.sha256 !== sha256);
            const nextUnit: FleetUnitDetail = {
                ...unit,
                private_photos: nextPhotos,
            };
            setUnit(nextUnit);
            void syncQueueEngine.saveOfflineKnowledge(unitCacheKey, nextUnit);
            setPendingDeletePhotoSha(null);
            setConfirmDeletePhotoWord('');
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setDeletingPhotoSha(null);
        }
    };

    const handleDeleteUnit = async () => {
        if (!unit || confirmDeleteUnitWord.trim() !== 'ACTUALIZAR') return;
        setDeletingUnit(true);
        setErrorMsg(null);
        try {
            const res = await authFetch(
                `${API_BASE_URL}/assets/${encodeURIComponent(unit.id)}?confirmWord=ACTUALIZAR`,
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(tenantId ? { 'X-Active-Account-Id': tenantId } : {}),
                    },
                    body: JSON.stringify({ confirmWord: 'ACTUALIZAR' }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || data?.error || t('common.error'));
            }
            if (tenantId) {
                const cachedFleet = await syncQueueEngine
                    .getOfflineKnowledge<FleetUnitDetail[]>(`opermaq_fleet_${tenantId}`)
                    .catch(() => null);
                if (Array.isArray(cachedFleet)) {
                    void syncQueueEngine.saveOfflineKnowledge(
                        `opermaq_fleet_${tenantId}`,
                        cachedFleet.filter((u) => u && u.id !== unit.id)
                    );
                }
            }
            setIsConfirmingDeleteUnit(false);
            setConfirmDeleteUnitWord('');
            onBack();
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('common.error'));
        } finally {
            setDeletingUnit(false);
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
            let pdfBlob: File | Blob = file;
            let clientOriginalBytes = file.size;
            let pdfSha256 = '';
            try {
                const digestedPdf = await mediaDigestorClient.digestPdf(file);
                pdfBlob = digestedPdf.blob;
                clientOriginalBytes = digestedPdf.originalBytes;
                pdfSha256 = digestedPdf.sha256;
            } catch {
                pdfBlob = file;
            }

            const form = new FormData();
            form.append('file', pdfBlob, file.name);
            form.append('globalAssetId', resolvedGlobalId);
            form.append('tenantAssetId', unit.id);
            form.append('clientOriginalBytes', String(clientOriginalBytes));
            if (pdfSha256) {
                form.append('sha256', pdfSha256);
            }

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
                    ? t('opermaq_domains.pdf_evaluated_notice', {
                          totalPages,
                          skippedCount: skippedPages + skippedSem,
                          netNew,
                      })
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
                const contribItems: ClientContributionRecord[] = Array.isArray(contribJson?.items)
                    ? contribJson.items
                    : [];
                setContributions(contribItems);
                void syncQueueEngine.saveOfflineKnowledge(
                    `opermaq_unit_contribs_${tenantId || 'default'}_${resolvedGlobalId}`,
                    contribItems
                );
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
                <M3CircularProgress size={28} strokeWidth={3} tone="copper" />
                <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    {t('fleet.syncing')}
                </span>
            </div>
        );
    }

    const pmCadence = unit?.physical_traits?.pm_cadence_basis;
    const requiresMetrology =
        Boolean(unit?.physical_traits?.requires_metrology_calibration) ||
        pmCadence === 'CALENDAR_AND_METROLOGY';
    const showHorometer =
        typeof unit?.horometer === 'number' ||
        !pmCadence ||
        pmCadence === 'HOROMETER_HOURS' ||
        pmCadence === 'DUAL_KM_AND_HOURS';
    const showOdometerKm =
        typeof unit?.odometer_km === 'number' ||
        pmCadence === 'ODOMETER_KM' ||
        pmCadence === 'DUAL_KM_AND_HOURS';
    const showCyclesCount =
        typeof unit?.cycles_count === 'number' || pmCadence === 'CYCLES_OR_FLIGHTS';
    const showCalibrationDueDate = Boolean(unit?.calibration_due_date) || requiresMetrology;
    const assetFallbackIcon = unit?.physical_traits?.material_symbol_icon || 'precision_manufacturing';

    const officialTitle =
        unit?.make_model ||
        `${unit?.make_oficial || publishedVault?.make_oficial || ''} ${unit?.model_oficial || publishedVault?.model_oficial || ''
            }`.trim() ||
        t('opermaq_domains.not_declared');

    const unitSerial = unit?.serial_number || unit?.identifier_value || t('opermaq_domains.pending_record');
    const effectiveOwnerTenant = unit?.tenant_id || unit?.tenantId || tenantId;
    const activePillarData = publishedVault?.published_pillars?.[activePillar];
    const activePillarItems = activePillarData?.items || [];
    const customOverrides = unit?.tenant_custom_overrides;

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
                        title={t('common.refresh')}
                        aria-label={t('common.refresh')}
                        className={flatIconBtn}
                    >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                    </button>

                    {canMutateUnit && unit && (
                        <button
                            type="button"
                            onClick={() => {
                                setIsConfirmingDeleteUnit((prev) => !prev);
                                setConfirmDeleteUnitWord('');
                            }}
                            title={t('opermaq_domains.delete_unit_tooltip')}
                            aria-label={t('opermaq_domains.delete_unit_tooltip')}
                            className={flatIconBtn}
                        >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    )}
                </div>
            </header>

            {isConfirmingDeleteUnit && canMutateUnit && unit && (
                <div className="px-[21px] py-[13px] border-b border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col sm:flex-row sm:items-center justify-between gap-[13px] shrink-0">
                    <span className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('opermaq_domains.confirm_delete_unit_prompt')}
                    </span>
                    <div className="flex items-center gap-[8px]">
                        <input
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={confirmDeleteUnitWord}
                            onChange={(e) => setConfirmDeleteUnitWord(e.target.value.toUpperCase())}
                            placeholder="ACTUALIZAR"
                            className="h-8 w-40 px-[8px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                        />
                        <button
                            type="button"
                            disabled={deletingUnit || confirmDeleteUnitWord.trim() !== 'ACTUALIZAR'}
                            onClick={() => void handleDeleteUnit()}
                            className="h-8 px-[13px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                        >
                            {t('common.confirm')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setIsConfirmingDeleteUnit(false);
                                setConfirmDeleteUnitWord('');
                            }}
                            title={t('common.cancel')}
                            aria-label={t('common.cancel')}
                            className={flatIconBtn}
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                </div>
            )}

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

            {/* Macro-Layout Proporción Áurea (61.8% Informe 5 Pilares / 38.2% Unidad, Overrides, Fotos Privadas y Aporte PDF) */}
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
                                        className={`px-[13px] py-[8px] bg-transparent border-0 border-b-2 text-[12px] font-mono uppercase tracking-[0.03em] whitespace-nowrap flex items-center gap-[8px] transition-colors cursor-pointer rounded-none shadow-none ${isActive
                                            ? 'border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] font-bold'
                                            : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                            }`}
                                    >
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

                                        {renderPublishedMarkdown(item.content, activePillar)}

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

                {/* ÁREA MENOR (38.2%) — Datos de Serie, Overrides Operativos Offline-First, Fotografías Privadas y Envío de PDF */}
                <aside className="w-full lg:w-[38.2%] h-full overflow-y-auto border-t lg:border-t-0 lg:border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] space-y-[21px]">
                    {/* Bloque 1: Ficha Acreditativa de Unidad */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none shadow-none">
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
                            {showHorometer && (
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
                            )}
                            {showOdometerKm && (
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.odometer_km_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {typeof unit?.odometer_km === 'number'
                                            ? `${unit.odometer_km.toLocaleString('es-CL')} km`
                                            : t('opermaq_domains.pending_record')}
                                    </dd>
                                </div>
                            )}
                            {showCyclesCount && (
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.cycles_count_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {typeof unit?.cycles_count === 'number'
                                            ? `${unit.cycles_count.toLocaleString('es-CL')}`
                                            : t('opermaq_domains.pending_record')}
                                    </dd>
                                </div>
                            )}
                            {showCalibrationDueDate && (
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#00AEEF]">
                                        {t('opermaq_domains.calibration_due_date_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums font-semibold text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {unit?.calibration_due_date || t('opermaq_domains.pending_record')}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </section>

                    {/* Bloque 1.5: Parámetros Operativos de Faena (`tenant_custom_overrides` · Edición Quirúrgica + Offline-First) */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none shadow-none">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px]">
                            <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                {t('opermaq_domains.overrides_heading')}
                            </h2>
                            {canMutateUnit && unit && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        isEditingOverrides
                                            ? setIsEditingOverrides(false)
                                            : handleOpenEditOverrides()
                                    }
                                    title={
                                        isEditingOverrides
                                            ? t('common.cancel')
                                            : t('opermaq_domains.overrides_edit_tooltip')
                                    }
                                    aria-label={
                                        isEditingOverrides
                                            ? t('common.cancel')
                                            : t('opermaq_domains.overrides_edit_tooltip')
                                    }
                                    className={flatIconBtn}
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        {isEditingOverrides ? 'close' : 'edit'}
                                    </span>
                                </button>
                            )}
                        </div>

                        {overridesStatusNotice && (
                            <div className="p-[8px] border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] text-[11px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none">
                                {overridesStatusNotice}
                            </div>
                        )}

                        {!isEditingOverrides ? (
                            <dl className="grid grid-cols-2 gap-[13px] text-[13px]">
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.overrides_faena_label')}
                                    </dt>
                                    <dd className="font-mono text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 break-words">
                                        {customOverrides?.faena_name || t('opermaq_domains.not_declared')}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.overrides_altitude_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {typeof customOverrides?.altitude_masl === 'number'
                                            ? `${customOverrides.altitude_masl.toLocaleString('es-CL')} msnm`
                                            : t('opermaq_domains.not_declared')}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.overrides_radio_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 break-words">
                                        {customOverrides?.internal_radio_channel ||
                                            t('opermaq_domains.not_declared')}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.overrides_ramp_speed_label')}
                                    </dt>
                                    <dd className="font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                        {typeof customOverrides?.max_ramp_speed_kmh === 'number'
                                            ? `${customOverrides.max_ramp_speed_kmh} km/h`
                                            : t('opermaq_domains.not_declared')}
                                    </dd>
                                </div>
                                <div className="col-span-2">
                                    <dt className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#94A3B8] dark:text-[#5A6072]">
                                        {t('opermaq_domains.overrides_notes_label')}
                                    </dt>
                                    <dd className="text-[12px] text-[#475569] dark:text-[#8A93A6] mt-0.5 break-words">
                                        {customOverrides?.private_operational_notes ||
                                            t('opermaq_domains.not_declared')}
                                    </dd>
                                </div>
                            </dl>
                        ) : (
                            <form
                                onSubmit={handleSaveOverrides}
                                autoComplete="off"
                                spellCheck={false}
                                className="space-y-[13px]"
                            >
                                <div className="grid grid-cols-2 gap-[8px]">
                                    <div className="flex flex-col gap-[4px]">
                                        <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.overrides_faena_label')}
                                        </label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={overrideFaenaName}
                                            onChange={(e) => setOverrideFaenaName(e.target.value)}
                                            className="h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-[4px]">
                                        <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.overrides_altitude_label')}
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={6000}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={overrideAltitudeMasl}
                                            onChange={(e) => setOverrideAltitudeMasl(e.target.value)}
                                            className="h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-[4px]">
                                        <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.overrides_radio_label')}
                                        </label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={overrideRadioChannel}
                                            onChange={(e) => setOverrideRadioChannel(e.target.value)}
                                            className="h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-[4px]">
                                        <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                            {t('opermaq_domains.overrides_ramp_speed_label')}
                                        </label>
                                        <input
                                            type="number"
                                            min={5}
                                            max={120}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={overrideMaxRampSpeed}
                                            onChange={(e) => setOverrideMaxRampSpeed(e.target.value)}
                                            className="h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col gap-[4px]">
                                    <label className="text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.overrides_notes_label')}
                                    </label>
                                    <textarea
                                        rows={2}
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={overrideNotes}
                                        onChange={(e) => setOverrideNotes(e.target.value)}
                                        className="p-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none resize-none select-text"
                                    />
                                </div>

                                <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] space-y-[8px]">
                                    <label className="block text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        {t('opermaq_domains.overrides_confirm_prompt')}
                                    </label>
                                    <div className="flex items-center gap-[8px]">
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={confirmOverridesWord}
                                            onChange={(e) => setConfirmOverridesWord(e.target.value.toUpperCase())}
                                            placeholder="ACTUALIZAR"
                                            className="flex-1 h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                        />
                                        <button
                                            type="submit"
                                            disabled={
                                                savingOverrides || confirmOverridesWord.trim() !== 'ACTUALIZAR'
                                            }
                                            className="h-8 px-[13px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            {t('common.save')}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        )}
                    </section>

                    {/* Bloque 2: Fotografías Privadas del Equipo (`TENANT_PRIVATE`) */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none shadow-none">
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
                                        spellCheck={false}
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
                                        {uploadingPhoto ? (
                                            <M3CircularProgress size={18} strokeWidth={2.5} tone="copper" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[20px]">
                                                add_a_photo
                                            </span>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>

                        {pendingDeletePhotoSha && canMutateUnit && (
                            <div className="p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] space-y-[8px] rounded-none">
                                <label className="block text-[11px] font-mono uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('opermaq_domains.confirm_delete_photo_prompt')}
                                </label>
                                <div className="flex items-center gap-[8px]">
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={confirmDeletePhotoWord}
                                        onChange={(e) => setConfirmDeletePhotoWord(e.target.value.toUpperCase())}
                                        placeholder="ACTUALIZAR"
                                        className="flex-1 h-8 px-[8px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[12px] font-mono tracking-widest uppercase text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none select-text"
                                    />
                                    <button
                                        type="button"
                                        disabled={
                                            deletingPhotoSha === pendingDeletePhotoSha ||
                                            confirmDeletePhotoWord.trim() !== 'ACTUALIZAR'
                                        }
                                        onClick={() => void handleDeletePrivatePhoto(pendingDeletePhotoSha)}
                                        className="h-8 px-[13px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-40 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        {t('actions.delete')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPendingDeletePhotoSha(null);
                                            setConfirmDeletePhotoWord('');
                                        }}
                                        title={t('common.cancel')}
                                        aria-label={t('common.cancel')}
                                        className={flatIconBtn}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {!unit?.private_photos || unit.private_photos.length === 0 ? (
                            <div className="py-[13px] text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {t('opermaq_domains.no_private_photos')}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
                                {unit.private_photos.map((photo) => {
                                    const origBytes = photo.original_bytes ?? photo.originalBytes;
                                    const optBytes = photo.optimized_bytes ?? photo.optimizedBytes;
                                    const computedPct =
                                        photo.savings_pct ??
                                        photo.savingsPct ??
                                        (typeof origBytes === 'number' &&
                                        typeof optBytes === 'number' &&
                                        origBytes > 0
                                            ? Math.max(0, Math.round((1 - optBytes / origBytes) * 100))
                                            : undefined);
                                    const hasCasMetrics =
                                        typeof origBytes === 'number' && typeof optBytes === 'number';

                                    return (
                                        <div
                                            key={photo.sha256}
                                            className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col rounded-none shadow-none"
                                        >
                                            <SecureCasThumbnail
                                                src={photo.url}
                                                alt={officialTitle}
                                                tenantId={effectiveOwnerTenant}
                                                fallbackIcon={assetFallbackIcon}
                                                className="w-full h-24 border-0"
                                            />
                                            {(hasCasMetrics || canMutateUnit) && (
                                                <div className="px-[8px] py-[4px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-[4px]">
                                                    <span className="text-[10px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] truncate">
                                                        {hasCasMetrics
                                                            ? `${formatCasBytesCompact(origBytes)} ➔ CAS ${formatCasBytesCompact(optBytes)} (-${computedPct ?? 0}%)`
                                                            : photo.sha256.slice(0, 8)}
                                                    </span>
                                                    {canMutateUnit && (
                                                        <button
                                                            type="button"
                                                            disabled={deletingPhotoSha === photo.sha256}
                                                            onClick={() => {
                                                                setPendingDeletePhotoSha(photo.sha256);
                                                                setConfirmDeletePhotoWord('');
                                                            }}
                                                            title={t('actions.delete')}
                                                            aria-label={t('actions.delete')}
                                                            className={flatIconBtn}
                                                        >
                                                            {deletingPhotoSha === photo.sha256 ? (
                                                                <M3CircularProgress
                                                                    size={14}
                                                                    strokeWidth={2}
                                                                    tone="copper"
                                                                />
                                                            ) : (
                                                                <span className="material-symbols-outlined text-[15px]">
                                                                    delete
                                                                </span>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Bloque 3: Subida Exclusiva de PDF para Evaluación Anti-Duplicados y Revisión Humana */}
                    <section className="p-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-[13px] rounded-none shadow-none">
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
                                    spellCheck={false}
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    disabled={uploadingPdf}
                                    onClick={() => pdfInputRef.current?.click()}
                                    className="w-full h-9 px-[13px] bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-50 text-white text-[11px] font-mono font-bold uppercase tracking-[0.05em] border-0 rounded-none shadow-none cursor-pointer transition-colors"
                                >
                                    {uploadingPdf
                                        ? t('opermaq_domains.uploading_pdf')
                                        : t('opermaq_domains.upload_pdf_btn')}
                                </button>
                            </div>
                        )}

                        {pdfStatusNotice && (
                            <div className="p-[8px] border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] text-[12px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none">
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

