import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import M3Switch from '../../../components/common/M3Switch';
import HitlConfirmModal, { type HitlComparisonDiffItem } from '../../../components/common/HitlConfirmModal';
import { cn } from '../../../utils/cn';
import { supplyApi } from '../services/supplyApi';
import {
    formatClp,
    type GrantTemporaryChannelRequest,
    type SupplyOperationalRole,
    type SupplyProfileStatus,
    type SupplyProfileViewRecord,
    type SupplySite,
    type SupplyWhatsAppChannelId,
    type UpsertSupplyProfileRequest,
} from '../types';
import { SupplyChannelMatrixGrid } from './SupplyChannelMatrixGrid';
import { SupplyTempGrantsPanel } from './SupplyTempGrantsPanel';

const OPERATIONAL_ROLES: SupplyOperationalRole[] = [
    'CAMP_MANAGER',
    'MECHANIC_TECH',
    'OPS_FOREMAN',
    'WAREHOUSE_KEEPER',
    'HSEC_OFFICER',
    'BUYER',
    'SITE_ADMIN',
    'OWNER_EXEC',
];

export interface SupplyProfilesChannelsViewProps {
    profiles: SupplyProfileViewRecord[];
    sites: SupplySite[];
    tenantId?: string;
    loading: boolean;
    canAdminister: boolean;
    onMutated: () => void;
}

interface ProfileFormState {
    profileId?: string;
    displayName: string;
    role: SupplyOperationalRole;
    phoneE164: string;
    hrPersonId: string;
    maxAmountClp: number;
    allowCapex: boolean;
    status: SupplyProfileStatus;
    allowedSitesCsv: string;
    allowedWarehousesCsv: string;
    dgmnCode: string;
    dgmnExpiry: string;
    sendOptInTemplate: boolean;
}

function createEmptyProfileForm(): ProfileFormState {
    return {
        displayName: '',
        role: 'CAMP_MANAGER',
        phoneE164: '',
        hrPersonId: '',
        maxAmountClp: 500_000,
        allowCapex: false,
        status: 'ACTIVE',
        allowedSitesCsv: '',
        allowedWarehousesCsv: '',
        dgmnCode: '',
        dgmnExpiry: '',
        sendOptInTemplate: true,
    };
}

function profileToFormState(p: SupplyProfileViewRecord): ProfileFormState {
    return {
        profileId: p.profileId,
        displayName: p.displayName,
        role: p.role,
        phoneE164: '',
        hrPersonId: p.hrPersonId || '',
        maxAmountClp: p.maxAmountClp,
        allowCapex: p.allowCapex,
        status: p.status,
        allowedSitesCsv: (p.allowedSiteIds || []).join(', '),
        allowedWarehousesCsv: (p.allowedWarehouseIds || []).join(', '),
        dgmnCode: p.controlledLicense?.resolutionCode || '',
        dgmnExpiry: p.controlledLicense?.expiresAtIso
            ? p.controlledLicense.expiresAtIso.slice(0, 10)
            : '',
        sendOptInTemplate: false,
    };
}

export const SupplyProfilesChannelsView: React.FC<SupplyProfilesChannelsViewProps> = ({
    profiles,
    sites: _sites,
    tenantId,
    loading: _loading,
    canAdminister,
    onMutated,
}) => {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [editMode, setEditMode] = useState<'NONE' | 'CREATE' | 'EDIT'>('NONE');
    const [formState, setFormState] = useState<ProfileFormState>(createEmptyProfileForm);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [pendingUpsertHitl, setPendingUpsertHitl] = useState<UpsertSupplyProfileRequest | null>(
        null
    );
    const [pendingOptInAction, setPendingOptInAction] = useState<
        'CONFIRM' | 'REVOKE_STOP' | null
    >(null);

    const filteredProfiles = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return profiles;
        return profiles.filter((p) =>
            [p.displayName, p.role, p.phoneMasked, p.hrPersonId || '']
                .join(' ')
                .toLowerCase()
                .includes(q)
        );
    }, [profiles, searchQuery]);

    useEffect(() => {
        if (filteredProfiles.length === 0) return;
        if (!selectedProfileId || !filteredProfiles.some((p) => p.profileId === selectedProfileId)) {
            setSelectedProfileId(filteredProfiles[0].profileId);
        }
    }, [filteredProfiles, selectedProfileId]);

    const selectedProfile = useMemo(() => {
        if (selectedProfileId) {
            const explicit = profiles.find((p) => p.profileId === selectedProfileId);
            if (explicit) return explicit;
        }
        return filteredProfiles[0] || profiles[0] || null;
    }, [filteredProfiles, profiles, selectedProfileId]);

    const openCreate = () => {
        setErrorMsg(null);
        setFormState(createEmptyProfileForm());
        setEditMode('CREATE');
    };

    const openEdit = () => {
        if (!selectedProfile) return;
        setErrorMsg(null);
        setFormState(profileToFormState(selectedProfile));
        setEditMode('EDIT');
    };

    const handlePrepareUpsert = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        const csvToArr = (raw: string) =>
            raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        const hasDgmn = Boolean(formState.dgmnCode.trim() && formState.dgmnExpiry.trim());
        const payload: UpsertSupplyProfileRequest = {
            ...(formState.profileId ? { profileId: formState.profileId } : {}),
            displayName: formState.displayName.trim(),
            role: formState.role,
            ...(formState.phoneE164.trim() ? { phoneE164: formState.phoneE164.trim() } : {}),
            status: formState.status,
            permanentChannels:
                editMode === 'EDIT' && selectedProfile ? selectedProfile.permanentChannels : [],
            allowedSiteIds: csvToArr(formState.allowedSitesCsv),
            allowedWarehouseIds: csvToArr(formState.allowedWarehousesCsv),
            maxAmountClp: Math.max(0, Number(formState.maxAmountClp) || 0),
            allowCapex: formState.allowCapex,
            controlledLicense: hasDgmn
                ? {
                      resolutionCode: formState.dgmnCode.trim(),
                      issuedBy: 'DGMN',
                      expiresAtIso: new Date(`${formState.dgmnExpiry.trim()}T23:59:59Z`).toISOString(),
                  }
                : null,
            hrPersonId: formState.hrPersonId.trim() || null,
            sendOptInTemplate: formState.sendOptInTemplate,
            confirmationKeyword: 'ACTUALIZAR',
        };
        setPendingUpsertHitl(payload);
    };

    const runMutation = async (fn: () => Promise<SupplyProfileViewRecord>) => {
        setSaving(true);
        setErrorMsg(null);
        try {
            const updated = await fn();
            setSelectedProfileId(updated.profileId);
            onMutated();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'PROFILE_MUTATION_ERROR');
            throw err;
        } finally {
            setSaving(false);
        }
    };

    const upsertDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!pendingUpsertHitl) return [];
        return [
            {
                field: t('supply.profiles_ws.field_name'),
                current: selectedProfile?.displayName || '—',
                suggested: `${pendingUpsertHitl.displayName} (${t(`supply.roles.${pendingUpsertHitl.role}`)})`,
            },
            {
                field: t('supply.profiles_ws.field_max_clp'),
                current: selectedProfile ? formatClp(selectedProfile.maxAmountClp) : '—',
                suggested: formatClp(pendingUpsertHitl.maxAmountClp),
            },
        ];
    }, [pendingUpsertHitl, selectedProfile, t]);

    const optInDiff = useMemo<HitlComparisonDiffItem[]>(() => {
        if (!selectedProfile || !pendingOptInAction) return [];
        return [
            {
                field: selectedProfile.displayName,
                current: t(`supply.profiles_ws.optin_${selectedProfile.optInStatus}`),
                suggested:
                    pendingOptInAction === 'CONFIRM'
                        ? t('supply.profiles_ws.optin_ACTIVE')
                        : t('supply.profiles_ws.optin_REVOKED_STOP'),
            },
        ];
    }, [pendingOptInAction, selectedProfile, t]);

    const inputClass =
        'w-full min-h-[48px] px-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';
    const labelClass = 'block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]';

    return (
        <div
            data-testid="supply-profiles-ws-view"
            className="w-full h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] bg-[#FFFFFF] dark:bg-[#000000]"
        >
            {/* Left 38.2%: Directory */}
            <aside className="border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col min-h-0">
                <div className="p-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] space-y-fib-13">
                    <div className="flex items-center justify-between gap-fib-8">
                        <div className="min-w-0 space-y-1">
                            <h3 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {t('supply.profiles_ws.title')}
                            </h3>
                            <span className="inline-block font-mono text-microcopy uppercase text-[#0369A1] dark:text-[#00AEEF]">
                                {t('supply.profiles_ws.rrhh_bridge_tag')}
                            </span>
                        </div>
                        {canAdminister && (
                            <button
                                type="button"
                                onClick={openCreate}
                                aria-label={t('supply.profiles_ws.new_profile')}
                                title={t('supply.profiles_ws.new_profile')}
                                data-testid="new-ws-profile-btn"
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none shrink-0"
                            >
                                <span className="material-symbols-outlined text-[22px]">
                                    person_add
                                </span>
                            </button>
                        )}
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('supply.profiles_ws.search_placeholder')}
                        className={`${inputClass} select-text`}
                    />
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredProfiles.length === 0 ? (
                        <div className="p-fib-21 font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.profiles_ws.empty_directory')}
                        </div>
                    ) : (
                        filteredProfiles.map((p) => {
                            const isSelected = p.profileId === selectedProfile?.profileId && editMode !== 'CREATE';
                            const borderClass = p.whatsappDispatchAllowed
                                ? 'border-l-[#00AEEF]'
                                : p.optInStatus === 'PENDING_DOUBLE_OPT_IN' ||
                                    p.optInStatus === 'REVOKED_STOP' ||
                                    p.status === 'SUSPENDED'
                                  ? 'border-l-[#C68346]'
                                  : 'border-l-transparent';

                            return (
                                <button
                                    key={p.profileId}
                                    type="button"
                                    onClick={() => {
                                        setSelectedProfileId(p.profileId);
                                        setEditMode('NONE');
                                        setErrorMsg(null);
                                    }}
                                    data-testid={`profile-row-${p.profileId}`}
                                    className={cn(
                                        'w-full text-left p-fib-13 border-0 border-l-[3px] transition-colors cursor-pointer rounded-none shadow-none space-y-fib-8',
                                        borderClass,
                                        isSelected
                                            ? 'bg-[#F8FAFC] dark:bg-[#07090D]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D]'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-fib-8">
                                        <span className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {p.displayName}
                                        </span>
                                        <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6] shrink-0">
                                            {p.effectiveChannels.length}/15
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-fib-8 font-mono text-microcopy tabular-nums">
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.roles.${p.role}`)} · {p.phoneMasked}
                                        </span>
                                        <span
                                            className={cn(
                                                'uppercase font-bold',
                                                p.optInStatus === 'ACTIVE'
                                                    ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                    : 'text-[#9A5B21] dark:text-[#C68346]'
                                            )}
                                        >
                                            {t(`supply.profiles_ws.optin_${p.optInStatus}`)}
                                        </span>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Right 61.8%: Profile Dossier + Channel Matrix + Temp Grants */}
            <div className="min-h-0 overflow-y-auto p-fib-21 space-y-fib-21">
                {errorMsg && (
                    <div className="border-l-[3px] border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] px-fib-13 py-fib-8 font-mono text-data-dense text-[#9A5B21] dark:text-[#C68346]">
                        {errorMsg}
                    </div>
                )}

                {editMode !== 'NONE' && canAdminister ? (
                    <form
                        autoComplete="off"
                        spellCheck={false}
                        onSubmit={handlePrepareUpsert}
                        className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 space-y-fib-13 rounded-none shadow-none"
                    >
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <h3 className="font-mono text-microcopy uppercase font-bold text-[#C68346]">
                                {editMode === 'CREATE'
                                    ? t('supply.profiles_ws.new_profile')
                                    : t('supply.profiles_ws.edit_profile')}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditMode('NONE')}
                                aria-label={t('supply.common.close')}
                                title={t('supply.common.close')}
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_name')}</label>
                                <input
                                    type="text"
                                    required
                                    value={formState.displayName}
                                    onChange={(e) => setFormState((s) => ({ ...s, displayName: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_role')}</label>
                                <select
                                    value={formState.role}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, role: e.target.value as SupplyOperationalRole }))
                                    }
                                    className={inputClass}
                                >
                                    {OPERATIONAL_ROLES.map((r) => (
                                        <option key={r} value={r}>
                                            {t(`supply.roles.${r}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_phone')}</label>
                                <input
                                    type="tel"
                                    required={editMode === 'CREATE'}
                                    value={formState.phoneE164}
                                    onChange={(e) => setFormState((s) => ({ ...s, phoneE164: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('supply.profiles_ws.field_phone_placeholder')}
                                    className={`${inputClass} select-text`}
                                />
                                <p className="font-mono text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.profiles_ws.field_phone_hint')}
                                </p>
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_hr_id')}</label>
                                <input
                                    type="text"
                                    value={formState.hrPersonId}
                                    onChange={(e) => setFormState((s) => ({ ...s, hrPersonId: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_max_clp')}</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={formState.maxAmountClp}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, maxAmountClp: Number(e.target.value) || 0 }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_status')}</label>
                                <select
                                    value={formState.status}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, status: e.target.value as SupplyProfileStatus }))
                                    }
                                    className={inputClass}
                                >
                                    <option value="ACTIVE">{t('supply.profiles_ws.status_ACTIVE')}</option>
                                    <option value="SUSPENDED">{t('supply.profiles_ws.status_SUSPENDED')}</option>
                                </select>
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_dgmn_code')}</label>
                                <input
                                    type="text"
                                    value={formState.dgmnCode}
                                    onChange={(e) => setFormState((s) => ({ ...s, dgmnCode: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_dgmn_expiry')}</label>
                                <input
                                    type="date"
                                    value={formState.dgmnExpiry}
                                    onChange={(e) => setFormState((s) => ({ ...s, dgmnExpiry: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_sites')}</label>
                                <input
                                    type="text"
                                    value={formState.allowedSitesCsv}
                                    onChange={(e) => setFormState((s) => ({ ...s, allowedSitesCsv: e.target.value }))}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-fib-8">
                                <label className={labelClass}>{t('supply.profiles_ws.field_warehouses')}</label>
                                <input
                                    type="text"
                                    value={formState.allowedWarehousesCsv}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, allowedWarehousesCsv: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${inputClass} select-text`}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-fib-13 pt-fib-8">
                            <div className="flex flex-wrap items-center gap-fib-21">
                                <div className="flex items-center gap-fib-8">
                                    <M3Switch
                                        checked={formState.allowCapex}
                                        aria-label={t('supply.profiles_ws.field_allow_capex')}
                                        onChange={(checked) => setFormState((s) => ({ ...s, allowCapex: checked }))}
                                    />
                                    <span className="font-mono text-microcopy uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('supply.profiles_ws.field_allow_capex')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <M3Switch
                                        checked={formState.sendOptInTemplate}
                                        aria-label={t('supply.profiles_ws.field_optin_send')}
                                        onChange={(checked) =>
                                            setFormState((s) => ({ ...s, sendOptInTemplate: checked }))
                                        }
                                    />
                                    <span className="font-mono text-microcopy uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('supply.profiles_ws.field_optin_send')}
                                    </span>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={saving || formState.displayName.trim().length < 2}
                                className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                            >
                                {t('supply.common.save')}
                            </button>
                        </div>
                    </form>
                ) : !selectedProfile ? (
                    <div className="p-fib-34 font-mono text-data-dense text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.profiles_ws.select_profile')}
                    </div>
                ) : (
                    <>
                        {/* Profile Read-Only Dossier Header (Modo Informe + Surgical Edit) */}
                        <div className="space-y-fib-13">
                            <div className="flex flex-wrap items-start justify-between gap-fib-13">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-fib-13">
                                        <h3 className="text-h1-header font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                            {selectedProfile.displayName}
                                        </h3>
                                        <span className="font-mono text-microcopy uppercase text-[#C68346]">
                                            {t(`supply.roles.${selectedProfile.role}`)}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-fib-13 font-mono text-data-dense tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                        <span className="select-text">{selectedProfile.phoneMasked}</span>
                                        {selectedProfile.hrPersonId && (
                                            <span className="select-text">RRHH: {selectedProfile.hrPersonId}</span>
                                        )}
                                        <span>
                                            {t('supply.profiles_ws.effective_channels_count')}:{' '}
                                            <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {selectedProfile.effectiveChannels.length}
                                            </strong>
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-fib-8">
                                    {canAdminister && (
                                        <button
                                            type="button"
                                            onClick={openEdit}
                                            aria-label={t('supply.profiles_ws.edit_profile')}
                                            title={t('supply.profiles_ws.edit_profile')}
                                            className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                                        >
                                            <span className="material-symbols-outlined text-[20px]">
                                                edit
                                            </span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-13 border-t border-b border-[#E2E8F0] dark:border-[#12151C] py-fib-13 font-mono tabular-nums">
                                <div>
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.profiles_ws.field_status')}
                                    </div>
                                    <div className={cn('text-data-dense font-bold', selectedProfile.whatsappDispatchAllowed ? 'text-[#0369A1] dark:text-[#00AEEF]' : 'text-[#9A5B21] dark:text-[#C68346]')}>
                                        {selectedProfile.whatsappDispatchAllowed
                                            ? t('supply.profiles_ws.dispatch_allowed')
                                            : t('supply.profiles_ws.dispatch_blocked')}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        LEY 21.719
                                    </div>
                                    <div className={cn('text-data-dense font-bold', selectedProfile.optInStatus === 'ACTIVE' ? 'text-[#0369A1] dark:text-[#00AEEF]' : 'text-[#9A5B21] dark:text-[#C68346]')}>
                                        {t(`supply.profiles_ws.optin_${selectedProfile.optInStatus}`)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.profiles_ws.field_max_clp')}
                                    </div>
                                    <div className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(selectedProfile.effectiveMaxAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        DGMN
                                    </div>
                                    <div className={cn('text-data-dense font-bold', selectedProfile.hasValidDgmnLicense ? 'text-[#0369A1] dark:text-[#00AEEF]' : 'text-[#475569] dark:text-[#8A93A6]')}>
                                        {selectedProfile.hasValidDgmnLicense
                                            ? t('supply.profiles_ws.dgmn_valid')
                                            : t('supply.profiles_ws.dgmn_missing')}
                                    </div>
                                </div>
                            </div>

                            {canAdminister && (
                                <div className="flex flex-wrap items-center gap-fib-13">
                                    {selectedProfile.optInStatus !== 'ACTIVE' && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setPendingOptInAction('CONFIRM')}
                                            className="min-h-[48px] px-fib-13 bg-transparent border border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-80"
                                        >
                                            {t('supply.profiles_ws.optin_confirm_btn')}
                                        </button>
                                    )}
                                    {selectedProfile.optInStatus !== 'REVOKED_STOP' && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setPendingOptInAction('REVOKE_STOP')}
                                            className="min-h-[48px] px-fib-13 bg-transparent border border-[#C68346] text-[#9A5B21] dark:text-[#C68346] font-mono text-microcopy font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer hover:opacity-80"
                                        >
                                            {t('supply.profiles_ws.optin_revoke_btn')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <SupplyChannelMatrixGrid
                            profile={selectedProfile}
                            canAdminister={canAdminister}
                            saving={saving}
                            onSavePermanentChannels={async (channels: SupplyWhatsAppChannelId[]) => {
                                await runMutation(() =>
                                    supplyApi.updateSupplyProfileChannels(
                                        selectedProfile.profileId,
                                        {
                                            permanentChannels: channels,
                                            confirmationKeyword: 'ACTUALIZAR',
                                        },
                                        tenantId
                                    )
                                );
                            }}
                        />

                        <SupplyTempGrantsPanel
                            profile={selectedProfile}
                            canAdminister={canAdminister}
                            saving={saving}
                            onGrantTemporary={async (payload: GrantTemporaryChannelRequest) => {
                                await runMutation(() =>
                                    supplyApi.grantTemporarySupplyChannel(
                                        selectedProfile.profileId,
                                        payload,
                                        tenantId
                                    )
                                );
                            }}
                            onRevokeTemporary={async (grantItemId: string) => {
                                await runMutation(() =>
                                    supplyApi.revokeTemporarySupplyChannel(
                                        selectedProfile.profileId,
                                        grantItemId,
                                        'ACTUALIZAR',
                                        tenantId
                                    )
                                );
                            }}
                        />
                    </>
                )}
            </div>

            <HitlConfirmModal
                open={Boolean(pendingUpsertHitl)}
                title={t('supply.profiles_ws.hitl_upsert_title')}
                description={t('supply.profiles_ws.hitl_upsert_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={upsertDiff}
                loading={saving}
                onConfirm={() => {
                    if (!pendingUpsertHitl) return;
                    void runMutation(() => supplyApi.upsertSupplyProfile(pendingUpsertHitl, tenantId)).then(
                        () => {
                            setPendingUpsertHitl(null);
                            setEditMode('NONE');
                        }
                    );
                }}
                onCancel={() => setPendingUpsertHitl(null)}
            />

            <HitlConfirmModal
                open={Boolean(pendingOptInAction)}
                title={t('supply.profiles_ws.hitl_optin_title')}
                description={t('supply.profiles_ws.hitl_optin_desc')}
                keyword="ACTUALIZAR"
                comparisonDiff={optInDiff}
                loading={saving}
                onConfirm={() => {
                    if (!selectedProfile || !pendingOptInAction) return;
                    void runMutation(() =>
                        supplyApi.confirmSupplyProfileOptIn(
                            selectedProfile.profileId,
                            pendingOptInAction,
                            'ACTUALIZAR',
                            tenantId
                        )
                    ).then(() => setPendingOptInAction(null));
                }}
                onCancel={() => setPendingOptInAction(null)}
            />
        </div>
    );
};

export default SupplyProfilesChannelsView;
