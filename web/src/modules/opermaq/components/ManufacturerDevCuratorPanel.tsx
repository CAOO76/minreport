import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    EMPTY_MANUFACTURER_OFFICIAL_CONTACTS,
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    type ManufacturerOfficialContacts,
    type ManufacturerRecord,
} from '../../../contracts/manufacturers.contracts';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    FLAT_ICON_BTN_CLS,
    INPUT_BOX_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
    formatBytesCompact,
} from '../utils/supplierUiHelpers';
import { invalidateManufacturerLogoCache, resolvePublicLogoHref } from './ManufacturerLogoBadge';
import { M3LinearProgress } from './M3ProgressIndicator';
import { M3Switch } from './M3Switch';

export type DevCuratorMode = 'edit-brand' | 'create-brand' | null;

interface ManufacturerDevCuratorPanelProps {
    mode: Exclude<DevCuratorMode, null>;
    manufacturer: ManufacturerRecord | null;
    onClose: () => void;
    onMutated: (opts?: { selectKey?: string; message?: string }) => Promise<void> | void;
    onError: (message: string) => void;
}

export const ManufacturerDevCuratorPanel: React.FC<ManufacturerDevCuratorPanelProps> = ({
    mode,
    manufacturer,
    onClose,
    onMutated,
    onError,
}) => {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [confirmWord, setConfirmWord] = useState('');

    // Edit OEM state
    const [officialName, setOfficialName] = useState('');
    const [legalCorporateName, setLegalCorporateName] = useState('');
    const [hqCountryIso2, setHqCountryIso2] = useState('');
    const [hqCity, setHqCity] = useState('');
    const [officialWebsiteUrl, setOfficialWebsiteUrl] = useState('');
    const [hasWebFootprint, setHasWebFootprint] = useState(true);
    const [aliasesCsv, setAliasesCsv] = useState('');
    const [contacts, setContacts] = useState<ManufacturerOfficialContacts>({
        ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS,
    });
    const [selectedCandidateId, setSelectedCandidateId] = useState('');
    const [invertInDark, setInvertInDark] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Create OEM state
    const [newMake, setNewMake] = useState('');
    const [newLegalName, setNewLegalName] = useState('');
    const [newCountry, setNewCountry] = useState('');
    const [newHqCity, setNewHqCity] = useState('');
    const [newWebsite, setNewWebsite] = useState('');
    const [newHasWeb, setNewHasWeb] = useState(true);
    const [newRunAi, setNewRunAi] = useState(true);

    useEffect(() => {
        setConfirmWord('');
        if (manufacturer) {
            setOfficialName(manufacturer.officialName || '');
            setLegalCorporateName(manufacturer.legalCorporateName || '');
            setHqCountryIso2(manufacturer.hqCountryIso2 || '');
            setHqCity(manufacturer.hqCity || '');
            setOfficialWebsiteUrl(manufacturer.officialWebsiteUrl || '');
            setHasWebFootprint(manufacturer.hasPublicWebFootprint ?? true);
            setAliasesCsv((manufacturer.aliases || []).join(', '));
            setContacts({
                ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS,
                ...(manufacturer.officialContacts || {}),
            });
            const activeCand = (manufacturer.logoCandidates || []).find(
                (c) => c.sha256 === manufacturer.logoSvg?.sha256
            );
            setSelectedCandidateId(activeCand?.candidateId || '');
            setInvertInDark(Boolean(manufacturer.logoSvg?.invertInDark));
        }
    }, [mode, manufacturer?.manufacturerKey]);

    useEffect(() => {
        const handleEsc = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape' && !busy) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [busy, onClose]);

    const keywordOk = confirmWord.trim().toUpperCase() === MANUFACTURER_HITL_CONFIRM_KEYWORD;

    const jsonPost = async (url: string, method: 'POST' | 'PUT', body: Record<string, unknown>) => {
        const res = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || t('manufacturers_directory.error_operation'));
        }
        return data;
    };

    const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !manufacturer) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await authFetch(
                `/api/manufacturers/${encodeURIComponent(manufacturer.manufacturerKey)}/upload-logo`,
                { method: 'POST', body: fd }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('manufacturers_directory.error_operation'));
            if (data.candidate?.candidateId) {
                setSelectedCandidateId(data.candidate.candidateId);
            }
            invalidateManufacturerLogoCache(manufacturer.manufacturerKey);
            await onMutated({ message: t('manufacturers_directory.logo_uploaded_msg') });
        } catch (err: any) {
            onError(err?.message || t('manufacturers_directory.error_operation'));
        } finally {
            setBusy(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manufacturer || !keywordOk) return;
        setBusy(true);
        try {
            await jsonPost(`/api/manufacturers/${encodeURIComponent(manufacturer.manufacturerKey)}`, 'PUT', {
                officialName: officialName.trim(),
                legalCorporateName: legalCorporateName.trim() || null,
                hqCountryIso2: hqCountryIso2.trim().toUpperCase() || null,
                hqCity: hqCity.trim() || null,
                officialWebsiteUrl: hasWebFootprint ? officialWebsiteUrl.trim() || null : null,
                hasPublicWebFootprint: hasWebFootprint,
                officialContacts: hasWebFootprint
                    ? {
                        corporateContactUrl: contacts.corporateContactUrl?.trim() || null,
                        corporateEmail: contacts.corporateEmail?.trim() || null,
                        corporatePhone: contacts.corporatePhone?.trim() || null,
                        officialPartsUrl: contacts.officialPartsUrl?.trim() || null,
                        officialSupportUrl: contacts.officialSupportUrl?.trim() || null,
                        dealerLocatorUrl: contacts.dealerLocatorUrl?.trim() || null,
                    }
                    : { ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS },
                aliases: aliasesCsv
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                selectedLogoCandidateId: selectedCandidateId || undefined,
                invertInDark,
                confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
            });
            invalidateManufacturerLogoCache(manufacturer.manufacturerKey);
            await onMutated({ message: t('manufacturers_directory.updated_msg') });
            onClose();
        } catch (err: any) {
            onError(err?.message || t('manufacturers_directory.error_operation'));
        } finally {
            setBusy(false);
        }
    };

    const handleCreateBrand = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMake.trim() || !keywordOk) return;
        setBusy(true);
        try {
            const data = await jsonPost('/api/manufacturers', 'POST', {
                rawMake: newMake.trim(),
                legalCorporateName: newLegalName.trim() || null,
                hqCountryIso2: newCountry.trim().toUpperCase() || null,
                hqCity: newHqCity.trim() || null,
                officialWebsiteUrl: newHasWeb ? newWebsite.trim() || null : null,
                hasPublicWebFootprint: newHasWeb,
                runAiDiscovery: newHasWeb && newRunAi,
                confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
            });
            invalidateManufacturerLogoCache();
            await onMutated({
                selectKey: data.manufacturer?.manufacturerKey,
                message: t('manufacturers_directory.created_msg'),
            });
            onClose();
        } catch (err: any) {
            onError(err?.message || t('manufacturers_directory.error_operation'));
        } finally {
            setBusy(false);
        }
    };

    const titleByMode: Record<Exclude<DevCuratorMode, null>, string> = {
        'edit-brand': t('manufacturers_directory.dev_edit_title'),
        'create-brand': t('manufacturers_directory.dev_create_title'),
    };

    const confirmBlock = (
        <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] grid grid-cols-1 md:grid-cols-2 gap-fib-13 items-end">
            <div>
                <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.confirm_keyword_label')}</label>
                <input
                    type="text"
                    value={confirmWord}
                    onChange={(e) => setConfirmWord(e.target.value)}
                    placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                    autoComplete="off"
                    spellCheck={false}
                    className={MONO_INPUT_BOX_CLS}
                />
            </div>
        </div>
    );

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={titleByMode[mode]}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-fib-21"
            onClick={(ev) => {
                if (ev.target === ev.currentTarget && !busy) {
                    onClose();
                }
            }}
        >
            <div className="w-full max-w-[740px] max-h-[90vh] flex flex-col bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                <div className="h-12 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between gap-fib-13 shrink-0">
                    <h3 className="text-h2-section font-semibold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-[0.02em] truncate">
                        {titleByMode[mode]}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        title={t('manufacturers_directory.close_title')}
                        aria-label={t('manufacturers_directory.close_title')}
                        className={FLAT_ICON_BTN_CLS}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                {busy && <M3LinearProgress indeterminate tone="copper" />}

                <div className="overflow-y-auto p-fib-21 space-y-fib-21">
                    {mode === 'edit-brand' && manufacturer && (
                        <form onSubmit={handleSaveEdit} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                                <div className="md:col-span-2">
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.official_name_label')}</label>
                                    <input
                                        type="text"
                                        value={officialName}
                                        onChange={(e) => setOfficialName(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.hq_country_label')}</label>
                                    <input
                                        type="text"
                                        maxLength={2}
                                        value={hqCountryIso2}
                                        onChange={(e) => setHqCountryIso2(e.target.value.toUpperCase())}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={MONO_INPUT_BOX_CLS}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.hq_city_label')}</label>
                                    <input
                                        type="text"
                                        value={hqCity}
                                        onChange={(e) => setHqCity(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.legal_corporate_label')}</label>
                                    <input
                                        type="text"
                                        value={legalCorporateName}
                                        onChange={(e) => setLegalCorporateName(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.aliases_label')}</label>
                                    <input
                                        type="text"
                                        value={aliasesCsv}
                                        onChange={(e) => setAliasesCsv(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                            </div>

                            <M3Switch
                                checked={hasWebFootprint}
                                onChange={setHasWebFootprint}
                                label={t('manufacturers_directory.has_web_footprint_label')}
                            />

                            {hasWebFootprint && (
                                <div className="space-y-fib-13 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.website_label')}</label>
                                            <input
                                                type="url"
                                                value={officialWebsiteUrl}
                                                onChange={(e) => setOfficialWebsiteUrl(e.target.value)}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.corporate_contact_url_label')}</label>
                                            <input
                                                type="url"
                                                value={contacts.corporateContactUrl || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, corporateContactUrl: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.corporate_email_label')}</label>
                                            <input
                                                type="email"
                                                value={contacts.corporateEmail || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, corporateEmail: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.corporate_phone_label')}</label>
                                            <input
                                                type="text"
                                                value={contacts.corporatePhone || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, corporatePhone: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.official_parts_url_label')}</label>
                                            <input
                                                type="url"
                                                value={contacts.officialPartsUrl || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, officialPartsUrl: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div>
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.official_support_url_label')}</label>
                                            <input
                                                type="url"
                                                value={contacts.officialSupportUrl || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, officialSupportUrl: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.dealer_locator_url_label')}</label>
                                            <input
                                                type="url"
                                                value={contacts.dealerLocatorUrl || ''}
                                                onChange={(e) =>
                                                    setContacts((p) => ({ ...p, dealerLocatorUrl: e.target.value }))
                                                }
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={MONO_INPUT_BOX_CLS}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-fib-8 pt-fib-8">
                                <div className="flex items-center justify-between gap-fib-13">
                                    <span className={MICRO_LABEL_CLS}>{t('manufacturers_directory.logo_candidates_label')}</span>
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className={BTN_OUTLINE_CLS}>
                                        {t('manufacturers_directory.upload_logo_btn')}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".svg,.png,.webp,.jpg,.jpeg"
                                        onChange={handleUploadLogo}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="hidden"
                                    />
                                </div>
                                {(manufacturer.logoCandidates || []).length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-13">
                                        {(manufacturer.logoCandidates || []).map((cand) => {
                                            const isSel = cand.candidateId === selectedCandidateId;
                                            return (
                                                <button
                                                    key={cand.candidateId}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedCandidateId(cand.candidateId);
                                                        setInvertInDark(cand.invertInDark);
                                                    }}
                                                    className={`p-fib-13 border text-left rounded-none shadow-none cursor-pointer transition-colors ${isSel
                                                        ? 'border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D]'
                                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]'
                                                        }`}
                                                >
                                                    <div className="h-12 flex items-center justify-center mb-fib-8">
                                                        <img
                                                            src={resolvePublicLogoHref(cand.downloadUrl)}
                                                            alt={cand.candidateId}
                                                            draggable={false}
                                                            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                            onContextMenu={(ev) => ev.preventDefault()}
                                                            className={`max-h-10 max-w-full object-contain select-none pointer-events-none ${cand.invertInDark ? 'dark:invert' : ''
                                                                }`}
                                                        />
                                                    </div>
                                                    <div className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                        {formatBytesCompact(cand.originalBytes)} ➔ {formatBytesCompact(cand.optimizedBytes)} (-{Number(cand.savingsPct || 0).toFixed(1)}%)
                                                    </div>
                                                    <div
                                                        className={`text-microcopy font-mono font-bold uppercase mt-1 ${isSel ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                                            }`}
                                                    >
                                                        {isSel
                                                            ? t('manufacturers_directory.active_logo_label')
                                                            : t('manufacturers_directory.select_logo_label')}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <M3Switch
                                    checked={invertInDark}
                                    onChange={setInvertInDark}
                                    label={t('manufacturers_directory.invert_dark_label')}
                                />
                            </div>
                            {confirmBlock}
                            <div className="flex justify-end gap-fib-13 pt-fib-8">
                                <button type="button" onClick={onClose} className={BTN_OUTLINE_CLS}>
                                    {t('manufacturers_directory.cancel_btn')}
                                </button>
                                <button type="submit" disabled={busy || !keywordOk} className={BTN_COPPER_CLS}>
                                    {t('manufacturers_directory.save_btn')}
                                </button>
                            </div>
                        </form>
                    )}

                    {mode === 'create-brand' && (
                        <form onSubmit={handleCreateBrand} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-fib-13">
                                <div className="md:col-span-2">
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.official_name_label')}</label>
                                    <input
                                        type="text"
                                        required
                                        value={newMake}
                                        onChange={(e) => setNewMake(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.hq_country_label')}</label>
                                    <input
                                        type="text"
                                        maxLength={2}
                                        value={newCountry}
                                        onChange={(e) => setNewCountry(e.target.value.toUpperCase())}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={MONO_INPUT_BOX_CLS}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.hq_city_label')}</label>
                                    <input
                                        type="text"
                                        value={newHqCity}
                                        onChange={(e) => setNewHqCity(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={INPUT_BOX_CLS}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.legal_corporate_label')}</label>
                                <input
                                    type="text"
                                    value={newLegalName}
                                    onChange={(e) => setNewLegalName(e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={INPUT_BOX_CLS}
                                />
                            </div>
                            <M3Switch
                                checked={newHasWeb}
                                onChange={setNewHasWeb}
                                label={t('manufacturers_directory.has_web_footprint_label')}
                            />
                            {newHasWeb && (
                                <>
                                    <div>
                                        <label className={MICRO_LABEL_CLS}>{t('manufacturers_directory.website_label')}</label>
                                        <input
                                            type="url"
                                            value={newWebsite}
                                            onChange={(e) => setNewWebsite(e.target.value)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={MONO_INPUT_BOX_CLS}
                                        />
                                    </div>
                                    <M3Switch
                                        checked={newRunAi}
                                        onChange={setNewRunAi}
                                        label={t('manufacturers_directory.run_ai_discovery_label')}
                                    />
                                </>
                            )}
                            {confirmBlock}
                            <div className="flex justify-end gap-fib-13 pt-fib-8">
                                <button type="button" onClick={onClose} className={BTN_OUTLINE_CLS}>
                                    {t('manufacturers_directory.cancel_btn')}
                                </button>
                                <button type="submit" disabled={busy || !keywordOk} className={BTN_COPPER_CLS}>
                                    {t('manufacturers_directory.save_btn')}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManufacturerDevCuratorPanel;
