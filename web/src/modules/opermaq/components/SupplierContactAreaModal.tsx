import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    type SupplierContactEntry,
    type SupplierEntity,
    type TenantPrivateSupplierContact,
} from '../../../contracts/manufacturers.contracts';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    FLAT_ICON_BTN_CLS,
    INPUT_BOX_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';

export interface SupplierContactAreaModalProps {
    open: boolean;
    supplier: SupplierEntity;
    existingAreas: string[];
    editingGlobalContact?: SupplierContactEntry | null;
    editingPrivateContact?: TenantPrivateSupplierContact | null;
    isDevMaster: boolean;
    isEduSandbox: boolean;
    tenantId?: string | null;
    activeManufacturerKey?: string | null;
    onClose: () => void;
    onSaved: (opts?: { updatedSupplier?: SupplierEntity; message?: string }) => Promise<void> | void;
}

export const SupplierContactAreaModal: React.FC<SupplierContactAreaModalProps> = ({
    open,
    supplier,
    existingAreas,
    editingGlobalContact = null,
    editingPrivateContact = null,
    isDevMaster,
    isEduSandbox,
    tenantId,
    activeManufacturerKey = null,
    onClose,
    onSaved,
}) => {
    const { t } = useTranslation();

    const lockedScope: 'GLOBAL' | 'TENANT_PRIVATE' | null = editingGlobalContact
        ? 'GLOBAL'
        : editingPrivateContact
          ? 'TENANT_PRIVATE'
          : !isDevMaster
            ? 'TENANT_PRIVATE'
            : null;

    const [scope, setScope] = useState<'GLOBAL' | 'TENANT_PRIVATE'>(
        lockedScope || (isDevMaster ? 'GLOBAL' : 'TENANT_PRIVATE')
    );
    const [areaName, setAreaName] = useState('');
    const [contactLabel, setContactLabel] = useState('');
    const [roleEmail, setRoleEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [portalUrl, setPortalUrl] = useState('');
    const [cityRegion, setCityRegion] = useState('');
    const [notes, setNotes] = useState('');
    const [confirmWord, setConfirmWord] = useState('');
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setErrorMsg(null);
        setConfirmWord('');

        if (editingGlobalContact) {
            setScope('GLOBAL');
            setAreaName(editingGlobalContact.areaName || '');
            setContactLabel(editingGlobalContact.contactLabel || '');
            setRoleEmail(editingGlobalContact.roleEmail || '');
            setPhone(editingGlobalContact.phone || '');
            setPortalUrl(editingGlobalContact.portalUrl || '');
            setCityRegion(editingGlobalContact.cityRegion || '');
            setNotes(editingGlobalContact.notes || '');
        } else if (editingPrivateContact) {
            setScope('TENANT_PRIVATE');
            setAreaName(editingPrivateContact.areaName || '');
            setContactLabel(editingPrivateContact.contactLabel || '');
            const isUrl = Boolean(editingPrivateContact.emailOrWeb && /^https?:\/\//i.test(editingPrivateContact.emailOrWeb));
            setRoleEmail(!isUrl ? editingPrivateContact.emailOrWeb || '' : '');
            setPortalUrl(isUrl ? editingPrivateContact.emailOrWeb || '' : '');
            setPhone(editingPrivateContact.phone || '');
            setCityRegion(editingPrivateContact.cityRegion || '');
            setNotes(editingPrivateContact.notes || '');
        } else {
            setScope(isDevMaster ? 'GLOBAL' : 'TENANT_PRIVATE');
            setAreaName('');
            setContactLabel('');
            setRoleEmail('');
            setPhone('');
            setPortalUrl('');
            setCityRegion(supplier.countryIso2 || 'CL');
            setNotes('');
        }
    }, [open, editingGlobalContact, editingPrivateContact, isDevMaster, supplier.countryIso2]);

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isEduSandbox) return;
        const cleanArea = areaName.trim();
        if (cleanArea.length < 2) {
            setErrorMsg(t('suppliers_v2.error_area_required', 'Ingresa el área comercial de este contacto.'));
            return;
        }

        if (scope === 'GLOBAL') {
            if (!isDevMaster) {
                setErrorMsg(t('suppliers_v2.error_dev_only', 'Edición maestra exclusiva de 1º DEV.'));
                return;
            }
            if (confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
                setErrorMsg(t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar la operación.'));
                return;
            }
            setBusy(true);
            setErrorMsg(null);
            try {
                const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/contacts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contactId: editingGlobalContact?.contactId || undefined,
                        areaName: cleanArea,
                        contactLabel: contactLabel.trim() || null,
                        roleEmail: roleEmail.trim() || null,
                        phone: phone.trim() || null,
                        portalUrl: portalUrl.trim() || null,
                        cityRegion: cityRegion.trim() || null,
                        manufacturerKeys: activeManufacturerKey
                            ? Array.from(new Set([...(supplier.manufacturerKeys || []), activeManufacturerKey]))
                            : supplier.manufacturerKeys || [],
                        isOfficialDealer: (supplier.manufacturerKeys || []).length > 0,
                        notes: notes.trim() || null,
                        confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || t('suppliers_v2.error_save_contact', 'Error al guardar contacto.'));
                }
                await onSaved({
                    updatedSupplier: data.supplier,
                    message: t('suppliers_v2.contact_saved_ok', 'Contacto registrado en agenda.'),
                });
                onClose();
            } catch (err: unknown) {
                setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_save_contact', 'Error al guardar.'));
            } finally {
                setBusy(false);
            }
            return;
        }

        // Alcance TENANT_PRIVATE (4º B2B o 1º DEV privado, Offline-First)
        if (!tenantId) {
            setErrorMsg(t('suppliers_v2.error_tenant_required', 'Cuenta organizacional requerida para agenda privada.'));
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        const privPayload = {
            contactId: editingPrivateContact?.contactId || undefined,
            supplierKey: supplier.supplierKey,
            manufacturerKey: activeManufacturerKey || supplier.manufacturerKeys?.[0] || null,
            distributorName: supplier.tradeName,
            areaName: cleanArea,
            contactLabel: contactLabel.trim() || null,
            channelType: 'PARTS' as const,
            cityRegion: cityRegion.trim() || supplier.countryIso2 || 'CL',
            phone: phone.trim() || null,
            emailOrWeb: roleEmail.trim() || portalUrl.trim() || null,
            notes: notes.trim() || null,
        };

        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                await syncQueueEngine.enqueueApiMutation(
                    '/api/manufacturers/contacts/private',
                    privPayload,
                    'opermaq:private-contact-synced',
                    tenantId,
                    'POST'
                );
                await onSaved({
                    message: t('suppliers_v2.contact_queued_offline', 'Contacto privado encolado para sincronización offline.'),
                });
                onClose();
                return;
            }

            try {
                const res = await authFetch('/api/manufacturers/contacts/private', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(privPayload),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || t('suppliers_v2.error_save_contact', 'Error al guardar contacto privado.'));
                }
                await onSaved({
                    message: t('suppliers_v2.contact_saved_ok', 'Contacto guardado en agenda privada B2B.'),
                });
                onClose();
            } catch {
                await syncQueueEngine.enqueueApiMutation(
                    '/api/manufacturers/contacts/private',
                    privPayload,
                    'opermaq:private-contact-synced',
                    tenantId,
                    'POST'
                );
                await onSaved({
                    message: t('suppliers_v2.contact_queued_offline', 'Contacto privado encolado para sincronización offline.'),
                });
                onClose();
            }
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : t('suppliers_v2.error_save_contact', 'Error de guardado.'));
        } finally {
            setBusy(false);
        }
    };

    const datalistId = `open-areas-${supplier.supplierKey}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-fib-21">
            <div className="w-full max-w-[680px] max-h-[90vh] overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                <div className="flex items-center justify-between h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                    <div className="flex items-center gap-fib-13 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-[#C68346]">
                            {editingGlobalContact || editingPrivateContact ? 'edit' : 'add'}
                        </span>
                        <span className="text-data-dense font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] truncate">
                            {t('suppliers_v2.contact_modal_title', 'CONTACTO COMERCIAL · ÁREA ABIERTA')}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close', 'Cerrar')}
                        className={FLAT_ICON_BTN_CLS}
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <form onSubmit={handleSubmit} autoComplete="off" spellCheck={false} className="p-fib-21 space-y-fib-21">
                    <div className="pb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13">
                        <div className="min-w-0">
                            <div className="text-body-main font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                {supplier.tradeName}
                            </div>
                            <div className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                                {supplier.countryIso2} · {supplier.legalName}
                            </div>
                        </div>
                        {isDevMaster && tenantId && !lockedScope && (
                            <div className="flex items-center gap-fib-8">
                                <button
                                    type="button"
                                    onClick={() => setScope('GLOBAL')}
                                    className={`min-h-[36px] px-fib-13 py-1 text-microcopy font-mono font-bold uppercase border rounded-none cursor-pointer ${
                                        scope === 'GLOBAL'
                                            ? 'border-[#C68346] text-[#C68346]'
                                            : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    {t('suppliers_v2.scope_global', 'GLOBAL')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScope('TENANT_PRIVATE')}
                                    className={`min-h-[36px] px-fib-13 py-1 text-microcopy font-mono font-bold uppercase border rounded-none cursor-pointer ${
                                        scope === 'TENANT_PRIVATE'
                                            ? 'border-[#00AEEF] text-[#00AEEF]'
                                            : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]'
                                    }`}
                                >
                                    {t('suppliers_v2.scope_private', 'PRIVADO B2B')}
                                </button>
                            </div>
                        )}
                    </div>

                    {errorMsg && (
                        <div className="p-fib-13 border border-[#C68346] text-data-dense font-mono text-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D]">
                            {errorMsg}
                        </div>
                    )}

                    {/* Campo Área Abierta Zero-Preset con sugerencias exclusivamente de áreas ya registradas */}
                    <div>
                        <label className={MICRO_LABEL_CLS}>
                            {t('suppliers_v2.open_area_label', 'ÁREA COMERCIAL O INDUSTRIAL (LIBRE · ZERO-PRESET) *')}
                        </label>
                        <input
                            type="text"
                            list={datalistId}
                            value={areaName}
                            onChange={(e) => setAreaName(e.target.value)}
                            placeholder={t(
                                'suppliers_v2.open_area_input_placeholder',
                                'Escribe cualquier área: Repuestos, Lubricantes, Equipos Nuevos, Usados, Arriendo, OTR...'
                            )}
                            className={INPUT_BOX_CLS}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <datalist id={datalistId}>
                            {existingAreas.map((area) => (
                                <option key={area} value={area} />
                            ))}
                        </datalist>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-[13px]">
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.contact_label_field', 'VENTANILLA / CARGO FUNCIONAL')}
                            </label>
                            <input
                                type="text"
                                value={contactLabel}
                                onChange={(e) => setContactLabel(e.target.value)}
                                placeholder={t('suppliers_v2.contact_label_placeholder', 'ej. Mesa Repuestos Zona Norte')}
                                className={INPUT_BOX_CLS}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.city_region_label', 'CIUDAD / SUCURSAL / REGIÓN')}
                            </label>
                            <input
                                type="text"
                                value={cityRegion}
                                onChange={(e) => setCityRegion(e.target.value)}
                                placeholder="ej. Antofagasta"
                                className={INPUT_BOX_CLS}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.role_email_label', 'CORREO DE ROL / VENTANILLA')}
                            </label>
                            <input
                                type="email"
                                value={roleEmail}
                                onChange={(e) => setRoleEmail(e.target.value)}
                                placeholder="repuestos@..."
                                className={MONO_INPUT_BOX_CLS}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div>
                            <label className={MICRO_LABEL_CLS}>
                                {t('suppliers_v2.phone_label', 'TELÉFONO CORPORATIVO')}
                            </label>
                            <input
                                type="text"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="+56 ..."
                                className={MONO_INPUT_BOX_CLS}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={MICRO_LABEL_CLS}>
                            {t('suppliers_v2.portal_url_label', 'PORTAL DE COTIZACIÓN / CATÁLOGO HTTPS')}
                        </label>
                        <input
                            type="url"
                            value={portalUrl}
                            onChange={(e) => setPortalUrl(e.target.value)}
                            placeholder="https://..."
                            className={MONO_INPUT_BOX_CLS}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    <div>
                        <label className={MICRO_LABEL_CLS}>
                            {t('suppliers_v2.notes_label', 'OBSERVACIONES OPERATIVAS')}
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t('suppliers_v2.notes_placeholder', 'Horario, SLA o alcance técnico del área.')}
                            className={INPUT_BOX_CLS}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    {busy && <M3LinearProgress indeterminate tone="copper" />}

                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                        {scope === 'GLOBAL' ? (
                            <div className="sm:w-[220px]">
                                <label className={MICRO_LABEL_CLS}>
                                    {t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}
                                </label>
                                <input
                                    type="text"
                                    value={confirmWord}
                                    onChange={(e) => setConfirmWord(e.target.value)}
                                    placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                        ) : (
                            <div className="text-microcopy font-mono text-[#00AEEF]">
                                {t('suppliers_v2.private_scope_ley21719', 'Aislado por tenant · Offline-First (Ley N° 21.719)')}
                            </div>
                        )}

                        <div className="flex items-center gap-fib-13">
                            <button type="button" onClick={onClose} className={BTN_OUTLINE_CLS}>
                                {t('common.cancel', 'Cancelar')}
                            </button>
                            <button
                                type="submit"
                                disabled={
                                    busy ||
                                    (scope === 'GLOBAL' &&
                                        confirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD)
                                }
                                className={BTN_COPPER_CLS}
                            >
                                {t('common.save', 'GUARDAR')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};
