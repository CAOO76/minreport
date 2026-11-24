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
    type SupplyWarehouse,
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
    warehouses?: SupplyWarehouse[];
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
    selectedSiteIds: string[];
    selectedWarehouseIds: string[];
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
        selectedSiteIds: [],
        selectedWarehouseIds: [],
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
        selectedSiteIds: p.allowedSiteIds || [],
        selectedWarehouseIds: p.allowedWarehouseIds || [],
        dgmnCode: p.controlledLicense?.resolutionCode || '',
        dgmnExpiry: p.controlledLicense?.expiresAtIso
            ? p.controlledLicense.expiresAtIso.slice(0, 10)
            : '',
        sendOptInTemplate: false,
    };
}

export const SupplyProfilesChannelsView: React.FC<SupplyProfilesChannelsViewProps> = ({
    profiles,
    sites,
    warehouses = [],
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

    const toggleSiteSelection = (siteId: string) => {
        setFormState((s) => {
            const exists = s.selectedSiteIds.includes(siteId);
            return {
                ...s,
                selectedSiteIds: exists
                    ? s.selectedSiteIds.filter((id) => id !== siteId)
                    : [...s.selectedSiteIds, siteId],
            };
        });
    };

    const toggleWarehouseSelection = (warehouseId: string) => {
        setFormState((s) => {
            const exists = s.selectedWarehouseIds.includes(warehouseId);
            return {
                ...s,
                selectedWarehouseIds: exists
                    ? s.selectedWarehouseIds.filter((id) => id !== warehouseId)
                    : [...s.selectedWarehouseIds, warehouseId],
            };
        });
    };

    const handlePrepareUpsert = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        const hasDgmn = Boolean(formState.dgmnCode.trim() && formState.dgmnExpiry.trim());
        const payload: UpsertSupplyProfileRequest = {
            ...(formState.profileId ? { profileId: formState.profileId } : {}),
            displayName: formState.displayName.trim(),
            role: formState.role,
            ...(formState.phoneE164.trim() ? { phoneE164: formState.phoneE164.trim() } : {}),
            status: formState.status,
            permanentChannels:
                editMode === 'EDIT' && selectedProfile ? selectedProfile.permanentChannels : [],
            allowedSiteIds: formState.selectedSiteIds,
            allowedWarehouseIds: formState.selectedWarehouseIds,
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

    const underlineInputClass =
        'w-full min-h-[48px] px-fib-13 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[16px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none';
    const labelClass = 'block text-[14px] font-medium text-[#475569] dark:text-[#8A93A6]';

    return (
        <div
            data-testid="supply-profiles-ws-view"
            className="w-full h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] bg-[#FFFFFF] dark:bg-[#000000]"
        >
            {/* Izquierda 38.2%: Directorio plano */}
            <aside className="border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] flex flex-col min-h-0">
                <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                    <div className="flex items-center justify-between gap-fib-8">
                        <h3 className="text-[18px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                            {t('supply.profiles_ws.title')}
                        </h3>
                        {canAdminister && (
                            <button
                                type="button"
                                onClick={openCreate}
                                aria-label={t('supply.profiles_ws.new_profile')}
                                title={t('supply.profiles_ws.new_profile')}
                                data-testid="new-ws-profile-btn"
                                className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#C68346] hover:opacity-80 cursor-pointer rounded-none shadow-none shrink-0"
                            >
                                <span className="material-symbols-outlined text-[24px]">
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
                        className={`${underlineInputClass} select-text`}
                    />
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                    {filteredProfiles.length === 0 ? (
                        <div className="p-fib-21 text-[16px] text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.profiles_ws.empty_directory')}
                        </div>
                    ) : (
                        filteredProfiles.map((p) => {
                            const isSelected =
                                p.profileId === selectedProfile?.profileId && editMode !== 'CREATE';
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
                                        'w-full text-left px-fib-21 py-fib-13 min-h-[60px] border-0 border-l-[3px] transition-colors cursor-pointer rounded-none shadow-none space-y-1',
                                        borderClass,
                                        isSelected
                                            ? 'bg-[#F8FAFC] dark:bg-[#07090D]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D]'
                                    )}
                                >
                                    <div className="flex items-baseline justify-between gap-fib-8">
                                        <span className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                            {p.displayName}
                                        </span>
                                        <span className="text-[14px] tabular-nums text-[#475569] dark:text-[#8A93A6] shrink-0">
                                            {p.effectiveChannels.length}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-fib-8 text-[14px]">
                                        <span className="text-[#475569] dark:text-[#8A93A6]">
                                            {t(`supply.roles.${p.role}`)} · {p.phoneMasked}
                                        </span>
                                        <span
                                            className={cn(
                                                'font-semibold',
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

            {/* Derecha 61.8%: Ficha limpia + Permisos WhatsApp + Temporales */}
            <div className="min-h-0 overflow-y-auto p-fib-21 sm:p-fib-34 space-y-fib-34">
                {errorMsg && (
                    <div className="border-l-[3px] border-[#C68346] pl-fib-13 py-fib-8 text-[15px] text-[#9A5B21] dark:text-[#C68346]">
                        {errorMsg}
                    </div>
                )}

                {editMode !== 'NONE' && canAdminister ? (
                    <form
                        autoComplete="off"
                        spellCheck={false}
                        onSubmit={handlePrepareUpsert}
                        className="space-y-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21"
                    >
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <h3 className="text-[20px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
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
                                <span className="material-symbols-outlined text-[22px]">close</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-21">
                            <div className="space-y-1">
                                <label className={labelClass}>{t('supply.profiles_ws.field_name')}</label>
                                <input
                                    type="text"
                                    required
                                    value={formState.displayName}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, displayName: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${underlineInputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>{t('supply.profiles_ws.field_role')}</label>
                                <select
                                    value={formState.role}
                                    onChange={(e) =>
                                        setFormState((s) => ({
                                            ...s,
                                            role: e.target.value as SupplyOperationalRole,
                                        }))
                                    }
                                    className={underlineInputClass}
                                >
                                    {OPERATIONAL_ROLES.map((r) => (
                                        <option key={r} value={r}>
                                            {t(`supply.roles.${r}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>{t('supply.profiles_ws.field_phone')}</label>
                                <input
                                    type="tel"
                                    required={editMode === 'CREATE'}
                                    value={formState.phoneE164}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, phoneE164: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={t('supply.profiles_ws.field_phone_placeholder')}
                                    className={`${underlineInputClass} select-text`}
                                />
                                <p className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.profiles_ws.field_phone_hint')}
                                </p>
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>
                                    {t('supply.profiles_ws.field_max_clp')}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    value={formState.maxAmountClp}
                                    onChange={(e) =>
                                        setFormState((s) => ({
                                            ...s,
                                            maxAmountClp: Number(e.target.value) || 0,
                                        }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${underlineInputClass} font-mono tabular-nums select-text`}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>{t('supply.profiles_ws.field_status')}</label>
                                <select
                                    value={formState.status}
                                    onChange={(e) =>
                                        setFormState((s) => ({
                                            ...s,
                                            status: e.target.value as SupplyProfileStatus,
                                        }))
                                    }
                                    className={underlineInputClass}
                                >
                                    <option value="ACTIVE">{t('supply.profiles_ws.status_ACTIVE')}</option>
                                    <option value="SUSPENDED">
                                        {t('supply.profiles_ws.status_SUSPENDED')}
                                    </option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>{t('supply.profiles_ws.field_hr_id')}</label>
                                <input
                                    type="text"
                                    value={formState.hrPersonId}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, hrPersonId: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${underlineInputClass} select-text`}
                                />
                            </div>
                        </div>

                        {/* Faenas y Bodegas seleccionables por casillas (cero CSV) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-21 pt-fib-8">
                            <div className="space-y-fib-8">
                                <div className={labelClass}>{t('supply.profiles_ws.field_sites')}</div>
                                <div className="space-y-fib-8">
                                    {sites.length === 0 ? (
                                        <span className="text-[15px] text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.common.all_sites')}
                                        </span>
                                    ) : (
                                        sites.map((site) => (
                                            <label
                                                key={site.siteId}
                                                className="flex items-center gap-fib-13 min-h-[48px] text-[16px] text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={formState.selectedSiteIds.includes(
                                                        site.siteId
                                                    )}
                                                    onChange={() => toggleSiteSelection(site.siteId)}
                                                    className="w-5 h-5 accent-[#C68346]"
                                                />
                                                <span>{site.name}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="space-y-fib-8">
                                <div className={labelClass}>
                                    {t('supply.profiles_ws.field_warehouses')}
                                </div>
                                <div className="space-y-fib-8">
                                    {warehouses.length === 0 ? (
                                        <span className="text-[15px] text-[#475569] dark:text-[#8A93A6]">
                                            {t('supply.warehouse.all_warehouses')}
                                        </span>
                                    ) : (
                                        warehouses.map((wh) => (
                                            <label
                                                key={wh.warehouseId}
                                                className="flex items-center gap-fib-13 min-h-[48px] text-[16px] text-[#0F172A] dark:text-[#F3F4F6] cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={formState.selectedWarehouseIds.includes(
                                                        wh.warehouseId
                                                    )}
                                                    onChange={() =>
                                                        toggleWarehouseSelection(wh.warehouseId)
                                                    }
                                                    className="w-5 h-5 accent-[#C68346]"
                                                />
                                                <span>{wh.name}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-21">
                            <div className="space-y-1">
                                <label className={labelClass}>
                                    {t('supply.profiles_ws.field_dgmn_code')}
                                </label>
                                <input
                                    type="text"
                                    value={formState.dgmnCode}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, dgmnCode: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${underlineInputClass} select-text`}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>
                                    {t('supply.profiles_ws.field_dgmn_expiry')}
                                </label>
                                <input
                                    type="date"
                                    value={formState.dgmnExpiry}
                                    onChange={(e) =>
                                        setFormState((s) => ({ ...s, dgmnExpiry: e.target.value }))
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${underlineInputClass} select-text`}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-fib-21 pt-fib-8">
                            <div className="flex flex-wrap items-center gap-fib-21">
                                <div className="flex items-center gap-fib-13">
                                    <M3Switch
                                        checked={formState.allowCapex}
                                        aria-label={t('supply.profiles_ws.field_allow_capex')}
                                        onChange={(checked) =>
                                            setFormState((s) => ({ ...s, allowCapex: checked }))
                                        }
                                    />
                                    <span className="text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('supply.profiles_ws.field_allow_capex')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-fib-13">
                                    <M3Switch
                                        checked={formState.sendOptInTemplate}
                                        aria-label={t('supply.profiles_ws.field_optin_send')}
                                        onChange={(checked) =>
                                            setFormState((s) => ({
                                                ...s,
                                                sendOptInTemplate: checked,
                                            }))
                                        }
                                    />
                                    <span className="text-[15px] text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('supply.profiles_ws.field_optin_send')}
                                    </span>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={saving || formState.displayName.trim().length < 2}
                                className="min-h-[48px] px-fib-21 bg-[#C68346] border border-[#C68346] text-[#000000] text-[15px] font-semibold rounded-none shadow-none cursor-pointer hover:opacity-90 disabled:opacity-40"
                            >
                                {t('supply.common.save')}
                            </button>
                        </div>
                    </form>
                ) : !selectedProfile ? (
                    <div className="p-fib-34 text-[17px] text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.profiles_ws.select_profile')}
                    </div>
                ) : (
                    <>
                        {/* Encabezado limpio solo lectura */}
                        <div className="space-y-fib-21">
                            <div className="flex flex-wrap items-start justify-between gap-fib-13">
                                <div className="space-y-1">
                                    <h3 className="text-[22px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {selectedProfile.displayName}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-fib-13 text-[15px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                        <span>{t(`supply.roles.${selectedProfile.role}`)}</span>
                                        <span>·</span>
                                        <span className="select-text">
                                            {selectedProfile.phoneMasked}
                                        </span>
                                        <span>·</span>
                                        <span>
                                            {t('supply.profiles_ws.effective_channels_count')}:{' '}
                                            <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                {selectedProfile.effectiveChannels.length}
                                            </strong>
                                        </span>
                                    </div>
                                </div>

                                {canAdminister && (
                                    <button
                                        type="button"
                                        onClick={openEdit}
                                        aria-label={t('supply.profiles_ws.edit_profile')}
                                        title={t('supply.profiles_ws.edit_profile')}
                                        className="bg-transparent border-0 outline-none p-1 min-w-[48px] min-h-[48px] inline-flex items-center justify-center text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] cursor-pointer rounded-none shadow-none"
                                    >
                                        <span className="material-symbols-outlined text-[22px]">
                                            edit
                                        </span>
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-21 border-t border-b border-[#E2E8F0] dark:border-[#12151C] py-fib-13 tabular-nums">
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.profiles_ws.field_status')}
                                    </div>
                                    <div
                                        className={cn(
                                            'text-[16px] font-semibold',
                                            selectedProfile.whatsappDispatchAllowed
                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                : 'text-[#9A5B21] dark:text-[#C68346]'
                                        )}
                                    >
                                        {selectedProfile.whatsappDispatchAllowed
                                            ? t('supply.profiles_ws.dispatch_allowed')
                                            : t('supply.profiles_ws.dispatch_blocked')}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.profiles_ws.optin_ACTIVE')}
                                    </div>
                                    <div
                                        className={cn(
                                            'text-[16px] font-semibold',
                                            selectedProfile.optInStatus === 'ACTIVE'
                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                : 'text-[#9A5B21] dark:text-[#C68346]'
                                        )}
                                    >
                                        {t(`supply.profiles_ws.optin_${selectedProfile.optInStatus}`)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.profiles_ws.field_max_clp')}
                                    </div>
                                    <div className="font-mono text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {formatClp(selectedProfile.effectiveMaxAmountClp)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        DGMN
                                    </div>
                                    <div
                                        className={cn(
                                            'text-[16px] font-semibold',
                                            selectedProfile.hasValidDgmnLicense
                                                ? 'text-[#0369A1] dark:text-[#00AEEF]'
                                                : 'text-[#475569] dark:text-[#8A93A6]'
                                        )}
                                    >
                                        {selectedProfile.hasValidDgmnLicense
                                            ? t('supply.profiles_ws.dgmn_valid')
                                            : t('supply.profiles_ws.dgmn_missing')}
                                    </div>
                                </div>
                            </div>

                            {canAdminister && (
                                <div className="flex flex-wrap items-center gap-fib-21">
                                    {selectedProfile.optInStatus !== 'ACTIVE' && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setPendingOptInAction('CONFIRM')}
                                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b-2 border-[#00AEEF] text-[#0369A1] dark:text-[#00AEEF] text-[15px] font-semibold rounded-none shadow-none cursor-pointer hover:opacity-80"
                                        >
                                            {t('supply.profiles_ws.optin_confirm_btn')}
                                        </button>
                                    )}
                                    {selectedProfile.optInStatus !== 'REVOKED_STOP' && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setPendingOptInAction('REVOKE_STOP')}
                                            className="min-h-[48px] px-fib-13 bg-transparent border-0 border-b-2 border-[#C68346] text-[#9A5B21] dark:text-[#C68346] text-[15px] font-semibold rounded-none shadow-none cursor-pointer hover:opacity-80"
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
