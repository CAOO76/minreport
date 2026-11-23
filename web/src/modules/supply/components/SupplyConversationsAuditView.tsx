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

export const SupplyConversationsAuditView: React.FC<SupplyConversationsAuditViewProps> = ({
    threads,
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

    // Decoupled DEV / TEST-PILOT WhatsApp Simulator State (zero hardcoded phone numbers)
    const [simPhone, setSimPhone] = useState('');
    const [simRole, setSimRole] = useState<SupplyOperationalRole>('CAMP_MANAGER');
    const [simInput, setSimInput] = useState('');
    const [simBusy, setSimBusy] = useState(false);
    const [simMessages, setSimMessages] = useState<WhatsAppSimMessage[]>([]);

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
                    simulateSenderRole: simRole,
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

    const threadToRender = activeThreadDetail && activeThreadDetail.threadId === selectedThread?.threadId
        ? activeThreadDetail
        : selectedThread;

    const inputClass =
        'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';

    return (
        <div
            data-testid="supply-conversations-audit-view"
            className="w-full h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] bg-[#FFFFFF] dark:bg-[#000000] select-none"
        >
            {/* Left 38.2%: Profiles / Threads Directory + Channel Filter */}
            <aside className="border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col min-h-0">
                <div className="p-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] space-y-fib-13">
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="flex items-center gap-fib-8 min-w-0">
                            <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">
                                forum
                            </span>
                            <h3 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {t('supply.conversations.title')}
                            </h3>
                        </div>
                        {canAccessSimulator && (
                            <button
                                type="button"
                                onClick={() => onToggleSimulator(!simulatorOpen)}
                                aria-label={t('supply.conversations.open_simulator')}
                                title={t('supply.conversations.open_simulator')}
                                data-testid="toggle-ws-simulator-btn"
                                className={cn(
                                    'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none shrink-0',
                                    simulatorOpen
                                        ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                        : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                )}
                            >
                                <span className="material-symbols-outlined text-[22px]">chat</span>
                            </button>
                        )}
                    </div>

                    <div className="space-y-fib-8">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            aria-label={t('supply.conversations.search_placeholder')}
                            placeholder={t('supply.conversations.search_placeholder')}
                            data-testid="conv-search-input"
                            className={`${inputClass} select-text`}
                        />

                        <select
                            value={channelFilter}
                            onChange={(e) =>
                                setChannelFilter(e.target.value as SupplyWhatsAppChannelId | 'ALL')
                            }
                            aria-label={t('supply.conversations.filter_channel')}
                            data-testid="conv-channel-filter"
                            className={inputClass}
                        >
                            <option value="ALL">{t('supply.conversations.all_channels')}</option>
                            {CANONICAL_WHATSAPP_CHANNEL_IDS.map((ch) => (
                                <option key={ch} value={ch}>
                                    {t(`supply.channels.${ch}`)} ({ch})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading && (
                    <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredThreads.length === 0 ? (
                        <div className="p-fib-21 font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.conversations.empty_threads')}
                        </div>
                    ) : (
                        filteredThreads.map((th) => {
                            const isSelected = th.threadId === selectedThread?.threadId;
                            const borderClass =
                                th.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED'
                                    ? 'border-l-[#C68346]'
                                    : th.retentionPolicy === 'TAX_HOLD_6Y'
                                      ? 'border-l-[#00AEEF]'
                                      : 'border-l-transparent';

                            return (
                                <button
                                    key={th.threadId}
                                    type="button"
                                    onClick={() => setSelectedThreadId(th.threadId)}
                                    data-testid={`conv-thread-row-${th.threadId}`}
                                    className={cn(
                                        'w-full text-left p-fib-13 min-h-[48px] border-0 border-l-[3px] transition-colors cursor-pointer rounded-none shadow-none space-y-fib-8',
                                        borderClass,
                                        isSelected
                                            ? 'bg-[#F8FAFC] dark:bg-[#07090D]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D]'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-fib-8">
                                        <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {th.displayName}
                                        </span>
                                        <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6] shrink-0">
                                            {th.turnCount} {t('supply.conversations.turns_count')} ·{' '}
                                            {(th.activeEffectiveChannels || []).length}/15
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.roles.${th.role}`)} · {th.phoneMasked}
                                        </span>
                                        <span
                                            className={cn(
                                                'uppercase font-bold',
                                                th.retentionPolicy === 'LEGAL_HOLD_PSEUDONYMIZED'
                                                    ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                    : th.retentionPolicy === 'TAX_HOLD_6Y'
                                                      ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                      : 'text-[#475569] dark:text-[#8A93A6]'
                                            )}
                                        >
                                            {t(`supply.conversations.retention_${th.retentionPolicy}`)}
                                        </span>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Right 61.8%: Decoupled DEV Simulator + Immutable SHA-256 Audit Timeline */}
            <div className="min-h-0 overflow-y-auto p-fib-21 space-y-fib-21">
                {canAccessSimulator && simulatorOpen && (
                    <section
                        data-testid="ws-dev-simulator-panel"
                        className="border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 space-y-fib-13 rounded-none shadow-none"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <div className="flex items-center gap-fib-8">
                                <span className="material-symbols-outlined text-[20px] text-[#0369A1] dark:text-[#00AEEF]">
                                    chat
                                </span>
                                <span className="font-mono text-data-dense font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('supply.backlog.sim_title')}
                                </span>
                            </div>
                            <div className="flex items-center gap-fib-8">
                                <button
                                    type="button"
                                    onClick={() => void sendSimulatedMessage(undefined, true)}
                                    aria-label={t('supply.backlog.sim_reset')}
                                    title={t('supply.backlog.sim_reset')}
                                    className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#7C3F0E] dark:hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                >
                                    <span className="material-symbols-outlined text-[18px]">
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
                                    <span className="material-symbols-outlined text-[18px]">
                                        close
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-sim-phone`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.backlog.sim_phone')}
                                </label>
                                <input
                                    id={`${uid}-sim-phone`}
                                    type="text"
                                    value={simPhone}
                                    onChange={(e) => setSimPhone(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label={t('supply.backlog.sim_phone')}
                                    placeholder={t('supply.profiles_ws.field_phone_placeholder')}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label
                                    htmlFor={`${uid}-sim-role`}
                                    className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('supply.backlog.sim_role')}
                                </label>
                                <select
                                    id={`${uid}-sim-role`}
                                    value={simRole}
                                    onChange={(e) =>
                                        setSimRole(e.target.value as SupplyOperationalRole)
                                    }
                                    aria-label={t('supply.backlog.sim_role')}
                                    className={inputClass}
                                >
                                    {SIM_ROLES.map((r) => (
                                        <option key={r} value={r}>
                                            {t(`supply.roles.${r}`)} ({r})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-fib-8">
                            <button
                                type="button"
                                disabled={simBusy}
                                onClick={() =>
                                    void sendSimulatedMessage(t('supply.backlog.sim_preset_slots_msg'))
                                }
                                className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#00AEEF] font-mono text-microcopy text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none cursor-pointer"
                            >
                                {t('supply.backlog.sim_preset_slots')}
                            </button>
                            <button
                                type="button"
                                disabled={simBusy}
                                onClick={() =>
                                    void sendSimulatedMessage(t('supply.backlog.sim_preset_deny_msg'))
                                }
                                className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346] font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346] rounded-none shadow-none cursor-pointer"
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
                                className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#C68346] font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346] rounded-none shadow-none cursor-pointer"
                            >
                                {t('supply.backlog.sim_preset_atypical')}
                            </button>
                            <button
                                type="button"
                                disabled={simBusy}
                                onClick={() => void sendSimulatedMessage('OK')}
                                className="min-h-[48px] px-fib-13 border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] font-mono text-microcopy text-[#0369A1] dark:text-[#00AEEF] rounded-none shadow-none cursor-pointer"
                            >
                                {t('supply.backlog.sim_preset_confirm')}
                            </button>
                        </div>

                        {simBusy && (
                            <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />
                        )}

                        {simMessages.length > 0 && (
                            <div className="max-h-56 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                {simMessages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={cn(
                                            'px-fib-13 py-fib-8 space-y-fib-8 border-l-[3px]',
                                            msg.hardDeniedItems?.length || msg.atypicalFlags?.length
                                                ? 'border-[#C68346]'
                                                : msg.direction === 'OUTBOUND'
                                                  ? 'border-[#00AEEF]'
                                                  : 'border-transparent'
                                        )}
                                    >
                                        <div className="flex items-center justify-between font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            <span>
                                                {msg.direction === 'INBOUND'
                                                    ? simRole
                                                    : 'MINREPORT BOT'}
                                            </span>
                                            {msg.fsmState && (
                                                <span className="text-[#0369A1] dark:text-[#00AEEF] font-bold">
                                                    {t('supply.backlog.fsm_state')}: {msg.fsmState}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                            {msg.text}
                                        </div>
                                        {msg.committedReqId && (
                                            <div className="flex items-center gap-fib-8 font-mono text-microcopy text-[#0369A1] dark:text-[#00AEEF] select-text">
                                                <span>REQ: {msg.committedReqId}</span>
                                                <CopyButton
                                                    value={msg.committedReqId}
                                                    title={t('supply.common.copy_code')}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void sendSimulatedMessage();
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            className="flex items-center gap-fib-8"
                        >
                            <input
                                type="text"
                                value={simInput}
                                onChange={(e) => setSimInput(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={t('supply.backlog.sim_input_placeholder')}
                                placeholder={t('supply.backlog.sim_input_placeholder')}
                                className="flex-1 min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                            <button
                                type="submit"
                                disabled={simBusy || !simInput.trim()}
                                aria-label={t('supply.backlog.sim_send')}
                                title={t('supply.backlog.sim_send')}
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[22px]">send</span>
                            </button>
                        </form>
                    </section>
                )}

                {turnsError && (
                    <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 font-mono text-data-dense text-[#9A5B21] dark:text-[#C68346]">
                        {turnsError}
                    </div>
                )}

                {!threadToRender ? (
                    <div className="p-fib-34 font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.conversations.select_thread')}
                    </div>
                ) : (
                    <>
                        {/* Thread Audit Header */}
                        <header className="space-y-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                            <div className="flex flex-wrap items-start justify-between gap-fib-13">
                                <div className="space-y-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-fib-13">
                                        <h3 className="text-h1-header font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {threadToRender.displayName}
                                        </h3>
                                        <span className="font-mono text-microcopy uppercase text-[#C68346]">
                                            {t(`supply.roles.${threadToRender.role}`)}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-fib-13 font-mono text-data-dense tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                        <span className="select-text">{threadToRender.phoneMasked}</span>
                                        <span className="inline-flex items-center gap-1 select-text">
                                            {threadToRender.threadId}
                                            <CopyButton
                                                value={threadToRender.threadId}
                                                title={t('supply.common.copy_code')}
                                            />
                                        </span>
                                        <span className="inline-flex items-center gap-1 select-text">
                                            {t('supply.conversations.head_hash')}:{' '}
                                            {threadToRender.headHashSha256.slice(0, 12)}
                                            <CopyButton
                                                value={threadToRender.headHashSha256}
                                                title={t('supply.common.copy_code')}
                                            />
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-fib-8">
                                    <button
                                        type="button"
                                        disabled={Boolean(exportingFormat)}
                                        onClick={() => void handleExport('JSON')}
                                        data-testid="export-conv-json-btn"
                                        className="min-h-[48px] px-fib-13 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] font-mono text-microcopy font-bold uppercase tracking-wider inline-flex items-center gap-fib-8 rounded-none shadow-none cursor-pointer disabled:opacity-40"
                                    >
                                        <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">
                                            download
                                        </span>
                                        <span>{t('supply.conversations.export_json')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={Boolean(exportingFormat)}
                                        onClick={() => void handleExport('CSV')}
                                        data-testid="export-conv-csv-btn"
                                        className="min-h-[48px] px-fib-13 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-microcopy font-bold uppercase tracking-wider inline-flex items-center gap-fib-8 rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                                    >
                                        <span className="material-symbols-outlined text-[18px] text-[#000000]">
                                            download
                                        </span>
                                        <span>{t('supply.conversations.export_csv')}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Chain Verification & Ley 21.719 / Art. 17 Retention Strip */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 font-mono tabular-nums">
                                <div className="space-y-1">
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        SHA-256
                                    </div>
                                    <div
                                        data-testid="conv-chain-status"
                                        className={cn(
                                            'text-data-dense font-bold inline-flex items-center gap-1',
                                            chainVerification?.valid === false
                                                ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                : 'text-[#0369A1] dark:text-[#00AEEF]'
                                        )}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
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
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.conversations.legal_hold_years')}
                                    </div>
                                    <div
                                        data-testid="conv-retention-badge"
                                        className={cn(
                                            'text-data-dense font-bold',
                                            threadToRender.retentionPolicy ===
                                                'LEGAL_HOLD_PSEUDONYMIZED'
                                                ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                : threadToRender.retentionPolicy === 'TAX_HOLD_6Y'
                                                  ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                  : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {t(
                                            `supply.conversations.retention_${threadToRender.retentionPolicy}`
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.conversations.retention_until')}
                                    </div>
                                    <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {threadToRender.retentionExpiresAtIso.slice(0, 10)}
                                    </div>
                                </div>
                            </div>

                            {exportReceipt && (
                                <div
                                    data-testid="conv-export-receipt"
                                    className="border-l-[3px] border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums"
                                >
                                    <span className="text-[#0369A1] dark:text-[#00AEEF] font-bold">
                                        {t('supply.conversations.export_receipt')} ({exportReceipt.format}):{' '}
                                        {exportReceipt.filename}
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                        {exportReceipt.sha256 || '—'}
                                        {exportReceipt.sha256 && (
                                            <CopyButton
                                                value={exportReceipt.sha256}
                                                title={t('supply.common.copy_code')}
                                            />
                                        )}
                                    </span>
                                </div>
                            )}

                            {/* Thread-Level Linked Entities (REQ / PUR / DTE) */}
                            {((threadToRender.linkedRequisitionIds?.length || 0) > 0 ||
                                (threadToRender.linkedPurchaseIds?.length || 0) > 0 ||
                                (threadToRender.linkedDteIds?.length || 0) > 0) && (
                                <div className="flex flex-wrap items-center gap-fib-8 font-mono text-microcopy">
                                    {(threadToRender.linkedRequisitionIds || []).map((reqId) => (
                                        <button
                                            key={`th-req-${reqId}`}
                                            type="button"
                                            onClick={() =>
                                                onNavigateLinked?.({ type: 'REQ', id: reqId })
                                            }
                                            data-testid={`thread-link-req-${reqId}`}
                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-transparent text-[#0369A1] dark:text-[#00AEEF] inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">
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
                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-transparent text-[#0369A1] dark:text-[#00AEEF] inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">
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
                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-transparent text-[#9A5B21] dark:text-[#C68346] inline-flex items-center gap-fib-8 cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">
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
                            <div className="p-fib-21 font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.conversations.empty_turns')}
                            </div>
                        ) : (
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C]">
                                {turns.map((turn) => {
                                    const hasPolicyDeny = (turn.policyAuditRefs?.length || 0) > 0;
                                    const turnBorder = hasPolicyDeny
                                        ? 'border-l-[#C68346]'
                                        : turn.direction === 'OUTBOUND'
                                          ? 'border-l-[#00AEEF]'
                                          : 'border-l-transparent';
                                    const tempScopeSet = new Set(
                                        turn.scopeSnapshot.temporaryChannels || []
                                    );

                                    return (
                                        <article
                                            key={turn.turnId}
                                            data-testid={`conv-turn-${turn.seq}`}
                                            className={cn(
                                                'p-fib-13 border-l-[3px] bg-[#FFFFFF] dark:bg-[#000000] space-y-fib-13',
                                                turnBorder
                                            )}
                                        >
                                            {/* Turn Header: Seq, Direction, Source, Timestamp, SHA-256 */}
                                            <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                                <div className="flex flex-wrap items-center gap-fib-8">
                                                    <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {t('supply.conversations.turn_seq')} #{turn.seq}
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            'font-bold uppercase',
                                                            turn.direction === 'SYSTEM_POLICY' ||
                                                                hasPolicyDeny
                                                                ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                                : turn.direction === 'OUTBOUND'
                                                                  ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                  : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                                        )}
                                                    >
                                                        {t(
                                                            `supply.conversations.dir_${turn.direction}`
                                                        )}
                                                    </span>
                                                    <span className="text-[#475569] dark:text-[#8A93A6]">
                                                        {t(
                                                            `supply.conversations.source_${turn.channelSource}`
                                                        )}
                                                    </span>
                                                    {turn.aiModelUsed && (
                                                        <span className="text-[#0369A1] dark:text-[#00AEEF]">
                                                            {turn.aiModelUsed}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-fib-8 text-[#475569] dark:text-[#8A93A6]">
                                                    <span>{turn.createdAtIso}</span>
                                                    <span className="inline-flex items-center gap-1 select-text">
                                                        {t('supply.conversations.turn_hash')}:{' '}
                                                        {turn.turnHash.slice(0, 12)}
                                                        <CopyButton
                                                            value={turn.turnHash}
                                                            title={t('supply.common.copy_code')}
                                                        />
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Scrubbed Message Body (Ley 21.719) */}
                                            <div className="text-body-main text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                                {turn.contentScrubbed}
                                            </div>

                                            {(turn.redactedCategories?.length || 0) > 0 && (
                                                <div className="flex items-center gap-1 font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    <span className="material-symbols-outlined text-[14px]">
                                                        shield
                                                    </span>
                                                    <span>
                                                        {t('supply.conversations.pii_redacted')}:{' '}
                                                        {turn.redactedCategories.join(', ')}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Exact Scope Snapshot for this Turn */}
                                            <div
                                                data-testid={`turn-scope-${turn.seq}`}
                                                className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-8 space-y-fib-8"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                    <span>
                                                        {t('supply.conversations.scope_fingerprint')}
                                                        : {turn.scopeSnapshot.scopeFingerprint.slice(0, 12)}
                                                    </span>
                                                    {turn.scopeSnapshot.hasValidDgmnLicense && (
                                                        <span className="inline-flex items-center gap-1 text-[#0369A1] dark:text-[#00AEEF]">
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                lock
                                                            </span>
                                                            DGMN
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-fib-8">
                                                    {(turn.scopeSnapshot.effectiveChannels || []).map(
                                                        (ch) => {
                                                            const isTemp = tempScopeSet.has(ch);
                                                            return (
                                                                <span
                                                                    key={`${turn.turnId}-${ch}`}
                                                                    className={cn(
                                                                        'px-fib-8 py-1 border font-mono text-microcopy inline-flex items-center gap-1',
                                                                        isTemp
                                                                            ? 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                                                                            : 'border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6]'
                                                                    )}
                                                                >
                                                                    {isTemp && (
                                                                        <span className="material-symbols-outlined text-[12px]">
                                                                            schedule
                                                                        </span>
                                                                    )}
                                                                    <span>{ch}</span>
                                                                    <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                        {isTemp
                                                                            ? t(
                                                                                  'supply.conversations.scope_temporary'
                                                                              )
                                                                            : t(
                                                                                  'supply.conversations.scope_permanent'
                                                                              )}
                                                                    </span>
                                                                </span>
                                                            );
                                                        }
                                                    )}
                                                </div>
                                            </div>

                                            {/* CAS Media Attachments (SecureImage / Audio / ORIG -> CAS) */}
                                            {(turn.casMedia?.length || 0) > 0 && (
                                                <div className="space-y-fib-8 border border-[#E2E8F0] dark:border-[#12151C] p-fib-8 bg-[#F8FAFC] dark:bg-[#07090D]">
                                                    <div className="flex items-center gap-1 font-mono text-microcopy uppercase font-bold text-[#475569] dark:text-[#8A93A6]">
                                                        <span className="material-symbols-outlined text-[14px]">
                                                            attach_file
                                                        </span>
                                                        <span>
                                                            {t('supply.conversations.cas_media_title')}
                                                        </span>
                                                    </div>
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
                                                                            className="max-h-40 object-contain border border-[#E2E8F0] dark:border-[#12151C]"
                                                                        />
                                                                    )}
                                                                    {isAudio && (
                                                                        <div className="flex items-center gap-fib-8">
                                                                            <span className="material-symbols-outlined text-[18px] text-[#00AEEF]">
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
                                                                    <div className="flex flex-wrap items-center gap-fib-13 font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
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
                                                                        <span className="inline-flex items-center gap-1 select-text">
                                                                            {media.sha256.slice(
                                                                                0,
                                                                                12
                                                                            )}
                                                                            <CopyButton
                                                                                value={media.sha256}
                                                                                title={t(
                                                                                    'supply.common.copy_code'
                                                                                )}
                                                                            />
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Policy Audit Events */}
                                            {hasPolicyDeny && (
                                                <div
                                                    data-testid={`turn-policy-audit-${turn.seq}`}
                                                    className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 font-mono text-microcopy text-[#9A5B21] dark:text-[#C68346] space-y-1"
                                                >
                                                    <div className="font-bold uppercase">
                                                        {t('supply.conversations.policy_audit_title')}
                                                    </div>
                                                    <div className="select-text">
                                                        {turn.policyAuditRefs.join(' · ')}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Turn-level Bidrectional Links */}
                                            {((turn.linkedRequisitionIds?.length || 0) > 0 ||
                                                (turn.linkedPurchaseIds?.length || 0) > 0 ||
                                                (turn.linkedDteIds?.length || 0) > 0) && (
                                                <div className="flex flex-wrap items-center gap-fib-8 font-mono text-microcopy">
                                                    {(turn.linkedRequisitionIds || []).map((id) => (
                                                        <button
                                                            key={`${turn.turnId}-req-${id}`}
                                                            type="button"
                                                            onClick={() =>
                                                                onNavigateLinked?.({
                                                                    type: 'REQ',
                                                                    id,
                                                                })
                                                            }
                                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-transparent text-[#0369A1] dark:text-[#00AEEF] inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                link
                                                            </span>
                                                            <span>
                                                                {t('supply.conversations.linked_req')}
                                                                : {id}
                                                            </span>
                                                        </button>
                                                    ))}
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
                                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-transparent text-[#0369A1] dark:text-[#00AEEF] inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                link
                                                            </span>
                                                            <span>
                                                                {t('supply.conversations.linked_pur')}
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
                                                            className="min-h-[48px] px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] bg-transparent text-[#9A5B21] dark:text-[#C68346] inline-flex items-center gap-1 cursor-pointer rounded-none shadow-none"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">
                                                                receipt_long
                                                            </span>
                                                            <span>
                                                                {t('supply.conversations.linked_dte')}
                                                                : {id}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default SupplyConversationsAuditView;
