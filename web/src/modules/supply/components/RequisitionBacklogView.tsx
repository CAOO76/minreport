import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import CopyButton from '../../../components/common/CopyButton';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import {
    SUPPLY_CATEGORIES,
    SUPPLY_UNITS_SI,
    type RequisitionUrgency,
    type SupplyCategoryCode,
    type SupplyDemandOrigin,
    type SupplyOperationalRole,
    type SupplyRequisition,
    type SupplySite,
    type SupplyUnitSi,
    type WhatsAppSimMessage,
} from '../types';

export interface RequisitionBacklogViewProps {
    requisitions: SupplyRequisition[];
    sites: SupplySite[];
    defaultSiteId?: string;
    tenantId?: string;
    loading: boolean;
    canMutate?: boolean;
    canAccessSimulator: boolean;
    simulatorOpen: boolean;
    onToggleSimulator: (open: boolean) => void;
    onRequisitionCreated: () => void;
}

const DEMAND_ORIGINS: SupplyDemandOrigin[] = [
    'WA_CAMP',
    'WA_MECHANIC',
    'WA_OPS',
    'WA_WAREHOUSE_HSEC',
    'WA_EXEC_DIRECT',
    'MODULE_PLANNING',
    'MODULE_HSEC',
    'MODULE_OPERMAQ',
    'MODULE_STOCKPILE',
    'DESKTOP_MANUAL',
];

const SIM_ROLES: SupplyOperationalRole[] = [
    'CAMP_MANAGER',
    'MECHANIC_TECH',
    'OPS_FOREMAN',
    'WAREHOUSE_KEEPER',
    'HSEC_OFFICER',
    'BUYER',
    'OWNER_EXEC',
];

interface DraftLine {
    key: string;
    name: string;
    categoryCode: SupplyCategoryCode;
    qtyRequested: number;
    unitSi: SupplyUnitSi;
    urgency: RequisitionUrgency;
}

function createDraftLine(): DraftLine {
    return {
        key: `rl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: '',
        categoryCode: 'VIVERES_ALIMENTACION',
        qtyRequested: 1,
        unitSi: 'kg',
        urgency: 'STANDARD',
    };
}

export const RequisitionBacklogView: React.FC<RequisitionBacklogViewProps> = ({
    requisitions,
    sites,
    defaultSiteId,
    tenantId,
    loading: _loading,
    canMutate = true,
    canAccessSimulator,
    simulatorOpen,
    onToggleSimulator,
    onRequisitionCreated,
}) => {
    const { t } = useTranslation();
    const uid = useId();
    const [originFilter, setOriginFilter] = useState<SupplyDemandOrigin | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);

    // Manual Requisition State
    const [siteId, setSiteId] = useState(defaultSiteId || sites[0]?.siteId || 'site-main');
    const [costCenter, setCostCenter] = useState('CC-CAMPAMENTO');
    const [draftLines, setDraftLines] = useState<DraftLine[]>([createDraftLine()]);
    const [submittingReq, setSubmittingReq] = useState(false);
    const [formNotice, setFormNotice] = useState<{ tone: 'copper' | 'cyan'; text: string } | null>(null);

    // DEV / TEST-PILOT Interactive WhatsApp Simulator State
    const [simPhone, setSimPhone] = useState('+56911112222');
    const [simRole, setSimRole] = useState<SupplyOperationalRole>('CAMP_MANAGER');
    const [simInput, setSimInput] = useState('');
    const [simBusy, setSimBusy] = useState(false);
    const [simMessages, setSimMessages] = useState<WhatsAppSimMessage[]>([]);

    const filteredReqs = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return requisitions.filter((req) => {
            if (originFilter !== 'ALL' && req.demandOrigin !== originFilter) return false;
            if (!q) return true;
            const hay = [
                req.reqId,
                req.requesterName,
                req.costCenter,
                req.demandOrigin,
                ...(req.lines || []).map((l) => `${l.name} ${l.canonicalSkuId}`),
            ]
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }, [requisitions, originFilter, searchQuery]);

    const handleCreateManualRequisition = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate) return;
        const validLines = draftLines.filter((l) => l.name.trim().length > 0 && l.qtyRequested > 0);
        if (validLines.length === 0) return;

        setSubmittingReq(true);
        setFormNotice(null);
        try {
            const res = await supplyApi.createRequisition(
                {
                    siteId: siteId || defaultSiteId || 'site-main',
                    costCenter: costCenter.trim() || 'CC-CAMPAMENTO',
                    demandOrigin: 'DESKTOP_MANUAL',
                    demandNature: 'REACTIVE_FIELD',
                    lines: validLines.map((l) => ({
                        rawDescription: l.name.trim(),
                        normalizedName: l.name.trim(),
                        categoryCode: l.categoryCode,
                        unitSi: l.unitSi,
                        qtyRequested: l.qtyRequested,
                        urgency: l.urgency,
                    })),
                },
                tenantId
            );
            setDraftLines([createDraftLine()]);
            setShowCreateForm(false);
            setFormNotice({
                tone: 'cyan',
                text: res.queuedOffline
                    ? t('supply.scanner.offline_queued_notice')
                    : res.requisition?.reqId || t('supply.common.confirm'),
            });
            onRequisitionCreated();
        } catch (err) {
            setFormNotice({
                tone: 'copper',
                text: err instanceof Error ? err.message : 'REQ_ERROR',
            });
        } finally {
            setSubmittingReq(false);
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
                onRequisitionCreated();
            }
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

    return (
        <section className="w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] select-none">
            {/* Controls Strip */}
            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-fib-13">
                <div className="flex flex-wrap items-center gap-fib-13">
                    <select
                        id={`${uid}-origin-filter`}
                        value={originFilter}
                        onChange={(e) =>
                            setOriginFilter(e.target.value as SupplyDemandOrigin | 'ALL')
                        }
                        aria-label={t('supply.backlog.origin')}
                        className="min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                    >
                        <option value="ALL">{t('supply.common.all_origins')}</option>
                        {DEMAND_ORIGINS.map((origin) => (
                            <option key={origin} value={origin}>
                                {t(`supply.origins.${origin}`)}
                            </option>
                        ))}
                    </select>

                    <div>
                        <label htmlFor={`${uid}-search`} className="sr-only">
                            {t('supply.common.search_placeholder')}
                        </label>
                        <input
                            id={`${uid}-search`}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            aria-label={t('supply.common.search_placeholder')}
                            placeholder={t('supply.common.search_placeholder')}
                            className="w-56 min-h-[48px] px-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-fib-8">
                    {canMutate && (
                        <button
                            type="button"
                            onClick={() => setShowCreateForm((prev) => !prev)}
                            aria-label={t('supply.backlog.new_requisition')}
                            title={t('supply.backlog.new_requisition')}
                            className={cn(
                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                showCreateForm
                                    ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[22px]">
                                {showCreateForm ? 'close' : 'add'}
                            </span>
                        </button>
                    )}

                    {canAccessSimulator && (
                        <button
                            type="button"
                            onClick={() => onToggleSimulator(!simulatorOpen)}
                            aria-label={t('supply.backlog.open_simulator')}
                            title={t('supply.backlog.open_simulator')}
                            className={cn(
                                'bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center transition-colors cursor-pointer rounded-none shadow-none',
                                simulatorOpen
                                    ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                    : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            )}
                        >
                            <span className="material-symbols-outlined text-[22px]">chat</span>
                        </button>
                    )}
                </div>
            </div>

            {formNotice && (
                <div
                    className={cn(
                        'mx-fib-21 mt-fib-13 border-l-[3px] pl-fib-13 py-fib-8 font-mono text-data-dense tabular-nums',
                        formNotice.tone === 'copper'
                            ? 'border-[#C68346] text-[#7C3F0E] dark:text-[#C68346]'
                            : 'border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF]'
                    )}
                >
                    {formNotice.text}
                </div>
            )}

            {/* Inline Manual Requisition Form */}
            {canMutate && showCreateForm && (
                <form
                    onSubmit={handleCreateManualRequisition}
                    autoComplete="off"
                    spellCheck={false}
                    className="px-fib-21 py-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13"
                >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                        <div className="space-y-fib-8">
                            <label
                                htmlFor={`${uid}-req-site`}
                                className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.common.site_selector')}
                            </label>
                            <select
                                id={`${uid}-req-site`}
                                aria-label={t('supply.common.site_selector')}
                                value={siteId}
                                onChange={(e) => setSiteId(e.target.value)}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                {sites.length > 0 ? (
                                    sites.map((s) => (
                                        <option key={s.siteId} value={s.siteId}>
                                            {s.name}
                                        </option>
                                    ))
                                ) : (
                                    <option value="site-main">FAENA-01</option>
                                )}
                            </select>
                        </div>
                        <div className="space-y-fib-8">
                            <label
                                htmlFor={`${uid}-req-cc`}
                                className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]"
                            >
                                {t('supply.backlog.cost_center')}
                            </label>
                            <input
                                id={`${uid}-req-cc`}
                                type="text"
                                value={costCenter}
                                onChange={(e) => setCostCenter(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                            />
                        </div>
                    </div>

                    <div className="space-y-fib-8">
                        {draftLines.map((line, idx) => (
                            <div
                                key={line.key}
                                className="grid grid-cols-1 md:grid-cols-12 gap-fib-8 items-center"
                            >
                                <input
                                    type="text"
                                    aria-label={`${t('supply.backlog.sku_name')} #${idx + 1}`}
                                    value={line.name}
                                    onChange={(e) =>
                                        setDraftLines((prev) =>
                                            prev.map((d) =>
                                                d.key === line.key
                                                    ? { ...d, name: e.target.value }
                                                    : d
                                            )
                                        )
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('supply.backlog.sku_name')}
                                    className="md:col-span-4 min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                                <select
                                    aria-label={`${t('supply.backlog.category')} #${idx + 1}`}
                                    value={line.categoryCode}
                                    onChange={(e) =>
                                        setDraftLines((prev) =>
                                            prev.map((d) =>
                                                d.key === line.key
                                                    ? {
                                                          ...d,
                                                          categoryCode: e.target
                                                              .value as SupplyCategoryCode,
                                                      }
                                                    : d
                                            )
                                        )
                                    }
                                    className="md:col-span-3 min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                >
                                    {SUPPLY_CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {t(`supply.categories.${c}`)}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    aria-label={`${t('supply.backlog.qty')} #${idx + 1}`}
                                    step="any"
                                    min={0}
                                    value={line.qtyRequested}
                                    onChange={(e) =>
                                        setDraftLines((prev) =>
                                            prev.map((d) =>
                                                d.key === line.key
                                                    ? { ...d, qtyRequested: Number(e.target.value) || 0 }
                                                    : d
                                            )
                                        )
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="md:col-span-2 min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
                                />
                                <select
                                    aria-label={`${t('supply.backlog.unit')} #${idx + 1}`}
                                    value={line.unitSi}
                                    onChange={(e) =>
                                        setDraftLines((prev) =>
                                            prev.map((d) =>
                                                d.key === line.key
                                                    ? { ...d, unitSi: e.target.value as SupplyUnitSi }
                                                    : d
                                            )
                                        )
                                    }
                                    className="md:col-span-1 min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                >
                                    {SUPPLY_UNITS_SI.map((u) => (
                                        <option key={u} value={u}>
                                            {u}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label={`${t('supply.backlog.urgency')} #${idx + 1}`}
                                    value={line.urgency}
                                    onChange={(e) =>
                                        setDraftLines((prev) =>
                                            prev.map((d) =>
                                                d.key === line.key
                                                    ? {
                                                          ...d,
                                                          urgency: e.target
                                                              .value as RequisitionUrgency,
                                                      }
                                                    : d
                                            )
                                        )
                                    }
                                    className="md:col-span-1 min-h-[48px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                                >
                                    <option value="STANDARD">
                                        {t('supply.backlog.urgency_standard')}
                                    </option>
                                    <option value="HIGH">
                                        {t('supply.backlog.urgency_high')}
                                    </option>
                                    <option value="CRITICAL">
                                        {t('supply.backlog.urgency_critical')}
                                    </option>
                                </select>
                                <div className="md:col-span-1 flex justify-end">
                                    {draftLines.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDraftLines((prev) =>
                                                    prev.filter((d) => d.key !== line.key)
                                                )
                                            }
                                            aria-label={t('supply.common.remove')}
                                            title={t('supply.common.remove')}
                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#7C3F0E] dark:hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">
                                                delete
                                            </span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between pt-fib-8">
                        <button
                            type="button"
                            onClick={() => setDraftLines((prev) => [...prev, createDraftLine()])}
                            aria-label={t('supply.backlog.add_line')}
                            title={t('supply.backlog.add_line')}
                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#0369A1] dark:text-[#00AEEF] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                        >
                            <span className="material-symbols-outlined text-[20px]">add</span>
                        </button>
                        <button
                            type="submit"
                            disabled={submittingReq}
                            className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-data-dense font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:opacity-40"
                        >
                            {t('supply.backlog.submit_req')}
                        </button>
                    </div>
                </form>
            )}

            {/* DEV / TEST-PILOT WhatsApp Campamento Simulator Drawer */}
            {canAccessSimulator && simulatorOpen && (
                <div className="border-b border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 space-y-fib-13">
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
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onToggleSimulator(false)}
                                aria-label={t('supply.common.close')}
                                title={t('supply.common.close')}
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
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
                                placeholder="+56911112222"
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-text"
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
                                onChange={(e) => setSimRole(e.target.value as SupplyOperationalRole)}
                                aria-label={t('supply.backlog.sim_role')}
                                className="w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] font-mono text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                            >
                                {SIM_ROLES.map((r) => (
                                    <option key={r} value={r}>
                                        {r}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Deterministic Scenario Presets */}
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

                    {simBusy && <M3LinearProgress indeterminate ariaLabel={t('supply.common.loading')} />}

                    {/* Transcript */}
                    {simMessages.length > 0 && (
                        <div className="max-h-60 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
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
                                        <span>{msg.direction === 'INBOUND' ? simRole : 'MINREPORT BOT'}</span>
                                        {msg.fsmState && (
                                            <span className="text-[#0369A1] dark:text-[#00AEEF] font-bold">
                                                {t('supply.backlog.fsm_state')}: {msg.fsmState}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] whitespace-pre-wrap select-text">
                                        {msg.text}
                                    </div>
                                    {msg.hardDeniedItems && msg.hardDeniedItems.length > 0 && (
                                        <div className="font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346]">
                                            {t('supply.backlog.hard_denied')}: {msg.hardDeniedItems.join(', ')}
                                        </div>
                                    )}
                                    {msg.atypicalFlags && msg.atypicalFlags.length > 0 && (
                                        <div className="font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346]">
                                            {msg.atypicalFlags
                                                .map((f) => t(`supply.atypicals.${f}`))
                                                .join(' · ')}
                                        </div>
                                    )}
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
                        <label htmlFor={`${uid}-sim-input`} className="sr-only">
                            {t('supply.backlog.sim_input_placeholder')}
                        </label>
                        <input
                            id={`${uid}-sim-input`}
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
                </div>
            )}

            {/* Requisition Rows */}
            {filteredReqs.length === 0 ? (
                <div className="px-fib-21 py-fib-55 text-center font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                    {t('supply.common.no_records')}
                </div>
            ) : (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredReqs.map((req) => {
                        const reqHasAtypical = (req.lines || []).some(
                            (l) => (l.atypicalFlags?.length || 0) > 0
                        );
                        const reqFulfilled = req.status === 'FULFILLED' || req.status === 'CLOSED';
                        const leftBorder = reqHasAtypical
                            ? 'border-[#C68346]'
                            : reqFulfilled
                              ? 'border-[#00AEEF]'
                              : 'border-transparent';

                        return (
                            <article
                                key={req.reqId}
                                className={cn(
                                    'px-fib-21 py-fib-13 border-l-[3px] space-y-fib-13',
                                    leftBorder
                                )}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                    <div className="flex flex-wrap items-center gap-fib-8">
                                        <span className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                            {req.reqId}
                                        </span>
                                        <CopyButton
                                            value={req.reqId}
                                            title={t('supply.common.copy_folio')}
                                        />
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.origins.${req.demandOrigin}`)}
                                        </span>
                                        <span className="text-[#475569] dark:text-[#8A93A6]">·</span>
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.natures.${req.demandNature}`)}
                                        </span>
                                        <span className="text-[#475569] dark:text-[#8A93A6]">·</span>
                                        <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                            {req.costCenter}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-fib-13">
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {req.requesterName} ({req.requesterRole})
                                        </span>
                                        <span
                                            className={cn(
                                                'font-bold uppercase',
                                                reqFulfilled
                                                    ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                    : reqHasAtypical
                                                      ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                      : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                            )}
                                        >
                                            {t(`supply.status.${req.status}`)}
                                        </span>
                                    </div>
                                </div>

                                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-t border-[#E2E8F0] dark:border-[#12151C]">
                                    {(req.lines || []).map((line) => {
                                        const pct =
                                            line.qtyRequested > 0
                                                ? Math.min(
                                                      100,
                                                      Math.round(
                                                          (line.qtyPurchased / line.qtyRequested) *
                                                              100
                                                      )
                                                  )
                                                : 0;
                                        const isAtypical = (line.atypicalFlags?.length || 0) > 0;
                                        return (
                                            <div
                                                key={line.lineId}
                                                className="py-fib-8 grid grid-cols-1 md:grid-cols-12 gap-fib-8 items-center"
                                            >
                                                <div className="md:col-span-5 min-w-0 space-y-fib-8">
                                                    <div className="flex flex-wrap items-center gap-fib-8">
                                                        <span className="text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {line.name}
                                                        </span>
                                                        <span className="font-mono text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                            {line.canonicalSkuId}
                                                        </span>
                                                        <CopyButton
                                                            value={line.canonicalSkuId}
                                                            title={t('supply.common.copy_code')}
                                                        />
                                                    </div>
                                                    {isAtypical && (
                                                        <div className="font-mono text-microcopy text-[#7C3F0E] dark:text-[#C68346] font-bold">
                                                            {line.atypicalFlags
                                                                .map((f) =>
                                                                    t(`supply.atypicals.${f}`)
                                                                )
                                                                .join(' · ')}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="md:col-span-3 font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                                    {t(`supply.buckets.${line.procurementBucket}`)}
                                                </div>

                                                <div className="md:col-span-2 space-y-fib-8">
                                                    <div className="font-mono text-microcopy tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {line.qtyPurchased} / {line.qtyRequested}{' '}
                                                        {line.unitSi}
                                                    </div>
                                                    <M3LinearProgress
                                                        value={pct}
                                                        ariaLabel={line.name}
                                                    />
                                                </div>

                                                <div className="md:col-span-2 text-right font-mono text-microcopy tabular-nums font-bold">
                                                    <span
                                                        className={cn(
                                                            line.lineStatus === 'FULFILLED'
                                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                                : line.lineStatus === 'PARTIAL' ||
                                                                    isAtypical
                                                                  ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                                  : 'text-[#475569] dark:text-[#8A93A6]'
                                                        )}
                                                    >
                                                        {t(`supply.status.${line.lineStatus}`)}
                                                        {line.qtyPending > 0
                                                            ? ` (${line.qtyPending} ${line.unitSi})`
                                                            : ''}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default RequisitionBacklogView;
