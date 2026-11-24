import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import {
    CANONICAL_WHATSAPP_CHANNEL_IDS,
    formatClp,
    type GrantTemporaryChannelRequest,
    type SupplyProfileViewRecord,
    type SupplyWhatsAppChannelId,
    type TemporaryChannelGrant,
} from '../types';

function toLocalDateTimeInput(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFriendlyWindowDate(iso: string): string {
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

function computeGrantWindowProgress(grant: TemporaryChannelGrant): {
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    pct: number;
} {
    if (grant.revokedAtIso) return { status: 'REVOKED', pct: 0 };
    const now = Date.now();
    const start = Date.parse(grant.validFromIso);
    const end = Date.parse(grant.validUntilIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || now >= end) {
        return { status: 'EXPIRED', pct: 0 };
    }
    if (now <= start) return { status: 'ACTIVE', pct: 100 };
    const remainingPct = Math.round(((end - now) / (end - start)) * 100);
    return { status: 'ACTIVE', pct: Math.max(1, Math.min(99, remainingPct)) };
}

export interface SupplyTempGrantsPanelProps {
    profile: SupplyProfileViewRecord;
    canAdminister: boolean;
    saving?: boolean;
    onGrantTemporary: (payload: GrantTemporaryChannelRequest) => Promise<void>;
    onRevokeTemporary: (grantItemId: string) => Promise<void>;
}

export const SupplyTempGrantsPanel: React.FC<SupplyTempGrantsPanelProps> = ({
    profile,
    canAdminister,
    saving = false,
    onGrantTemporary,
    onRevokeTemporary,
}) => {
    const { t } = useTranslation();
    const [formOpen, setFormOpen] = useState(false);
    const [channelId, setChannelId] = useState<SupplyWhatsAppChannelId>('CH_OPS_FLEET_FUEL');
    const [validFromLocal, setValidFromLocal] = useState(() =>
        toLocalDateTimeInput(new Date().toISOString())
    );
    const [validUntilLocal, setValidUntilLocal] = useState(() =>
        toLocalDateTimeInput(new Date(Date.now() + 48 * 3600_000).toISOString())
    );
    const [reason, setReason] = useState('');
    const [maxAmountOverride, setMaxAmountOverride] = useState('');
    const [pendingGrantHitl, setPendingGrantHitl] = useState<GrantTemporaryChannelRequest | null>(
        null
    );
    const [pendingRevokeGrant, setPendingRevokeGrant] = useState<TemporaryChannelGrant | null>(
        null
    );

    const applyPresetHours = (hours: number) => {
        const now = Date.now();
        setValidFromLocal(toLocalDateTimeInput(new Date(now).toISOString()));
        setValidUntilLocal(toLocalDateTimeInput(new Date(now + hours * 3600_000).toISOString()));
    };

    const canSubmitForm =
        Boolean(reason.trim().length >= 2 && validFromLocal && validUntilLocal) &&
        Date.parse(validUntilLocal) > Date.parse(validFromLocal) &&
        !(channelId === 'CH_CONTROLLED_DGMN' && !profile.hasValidDgmnLicense);

    const grantDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingGrantHitl) return [];
        return [
            {
                field: t('supply.profiles_ws.temp_channel'),
                current: '—',
                suggested: t(`supply.channels.${pendingGrantHitl.channelId}`),
            },
            {
                field: `${t('supply.profiles_ws.temp_from')} ➔ ${t('supply.profiles_ws.temp_until')}`,
                current: '—',
                suggested: `${formatFriendlyWindowDate(pendingGrantHitl.validFromIso)} ➔ ${formatFriendlyWindowDate(pendingGrantHitl.validUntilIso)}`,
            },
            {
                field: t('supply.profiles_ws.temp_reason'),
                current: '—',
                suggested: pendingGrantHitl.reason,
            },
        ];
    }, [pendingGrantHitl, t]);

    const revokeDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingRevokeGrant) return [];
        return [
            {
                field: t('supply.profiles_ws.temp_channel'),
                current: t(`supply.channels.${pendingRevokeGrant.channelId}`),
                suggested: t('supply.profiles_ws.temp_revoked_tag'),
            },
        ];
    }, [pendingRevokeGrant, t]);

    const sortedGrants = useMemo(
        () =>
            [...(profile.temporaryGrants || [])].sort(
                (a, b) => Date.parse(b.validUntilIso) - Date.parse(a.validUntilIso)
            ),
        [profile.temporaryGrants]
    );

    const underlineInputClass =
        'w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[16px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';

    return (
        <section className="space-y-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21">
            <div className="flex items-center justify-between gap-fib-13">
                <h4 className="text-[18px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    {t('supply.profiles_ws.temp_title')}
                </h4>
                {canAdminister && (
                    <button
                        type="button"
                        onClick={() => setFormOpen((prev) => !prev)}
                        aria-label={t('supply.profiles_ws.temp_add_btn')}
                        title={t('supply.profiles_ws.temp_add_btn')}
                        data-testid="toggle-temp-grant-form"
                        className="bg-transparent border-0 outline-none px-fib-13 min-h-[48px] inline-flex items-center gap-fib-8 text-[15px] font-semibold text-[#7C3F0E] dark:text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[22px]">
                            {formOpen ? 'close' : 'add'}
                        </span>
                        <span>
                            {formOpen
                                ? t('supply.common.close')
                                : t('supply.profiles_ws.temp_add_btn')}
                        </span>
                    </button>
                )}
            </div>

            {formOpen && canAdminister && (
                <form
                    autoComplete="off"
                    spellCheck={false}
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!canSubmitForm) return;
                        const maxNum = Number(maxAmountOverride);
                        setPendingGrantHitl({
                            channelId,
                            validFromIso: new Date(validFromLocal).toISOString(),
                            validUntilIso: new Date(validUntilLocal).toISOString(),
                            timezoneIana: 'America/Santiago',
                            reason: reason.trim(),
                            maxAmountClpOverride:
                                maxAmountOverride.trim() && Number.isFinite(maxNum) && maxNum >= 0
                                    ? maxNum
                                    : null,
                            confirmationKeyword: 'ACTUALIZAR',
                        });
                    }}
                    className="border-l-[3px] border-l-[#00AEEF] pl-fib-21 py-fib-13 space-y-fib-21"
                >
                    <div className="flex flex-wrap items-center gap-fib-13">
                        <button
                            type="button"
                            onClick={() => applyPresetHours(48)}
                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[15px] font-medium text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                        >
                            {t('supply.profiles_ws.temp_preset_weekend')}
                        </button>
                        <button
                            type="button"
                            onClick={() => applyPresetHours(12)}
                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[15px] font-medium text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                        >
                            {t('supply.profiles_ws.temp_preset_shift12')}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-21">
                        <div className="space-y-1">
                            <label className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.profiles_ws.temp_channel')}
                            </label>
                            <select
                                value={channelId}
                                onChange={(e) =>
                                    setChannelId(e.target.value as SupplyWhatsAppChannelId)
                                }
                                className={underlineInputClass}
                            >
                                {CANONICAL_WHATSAPP_CHANNEL_IDS.map((ch) => (
                                    <option
                                        key={ch}
                                        value={ch}
                                        disabled={
                                            ch === 'CH_CONTROLLED_DGMN' &&
                                            !profile.hasValidDgmnLicense
                                        }
                                    >
                                        {t(`supply.channels.${ch}`)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.profiles_ws.temp_max_clp')}
                            </label>
                            <input
                                type="number"
                                min={0}
                                value={maxAmountOverride}
                                onChange={(e) => setMaxAmountOverride(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className={`${underlineInputClass} font-mono tabular-nums select-text`}
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.profiles_ws.temp_from')}
                            </label>
                            <input
                                type="datetime-local"
                                value={validFromLocal}
                                onChange={(e) => setValidFromLocal(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className={`${underlineInputClass} font-mono tabular-nums select-text`}
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                                {t('supply.profiles_ws.temp_until')}
                            </label>
                            <input
                                type="datetime-local"
                                value={validUntilLocal}
                                onChange={(e) => setValidUntilLocal(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className={`${underlineInputClass} font-mono tabular-nums select-text`}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.profiles_ws.temp_reason')}
                        </label>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            data-testid="temp-grant-reason-input"
                            className={`${underlineInputClass} select-text`}
                        />
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={!canSubmitForm || saving}
                            data-testid="temp-grant-submit-btn"
                            className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-semibold rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {t('supply.profiles_ws.temp_add_btn')}
                        </button>
                    </div>
                </form>
            )}

            {sortedGrants.length === 0 ? (
                <p className="text-[15px] text-[#475569] dark:text-[#8A93A6]">
                    {t('supply.profiles_ws.temp_empty')}
                </p>
            ) : (
                <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {sortedGrants.map((grant) => {
                        const meta = computeGrantWindowProgress(grant);
                        return (
                            <div
                                key={grant.grantItemId}
                                data-testid={`temp-grant-${grant.grantItemId}`}
                                className={cn(
                                    'py-fib-13 pl-fib-13 space-y-fib-8 border-l-[3px]',
                                    meta.status === 'ACTIVE'
                                        ? 'border-l-[#00AEEF]'
                                        : 'border-l-transparent'
                                )}
                            >
                                <div className="flex items-start justify-between gap-fib-13">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-fib-13">
                                            <span className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {t(`supply.channels.${grant.channelId}`)}
                                            </span>
                                            <span
                                                className={cn(
                                                    'text-[14px] font-semibold',
                                                    meta.status === 'ACTIVE'
                                                        ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                        : 'text-[#475569] dark:text-[#8A93A6]'
                                                )}
                                            >
                                                {meta.status === 'ACTIVE'
                                                    ? t('supply.profiles_ws.temp_active_tag')
                                                    : meta.status === 'REVOKED'
                                                      ? t('supply.profiles_ws.temp_revoked_tag')
                                                      : t('supply.profiles_ws.temp_expired_tag')}
                                            </span>
                                        </div>
                                        <div className="text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                            {formatFriendlyWindowDate(grant.validFromIso)} ➔{' '}
                                            {formatFriendlyWindowDate(grant.validUntilIso)}
                                            {typeof grant.maxAmountClpOverride === 'number'
                                                ? ` · ${formatClp(grant.maxAmountClpOverride)}`
                                                : ''}
                                        </div>
                                        <div className="text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                            {grant.reason}
                                        </div>
                                    </div>

                                    {canAdminister && meta.status === 'ACTIVE' && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setPendingRevokeGrant(grant)}
                                            aria-label={t('supply.profiles_ws.temp_revoke_btn')}
                                            title={t('supply.profiles_ws.temp_revoke_btn')}
                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">
                                                delete
                                            </span>
                                        </button>
                                    )}
                                </div>

                                {meta.status === 'ACTIVE' && (
                                    <M3LinearProgress
                                        value={meta.pct}
                                        ariaLabel={t('supply.profiles_ws.temp_progress_aria')}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <HitlConfirmModal
                open={Boolean(pendingGrantHitl)}
                title={t('supply.profiles_ws.hitl_temp_grant_title')}
                description={t('supply.profiles_ws.hitl_temp_grant_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={grantDiff}
                loading={saving}
                onConfirm={() => {
                    if (!pendingGrantHitl) return;
                    void onGrantTemporary(pendingGrantHitl).then(() => {
                        setPendingGrantHitl(null);
                        setFormOpen(false);
                        setReason('');
                        setMaxAmountOverride('');
                    });
                }}
                onCancel={() => setPendingGrantHitl(null)}
            />

            <HitlConfirmModal
                open={Boolean(pendingRevokeGrant)}
                title={t('supply.profiles_ws.hitl_temp_revoke_title')}
                description={t('supply.profiles_ws.hitl_temp_revoke_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={revokeDiff}
                loading={saving}
                onConfirm={() => {
                    if (!pendingRevokeGrant) return;
                    void onRevokeTemporary(pendingRevokeGrant.grantItemId).then(() =>
                        setPendingRevokeGrant(null)
                    );
                }}
                onCancel={() => setPendingRevokeGrant(null)}
            />
        </section>
    );
};

export default SupplyTempGrantsPanel;
