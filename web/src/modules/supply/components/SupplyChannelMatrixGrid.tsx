import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3Switch from '../../../components/common/M3Switch';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import type { SupplyProfileViewRecord, SupplyWhatsAppChannelId } from '../types';

export interface SupplyChannelDomainGroup {
    groupKey: 'group_camp' | 'group_ops' | 'group_special';
    channels: Array<{
        id: SupplyWhatsAppChannelId;
        normativeTag: string;
        requiresDgmnLicense?: boolean;
    }>;
}

export const SUPPLY_CHANNEL_DOMAIN_GROUPS: SupplyChannelDomainGroup[] = [
    {
        groupKey: 'group_camp',
        channels: [
            { id: 'CH_CAMP_FOOD', normativeTag: 'DS 594 / RSA' },
            { id: 'CH_CAMP_POTABLE_WATER', normativeTag: 'DS 594 / DS 28' },
            { id: 'CH_CAMP_GLP_GAS', normativeTag: 'SEC DS 108' },
            { id: 'CH_CAMP_FUEL', normativeTag: 'SEC DS 160' },
            { id: 'CH_CAMP_HYGIENE_MAINT', normativeTag: 'DS 594' },
        ],
    },
    {
        groupKey: 'group_ops',
        channels: [
            { id: 'CH_OPS_IND_WATER', normativeTag: 'DGA / RCA' },
            { id: 'CH_OPS_FLEET_FUEL', normativeTag: 'SEC 160 / OPERMAQ' },
            { id: 'CH_OPS_IND_GASES', normativeTag: 'DS 43 / NCh 2190' },
            { id: 'CH_OPS_PARTS_LUBES', normativeTag: 'DS 148 / OPERMAQ' },
            { id: 'CH_OPS_HARDWARE_DRILL', normativeTag: 'DS 132 / 20.949' },
            { id: 'CH_HSEC_EPP', normativeTag: 'DS 594 / ISP' },
        ],
    },
    {
        groupKey: 'group_special',
        channels: [
            { id: 'CH_WAREHOUSE_RECEPTION', normativeTag: '4-Way / Kardex' },
            { id: 'CH_DIRECT_PURCHASE_EXEC', normativeTag: 'SII DL 825 / RCV' },
            { id: 'CH_CAPEX_ASSETS', normativeTag: 'Art. 31 LIR / DTE 33' },
            { id: 'CH_CONTROLLED_DGMN', normativeTag: 'Ley 17.798 DGMN', requiresDgmnLicense: true },
        ],
    },
];

export interface SupplyChannelMatrixGridProps {
    profile: SupplyProfileViewRecord;
    canAdminister: boolean;
    saving?: boolean;
    onSavePermanentChannels: (channels: SupplyWhatsAppChannelId[]) => Promise<void>;
}

export const SupplyChannelMatrixGrid: React.FC<SupplyChannelMatrixGridProps> = ({
    profile,
    canAdminister,
    saving = false,
    onSavePermanentChannels,
}) => {
    const { t } = useTranslation();
    const [draftChannels, setDraftChannels] = useState<SupplyWhatsAppChannelId[]>(
        profile.permanentChannels
    );
    const [hitlOpen, setHitlOpen] = useState(false);
    const lastSyncedRef = useRef({
        profileId: profile.profileId,
        permanentChannels: profile.permanentChannels,
    });

    useEffect(() => {
        if (
            lastSyncedRef.current.profileId === profile.profileId &&
            lastSyncedRef.current.permanentChannels === profile.permanentChannels
        ) {
            return;
        }
        lastSyncedRef.current = {
            profileId: profile.profileId,
            permanentChannels: profile.permanentChannels,
        };
        setDraftChannels(profile.permanentChannels);
        setHitlOpen(false);
    }, [profile.profileId, profile.permanentChannels]);

    const permanentSet = useMemo(() => new Set(draftChannels), [draftChannels]);
    const savedSet = useMemo(() => new Set(profile.permanentChannels), [profile.permanentChannels]);
    const tempActiveSet = useMemo(
        () => new Set(profile.activeTemporaryGrants.map((g) => g.channelId)),
        [profile.activeTemporaryGrants]
    );

    const hasUnsavedChanges = useMemo(() => {
        if (draftChannels.length !== profile.permanentChannels.length) return true;
        return draftChannels.some((ch) => !savedSet.has(ch));
    }, [draftChannels, profile.permanentChannels.length, savedSet]);

    const toggleChannel = (channelId: SupplyWhatsAppChannelId, checked: boolean) => {
        if (!canAdminister) return;
        if (channelId === 'CH_CONTROLLED_DGMN' && checked && !profile.hasValidDgmnLicense) return;
        setDraftChannels((prev) => {
            const next = new Set(prev);
            if (checked) next.add(channelId);
            else next.delete(channelId);
            return Array.from(next);
        });
    };

    const hitlDiff = useMemo<HitlComparisonDiffItem[]>(
        () => [
            {
                field: `${profile.displayName} · ${t('supply.profiles_ws.matrix_title')}`,
                current:
                    profile.permanentChannels.map((c) => t(`supply.channels.${c}`)).join(', ') ||
                    '—',
                suggested:
                    draftChannels.map((c) => t(`supply.channels.${c}`)).join(', ') || '—',
            },
        ],
        [draftChannels, profile.displayName, profile.permanentChannels, t]
    );

    return (
        <section className="space-y-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21">
            <div className="flex flex-wrap items-center justify-between gap-fib-13">
                <h4 className="text-[18px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    {t('supply.profiles_ws.matrix_title')}
                </h4>
                {canAdminister && hasUnsavedChanges && (
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => setHitlOpen(true)}
                        className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-semibold rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                    >
                        {t('supply.profiles_ws.matrix_save_btn')}
                    </button>
                )}
            </div>

            <div className="space-y-fib-21">
                {SUPPLY_CHANNEL_DOMAIN_GROUPS.map((group) => (
                    <div key={group.groupKey} className="space-y-fib-8">
                        <div className="pb-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                            {t(`supply.channels.${group.groupKey}`)}
                        </div>
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                            {group.channels.map((ch) => {
                                const isPerm = permanentSet.has(ch.id);
                                const isTemp = tempActiveSet.has(ch.id);
                                const dgmnLocked = Boolean(
                                    ch.requiresDgmnLicense && !profile.hasValidDgmnLicense
                                );
                                const rowLabel = t(`supply.channels.${ch.id}`);

                                return (
                                    <div
                                        key={ch.id}
                                        data-testid={`channel-row-${ch.id}`}
                                        className={cn(
                                            'py-fib-13 pl-fib-13 flex items-center justify-between gap-fib-13 border-l-[3px]',
                                            isTemp
                                                ? 'border-l-[#00AEEF]'
                                                : isPerm
                                                  ? 'border-l-[#C68346]'
                                                  : 'border-l-transparent'
                                        )}
                                    >
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex items-center gap-fib-8">
                                                <span className="text-[16px] font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {rowLabel}
                                                </span>
                                                <span
                                                    title={`${ch.id} · ${ch.normativeTag}`}
                                                    className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6] cursor-help"
                                                >
                                                    info
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-fib-13 text-[14px]">
                                                <span
                                                    className={cn(
                                                        'font-medium',
                                                        isTemp
                                                            ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                            : isPerm
                                                              ? 'text-[#9A5B21] dark:text-[#C68346]'
                                                              : 'text-[#475569] dark:text-[#8A93A6]'
                                                    )}
                                                >
                                                    {isTemp
                                                        ? t('supply.profiles_ws.matrix_active_temp')
                                                        : isPerm
                                                          ? t('supply.profiles_ws.matrix_active_perm')
                                                          : t('supply.profiles_ws.matrix_inactive')}
                                                </span>
                                                {dgmnLocked && (
                                                    <span className="text-[#9A5B21] dark:text-[#C68346] inline-flex items-center gap-1">
                                                        <span className="material-symbols-outlined text-[16px]">
                                                            lock
                                                        </span>
                                                        {t('supply.profiles_ws.dgmn_missing')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="min-w-[48px] min-h-[48px] flex items-center justify-end">
                                            <M3Switch
                                                checked={isPerm}
                                                disabled={!canAdminister || saving || dgmnLocked}
                                                aria-label={rowLabel}
                                                data-testid={`channel-switch-${ch.id}`}
                                                onChange={(next) => toggleChannel(ch.id, next)}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <HitlConfirmModal
                open={hitlOpen}
                title={t('supply.profiles_ws.hitl_matrix_title')}
                description={t('supply.profiles_ws.hitl_matrix_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={hitlDiff}
                loading={saving}
                onConfirm={() => {
                    void onSavePermanentChannels(draftChannels).then(() => setHitlOpen(false));
                }}
                onCancel={() => setHitlOpen(false)}
            />
        </section>
    );
};

export default SupplyChannelMatrixGrid;
