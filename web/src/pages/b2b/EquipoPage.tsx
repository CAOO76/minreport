import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { StaffService, type B2BMemberRecord } from '../../services/StaffService';
import {
    UpsertB2BMemberPayloadSchema,
    UpdateB2BMemberPayloadSchema,
    type B2BSeatRole,
} from '../../contracts';
import M3Switch from '../../components/common/M3Switch';
import CopyButton from '../../components/common/CopyButton';

const COUNTRY_OPTIONS = [
    { code: 'CL', taxPlaceholder: '12.345.678-9' },
    { code: 'PE', taxPlaceholder: '20123456789' },
    { code: 'BR', taxPlaceholder: '11.222.333/0001-81' },
    { code: 'AR', taxPlaceholder: '20-12345678-9' },
    { code: 'US', taxPlaceholder: '12-3456789' },
    { code: 'AU', taxPlaceholder: '51824753556' },
    { code: 'CA', taxPlaceholder: '123456789RC0001' },
    { code: 'MX', taxPlaceholder: 'MIN260101ABC' },
    { code: 'CO', taxPlaceholder: '900123456-1' },
    { code: 'ES', taxPlaceholder: 'ESB12345678' },
    { code: 'INTL', taxPlaceholder: 'TAX-ID-0001' },
];

const LBL = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const INP =
    'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-text';

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

export const EquipoPage: React.FC = () => {
    const { t } = useTranslation();
    const undeclaredLabel = t('core_equipo.undeclared', '[Información técnica no declarada en ficha]');
    const { currentAccount } = useAuth();

    const [members, setMembers] = useState<B2BMemberRecord[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Estado formulario alta de integrante (panel derecho 38.2%)
    const [createRole, setCreateRole] = useState<'ADMIN' | 'OPERATOR' | 'VIEWER'>('OPERATOR');
    const [email, setEmail] = useState<string>('');
    const [displayName, setDisplayName] = useState<string>('');
    const [countryCode, setCountryCode] = useState<string>(
        String((currentAccount as any)?.countryCode || (currentAccount as any)?.country || 'CL').toUpperCase()
    );
    const [taxId, setTaxId] = useState<string>('');
    const [jobTitle, setJobTitle] = useState<string>('');
    const [modOpermaq, setModOpermaq] = useState<boolean>(true);
    const [modStockpile, setModStockpile] = useState<boolean>(false);
    const [canViewBilling, setCanViewBilling] = useState<boolean>(false);
    const [submittingCreate, setSubmittingCreate] = useState<boolean>(false);
    const [createFeedback, setCreateFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    // Estado edición quirúrgica (Modo Informe -> HITL "ACTUALIZAR")
    const [editingMember, setEditingMember] = useState<B2BMemberRecord | null>(null);
    const [editRole, setEditRole] = useState<'ADMIN' | 'OPERATOR' | 'VIEWER'>('OPERATOR');
    const [editJobTitle, setEditJobTitle] = useState<string>('');
    const [editModOpermaq, setEditModOpermaq] = useState<boolean>(true);
    const [editModStockpile, setEditModStockpile] = useState<boolean>(false);
    const [editCanViewBilling, setEditCanViewBilling] = useState<boolean>(false);
    const [editStatus, setEditStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
    const [editConfirmWord, setEditConfirmWord] = useState<string>('');
    const [submittingEdit, setSubmittingEdit] = useState<boolean>(false);
    const [editError, setEditError] = useState<string | null>(null);

    // Estado desvinculación (HITL "ACTUALIZAR")
    const [deletingMember, setDeletingMember] = useState<B2BMemberRecord | null>(null);
    const [deleteConfirmWord, setDeleteConfirmWord] = useState<string>('');
    const [submittingDelete, setSubmittingDelete] = useState<boolean>(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const [listNotice, setListNotice] = useState<string | null>(null);

    const activeCountry = useMemo(
        () => COUNTRY_OPTIONS.find((c) => c.code === countryCode) || COUNTRY_OPTIONS[0],
        [countryCode]
    );

    const fetchMembers = useCallback(async () => {
        if (!currentAccount?.id) {
            setMembers([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError(null);
        try {
            const list = await StaffService.listMembers(currentAccount.id);
            setMembers(list);
        } catch (err: any) {
            setLoadError(err?.message || t('core_equipo.err_fetch_members'));
        } finally {
            setLoading(false);
        }
    }, [currentAccount?.id, t]);

    useEffect(() => {
        void fetchMembers();
    }, [fetchMembers]);

    useEffect(() => {
        if (createRole === 'ADMIN') {
            setModOpermaq(true);
            setModStockpile(true);
            setCanViewBilling(true);
        } else if (createRole === 'OPERATOR') {
            setCanViewBilling(false);
        }
    }, [createRole]);

    useEffect(() => {
        if (editRole === 'ADMIN') {
            setEditModOpermaq(true);
            setEditModStockpile(true);
            setEditCanViewBilling(true);
        } else if (editRole === 'OPERATOR') {
            setEditCanViewBilling(false);
        }
    }, [editRole]);

    const openEditMember = (member: B2BMemberRecord) => {
        if (member.role === 'OWNER') return;
        setDeletingMember(null);
        setDeleteConfirmWord('');
        setDeleteError(null);
        setEditingMember(member);
        const safeRole: 'ADMIN' | 'OPERATOR' | 'VIEWER' =
            member.role === 'ADMIN' || member.role === 'VIEWER' ? member.role : 'OPERATOR';
        setEditRole(safeRole);
        setEditJobTitle(member.jobTitle || '');
        setEditModOpermaq(safeRole === 'ADMIN' ? true : Boolean(member.allowedModules?.opermaq ?? true));
        setEditModStockpile(safeRole === 'ADMIN' ? true : Boolean(member.allowedModules?.stockpile ?? false));
        setEditCanViewBilling(
            safeRole === 'ADMIN' ? true : safeRole === 'VIEWER' ? Boolean(member.canViewBilling) : false
        );
        setEditStatus(String(member.status || '').toUpperCase() === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
        setEditConfirmWord('');
        setEditError(null);
    };

    const openDeleteMember = (member: B2BMemberRecord) => {
        if (member.role === 'OWNER') return;
        setEditingMember(null);
        setEditConfirmWord('');
        setEditError(null);
        setDeletingMember(member);
        setDeleteConfirmWord('');
        setDeleteError(null);
    };

    const handleCreateMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount?.id) return;

        setCreateFeedback(null);
        setListNotice(null);

        const accountName =
            currentAccount.name || (currentAccount as any).companyName || currentAccount.id;

        const rawPayload = {
            accountId: currentAccount.id,
            accountName,
            email: email.trim().toLowerCase(),
            displayName: displayName.trim(),
            taxId: taxId.trim(),
            countryCode: countryCode.trim().toUpperCase(),
            role: createRole,
            jobTitle: jobTitle.trim(),
            allowedModules:
                createRole === 'ADMIN'
                    ? { opermaq: true, stockpile: true }
                    : { opermaq: modOpermaq, stockpile: modStockpile },
            canViewBilling: createRole === 'ADMIN' ? true : createRole === 'VIEWER' ? canViewBilling : false,
        };

        const validated = UpsertB2BMemberPayloadSchema.safeParse(rawPayload);
        if (!validated.success) {
            const firstIssue = validated.error.issues[0];
            setCreateFeedback({
                type: 'err',
                text: `${firstIssue?.path?.join('.') || t('core_equipo.err_field_fallback')}: ${firstIssue?.message || t('core_equipo.err_validation_invalid')}`,
            });
            return;
        }

        setSubmittingCreate(true);
        try {
            const res = await StaffService.upsertMember(validated.data);
            setCreateFeedback({
                type: 'ok',
                text: res.message || t('core_equipo.msg_member_linked', { uid: res.uid }),
            });
            setEmail('');
            setDisplayName('');
            setTaxId('');
            setJobTitle('');
            if (createRole !== 'ADMIN') {
                setModOpermaq(true);
                setModStockpile(false);
                setCanViewBilling(false);
            }
            await fetchMembers();
        } catch (err: any) {
            setCreateFeedback({
                type: 'err',
                text: err?.message || t('core_equipo.err_create_member'),
            });
        } finally {
            setSubmittingCreate(false);
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount?.id || !editingMember) return;
        setEditError(null);

        const rawUpdate = {
            accountId: currentAccount.id,
            confirmationKeyword: editConfirmWord.trim(),
            role: editRole,
            jobTitle: editJobTitle.trim(),
            allowedModules:
                editRole === 'ADMIN'
                    ? { opermaq: true, stockpile: true }
                    : { opermaq: editModOpermaq, stockpile: editModStockpile },
            canViewBilling: editRole === 'ADMIN' ? true : editRole === 'VIEWER' ? editCanViewBilling : false,
            status: editStatus,
        };

        const parsed = UpdateB2BMemberPayloadSchema.safeParse(rawUpdate);
        if (!parsed.success) {
            setEditError(t('core_equipo.err_edit_hitl'));
            return;
        }

        setSubmittingEdit(true);
        try {
            await StaffService.updateMember(currentAccount.id, editingMember.uid, parsed.data);
            setListNotice(
                t('core_equipo.msg_permissions_updated', {
                    target: editingMember.fullName || editingMember.email,
                })
            );
            setEditingMember(null);
            setEditConfirmWord('');
            await fetchMembers();
        } catch (err: any) {
            setEditError(err?.message || t('core_equipo.err_update_member'));
        } finally {
            setSubmittingEdit(false);
        }
    };

    const handleConfirmDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount?.id || !deletingMember) return;
        setDeleteError(null);

        if (deleteConfirmWord.trim() !== 'ACTUALIZAR') {
            setDeleteError(t('core_equipo.err_delete_hitl'));
            return;
        }

        setSubmittingDelete(true);
        try {
            await StaffService.removeMember(currentAccount.id, deletingMember.uid, 'ACTUALIZAR');
            setListNotice(
                t('core_equipo.msg_member_removed', {
                    target: deletingMember.fullName || deletingMember.email,
                })
            );
            setDeletingMember(null);
            setDeleteConfirmWord('');
            await fetchMembers();
        } catch (err: any) {
            setDeleteError(err?.message || t('core_equipo.err_remove_member'));
        } finally {
            setSubmittingDelete(false);
        }
    };

    const roleTextClass = (role: B2BSeatRole): string => {
        switch (role) {
            case 'OWNER':
                return 'text-[#C68346] font-bold';
            case 'ADMIN':
                return 'text-[#00AEEF] font-bold';
            case 'OPERATOR':
                return 'text-[#0F172A] dark:text-[#F3F4F6]';
            case 'VIEWER':
                return 'text-[#475569] dark:text-[#8A93A6]';
            default:
                return 'text-[#475569] dark:text-[#8A93A6]';
        }
    };

    if (!currentAccount) return null;

    return (
        <div className="max-w-7xl mx-auto py-fib-21 px-fib-13 sm:px-fib-21 space-y-fib-21 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        {t('core_equipo.header_kicker')}
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_equipo.header_title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        {t('core_equipo.header_subtitle_prefix')} <span className="font-mono text-[#0F172A] dark:text-[#F3F4F6]">{currentAccount.name}</span>.
                    </p>
                </div>

                <div className="flex items-center gap-fib-13">
                    <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] select-text">
                        {t('core_equipo.tenant_prefix')}: {currentAccount.id}
                    </span>
                    <CopyButton value={currentAccount.id} title={t('core_equipo.copy_tenant_id')} />
                    <button
                        type="button"
                        onClick={() => void fetchMembers()}
                        title={t('core_equipo.btn_refresh')}
                        aria-label={t('core_equipo.btn_refresh')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                    </button>
                </div>
            </header>

            {/* Macro-Layout Proporción Áurea: 61.8% Tabla Informe / 38.2% Alta de Integrante */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                {/* PANEL IZQUIERDO (61.8%) — MODO INFORME */}
                <section className="space-y-fib-21">
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                        <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between">
                            <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('core_equipo.roster_title')}
                            </h2>
                            <span className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                {t('core_equipo.records_count', { count: members.length })}
                            </span>
                        </div>

                        {loading && (
                            <div className="p-fib-21 space-y-fib-8">
                                <M3LinearBar percent={68} ariaLabel={t('core_equipo.loading_aria')} />
                                <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_equipo.loading_roster')}
                                </p>
                            </div>
                        )}

                        {loadError && !loading && (
                            <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] text-data-dense font-mono text-red-600 dark:text-red-400">
                                {loadError}
                            </div>
                        )}

                        {listNotice && (
                            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-data-dense font-mono text-[#00AEEF] flex items-center justify-between">
                                <span>{listNotice}</span>
                                <button
                                    type="button"
                                    onClick={() => setListNotice(null)}
                                    title={t('core_equipo.btn_close_notice')}
                                    aria-label={t('core_equipo.btn_close_notice')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            </div>
                        )}

                        {!loading && members.length === 0 && !loadError && (
                            <div className="p-fib-34 text-center">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {undeclaredLabel}
                                </p>
                            </div>
                        )}

                        {!loading && members.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            <th className="py-fib-13 px-fib-13">{t('core_equipo.col_member')}</th>
                                            <th className="py-fib-13 px-fib-13">{t('core_equipo.col_role')}</th>
                                            <th className="py-fib-13 px-fib-13">{t('core_equipo.col_modules')}</th>
                                            <th className="py-fib-13 px-fib-13">{t('core_equipo.col_billing')}</th>
                                            <th className="py-fib-13 px-fib-13">{t('core_equipo.col_status')}</th>
                                            <th className="py-fib-13 px-fib-13 text-right">{t('core_equipo.col_actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {members.map((member) => {
                                            const isOwner = member.role === 'OWNER';
                                            const opermaqEnabled = Boolean(member.allowedModules?.opermaq);
                                            const stockpileEnabled = Boolean(member.allowedModules?.stockpile);
                                            const billingEnabled = Boolean(member.canViewBilling);
                                            const memberStatus = String(member.status || 'ACTIVE').toUpperCase();

                                            return (
                                                <tr
                                                    key={member.uid}
                                                    className="hover:bg-[#FFFFFF]/60 dark:hover:bg-[#000000]/40 transition-colors"
                                                >
                                                    <td className="py-fib-13 px-fib-13 align-top">
                                                        <div className="font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {member.fullName || undeclaredLabel}
                                                        </div>
                                                        <div className="flex items-center gap-1 text-microcopy text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                                            <span className="select-text">{member.email}</span>
                                                            <CopyButton value={member.email} title={t('core_equipo.copy_email')} />
                                                        </div>
                                                        <div className="text-microcopy text-[#94A3B8] dark:text-[#5A6072] mt-0.5">
                                                            {member.jobTitle ? member.jobTitle : undeclaredLabel}
                                                            {member.taxId ? ` · ${member.countryCode || 'CL'} ${member.taxId}` : ''}
                                                        </div>
                                                    </td>
                                                    <td className="py-fib-13 px-fib-13 align-top">
                                                        <span className={roleTextClass(member.role)}>
                                                            {t(`core_equipo.role_${member.role}`, member.role)}
                                                        </span>
                                                    </td>
                                                    <td className="py-fib-13 px-fib-13 align-top">
                                                        <div className="space-y-1 text-microcopy">
                                                            <div>
                                                                <span className="text-[#475569] dark:text-[#8A93A6]">OPQ: </span>
                                                                <span className={opermaqEnabled ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                                                    {opermaqEnabled ? t('core_equipo.mod_on') : t('core_equipo.mod_off')}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-[#475569] dark:text-[#8A93A6]">STK: </span>
                                                                <span className={stockpileEnabled ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                                                    {stockpileEnabled ? t('core_equipo.mod_on') : t('core_equipo.mod_off')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-fib-13 px-fib-13 align-top">
                                                        <span
                                                            className={`text-microcopy ${
                                                                billingEnabled
                                                                    ? 'text-[#00AEEF]'
                                                                    : 'text-[#94A3B8] dark:text-[#5A6072]'
                                                            }`}
                                                        >
                                                            {billingEnabled ? t('core_equipo.yes') : t('core_equipo.no')}
                                                        </span>
                                                    </td>
                                                    <td className="py-fib-13 px-fib-13 align-top">
                                                        <span
                                                            className={`text-microcopy ${
                                                                memberStatus === 'ACTIVE'
                                                                    ? 'text-[#00AEEF]'
                                                                    : memberStatus === 'PENDING'
                                                                        ? 'text-[#C68346]'
                                                                        : 'text-red-500'
                                                            }`}
                                                        >
                                                            {t(`core_equipo.status_${memberStatus}`, memberStatus)}
                                                        </span>
                                                    </td>
                                                    <td className="py-fib-13 px-fib-13 align-top text-right">
                                                        <div className="inline-flex items-center gap-fib-8">
                                                            <button
                                                                type="button"
                                                                disabled={isOwner}
                                                                onClick={() => openEditMember(member)}
                                                                title={isOwner ? t('core_equipo.btn_owner_locked_edit') : t('core_equipo.btn_edit_member')}
                                                                aria-label={isOwner ? t('core_equipo.btn_owner_locked_edit') : t('core_equipo.btn_edit_member')}
                                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={isOwner}
                                                                onClick={() => openDeleteMember(member)}
                                                                title={isOwner ? t('core_equipo.btn_owner_locked_delete') : t('core_equipo.btn_delete_member')}
                                                                aria-label={isOwner ? t('core_equipo.btn_owner_locked_delete') : t('core_equipo.btn_delete_member')}
                                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* PANEL QUIRÚRGICO DE EDICIÓN (HITL "ACTUALIZAR") */}
                    {editingMember && (
                        <form
                            onSubmit={handleSaveEdit}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13"
                        >
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <span className="text-microcopy font-mono uppercase text-[#C68346] block">
                                        {t('core_equipo.edit_kicker')}
                                    </span>
                                    <h3 className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {editingMember.fullName} · <span className="font-mono text-data-dense">{editingMember.email}</span>
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingMember(null);
                                        setEditConfirmWord('');
                                        setEditError(null);
                                    }}
                                    title={t('core_equipo.btn_close_edit')}
                                    aria-label={t('core_equipo.btn_close_edit')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13">
                                <div>
                                    <label htmlFor="equipo_edit_role" className={LBL}>
                                        {t('core_equipo.label_seat_role')}
                                    </label>
                                    <select
                                        id="equipo_edit_role"
                                        value={editRole}
                                        onChange={(e) => setEditRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'VIEWER')}
                                        className={INP}
                                    >
                                        <option value="ADMIN">{t('core_equipo.role_ADMIN')}</option>
                                        <option value="OPERATOR">{t('core_equipo.role_OPERATOR')}</option>
                                        <option value="VIEWER">{t('core_equipo.role_VIEWER')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="equipo_edit_status" className={LBL}>
                                        {t('core_equipo.label_status')}
                                    </label>
                                    <select
                                        id="equipo_edit_status"
                                        value={editStatus}
                                        onChange={(e) => setEditStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                                        className={INP}
                                    >
                                        <option value="ACTIVE">{t('core_equipo.status_ACTIVE')}</option>
                                        <option value="SUSPENDED">{t('core_equipo.status_SUSPENDED')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="equipo_edit_job_title" className={LBL}>
                                        {t('core_equipo.label_job_title')}
                                    </label>
                                    <input
                                        id="equipo_edit_job_title"
                                        type="text"
                                        value={editJobTitle}
                                        onChange={(e) => setEditJobTitle(e.target.value)}
                                        placeholder={t('core_equipo.edit_job_placeholder')}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INP}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="flex items-center justify-between gap-fib-8 p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                    <span className="text-microcopy font-mono uppercase">OPERMAQ</span>
                                    <M3Switch
                                        checked={editRole === 'ADMIN' ? true : editModOpermaq}
                                        disabled={editRole === 'ADMIN'}
                                        onChange={setEditModOpermaq}
                                        aria-label={t('core_equipo.aria_toggle_opermaq')}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-fib-8 p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                    <span className="text-microcopy font-mono uppercase">STOCKPILE</span>
                                    <M3Switch
                                        checked={editRole === 'ADMIN' ? true : editModStockpile}
                                        disabled={editRole === 'ADMIN'}
                                        onChange={setEditModStockpile}
                                        aria-label={t('core_equipo.aria_toggle_stockpile')}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-fib-8 p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                    <span className="text-microcopy font-mono uppercase">{t('core_equipo.col_billing')}</span>
                                    <M3Switch
                                        checked={editRole === 'ADMIN' ? true : editRole === 'VIEWER' ? editCanViewBilling : false}
                                        disabled={editRole !== 'VIEWER'}
                                        onChange={setEditCanViewBilling}
                                        aria-label={t('core_equipo.aria_toggle_billing')}
                                    />
                                </div>
                            </div>

                            {editError && (
                                <p className="text-data-dense font-mono text-red-600 dark:text-red-400">{editError}</p>
                            )}

                            {submittingEdit && <M3LinearBar percent={75} ariaLabel={t('core_equipo.saving_aria')} />}

                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="flex-1">
                                    <label htmlFor="equipo_edit_confirm" className={LBL}>
                                        {t('core_equipo.hitl_edit_prefix')}{' '}
                                        <span className="text-[#C68346]">ACTUALIZAR</span>{' '}
                                        {t('core_equipo.hitl_edit_suffix')}
                                    </label>
                                    <input
                                        id="equipo_edit_confirm"
                                        type="text"
                                        value={editConfirmWord}
                                        onChange={(e) => setEditConfirmWord(e.target.value)}
                                        placeholder="ACTUALIZAR"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INP}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submittingEdit || editConfirmWord.trim() !== 'ACTUALIZAR'}
                                    className="px-fib-21 py-fib-13 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    {submittingEdit ? t('core_equipo.btn_processing') : t('core_equipo.btn_save_changes')}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* PANEL QUIRÚRGICO DE DESVINCULACIÓN (HITL "ACTUALIZAR") */}
                    {deletingMember && (
                        <form
                            onSubmit={handleConfirmDelete}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-red-500/60 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13"
                        >
                            <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <span className="text-microcopy font-mono uppercase text-red-500 block">
                                        {t('core_equipo.delete_kicker')}
                                    </span>
                                    <h3 className="text-h2-section font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {deletingMember.fullName} · <span className="font-mono text-data-dense">{deletingMember.email}</span>
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDeletingMember(null);
                                        setDeleteConfirmWord('');
                                        setDeleteError(null);
                                    }}
                                    title={t('core_equipo.btn_cancel_delete')}
                                    aria-label={t('core_equipo.btn_cancel_delete')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>

                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                {t('core_equipo.delete_warning_prefix')}{' '}
                                <span className="font-mono">{t(`core_equipo.role_${deletingMember.role}`, deletingMember.role)}</span>{' '}
                                {t('core_equipo.delete_warning_suffix')}
                            </p>

                            {deleteError && (
                                <p className="text-data-dense font-mono text-red-600 dark:text-red-400">{deleteError}</p>
                            )}

                            {submittingDelete && <M3LinearBar percent={80} ariaLabel={t('core_equipo.revoking_aria')} />}

                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13">
                                <div className="flex-1">
                                    <label htmlFor="equipo_delete_confirm" className={LBL}>
                                        {t('core_equipo.hitl_edit_prefix')}{' '}
                                        <span className="text-red-500">ACTUALIZAR</span>{' '}
                                        {t('core_equipo.hitl_delete_suffix')}
                                    </label>
                                    <input
                                        id="equipo_delete_confirm"
                                        type="text"
                                        value={deleteConfirmWord}
                                        onChange={(e) => setDeleteConfirmWord(e.target.value)}
                                        placeholder="ACTUALIZAR"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INP}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submittingDelete || deleteConfirmWord.trim() !== 'ACTUALIZAR'}
                                    className="px-fib-21 py-fib-13 bg-red-600 hover:bg-red-700 text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    {submittingDelete ? t('core_equipo.btn_revoking') : t('core_equipo.btn_confirm_delete')}
                                </button>
                            </div>
                        </form>
                    )}
                </section>

                {/* PANEL DERECHO (38.2%) — ALTA DE INTEGRANTE */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                    <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                            {t('core_equipo.create_title')}
                        </h2>
                    </div>

                    <form
                        onSubmit={handleCreateMember}
                        autoComplete="off"
                        spellCheck={false}
                        className="p-fib-21 space-y-fib-13"
                    >
                        <div>
                            <span id="equipo_create_role_label" className={LBL}>
                                {t('core_equipo.label_seat_role')}
                            </span>
                            <div
                                className="grid grid-cols-3 gap-fib-8"
                                role="group"
                                aria-labelledby="equipo_create_role_label"
                            >
                                {(['ADMIN', 'OPERATOR', 'VIEWER'] as const).map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setCreateRole(r)}
                                        className={`py-fib-8 px-fib-8 text-microcopy font-mono uppercase border rounded-none shadow-none cursor-pointer transition-colors ${
                                            createRole === r
                                                ? 'border-[#C68346] bg-[#C68346] text-white'
                                                : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] hover:border-[#C68346]'
                                        }`}
                                    >
                                        {t(`core_equipo.role_${r}`, r)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label htmlFor="equipo_create_email" className={LBL}>
                                {t('core_equipo.create_email_label')}
                            </label>
                            <input
                                id="equipo_create_email"
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('core_equipo.create_email_placeholder')}
                                autoComplete="off"
                                spellCheck={false}
                                className={INP}
                            />
                        </div>

                        <div>
                            <label htmlFor="equipo_create_name" className={LBL}>
                                {t('core_equipo.create_name_label')}
                            </label>
                            <input
                                id="equipo_create_name"
                                type="text"
                                required
                                minLength={2}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder={t('core_equipo.create_name_placeholder')}
                                autoComplete="off"
                                spellCheck={false}
                                className={INP}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                            <div>
                                <label htmlFor="equipo_create_country" className={LBL}>
                                    {t('core_equipo.create_country_label')}
                                </label>
                                <select
                                    id="equipo_create_country"
                                    value={countryCode}
                                    onChange={(e) => setCountryCode(e.target.value)}
                                    className={INP}
                                >
                                    {COUNTRY_OPTIONS.map((c) => (
                                        <option key={c.code} value={c.code}>
                                            {t(`core_equipo.countries.${c.code}`, c.code)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="equipo_create_tax_id" className={LBL}>
                                    {t('core_equipo.create_tax_id_label')}
                                </label>
                                <input
                                    id="equipo_create_tax_id"
                                    type="text"
                                    value={taxId}
                                    onChange={(e) => setTaxId(e.target.value)}
                                    placeholder={activeCountry.taxPlaceholder}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INP}
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="equipo_create_job_title" className={LBL}>
                                {t('core_equipo.create_job_label')}
                            </label>
                            <input
                                id="equipo_create_job_title"
                                type="text"
                                value={jobTitle}
                                onChange={(e) => setJobTitle(e.target.value)}
                                placeholder={t('core_equipo.create_job_placeholder')}
                                autoComplete="off"
                                spellCheck={false}
                                className={INP}
                            />
                        </div>

                        <div className="space-y-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <span className={LBL}>{t('core_equipo.enabled_modules_label')}</span>
                            <div className="flex items-center justify-between p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                <span className="text-data-dense font-mono">OPERMAQ</span>
                                <M3Switch
                                    checked={createRole === 'ADMIN' ? true : modOpermaq}
                                    disabled={createRole === 'ADMIN'}
                                    onChange={setModOpermaq}
                                    aria-label={t('core_equipo.aria_toggle_opermaq')}
                                />
                            </div>
                            <div className="flex items-center justify-between p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                <span className="text-data-dense font-mono">STOCKPILE CONTROL</span>
                                <M3Switch
                                    checked={createRole === 'ADMIN' ? true : modStockpile}
                                    disabled={createRole === 'ADMIN'}
                                    onChange={setModStockpile}
                                    aria-label={t('core_equipo.aria_toggle_stockpile')}
                                />
                            </div>

                            {createRole === 'VIEWER' && (
                                <div className="flex items-center justify-between p-fib-13 border border-[#00AEEF]/40 bg-[#FFFFFF] dark:bg-[#000000]">
                                    <div>
                                        <span className="text-data-dense font-mono block">
                                            {t('core_equipo.billing_access_title')}
                                        </span>
                                        <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_equipo.billing_access_desc')}
                                        </span>
                                    </div>
                                    <M3Switch
                                        checked={canViewBilling}
                                        onChange={setCanViewBilling}
                                        aria-label={t('core_equipo.aria_toggle_billing_viewer')}
                                    />
                                </div>
                            )}
                        </div>

                        {createFeedback && (
                            <div
                                className={`p-fib-13 border text-data-dense font-mono ${
                                    createFeedback.type === 'ok'
                                        ? 'border-[#00AEEF]/40 bg-[#00AEEF]/5 text-[#00AEEF]'
                                        : 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400'
                                }`}
                            >
                                {createFeedback.text}
                            </div>
                        )}

                        {submittingCreate && <M3LinearBar percent={70} ariaLabel={t('core_equipo.creating_aria')} />}

                        <button
                            type="submit"
                            disabled={submittingCreate}
                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {submittingCreate ? t('core_equipo.btn_creating') : t('core_equipo.btn_create')}
                        </button>
                    </form>
                </aside>
            </div>
        </div>
    );
};

export default EquipoPage;
