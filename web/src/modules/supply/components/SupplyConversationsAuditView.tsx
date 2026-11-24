import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CopyButton from '../../../components/common/CopyButton';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import SecureImage from '../../../components/common/SecureImage';
import { cn } from '../../../utils/cn';
import {
    supplyApi,
    type SupplyConversationChainVerification,
    type SupplyConversationExportResult,
} from '../services/supplyApi';
import {
    CANONICAL_WHATSAPP_CHANNEL_IDS,
    type SupplyConversationThread,
    type SupplyConversationTurn,
    type SupplyOperationalRole,
    type SupplyProfileViewRecord,
    type SupplySite,
    type SupplyWhatsAppChannelId,
    type WhatsAppSimMessage,
} from '../types';

export type SupplyLinkedEntityTarget = {
    type: 'REQ' | 'PUR' | 'DTE';
    id: string;
};

export interface SupplyConversationsAuditViewProps {
    threads: SupplyConversationThread[];
    profiles?: SupplyProfileViewRecord[];
    sites: SupplySite[];
    defaultSiteId?: string;
    tenantId?: string;
    loading: boolean;
    canAccessSimulator: boolean;
    simulatorOpen: boolean;
    onToggleSimulator: (open: boolean) => void;
    onNavigateLinked?: (target: SupplyLinkedEntityTarget) => void;
    onRefreshThreads?: () => void;
    onRequisitionCreated?: () => void;
}

const SIM_ROLES: SupplyOperationalRole[] = [
    'CAMP_MANAGER',
    'MECHANIC_TECH',
    'OPS_FOREMAN',
    'WAREHOUSE_KEEPER',
    'HSEC_OFFICER',
    'BUYER',
    'OWNER_EXEC',
];

function formatBytesCompact(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatReadableDateTime(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    try {
        return new Date(ms).toLocaleString('es-CL', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso.slice(0, 16).replace('T', ' ');
    }
}

export const SupplyConversationsAuditView: React.FC<SupplyConversationsAuditViewProps> = ({
    threads,
    profiles = [],
    sites,
    defaultSiteId,
    tenantId,
    loading,
    canAccessSimulator,
    simulatorOpen,
    onToggleSimulator,
    onNavigateLinked,
    onRefreshThreads,
    onRequisitionCreated,
}) => {
    const { t } = useTranslation();
    const uid = useId();

    const [searchQuery, setSearchQuery] = useState('');
    const [channelFilter, setChannelFilter] = useState<SupplyWhatsAppChannelId | 'ALL'>('ALL');
    const [selectedThreadId, setSelectedThreadId] = useState<string>('');

    const [turnsLoading, setTurnsLoading] = useState(false);
    const [turnsError, setTurnsError] = useState<string | null>(null);
    const [turns, setTurns] = useState<SupplyConversationTurn[]>([]);
    const [activeThreadDetail, setActiveThreadDetail] = useState<SupplyConversationThread | null>(
        null
    );
    const [chainVerification, setChainVerification] =
        useState<SupplyConversationChainVerification | null>(null);

    const [exportingFormat, setExportingFormat] = useState<'JSON' | 'CSV' | null>(null);
    const [exportReceipt, setExportReceipt] = useState<SupplyConversationExportResult | null>(null);

    // Simulador Humano (elige persona registrada o cargo estándar; cero E.164 ni S1/FSM en Capa 1)
    const [selectedSimProfileId, setSelectedSimProfileId] = useState<string>('');
    const [simPhone, setSimPhone] = useState('');
    const [simRole, setSimRole] = useState<SupplyOperationalRole>('CAMP_MANAGER');
    const [simInput, setSimInput] = useState('');
    const [simBusy, setSimBusy] = useState(false);
    const [simMessages, setSimMessages] = useState<WhatsAppSimMessage[]>([]);

    useEffect(() => {
        if (!selectedSimProfileId && profiles.length > 0) {
            setSelectedSimProfileId(profiles[0].profileId);
        } else if (!selectedSimProfileId) {
            setSelectedSimProfileId('__STANDARD__');
        }
    }, [profiles, selectedSimProfileId]);

    const activeSimProfile = useMemo(
        () => profiles.find((p) => p.profileId === selectedSimProfileId) || null,
        [profiles, selectedSimProfileId]
    );

    const effectiveSimRole: SupplyOperationalRole = activeSimProfile
        ? activeSimProfile.role
        : simRole;

    const effectiveSimSenderLabel = activeSimProfile
        ? activeSimProfile.displayName
        : t(`supply.roles.${effectiveSimRole}`);

    const filteredThreads = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return threads.filter((th) => {
            if (
                channelFilter !== 'ALL' &&
                !(th.activeEffectiveChannels || []).includes(channelFilter)
            ) {
                return false;
            }
            if (!q) return true;
            const hay = [
                th.threadId,
                th.profileId,
                th.displayName,
                th.role,
                th.phoneMasked,
                ...(th.linkedRequisitionIds || []),
                ...(th.linkedPurchaseIds || []),
                ...(th.linkedDteIds || []),
            ]
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }, [channelFilter, searchQuery, threads]);

    const selectedThread = useMemo(() => {
        if (selectedThreadId) {
            const explicit = threads.find((th) => th.threadId === selectedThreadId);
            if (explicit) return explicit;
        }
        return filteredThreads[0] || threads[0] || null;
    }, [filteredThreads, selectedThreadId, threads]);

    useEffect(() => {
        if (filteredThreads.length === 0) return;
        if (
            !selectedThreadId ||
            !filteredThreads.some((th) => th.threadId === selectedThreadId)
        ) {
            setSelectedThreadId(filteredThreads[0].threadId);
        }
    }, [filteredThreads, selectedThreadId]);

    const loadTurnsForThread = useCallback(
        async (threadId: string) => {
            setTurnsLoading(true);
            setTurnsError(null);
            setExportReceipt(null);
            try {
                const res = await supplyApi.listSupplyConversationTurns(threadId, {}, tenantId);
                setTurns(res.turns);
                setActiveThreadDetail(res.thread || null);
                setChainVerification(res.chainVerification);
            } catch (err) {
                setTurns([]);
                setChainVerification(null);
                setTurnsError(err instanceof Error ? err.message : 'CONVERSATION_TURNS_ERROR');
            } finally {
                setTurnsLoading(false);
            }
        },
        [tenantId]
    );

    useEffect(() => {
        if (!selectedThread?.threadId) {
            setTurns([]);
            setActiveThreadDetail(null);
            setChainVerification(null);
            return;
        }
        void loadTurnsForThread(selectedThread.threadId);
    }, [loadTurnsForThread, selectedThread?.threadId]);

    const handleExport = async (format: 'JSON' | 'CSV') => {
        const targetId = selectedThread?.threadId;
        if (!targetId) return;
        setExportingFormat(format);
        setTurnsError(null);
        try {
            const result = await supplyApi.exportSupplyConversation(targetId, format, tenantId);
            setExportReceipt(result);
            if (
                typeof window !== 'undefined' &&
                typeof Blob !== 'undefined' &&
                typeof window.URL?.createObjectURL === 'function'
            ) {
                const mime =
                    format === 'CSV'
                        ? 'text/csv;charset=utf-8'
                        : 'application/json;charset=utf-8';
                const blob = new Blob([result.bodyText], { type: mime });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = result.filename;
                anchor.click();
                window.URL.revokeObjectURL(url);
            }
        } catch (err) {
            setTurnsError(err instanceof Error ? err.message : 'EXPORT_ERROR');
        } finally {
            setExportingFormat(null);
        }
    };

    const sendSimulatedMessage = async (textOverride?: string, resetSession: boolean = false) => {
        if (!canAccessSimulator) return;
        const messageText = (textOverride ?? simInput).trim();
        if (!messageText && !resetSession) return;

        if (resetSession) {
            setSimMessages([]);
        } else {
            setSimMessages((prev) => [
                ...prev,
                {
                    id: `in_${Date.now()}`,
                    direction: 'INBOUND',
                    text: messageText,
                    timestamp: new Date().toISOString(),
                },
            ]);
            setSimInput('');
        }

        setSimBusy(true);
        try {
            const res = await supplyApi.simulateWhatsAppMessage(
                {
                    siteId: defaultSiteId || sites[0]?.siteId || 'site-main',
                    phoneE164: simPhone.trim(),
                    simulateSenderRole: effectiveSimRole,
                    text: resetSession ? '/reset' : messageText,
                    resetSession,
                },
                tenantId
            );
            setSimMessages((prev) => [
                ...prev,
                {
                    id: `out_${Date.now()}`,
                    direction: 'OUTBOUND',
                    text: res.replyText,
                    fsmState: res.fsmState,
                    hardDeniedItems: res.hardDeniedItems,
                    atypicalFlags: res.atypicalFlags,
                    missingSlots: res.missingSlots,
                    committedReqId: res.committedReqId,
                    timestamp: new Date().toISOString(),
                },
            ]);
            if (res.committedReqId) {
                onRequisitionCreated?.();
            }
            onRefreshThreads?.();
        } catch (err) {
            setSimMessages((prev) => [
                ...prev,
                {
                    id: `err_${Date.now()}`,
                    direction: 'OUTBOUND',
                    text: err instanceof Error ? err.message : 'SIM_ERROR',
                    timestamp: new Date().toISOString(),
                },
            ]);
        } finally {
            setSimBusy(false);
        }
    };

    const threadToRender =
        activeThreadDetail && activeThreadDetail.threadId === selectedThread?.threadId
            ? activeThreadDetail
            : selectedThread;

    const underlineInputClass =
        'w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[16px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';

    return (
        <div
            data-testid="supply-conversations-audit-view"
            className="w-full h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] bg-[#FFFFFF] dark:bg-[#000000] select-none"
        >
            {/* Izquierda 38.2%: Lista plana de personas y conversaciones */}
            <aside className="border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col min-h-0">
                <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                    <h3 className="text-[18px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.conversations.title')}
                    </h3>

                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t('supply.conversations.search_placeholder')}
                        placeholder={t('supply.conversations.search_placeholder')}
                        data-testid="conv-search-input"
                        className={`${underlineInputClass} select-text`}
                    />

                    <select
                        value={channelFilter}
                        onChange={(e) =>
                            setChannelFilter(e.target.value as SupplyWhatsAppChannelId | 'ALL')
                        }
                        aria-label={t('supply.conversations.filter_channel')}
                        data-testid="conv-channel-filter"
                        className={underlineInputClass}
                    >
                        <option value="ALL">{t('supply.conversations.all_channels')}</option>
                        {CANONICAL_WHATSAPP_CHANNEL_IDS.map((ch) => (
                            <option key={ch} value={ch}>
                                {t(`supply.channels.${ch}`)}
                            </option>
                        ))}
                    </select>
                </div>

                {loading && (
                    <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredThreads.length === 0 ? (
                        <div className="p-fib-21 text-[16px] text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.conversations.empty_threads')}
                        </div>
                    ) : (
                        filteredThreads.map((th) => {
                            const isSelected = th.threadId === selectedThread?.threadId;
                            const isLegalNotice = th.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED';

                            return (
                                <button
                                    key={th.threadId}
                                    type="button"
                                    onClick={() => setSelectedThreadId(th.threadId)}
                                    data-testid={`conv-thread-row-${th.threadId}`}
                                    className={cn(
                                        'w-full text-left px-fib-21 py-fib-13 min-h-[60px] border-0 border-l-[3px] transition-colors cursor-pointer rounded-none shadow-none space-y-1',
                                        isLegalNotice ? 'border-l-[#C68346]' : 'border-l-transparent',
                                        isSelected
                                            ? 'bg-[#F8FAFC] dark:bg-[#07090D]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D]'
                                    )}
                                >
                                    <div className="flex items-baseline justify-between gap-fib-8">
                                        <span className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {th.displayName}
                                        </span>
                                        <span className="text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6] shrink-0">
                                            {formatReadableDateTime(th.lastTurnAtIso)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        <span className="truncate">{t(`supply.roles.${th.role}`)}</span>
                                        <span className="tabular-nums shrink-0">
                                            {th.turnCount} {t('supply.conversations.turns_count')}
                                        </span>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Derecha 61.8%: Conversación limpia en español + (opcional) Simulador humano lado a lado */}
            <div
                className={cn(
                    'min-h-0 overflow-hidden',
                    canAccessSimulator && simulatorOpen
                        ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,61.8fr)_minmax(0,38.2fr)]'
                        : 'flex flex-col'
                )}
            >
                {/* Hilo de Conversación (Capa 1 limpia + Capa 2 acordeón auditoría) */}
                <div className="min-h-0 flex-1 overflow-y-auto p-fib-21 sm:p-fib-34 space-y-fib-21">
                    {turnsError && (
                        <div className="border-l-[3px] border-[#C68346] pl-fib-13 py-fib-8 text-[15px] text-[#9A5B21] dark:text-[#C68346]">
                            {turnsError}
                        </div>
                    )}

                    {!threadToRender ? (
                        <div className="p-fib-34 text-[17px] text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.conversations.select_thread')}
                        </div>
                    ) : (
                        <>
                            <header className="space-y-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                                <div className="flex flex-wrap items-start justify-between gap-fib-13">
                                    <div className="space-y-1 min-w-0">
                                        <h3 className="text-[22px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {threadToRender.displayName}
                                        </h3>
                                        <div className="text-[15px] text-[#475569] dark:text-[#8A93A6] flex flex-wrap items-center gap-fib-8 tabular-nums">
                                            <span>{t(`supply.roles.${threadToRender.role}`)}</span>
                                            <span>·</span>
                                            <span className="select-text">
                                                {threadToRender.phoneMasked}
                                            </span>
                                        </div>
                                    </div>

                                    {chainVerification?.valid === false && (
                                        <span className="border-l-[3px] border-l-[#C68346] pl-fib-13 text-[14px] font-semibold text-[#9A5B21] dark:text-[#C68346]">
                                            {t('supply.conversations.chain_broken')} #
                                            {chainVerification.brokenAtSeq ?? '?'}
                                        </span>
                                    )}
                                </div>

                                {/* Pedidos / Compras / Documentos vinculados en lenguaje claro */}
                                {((threadToRender.linkedRequisitionIds?.length || 0) > 0 ||
                                    (threadToRender.linkedPurchaseIds?.length || 0) > 0 ||
                                    (threadToRender.linkedDteIds?.length || 0) > 0) && (
                                    <div className="flex flex-wrap items-center gap-fib-13 text-[15px]">
                                        {(threadToRender.linkedRequisitionIds || []).map((reqId) => (
                                            <button
                                                key={`th-req-${reqId}`}
                                                type="button"
                                                onClick={() =>
                                                    onNavigateLinked?.({ type: 'REQ', id: reqId })
                                                }
                                                data-testid={`thread-link-req-${reqId}`}
                                                className="bg-transparent border-0 p-1 min-h-[48px] text-[#0369A1] dark:text-[#00AEEF] hover:underline inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none font-medium"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    link
                                                </span>
                                                <span>
                                                    {t('supply.conversations.linked_req')}: {reqId}
                                                </span>
                                            </button>
                                        ))}
                                        {(threadToRender.linkedPurchaseIds || []).map((purId) => (
                                            <button
                                                key={`th-pur-${purId}`}
                                                type="button"
                                                onClick={() =>
                                                    onNavigateLinked?.({ type: 'PUR', id: purId })
                                                }
                                                data-testid={`thread-link-pur-${purId}`}
                                                className="bg-transparent border-0 p-1 min-h-[48px] text-[#0369A1] dark:text-[#00AEEF] hover:underline inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none font-medium"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    link
                                                </span>
                                                <span>
                                                    {t('supply.conversations.linked_pur')}: {purId}
                                                </span>
                                            </button>
                                        ))}
                                        {(threadToRender.linkedDteIds || []).map((dteId) => (
                                            <button
                                                key={`th-dte-${dteId}`}
                                                type="button"
                                                onClick={() =>
                                                    onNavigateLinked?.({ type: 'DTE', id: dteId })
                                                }
                                                data-testid={`thread-link-dte-${dteId}`}
                                                className="bg-transparent border-0 p-1 min-h-[48px] text-[#9A5B21] dark:text-[#C68346] hover:underline inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none font-medium"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    receipt_long
                                                </span>
                                                <span>
                                                    {t('supply.conversations.linked_dte')}: {dteId}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </header>

                            {turnsLoading ? (
                                <M3LinearProgress
                                    indeterminate
                                    ariaLabel={t('supply.common.loading')}
                                />
                            ) : turns.length === 0 ? (
                                <div className="py-fib-34 text-[16px] text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.conversations.empty_turns')}
                                </div>
                            ) : (
                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                    {turns.map((turn) => {
                                        const hasPolicyDeny =
                                            (turn.policyAuditRefs?.length || 0) > 0;
                                        const turnBorder = hasPolicyDeny
                                            ? 'border-l-[#C68346]'
                                            : turn.direction === 'OUTBOUND'
                                              ? 'border-l-[#00AEEF]'
                                              : 'border-l-transparent';
                                        const tempScopeSet = new Set(
                                            turn.scopeSnapshot.temporaryChannels || []
                                        );
                                        const speakerName =
                                            turn.direction === 'OUTBOUND'
                                                ? t('supply.backlog.sim_bot_name')
                                                : turn.direction === 'SYSTEM_POLICY'
                                                  ? t('supply.conversations.dir_SYSTEM_POLICY')
                                                  : threadToRender.displayName;

                                        return (
                                            <article
                                                key={turn.turnId}
                                                data-testid={`conv-turn-${turn.seq}`}
                                                className={cn(
                                                    'py-fib-21 pl-fib-13 border-l-[3px] space-y-fib-13',
                                                    turnBorder
                                                )}
                                            >
                                                <div className="flex flex-wrap items-baseline justify-between gap-fib-8">
                                                    <span
                                                        className={cn(
                                                            'text-[15px] font-semibold',
                                                            turn.direction === 'OUTBOUND'
                                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                : hasPolicyDeny
                                                                  ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                                  : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                        )}
                                                    >
                                                        {speakerName}
                                                    </span>
                                                    <span className="text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                        {formatReadableDateTime(turn.createdAtIso)}
                                                    </span>
                                                </div>

                                                {/* Cuerpo del mensaje limpio para lectura fácil 70+ */}
                                                <div className="text-[17px] leading-relaxed text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                                    {turn.contentScrubbed}
                                                </div>

                                                {hasPolicyDeny && (
                                                    <div className="text-[14px] font-semibold text-[#9A5B21] dark:text-[#C68346]">
                                                        {t('supply.backlog.sim_blocked_notice')}
                                                    </div>
                                                )}

                                                {/* Imágenes o audios adjuntos directos */}
                                                {(turn.casMedia?.length || 0) > 0 && (
                                                    <div className="space-y-fib-8">
                                                        {turn.casMedia.map((media) => {
                                                            const isImage =
                                                                media.mimeType.startsWith('image/');
                                                            const isAudio =
                                                                media.mimeType.startsWith('audio/');
                                                            return (
                                                                <div
                                                                    key={`${turn.turnId}-${media.sha256}`}
                                                                    className="space-y-fib-8"
                                                                >
                                                                    {isImage && (
                                                                        <SecureImage
                                                                            src={media.downloadUrl}
                                                                            alt={
                                                                                media.originalFilename ||
                                                                                media.sha256
                                                                            }
                                                                            className="max-h-52 object-contain"
                                                                        />
                                                                    )}
                                                                    {isAudio && (
                                                                        <div className="flex items-center gap-fib-8">
                                                                            <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                                                                                volume_up
                                                                            </span>
                                                                            <audio
                                                                                controls
                                                                                preload="none"
                                                                                aria-label={t(
                                                                                    'supply.conversations.cas_audio_aria'
                                                                                )}
                                                                                src={media.downloadUrl}
                                                                                className="w-full max-w-md"
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* Enlaces de este mensaje en lenguaje claro */}
                                                {((turn.linkedRequisitionIds?.length || 0) > 0 ||
                                                    (turn.linkedPurchaseIds?.length || 0) > 0 ||
                                                    (turn.linkedDteIds?.length || 0) > 0) && (
                                                    <div className="flex flex-wrap items-center gap-fib-13 text-[14px]">
                                                        {(turn.linkedRequisitionIds || []).map(
                                                            (id) => (
                                                                <button
                                                                    key={`${turn.turnId}-req-${id}`}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        onNavigateLinked?.({
                                                                            type: 'REQ',
                                                                            id,
                                                                        })
                                                                    }
                                                                    className="bg-transparent border-0 p-1 min-h-[48px] text-[#0369A1] dark:text-[#00AEEF] hover:underline inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">
                                                                        link
                                                                    </span>
                                                                    <span>
                                                                        {t(
                                                                            'supply.conversations.linked_req'
                                                                        )}
                                                                        : {id}
                                                                    </span>
                                                                </button>
                                                            )
                                                        )}
                                                        {(turn.linkedPurchaseIds || []).map((id) => (
                                                            <button
                                                                key={`${turn.turnId}-pur-${id}`}
                                                                type="button"
                                                                onClick={() =>
                                                                    onNavigateLinked?.({
                                                                        type: 'PUR',
                                                                        id,
                                                                    })
                                                                }
                                                                className="bg-transparent border-0 p-1 min-h-[48px] text-[#0369A1] dark:text-[#00AEEF] hover:underline inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">
                                                                    link
                                                                </span>
                                                                <span>
                                                                    {t(
                                                                        'supply.conversations.linked_pur'
                                                                    )}
                                                                    : {id}
                                                                </span>
                                                            </button>
                                                        ))}
                                                        {(turn.linkedDteIds || []).map((id) => (
                                                            <button
                                                                key={`${turn.turnId}-dte-${id}`}
                                                                type="button"
                                                                onClick={() =>
                                                                    onNavigateLinked?.({
                                                                        type: 'DTE',
                                                                        id,
                                                                    })
                                                                }
                                                                className="bg-transparent border-0 p-1 min-h-[48px] text-[#9A5B21] dark:text-[#C68346] hover:underline inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">
                                                                    receipt_long
                                                                </span>
                                                                <span>
                                                                    {t(
                                                                        'supply.conversations.linked_dte'
                                                                    )}
                                                                    : {id}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Capa 2 por turno (cerrado por defecto): permisos en ese instante, CAS, SHA-256 */}
                                                <details className="pt-fib-8">
                                                    <summary className="min-h-[48px] inline-flex items-center gap-1 cursor-pointer text-[14px] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]">
                                                        <span>
                                                            {t('supply.conversations.audit_toggle')}
                                                        </span>
                                                        <span className="material-symbols-outlined text-[16px]">
                                                            expand_more
                                                        </span>
                                                    </summary>

                                                    <div className="mt-fib-8 pl-fib-13 border-l border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                        <div className="flex flex-wrap items-center gap-fib-13 font-mono tabular-nums">
                                                            <span>
                                                                #{turn.seq} ·{' '}
                                                                {t(
                                                                    `supply.conversations.source_${turn.channelSource}`
                                                                )}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1 select-text">
                                                                {t('supply.conversations.turn_hash')}
                                                                : {turn.turnHash.slice(0, 12)}
                                                                <CopyButton
                                                                    value={turn.turnHash}
                                                                    title={t(
                                                                        'supply.common.copy_code'
                                                                    )}
                                                                />
                                                            </span>
                                                        </div>

                                                        <div
                                                            data-testid={`turn-scope-${turn.seq}`}
                                                            className="space-y-1"
                                                        >
                                                            <div>
                                                                {t(
                                                                    'supply.conversations.scope_fingerprint'
                                                                )}
                                                                :{' '}
                                                                <span className="font-mono">
                                                                    {turn.scopeSnapshot.scopeFingerprint.slice(
                                                                        0,
                                                                        12
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-fib-8">
                                                                {(
                                                                    turn.scopeSnapshot
                                                                        .effectiveChannels || []
                                                                ).map((ch) => {
                                                                    const isTemp =
                                                                        tempScopeSet.has(ch);
                                                                    return (
                                                                        <span
                                                                            key={`${turn.turnId}-${ch}`}
                                                                            className={cn(
                                                                                'text-[14px]',
                                                                                isTemp
                                                                                    ? 'text-[#0369A1] dark:text-[#00AEEF] font-semibold'
                                                                                    : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                                            )}
                                                                        >
                                                                            {t(
                                                                                `supply.channels.${ch}`
                                                                            )}{' '}
                                                                            (
                                                                            {isTemp
                                                                                ? t(
                                                                                      'supply.conversations.scope_temporary'
                                                                                  )
                                                                                : t(
                                                                                      'supply.conversations.scope_permanent'
                                                                                  )}
                                                                            )
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        {(turn.casMedia?.length || 0) > 0 &&
                                                            turn.casMedia.map((media) => (
                                                                <div
                                                                    key={`${turn.turnId}-meta-${media.sha256}`}
                                                                    className="font-mono text-[13px] tabular-nums flex flex-wrap items-center gap-fib-8"
                                                                >
                                                                    <span>
                                                                        {t(
                                                                            'supply.conversations.cas_orig_label'
                                                                        )}
                                                                        :{' '}
                                                                        {formatBytesCompact(
                                                                            media.originalBytes
                                                                        )}{' '}
                                                                        ➔{' '}
                                                                        {formatBytesCompact(
                                                                            media.optimizedBytes
                                                                        )}{' '}
                                                                        (-{media.savingsPct}%)
                                                                    </span>
                                                                    <CopyButton
                                                                        value={media.sha256}
                                                                        title={t(
                                                                            'supply.common.copy_code'
                                                                        )}
                                                                    />
                                                                </div>
                                                            ))}

                                                        {hasPolicyDeny && (
                                                            <div
                                                                data-testid={`turn-policy-audit-${turn.seq}`}
                                                                className="font-mono text-[13px] text-[#9A5B21] dark:text-[#C68346] select-text"
                                                            >
                                                                {t(
                                                                    'supply.conversations.policy_audit_title'
                                                                )}
                                                                : {turn.policyAuditRefs.join(' · ')}
                                                            </div>
                                                        )}

                                                        {(turn.redactedCategories?.length || 0) > 0 && (
                                                            <div>
                                                                {t(
                                                                    'supply.conversations.pii_redacted'
                                                                )}
                                                                : {turn.redactedCategories.join(', ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </details>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Capa 2 Global (cerrado por defecto): Verificación criptográfica, retención y descarga */}
                            <details
                                data-testid="conv-audit-accordion"
                                className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21"
                            >
                                <summary className="min-h-[48px] flex items-center justify-between cursor-pointer text-[15px] font-medium text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]">
                                    <span>{t('supply.conversations.audit_toggle')}</span>
                                    <span className="material-symbols-outlined text-[20px]">
                                        expand_more
                                    </span>
                                </summary>

                                <div className="pt-fib-21 space-y-fib-21 text-[15px]">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                                        <div className="space-y-1">
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.conversations.head_hash')}
                                            </div>
                                            <div
                                                data-testid="conv-chain-status"
                                                className={cn(
                                                    'font-semibold inline-flex items-center gap-1',
                                                    chainVerification?.valid === false
                                                        ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                        : 'text-[#0369A1] dark:text-[#00AEEF]'
                                                )}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    {chainVerification?.valid === false
                                                        ? 'warning'
                                                        : 'verified_user'}
                                                </span>
                                                <span>
                                                    {chainVerification?.valid === false
                                                        ? `${t('supply.conversations.chain_broken')} #${chainVerification.brokenAtSeq ?? '?'}`
                                                        : t('supply.conversations.chain_valid')}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.conversations.legal_hold_years')}
                                            </div>
                                            <div
                                                data-testid="conv-retention-badge"
                                                className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]"
                                            >
                                                {t(
                                                    `supply.conversations.retention_${threadToRender.retentionPolicy}`
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                                {t('supply.conversations.retention_until')}
                                            </div>
                                            <div className="font-mono font-semibold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                {threadToRender.retentionExpiresAtIso.slice(0, 10)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-fib-13">
                                        <button
                                            type="button"
                                            disabled={Boolean(exportingFormat)}
                                            onClick={() => void handleExport('CSV')}
                                            data-testid="export-conv-csv-btn"
                                            className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-semibold inline-flex items-center gap-fib-8 rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">
                                                download
                                            </span>
                                            <span>{t('supply.conversations.export_csv')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={Boolean(exportingFormat)}
                                            onClick={() => void handleExport('JSON')}
                                            data-testid="export-conv-json-btn"
                                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] text-[15px] font-medium inline-flex items-center gap-fib-8 rounded-none shadow-none cursor-pointer disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-[20px] text-[#00AEEF]">
                                                download
                                            </span>
                                            <span>{t('supply.conversations.export_json')}</span>
                                        </button>
                                    </div>

                                    {exportReceipt && (
                                        <div
                                            data-testid="conv-export-receipt"
                                            className="border-l-[3px] border-[#00AEEF] pl-fib-13 py-fib-8 text-[14px] space-y-1 tabular-nums"
                                        >
                                            <div className="text-[#0369A1] dark:text-[#00AEEF] font-semibold">
                                                {t('supply.conversations.export_receipt')}:{' '}
                                                {exportReceipt.filename}
                                            </div>
                                            <div className="font-mono inline-flex items-center gap-1 select-text">
                                                <span>{exportReceipt.sha256 || '—'}</span>
                                                {exportReceipt.sha256 && (
                                                    <CopyButton
                                                        value={exportReceipt.sha256}
                                                        title={t('supply.common.copy_code')}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </details>
                        </>
                    )}
                </div>

                {/* Simulador Humano "Probar asistente" (panel lateral dedicado, sin jerga E.164/FSM/S1) */}
                {canAccessSimulator && simulatorOpen && (
                    <section
                        data-testid="ws-dev-simulator-panel"
                        className="min-h-0 flex flex-col border-t xl:border-t-0 xl:border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]"
                    >
                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8">
                            <div className="flex items-center gap-fib-8">
                                <span className="material-symbols-outlined text-[22px] text-[#00AEEF]">
                                    chat
                                </span>
                                <h4 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('supply.backlog.sim_title')}
                                </h4>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => void sendSimulatedMessage(undefined, true)}
                                    aria-label={t('supply.backlog.sim_reset')}
                                    title={t('supply.backlog.sim_reset')}
                                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#7C3F0E] dark:hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        refresh
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onToggleSimulator(false)}
                                    aria-label={t('supply.common.close')}
                                    title={t('supply.common.close')}
                                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[20px]">
                                        close
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="p-fib-21 space-y-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="space-y-1">
                                <label
                                    htmlFor={`${uid}-sim-person`}
                                    className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.backlog.sim_select_person')}
                                </label>
                                <select
                                    id={`${uid}-sim-person`}
                                    value={selectedSimProfileId}
                                    onChange={(e) => setSelectedSimProfileId(e.target.value)}
                                    className={underlineInputClass}
                                >
                                    {profiles.map((p) => (
                                        <option key={p.profileId} value={p.profileId}>
                                            {p.displayName} — {t(`supply.roles.${p.role}`)}
                                        </option>
                                    ))}
                                    <option value="__STANDARD__">
                                        {t('supply.backlog.sim_standard_person')}
                                    </option>
                                </select>
                            </div>

                            {activeSimProfile ? (
                                <div className="text-[14px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                    <span className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('supply.backlog.sim_allowed_today')}{' '}
                                    </span>
                                    {activeSimProfile.effectiveChannels.length > 0
                                        ? activeSimProfile.effectiveChannels
                                              .map((ch) => t(`supply.channels.${ch}`))
                                              .join(', ')
                                        : t('supply.profiles_ws.matrix_inactive')}
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <label
                                        htmlFor={`${uid}-sim-role`}
                                        className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]"
                                    >
                                        {t('supply.backlog.sim_role')}
                                    </label>
                                    <select
                                        id={`${uid}-sim-role`}
                                        value={simRole}
                                        onChange={(e) =>
                                            setSimRole(e.target.value as SupplyOperationalRole)
                                        }
                                        className={underlineInputClass}
                                    >
                                        {SIM_ROLES.map((r) => (
                                            <option key={r} value={r}>
                                                {t(`supply.roles.${r}`)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <details className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                <summary className="cursor-pointer py-1">
                                    {t('supply.backlog.sim_phone')}
                                </summary>
                                <input
                                    id={`${uid}-sim-phone`}
                                    type="text"
                                    value={simPhone}
                                    onChange={(e) => setSimPhone(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label={t('supply.backlog.sim_phone')}
                                    placeholder={t('supply.profiles_ws.field_phone_placeholder')}
                                    className={`${underlineInputClass} select-text`}
                                />
                            </details>

                            {/* 4 Botones de ejemplo en español natural */}
                            <div className="flex flex-col gap-1 pt-fib-8">
                                <button
                                    type="button"
                                    disabled={simBusy}
                                    onClick={() =>
                                        void sendSimulatedMessage(
                                            t('supply.backlog.sim_preset_slots_msg')
                                        )
                                    }
                                    className="text-left min-h-[48px] px-fib-13 bg-transparent border-0 border-l-[3px] border-l-transparent hover:border-l-[#00AEEF] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] text-[15px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('supply.backlog.sim_preset_slots')}
                                </button>
                                <button
                                    type="button"
                                    disabled={simBusy}
                                    onClick={() =>
                                        void sendSimulatedMessage(
                                            t('supply.backlog.sim_preset_deny_msg')
                                        )
                                    }
                                    className="text-left min-h-[48px] px-fib-13 bg-transparent border-0 border-l-[3px] border-l-transparent hover:border-l-[#C68346] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] text-[15px] text-[#7C3F0E] dark:text-[#C68346] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('supply.backlog.sim_preset_deny')}
                                </button>
                                <button
                                    type="button"
                                    disabled={simBusy}
                                    onClick={() =>
                                        void sendSimulatedMessage(
                                            t('supply.backlog.sim_preset_atypical_msg')
                                        )
                                    }
                                    className="text-left min-h-[48px] px-fib-13 bg-transparent border-0 border-l-[3px] border-l-transparent hover:border-l-[#C68346] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] text-[15px] text-[#7C3F0E] dark:text-[#C68346] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('supply.backlog.sim_preset_atypical')}
                                </button>
                                <button
                                    type="button"
                                    disabled={simBusy}
                                    onClick={() => void sendSimulatedMessage('OK')}
                                    className="text-left min-h-[48px] px-fib-13 bg-transparent border-0 border-l-[3px] border-l-[#00AEEF] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] text-[15px] font-semibold text-[#0369A1] dark:text-[#00AEEF] rounded-none shadow-none cursor-pointer"
                                >
                                    {t('supply.backlog.sim_preset_confirm')}
                                </button>
                            </div>
                        </div>

                        {simBusy && (
                            <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
                        )}

                        {/* Hilo del chat de prueba */}
                        <div className="flex-1 min-h-[200px] overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C] px-fib-21">
                            {simMessages.map((msg) => {
                                const hasAlert = Boolean(
                                    msg.hardDeniedItems?.length || msg.atypicalFlags?.length
                                );
                                return (
                                    <div
                                        key={msg.id}
                                        className={cn(
                                            'py-fib-13 pl-fib-13 space-y-1 border-l-[3px]',
                                            hasAlert
                                                ? 'border-[#C68346]'
                                                : msg.direction === 'OUTBOUND'
                                                  ? 'border-[#00AEEF]'
                                                  : 'border-transparent'
                                        )}
                                    >
                                        <div className="flex items-baseline justify-between gap-fib-8 text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                            <span className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {msg.direction === 'INBOUND'
                                                    ? effectiveSimSenderLabel
                                                    : t('supply.backlog.sim_bot_name')}
                                            </span>
                                            <span className="tabular-nums">
                                                {formatReadableDateTime(msg.timestamp)}
                                            </span>
                                        </div>
                                        <div className="text-[17px] leading-relaxed text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                            {msg.text}
                                        </div>
                                        {hasAlert && (
                                            <div className="text-[14px] font-semibold text-[#7C3F0E] dark:text-[#C68346]">
                                                {t('supply.backlog.sim_blocked_notice')}
                                            </div>
                                        )}
                                        {msg.committedReqId && (
                                            <div className="flex items-center gap-fib-8 text-[14px] font-semibold text-[#0369A1] dark:text-[#00AEEF] select-text">
                                                <span>
                                                    {t('supply.conversations.linked_req')}:{' '}
                                                    {msg.committedReqId}
                                                </span>
                                                <CopyButton
                                                    value={msg.committedReqId}
                                                    title={t('supply.common.copy_code')}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void sendSimulatedMessage();
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            className="p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-8"
                        >
                            <input
                                type="text"
                                value={simInput}
                                onChange={(e) => setSimInput(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={t('supply.backlog.sim_input_placeholder')}
                                placeholder={t('supply.backlog.sim_input_placeholder')}
                                className="flex-1 min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-[16px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <button
                                type="submit"
                                disabled={simBusy || !simInput.trim()}
                                aria-label={t('supply.backlog.sim_send')}
                                title={t('supply.backlog.sim_send')}
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[24px]">send</span>
                            </button>
                        </form>
                    </section>
                )}
            </div>
        </div>
    );
};

export default SupplyConversationsAuditView;
