import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { auth, db } from '../../config/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { isPasskeySupported, registerPasskey } from '../../services/passkeyService';
import siiActivities from '../../data/sii_activities.json';
import { CopyButton } from '../../components/common/CopyButton';
import SecureImage from '../../components/common/SecureImage';
import M3LinearProgress from '../../components/common/M3LinearProgress';
import CoBrandedReportHeader from '../../components/common/CoBrandedReportHeader';
import { SovereignGeoMapLazy } from '../../components/geo/SovereignGeoMapLazy';
import {
    CanonicalGeoFixSchema,
    type CanonicalGeoFix,
    type GeoResolvedCandidate,
} from '../../contracts/geo.contracts';
import {
    TenantLogoDescriptorSchema,
    type TenantLogoDescriptor,
} from '../../contracts/media.contracts';
import { geoCaptureService } from '../../core/geo/GeoCaptureService';
import { mediaDigestorClient } from '../../core/media/MediaDigestorClient';
import { getApiUrl } from '../../utils/network';

const LBL =
    'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const INP =
    'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const SECTION_HEADER =
    'px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between';
const FLAT_ICON_BTN =
    'bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center';

function parseAccountGeoFix(account: unknown): CanonicalGeoFix | null {
    const raw = (account as { geoFix?: unknown } | null)?.geoFix;
    if (!raw) return null;
    const parsed = CanonicalGeoFixSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

function parseAccountCorporateLogo(account: unknown): TenantLogoDescriptor | null {
    const raw = (account as { corporateLogo?: unknown } | null)?.corporateLogo;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = TenantLogoDescriptorSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

function parseAccountLegacyLogoUrl(account: unknown): string {
    const acc = account as { corporateLogo?: unknown; coBrandingLogoUrl?: unknown } | null;
    const raw =
        typeof (acc?.corporateLogo as { downloadUrl?: unknown } | undefined)?.downloadUrl === 'string'
            ? String((acc?.corporateLogo as { downloadUrl?: string }).downloadUrl)
            : typeof acc?.corporateLogo === 'string'
              ? acc.corporateLogo
              : typeof acc?.coBrandingLogoUrl === 'string'
                ? acc.coBrandingLogoUrl
                : '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.includes(';base64,')) {
        return '';
    }
    return trimmed;
}

function formatKbCas(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function resolveDisplayLogoUrl(rawUrl: string): string {
    const clean = rawUrl.trim();
    if (!clean) return '';
    return clean.startsWith('/api/') ? getApiUrl(clean) : clean;
}

export const EmpresaPage: React.FC = () => {
    const { t } = useTranslation();
    const undeclaredLabel = t('core_empresa.undeclared', '[Información técnica no declarada en ficha]');
    const { user, profile, currentAccount } = useAuth();
    const { session } = useMinReportSession();
    const isEduSandbox = Boolean(session?.isEduSandbox);
    const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
    const membershipRole = String(membership?.role || '').toUpperCase();
    const effectiveRole = String(session?.role || membershipRole || '').toUpperCase();
    const isLegacyBillingOnly =
        membershipRole === 'BILLING_ONLY' || membershipRole === 'SUBSCRIPTION_ADMIN';
    const canEditEmpresa = Boolean(
        !isEduSandbox &&
            (session?.isDevRoot ||
                session?.isSuperAdmin ||
                (currentAccount && user && currentAccount.ownerId === user.uid) ||
                (!isLegacyBillingOnly &&
                    (effectiveRole === 'OWNER' ||
                        effectiveRole === 'ADMIN' ||
                        membershipRole === 'OWNER' ||
                        membershipRole === 'ADMIN')))
    );
    const [editing, setEditing] = useState(false);
    const [enrollingPasskey, setEnrollingPasskey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [stampStatus, setStampStatus] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [addressSearchTerm, setAddressSearchTerm] = useState('');
    const [showAddressDropdown, setShowAddressDropdown] = useState(false);
    const [addressPredictions, setAddressPredictions] = useState<GeoResolvedCandidate[]>([]);
    const [addressLoading, setAddressLoading] = useState(false);
    const addressDropdownRef = useRef<HTMLDivElement>(null);
    const [confirmWord, setConfirmWord] = useState('');

    const [geoFix, setGeoFix] = useState<CanonicalGeoFix | null>(() =>
        parseAccountGeoFix(currentAccount)
    );
    const [capturingGps, setCapturingGps] = useState(false);
    const [geoNotice, setGeoNotice] = useState<string | null>(null);
    const [corporateLogo, setCorporateLogo] = useState<TenantLogoDescriptor | null>(() =>
        parseAccountCorporateLogo(currentAccount)
    );
    const [logoCleared, setLogoCleared] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

    const [form, setForm] = useState({
        razonSocial: currentAccount?.name || '',
        nombreFantasia: (currentAccount as any)?.nombreFantasia || '',
        rut: (currentAccount as any)?.taxId || '',
        giro: (currentAccount as any)?.giro || '',
        direccionComercial: (currentAccount as any)?.direccionComercial || '',
        comunaComercial: (currentAccount as any)?.commune || '',
        ciudadComercial: (currentAccount as any)?.city || '',
        regionComercial: (currentAccount as any)?.region || '',
        direccionSucursal: (currentAccount as any)?.direccionSucursal || '',
        emailComercial: (currentAccount as any)?.emailComercial || '',
        emailTributario: (currentAccount as any)?.emailTributario || '',
        emailDomain: (currentAccount as any)?.email_domain || '',
        telefonoPrincipal: (currentAccount as any)?.telefonoPrincipal || '',
        telefonoSecundario: (currentAccount as any)?.telefonoSecundario || '',
        postalCode: (currentAccount as any)?.postal_code || '',
    });

    useEffect(() => {
        if (currentAccount) {
            setForm({
                razonSocial: currentAccount.name || '',
                nombreFantasia: (currentAccount as any)?.nombreFantasia || '',
                rut: (currentAccount as any)?.taxId || '',
                giro: (currentAccount as any)?.giro || '',
                direccionComercial: (currentAccount as any)?.direccionComercial || '',
                comunaComercial: (currentAccount as any)?.commune || '',
                ciudadComercial: (currentAccount as any)?.city || '',
                regionComercial: (currentAccount as any)?.region || '',
                direccionSucursal: (currentAccount as any)?.direccionSucursal || '',
                emailComercial: (currentAccount as any)?.emailComercial || '',
                emailTributario: (currentAccount as any)?.emailTributario || '',
                emailDomain: (currentAccount as any)?.email_domain || '',
                telefonoPrincipal: (currentAccount as any)?.telefonoPrincipal || '',
                telefonoSecundario: (currentAccount as any)?.telefonoSecundario || '',
                postalCode: (currentAccount as any)?.postal_code || '',
            });
            setGeoFix(parseAccountGeoFix(currentAccount));
            setCorporateLogo(parseAccountCorporateLogo(currentAccount));
            setLogoCleared(false);
            setLogoUploading(false);
            setLogoUploadError(null);
        }
    }, [currentAccount]);

    const isChilean = useMemo(() => {
        const rutPattern = /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/;
        return rutPattern.test(form.rut);
    }, [form.rut]);

    const countryCode = useMemo(() => {
        const rawCode = String((currentAccount as any)?.countryCode || '')
            .trim()
            .toUpperCase();
        if (/^[A-Z]{2}$/.test(rawCode)) return rawCode;
        return isChilean ? 'CL' : undefined;
    }, [currentAccount, isChilean]);

    const filteredActivities = useMemo(() => {
        const list = Array.isArray(siiActivities)
            ? siiActivities
            : (siiActivities as any).default || [];
        if (!searchTerm) return list.slice(0, 10);
        const term = searchTerm.toLowerCase();
        return (list as any[])
            .filter(
                (a) => a.label.toLowerCase().includes(term) || a.code.includes(term)
            )
            .slice(0, 15);
    }, [searchTerm]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setShowDropdown(false);
            }
            if (
                addressDropdownRef.current &&
                !addressDropdownRef.current.contains(event.target as Node)
            ) {
                setShowAddressDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Geocodificación forward soberana con debounce 320ms solo en Modo Edición
    useEffect(() => {
        if (!editing || !showAddressDropdown) {
            setAddressPredictions([]);
            setAddressLoading(false);
            return;
        }
        const query = addressSearchTerm.trim();
        if (query.length < 2) {
            setAddressPredictions([]);
            setAddressLoading(false);
            return;
        }

        let active = true;
        const timer = window.setTimeout(async () => {
            setAddressLoading(true);
            try {
                const res = await geoCaptureService.resolveAddress({
                    mode: 'FORWARD',
                    query,
                    countryCode,
                    limit: 5,
                });
                if (active) {
                    setAddressPredictions(res.candidates);
                }
            } catch {
                if (active) setAddressPredictions([]);
            } finally {
                if (active) setAddressLoading(false);
            }
        }, 320);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [editing, addressSearchTerm, showAddressDropdown, countryCode]);

    const f = (k: keyof typeof form, v: string) =>
        setForm((prev) => ({ ...prev, [k]: v }));

    const handleSelectCandidate = (candidate: GeoResolvedCandidate) => {
        const composedStreet = `${candidate.street} ${candidate.streetNumber}`.trim();
        const resolvedAddress = composedStreet || candidate.formattedAddress;

        setForm((prev) => ({
            ...prev,
            direccionComercial: resolvedAddress,
            comunaComercial: candidate.locality || prev.comunaComercial,
            ciudadComercial: candidate.locality || prev.ciudadComercial,
            regionComercial: candidate.region || prev.regionComercial,
            postalCode: candidate.postalCode || prev.postalCode,
        }));

        const nextFix = geoCaptureService.fromCoordinates(candidate.lat, candidate.lng, {
            source: 'BACKEND_GEOCODER',
        });
        setGeoFix(nextFix);
        setAddressSearchTerm(resolvedAddress);
        setShowAddressDropdown(false);
        setGeoNotice(null);
    };

    const handleCaptureCurrentPosition = useCallback(async () => {
        if (!currentAccount?.id) return;
        setCapturingGps(true);
        setGeoNotice(null);
        try {
            const captured = await geoCaptureService.captureCurrentPosition({
                tenantId: currentAccount.id,
            });
            setGeoFix(captured);

            const hasEmptyDomicile =
                !form.direccionComercial.trim() ||
                !form.comunaComercial.trim() ||
                !form.ciudadComercial.trim() ||
                !form.regionComercial.trim();

            if (hasEmptyDomicile) {
                const rev = await geoCaptureService.resolveAddress({
                    mode: 'REVERSE',
                    lat: captured.lat,
                    lng: captured.lng,
                    countryCode,
                    limit: 1,
                });
                const top = rev.candidates[0];
                if (top) {
                    const streetLine =
                        `${top.street} ${top.streetNumber}`.trim() ||
                        top.formattedAddress;
                    setForm((prev) => ({
                        ...prev,
                        direccionComercial: prev.direccionComercial.trim() || streetLine,
                        comunaComercial: prev.comunaComercial.trim() || top.locality,
                        ciudadComercial: prev.ciudadComercial.trim() || top.locality,
                        regionComercial: prev.regionComercial.trim() || top.region,
                        postalCode: prev.postalCode.trim() || top.postalCode,
                    }));
                }
            }
        } catch (err: any) {
            setGeoNotice(err?.message || t('core_empresa.geo_capture_fallback'));
        } finally {
            setCapturingGps(false);
        }
    }, [
        countryCode,
        currentAccount?.id,
        form.ciudadComercial,
        form.comunaComercial,
        form.direccionComercial,
        form.regionComercial,
    ]);

    const handleCancelEdit = () => {
        if (currentAccount) {
            setForm({
                razonSocial: currentAccount.name || '',
                nombreFantasia: (currentAccount as any)?.nombreFantasia || '',
                rut: (currentAccount as any)?.taxId || '',
                giro: (currentAccount as any)?.giro || '',
                direccionComercial: (currentAccount as any)?.direccionComercial || '',
                comunaComercial: (currentAccount as any)?.commune || '',
                ciudadComercial: (currentAccount as any)?.city || '',
                regionComercial: (currentAccount as any)?.region || '',
                direccionSucursal: (currentAccount as any)?.direccionSucursal || '',
                emailComercial: (currentAccount as any)?.emailComercial || '',
                emailTributario: (currentAccount as any)?.emailTributario || '',
                emailDomain: (currentAccount as any)?.email_domain || '',
                telefonoPrincipal: (currentAccount as any)?.telefonoPrincipal || '',
                telefonoSecundario: (currentAccount as any)?.telefonoSecundario || '',
                postalCode: (currentAccount as any)?.postal_code || '',
            });
            setGeoFix(parseAccountGeoFix(currentAccount));
            setCorporateLogo(parseAccountCorporateLogo(currentAccount));
            setLogoCleared(false);
            setLogoUploading(false);
            setLogoUploadError(null);
        }
        setSearchTerm('');
        setShowDropdown(false);
        setAddressSearchTerm('');
        setShowAddressDropdown(false);
        setAddressPredictions([]);
        setEditing(false);
        setConfirmWord('');
        setSaveError(null);
        setGeoNotice(null);
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentAccount?.id || isEduSandbox) {
            e.target.value = '';
            return;
        }

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setLogoUploadError(t('core_empresa.err_logo_offline'));
            e.target.value = '';
            return;
        }

        const lowerName = file.name.toLowerCase();
        const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
        const isValidType =
            isSvg ||
            file.type === 'image/png' ||
            file.type === 'image/webp' ||
            lowerName.endsWith('.png') ||
            lowerName.endsWith('.webp');

        if (!isValidType) {
            setLogoUploadError(t('core_empresa.err_logo_format'));
            e.target.value = '';
            return;
        }

        setLogoUploading(true);
        setLogoUploadError(null);

        try {
            const profile: 'VECTOR_SVG_CLEAN' | 'IMAGE_ISO_SYMBOL' = isSvg
                ? 'VECTOR_SVG_CLEAN'
                : 'IMAGE_ISO_SYMBOL';

            const { descriptor } = await mediaDigestorClient.digestAndUploadCas(file, {
                profile,
                scope: 'SYMBOLOGY_MASTER',
                tenantId: currentAccount.id,
            });

            const url = String(descriptor.downloadUrl || '').trim();
            if (
                !url ||
                url.startsWith('blob:') ||
                url.startsWith('data:') ||
                url.includes(';base64,') ||
                !(url.startsWith('/api/media/') || url.startsWith('https://'))
            ) {
                throw new Error(t('core_empresa.err_logo_temp_url'));
            }

            const savingsPct =
                typeof descriptor.savingsPct === 'number'
                    ? descriptor.savingsPct
                    : Math.round((descriptor.savingsRatio || 0) * 1000) / 10;

            const normalizedDescriptor = TenantLogoDescriptorSchema.parse({
                sha256: descriptor.sha256,
                downloadUrl: url,
                mimeType: (descriptor.mimeType || (isSvg ? 'image/svg+xml' : 'image/webp')).slice(0, 64),
                ...(descriptor.extension ? { extension: descriptor.extension.slice(0, 16) } : {}),
                profile,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsPct,
                updatedAt: new Date().toISOString(),
            });

            setCorporateLogo(normalizedDescriptor);
            setLogoCleared(false);
        } catch (err: any) {
            setLogoUploadError(err?.message || t('core_empresa.err_logo_digest'));
        } finally {
            setLogoUploading(false);
            e.target.value = '';
        }
    };

    const handleResetLogo = () => {
        if (isEduSandbox) return;
        setCorporateLogo(null);
        setLogoCleared(true);
        setLogoUploadError(null);
    };

    const handleEnrollPasskey = async () => {
        if (!canEditEmpresa || !isPasskeySupported() || enrollingPasskey) return;
        setSaveError(null);
        setStampStatus(null);
        setEnrollingPasskey(true);
        try {
            const idToken = await auth.currentUser?.getIdToken();
            if (!idToken) {
                throw new Error(t('core_empresa.passkey_enroll_err'));
            }
            await registerPasskey(idToken, form.razonSocial.trim() || 'Terminal B2B MINREPORT');
            setStampStatus(t('core_empresa.passkey_enrolled_ok'));
        } catch (err: any) {
            if (err?.name !== 'NotAllowedError') {
                setSaveError(err?.message || t('core_empresa.passkey_enroll_err'));
            }
        } finally {
            setEnrollingPasskey(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canEditEmpresa) return;
        if (confirmWord !== 'ACTUALIZAR') return;
        if (!currentAccount?.id) {
            setSaveError(t('core_empresa.err_no_account'));
            return;
        }
        if (!form.razonSocial.trim()) {
            setSaveError(t('core_empresa.err_razon_social_required'));
            return;
        }

        setSaving(true);
        setSaveError(null);
        setStampStatus(null);

        try {
            const accountRef = doc(db, 'accounts', currentAccount.id);
            const updatePayload: Record<string, unknown> = {
                name: form.razonSocial.trim(),
                nombreFantasia: form.nombreFantasia.trim(),
                giro: form.giro.trim(),
                direccionComercial: form.direccionComercial.trim(),
                commune: form.comunaComercial.trim(),
                city: form.ciudadComercial.trim(),
                region: form.regionComercial.trim(),
                direccionSucursal: form.direccionSucursal.trim(),
                postal_code: form.postalCode.trim(),
                emailComercial: form.emailComercial.trim(),
                emailTributario: form.emailTributario.trim(),
                email_domain: form.emailDomain.trim(),
                telefonoPrincipal: form.telefonoPrincipal.trim(),
                telefonoSecundario: form.telefonoSecundario.trim(),
                updatedAt: serverTimestamp(),
            };

            if (geoFix) {
                updatePayload.geoFix = geoFix;
            }

            if (!isEduSandbox) {
                if (corporateLogo) {
                    const url = String(corporateLogo.downloadUrl || '').trim();
                    if (
                        url.startsWith('blob:') ||
                        url.startsWith('data:') ||
                        url.includes(';base64,') ||
                        !(url.startsWith('/api/media/') || url.startsWith('https://'))
                    ) {
                        setSaveError(t('core_empresa.err_logo_invalid_url'));
                        setSaving(false);
                        return;
                    }
                    const validLogo = TenantLogoDescriptorSchema.parse(corporateLogo);
                    updatePayload.corporateLogo = validLogo;
                    updatePayload.coBrandingLogoUrl = validLogo.downloadUrl;
                } else if (logoCleared) {
                    updatePayload.corporateLogo = null;
                    updatePayload.coBrandingLogoUrl = null;
                }
            }

            await updateDoc(accountRef, updatePayload);

            try {
                const tenantRef = doc(db, 'tenants', currentAccount.id);
                await updateDoc(tenantRef, {
                    company_name: form.razonSocial.trim(),
                    updatedAt: serverTimestamp(),
                });
            } catch {
                // Sincronización opcional sobre colección espejo tenants
            }

            if (geoFix) {
                try {
                    const stampRes = await geoCaptureService.issueGeoReportStamp({
                        accountId: currentAccount.id,
                        moduleId: 'b2b-core',
                        entityType: 'TENANT_HQ_LOCATION',
                        entityId: currentAccount.id,
                        fix: geoFix,
                        label: form.razonSocial.trim() || currentAccount.name,
                    });
                    setStampStatus(
                        stampRes.synced
                            ? t('core_empresa.stamp_synced', { id: stampRes.stamp.stampId })
                            : t('core_empresa.stamp_offline', { id: stampRes.stamp.stampId })
                    );
                } catch {
                    setStampStatus(t('core_empresa.stamp_pending'));
                }
            }

            setSaveSuccess(true);
            setEditing(false);
            setConfirmWord('');
            setSearchTerm('');
            setShowDropdown(false);
            setAddressSearchTerm('');
            setShowAddressDropdown(false);
            setGeoNotice(null);

            setTimeout(() => setSaveSuccess(false), 3500);
        } catch (err: any) {
            setSaveError(
                t('core_empresa.err_save_legal', {
                    detail: err?.message || t('core_empresa.err_check_permissions'),
                })
            );
        } finally {
            setSaving(false);
        }
    };

    if (!currentAccount) return null;

    const wgsFormatted = geoFix
        ? `${geoFix.lat.toFixed(6)}, ${geoFix.lng.toFixed(6)}`
        : '';
    const utmFormatted = geoFix ? geoFix.utm.formatted : '';
    const legacyAccountLogoUrl = parseAccountLegacyLogoUrl(currentAccount);
    const effectiveLogoDescriptor = logoCleared ? null : corporateLogo;
    const effectiveReadLogoUrl = isEduSandbox
        ? session?.coBrandingLogoUrl || ''
        : logoCleared
          ? ''
          : effectiveLogoDescriptor?.downloadUrl || legacyAccountLogoUrl;
    const resolvedReadLogoSrc = resolveDisplayLogoUrl(effectiveReadLogoUrl);

    const renderReadField = (
        label: string,
        value: string,
        opts?: { mono?: boolean; copyable?: boolean }
    ) => {
        const clean = value?.trim() || '';
        return (
            <div className="py-fib-13 px-fib-21 flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8">
                <span className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                    {label}
                </span>
                {clean ? (
                    <div className="inline-flex items-center gap-fib-8">
                        <span
                            className={`text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] ${
                                opts?.mono ? 'font-mono tabular-nums' : ''
                            } ${opts?.copyable ? 'select-text' : ''}`}
                        >
                            {clean}
                        </span>
                        {opts?.copyable && (
                            <CopyButton
                                value={clean}
                                title={t('core_empresa.copy_field', { field: label })}
                            />
                        )}
                    </div>
                ) : (
                    <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        {undeclaredLabel}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Modo Informe Técnico con Lápiz Quirúrgico */}
            <header className="flex items-start justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 gap-fib-13">
                <div>
                    <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                        {t('core_empresa.header_kicker')}
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('core_empresa.header_title')}
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        {isChilean
                            ? t('core_empresa.header_subtitle_sii')
                            : t('core_empresa.header_subtitle_reg')}
                    </p>
                </div>

                <div className="flex items-center gap-fib-13">
                    {saveSuccess && (
                        <span className="text-microcopy font-mono text-[#00AEEF] uppercase">
                            {t('core_empresa.badge_updated')}
                        </span>
                    )}
                    {canEditEmpresa && isPasskeySupported() && (
                        <button
                            type="button"
                            onClick={handleEnrollPasskey}
                            disabled={enrollingPasskey}
                            className="px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] dark:hover:border-[#C68346] text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {enrollingPasskey
                                ? t('core_empresa.passkey_enrolling')
                                : t('core_empresa.btn_enroll_passkey')}
                        </button>
                    )}
                    {canEditEmpresa &&
                        (!editing ? (
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                title={t('core_empresa.btn_edit_enable')}
                                aria-label={t('core_empresa.btn_edit_enable')}
                                className={FLAT_ICON_BTN}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    edit
                                </span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleCancelEdit}
                                title={t('core_empresa.btn_edit_cancel')}
                                aria-label={t('core_empresa.btn_edit_cancel')}
                                className={FLAT_ICON_BTN}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    close
                                </span>
                            </button>
                        ))}
                </div>
            </header>

            {saveError && (
                <div className="p-fib-13 bg-red-500/5 border border-red-500/30 rounded-none shadow-none text-data-dense text-red-600 dark:text-red-400 font-mono">
                    {saveError}
                </div>
            )}

            {stampStatus && (
                <div className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#00AEEF]/40 rounded-none shadow-none text-microcopy font-mono text-[#00AEEF]">
                    {stampStatus}
                </div>
            )}

            {!editing ? (
                /* MODO INFORME TÉCNICO POR DEFECTO (SOLO LECTURA) — Proporción Áurea 61.8% / 38.2% */
                <div className="space-y-fib-21">
                    <CoBrandedReportHeader
                        title={t('core_empresa.report_header_title')}
                        documentCode={`TENANT-${currentAccount.id.slice(0, 8).toUpperCase()}`}
                        organizationName={form.razonSocial || currentAccount.name}
                        coBrandingLogoUrl={effectiveReadLogoUrl || null}
                        utmStamp={utmFormatted || null}
                        isEduSandbox={isEduSandbox}
                    />

                    <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                    {/* ÁREA MAYOR (61.8%): Identificación Legal y Direcciones */}
                    <div className="space-y-fib-21">
                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_empresa.sec_legal_read')}
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                    gavel
                                </span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField(t('core_empresa.field_tenant_id'), currentAccount.id, {
                                    mono: true,
                                    copyable: true,
                                })}
                                {renderReadField(t('core_empresa.field_razon_social'), form.razonSocial)}
                                {renderReadField(
                                    isChilean ? t('core_empresa.field_rut_cl') : t('core_empresa.field_tax_id'),
                                    form.rut,
                                    { mono: true, copyable: true }
                                )}
                                {renderReadField(t('core_empresa.field_fantasy_name'), form.nombreFantasia)}
                                {renderReadField(t('core_empresa.field_giro'), form.giro)}
                            </div>
                        </section>

                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_empresa.sec_address_read')}
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                    location_on
                                </span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField(
                                    t('core_empresa.field_main_address'),
                                    form.direccionComercial
                                )}
                                {renderReadField(t('core_empresa.field_commune'), form.comunaComercial)}
                                {renderReadField(t('core_empresa.field_city'), form.ciudadComercial)}
                                {renderReadField(t('core_empresa.field_region'), form.regionComercial)}
                                {renderReadField(t('core_empresa.field_postal_code'), form.postalCode, {
                                    mono: true,
                                })}
                                {renderReadField(
                                    t('core_empresa.field_branch_address'),
                                    form.direccionSucursal
                                )}
                                {renderReadField(t('core_empresa.field_wgs84'), wgsFormatted, {
                                    mono: true,
                                    copyable: Boolean(wgsFormatted),
                                })}
                                {renderReadField(t('core_empresa.field_utm'), utmFormatted, {
                                    mono: true,
                                    copyable: Boolean(utmFormatted),
                                })}
                            </div>
                            <div className="p-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <SovereignGeoMapLazy
                                    fix={geoFix}
                                    interactive={false}
                                    label={form.razonSocial}
                                />
                            </div>
                        </section>
                    </div>

                    {/* ÁREA MENOR (38.2%): Contacto Oficial */}
                    <aside className="space-y-fib-21">
                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_empresa.sec_channels_read')}
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                    contact_mail
                                </span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField(t('core_empresa.field_email_commercial'), form.emailComercial, {
                                    mono: true,
                                    copyable: true,
                                })}
                                {renderReadField(
                                    isChilean
                                        ? t('core_empresa.field_email_dte_sii')
                                        : t('core_empresa.field_email_tax'),
                                    form.emailTributario,
                                    { mono: true, copyable: true }
                                )}
                                {renderReadField(t('core_empresa.field_email_domain'), form.emailDomain, {
                                    mono: true,
                                    copyable: true,
                                })}
                                {renderReadField(
                                    t('core_empresa.field_phone_primary'),
                                    form.telefonoPrincipal,
                                    { mono: true }
                                )}
                                {renderReadField(
                                    t('core_empresa.field_phone_secondary'),
                                    form.telefonoSecundario,
                                    { mono: true }
                                )}
                            </div>
                        </section>

                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_empresa.sec_cobranding')}
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">
                                    verified
                                </span>
                            </div>
                            <div className="p-fib-21 space-y-fib-13">
                                {isEduSandbox && (
                                    <p className="font-mono text-microcopy uppercase text-[#00AEEF]">
                                        {t('core_empresa.edu_logo_managed')}
                                    </p>
                                )}
                                {resolvedReadLogoSrc ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] p-fib-13 flex flex-col items-center justify-center min-h-[96px] rounded-none">
                                            <span className="self-start font-mono text-microcopy uppercase text-[#475569] mb-fib-8">
                                                {t('core_empresa.preview_light')}
                                            </span>
                                            <SecureImage
                                                src={resolvedReadLogoSrc}
                                                alt={form.razonSocial || t('core_empresa.logo_alt_light')}
                                                className="max-h-12 max-w-[160px] object-contain"
                                            />
                                        </div>
                                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#000000] p-fib-13 flex flex-col items-center justify-center min-h-[96px] rounded-none">
                                            <span className="self-start font-mono text-microcopy uppercase text-[#8A93A6] mb-fib-8">
                                                {t('core_empresa.preview_dark')}
                                            </span>
                                            <SecureImage
                                                src={resolvedReadLogoSrc}
                                                alt={form.razonSocial || t('core_empresa.logo_alt_dark')}
                                                className="max-h-12 max-w-[160px] object-contain"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <span className="block font-mono text-data-dense text-[#94A3B8] dark:text-[#5A6072]">
                                        {undeclaredLabel}
                                    </span>
                                )}

                                {effectiveLogoDescriptor && (
                                    <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6] space-y-1">
                                        <div className="text-[#0F172A] dark:text-[#F3F4F6]">
                                            ORIG {formatKbCas(effectiveLogoDescriptor.originalBytes)} ➔ CAS {formatKbCas(effectiveLogoDescriptor.optimizedBytes)} (-{effectiveLogoDescriptor.savingsPct.toFixed(1)}%)
                                        </div>
                                        <div className="truncate text-[#94A3B8] dark:text-[#5A6072]">
                                            SHA-256: {effectiveLogoDescriptor.sha256.slice(0, 16)}…
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    </aside>
                    </div>
                </div>
            ) : (
                /* MODO EDICIÓN QUIRÚRGICA CON CONFIRMACIÓN HITL "ACTUALIZAR" */
                <form
                    onSubmit={handleSave}
                    autoComplete="off"
                    spellCheck={false}
                    className="space-y-fib-21"
                >
                    <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                        {/* ÁREA MAYOR (61.8%): Edición Legal y Direcciones */}
                        <div className="space-y-fib-21">
                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    {t('core_empresa.edit_sec_1')}
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                    <div className="md:col-span-2">
                                        <label htmlFor="empresa_razon_social" className={LBL}>
                                            {t('core_empresa.field_razon_social')} *
                                        </label>
                                        <input
                                            id="empresa_razon_social"
                                            type="text"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.razonSocial}
                                            onChange={(e) =>
                                                f('razonSocial', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_rut" className={LBL}>
                                            {isChilean ? t('core_empresa.field_rut_cl') : t('core_empresa.field_tax_id_short')}
                                        </label>
                                        <input
                                            id="empresa_rut"
                                            type="text"
                                            disabled
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.rut}
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_nombre_fantasia" className={LBL}>
                                            {t('core_empresa.field_fantasy_name')}
                                        </label>
                                        <input
                                            id="empresa_nombre_fantasia"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.nombreFantasia}
                                            onChange={(e) =>
                                                f('nombreFantasia', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label htmlFor="empresa_giro" className={LBL}>
                                            {isChilean ? t('core_empresa.field_giro_sii') : t('core_empresa.field_giro')}
                                        </label>
                                        {isChilean ? (
                                            <div className="relative" ref={dropdownRef}>
                                                <input
                                                    id="empresa_giro"
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    placeholder={t('core_empresa.sii_search_placeholder')}
                                                    value={searchTerm || form.giro}
                                                    onFocus={() => setShowDropdown(true)}
                                                    onChange={(e) => {
                                                        setSearchTerm(e.target.value);
                                                        setShowDropdown(true);
                                                        if (!e.target.value)
                                                            f('giro', '');
                                                    }}
                                                    className={INP}
                                                />
                                                {showDropdown && (
                                                    <div className="absolute z-[100] w-full mt-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] shadow-none max-h-60 overflow-y-auto rounded-none">
                                                        {filteredActivities.length > 0 ? (
                                                            filteredActivities.map(
                                                                (act: any) => (
                                                                    <button
                                                                        key={act.code}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            f(
                                                                                'giro',
                                                                                act.label
                                                                            );
                                                                            setSearchTerm(
                                                                                act.label
                                                                            );
                                                                            setShowDropdown(
                                                                                false
                                                                            );
                                                                        }}
                                                                        className="w-full text-left px-fib-13 py-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] last:border-0 transition-colors flex items-start justify-between gap-fib-8 cursor-pointer rounded-none shadow-none"
                                                                    >
                                                                        <div className="flex flex-col">
                                                                            <span className="text-microcopy font-mono tabular-nums text-[#C68346]">
                                                                                {act.code}
                                                                            </span>
                                                                            <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                                                                {act.label}
                                                                            </span>
                                                                        </div>
                                                                    </button>
                                                                )
                                                            )
                                                        ) : (
                                                            <div className="px-fib-13 py-fib-13 text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                                                {t('core_empresa.sii_no_matches')}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <input
                                                id="empresa_giro"
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={form.giro}
                                                onChange={(e) =>
                                                    f('giro', e.target.value)
                                                }
                                                className={INP}
                                            />
                                        )}
                                    </div>
                                </div>
                            </section>

                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                                        {t('core_empresa.edit_sec_2')}
                                    </h2>
                                    <button
                                        type="button"
                                        onClick={handleCaptureCurrentPosition}
                                        disabled={capturingGps}
                                        title={t('core_empresa.btn_capture_gnss')}
                                        aria-label={t('core_empresa.btn_capture_gnss')}
                                        className={FLAT_ICON_BTN}
                                    >
                                        <span
                                            className={`material-symbols-outlined text-[20px] ${
                                                capturingGps
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#00AEEF]'
                                            }`}
                                        >
                                            my_location
                                        </span>
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                    <div className="md:col-span-2" ref={addressDropdownRef}>
                                        <label htmlFor="empresa_direccion_comercial" className={LBL}>
                                            {t('core_empresa.field_main_address')}
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="empresa_direccion_comercial"
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={
                                                    showAddressDropdown
                                                        ? addressSearchTerm
                                                        : form.direccionComercial
                                                }
                                                onFocus={() => {
                                                    setAddressSearchTerm(
                                                        form.direccionComercial
                                                    );
                                                    setShowAddressDropdown(true);
                                                }}
                                                onChange={(e) => {
                                                    setAddressSearchTerm(e.target.value);
                                                    f(
                                                        'direccionComercial',
                                                        e.target.value
                                                    );
                                                    setShowAddressDropdown(true);
                                                }}
                                                className={INP}
                                            />
                                            {showAddressDropdown &&
                                                addressSearchTerm.trim().length >= 2 &&
                                                (addressLoading ||
                                                    addressPredictions.length > 0) && (
                                                    <div className="absolute z-[100] w-full mt-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] shadow-none max-h-60 overflow-y-auto rounded-none">
                                                        {addressLoading ? (
                                                            <div className="px-fib-13 py-fib-13 text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                                                {t('core_empresa.resolving_address')}
                                                            </div>
                                                        ) : (
                                                            addressPredictions.map(
                                                                (cand) => (
                                                                    <button
                                                                        key={cand.placeId}
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleSelectCandidate(
                                                                                cand
                                                                            )
                                                                        }
                                                                        className="w-full text-left px-fib-13 py-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] last:border-0 transition-colors cursor-pointer rounded-none shadow-none"
                                                                    >
                                                                        <p className="text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                                            {
                                                                                cand.formattedAddress
                                                                            }
                                                                        </p>
                                                                        <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] truncate">
                                                                            {
                                                                                cand.utm
                                                                                    .formatted
                                                                            }
                                                                        </p>
                                                                    </button>
                                                                )
                                                            )
                                                        )}
                                                    </div>
                                                )}
                                        </div>
                                        {geoNotice && (
                                            <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] mt-fib-8">
                                                {geoNotice}
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_postal_code" className={LBL}>
                                            {t('core_empresa.field_postal_code')}
                                        </label>
                                        <input
                                            id="empresa_postal_code"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.postalCode}
                                            onChange={(e) =>
                                                f('postalCode', e.target.value)
                                            }
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_comuna" className={LBL}>
                                            {t('core_empresa.field_commune')}
                                        </label>
                                        <input
                                            id="empresa_comuna"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.comunaComercial}
                                            onChange={(e) =>
                                                f('comunaComercial', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_ciudad" className={LBL}>
                                            {t('core_empresa.field_city')}
                                        </label>
                                        <input
                                            id="empresa_ciudad"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.ciudadComercial}
                                            onChange={(e) =>
                                                f('ciudadComercial', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_region" className={LBL}>
                                            {t('core_empresa.field_region')}
                                        </label>
                                        <input
                                            id="empresa_region"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.regionComercial}
                                            onChange={(e) =>
                                                f('regionComercial', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label htmlFor="empresa_direccion_sucursal" className={LBL}>
                                            {t('core_empresa.field_branch_address')}
                                        </label>
                                        <input
                                            id="empresa_direccion_sucursal"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.direccionSucursal}
                                            onChange={(e) =>
                                                f('direccionSucursal', e.target.value)
                                            }
                                            className={INP}
                                        />
                                    </div>
                                </div>

                                {/* Coordenadas Canónicas y Visor Soberano Interactivo */}
                                <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                        <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none flex items-center justify-between gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_empresa.field_wgs84')}
                                            </span>
                                            {wgsFormatted ? (
                                                <div className="inline-flex items-center gap-fib-8">
                                                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                        {wgsFormatted}
                                                    </span>
                                                    <CopyButton
                                                        value={wgsFormatted}
                                                        title={t('core_empresa.copy_wgs84')}
                                                    />
                                                </div>
                                            ) : (
                                                <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                                    {undeclaredLabel}
                                                </span>
                                            )}
                                        </div>
                                        <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] rounded-none shadow-none flex items-center justify-between gap-fib-8">
                                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_empresa.field_utm')}
                                            </span>
                                            {utmFormatted ? (
                                                <div className="inline-flex items-center gap-fib-8">
                                                    <span className="text-data-dense font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                        {utmFormatted}
                                                    </span>
                                                    <CopyButton
                                                        value={utmFormatted}
                                                        title={t('core_empresa.copy_utm')}
                                                    />
                                                </div>
                                            ) : (
                                                <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                                    {undeclaredLabel}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <SovereignGeoMapLazy
                                        fix={geoFix}
                                        interactive={true}
                                        label={form.razonSocial}
                                        onSelectCoordinates={(coords) => {
                                            setGeoFix(coords.fix);
                                            setGeoNotice(null);
                                        }}
                                        onCaptureCurrent={handleCaptureCurrentPosition}
                                    />
                                </div>
                            </section>
                        </div>

                        {/* ÁREA MENOR (38.2%): Contacto Oficial y Confirmación HITL */}
                        <div className="space-y-fib-21">
                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    {t('core_empresa.edit_sec_3')}
                                </h2>
                                <div className="space-y-fib-13">
                                    <div>
                                        <label htmlFor="empresa_email_comercial" className={LBL}>
                                            {t('core_empresa.field_email_commercial')}
                                        </label>
                                        <input
                                            id="empresa_email_comercial"
                                            type="email"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailComercial}
                                            onChange={(e) =>
                                                f('emailComercial', e.target.value)
                                            }
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_email_tributario" className={LBL}>
                                            {isChilean ? t('core_empresa.field_email_dte_sii') : t('core_empresa.field_email_tax')}
                                        </label>
                                        <input
                                            id="empresa_email_tributario"
                                            type="email"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailTributario}
                                            onChange={(e) =>
                                                f('emailTributario', e.target.value)
                                            }
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_email_domain" className={LBL}>
                                            {t('core_empresa.field_email_domain')}
                                        </label>
                                        <input
                                            id="empresa_email_domain"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailDomain}
                                            onChange={(e) =>
                                                f('emailDomain', e.target.value)
                                            }
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_telefono_principal" className={LBL}>
                                            {t('core_empresa.field_phone_primary')}
                                        </label>
                                        <input
                                            id="empresa_telefono_principal"
                                            type="tel"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.telefonoPrincipal}
                                            onChange={(e) =>
                                                f('telefonoPrincipal', e.target.value)
                                            }
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="empresa_telefono_secundario" className={LBL}>
                                            {t('core_empresa.field_phone_secondary')}
                                        </label>
                                        <input
                                            id="empresa_telefono_secundario"
                                            type="tel"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.telefonoSecundario}
                                            onChange={(e) =>
                                                f('telefonoSecundario', e.target.value)
                                            }
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Co-Branding Corporativo CAS (Oculto para cuentas EDU Sandbox) */}
                            {!isEduSandbox ? (
                                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                    <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                        {t('core_empresa.edit_sec_4')}
                                    </h2>

                                    {logoUploading && (
                                        <div className="space-y-fib-8">
                                            <M3LinearProgress indeterminate ariaLabel={t('core_empresa.logo_digest_aria')} />
                                            <span className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_empresa.logo_digesting_msg')}
                                            </span>
                                        </div>
                                    )}

                                    {logoUploadError && (
                                        <div className="p-fib-8 border border-red-500/40 bg-red-500/10 font-mono text-microcopy text-red-600 dark:text-red-400 rounded-none">
                                            {logoUploadError}
                                        </div>
                                    )}

                                    {resolvedReadLogoSrc ? (
                                        <div className="p-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] flex items-center justify-between gap-fib-13 rounded-none">
                                            <SecureImage
                                                src={resolvedReadLogoSrc}
                                                alt={form.razonSocial || t('core_empresa.logo_alt_cas')}
                                                className="h-10 max-w-[140px] object-contain"
                                            />
                                            {effectiveLogoDescriptor && (
                                                <span className="font-mono text-microcopy tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                                    ORIG {formatKbCas(effectiveLogoDescriptor.originalBytes)} ➔ CAS {formatKbCas(effectiveLogoDescriptor.optimizedBytes)} (-{effectiveLogoDescriptor.savingsPct.toFixed(1)}%)
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="block font-mono text-data-dense text-[#94A3B8] dark:text-[#5A6072]">
                                            {undeclaredLabel}
                                        </span>
                                    )}

                                    <div className="flex flex-wrap items-center gap-fib-8">
                                        <label htmlFor="empresa_logo_file_input" className="relative cursor-pointer">
                                            <input
                                                id="empresa_logo_file_input"
                                                type="file"
                                                accept=".svg,.png,.webp"
                                                aria-label={t('core_empresa.logo_file_input_aria')}
                                                autoComplete="off"
                                                spellCheck={false}
                                                disabled={logoUploading || saving}
                                                onChange={handleLogoUpload}
                                                className="sr-only"
                                            />
                                            <span className="inline-block px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] hover:border-[#C68346] font-mono text-microcopy uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none">
                                                {resolvedReadLogoSrc ? t('core_empresa.btn_replace_logo') : t('core_empresa.btn_upload_logo')}
                                            </span>
                                        </label>

                                        {resolvedReadLogoSrc && (
                                            <button
                                                type="button"
                                                disabled={logoUploading || saving}
                                                onClick={handleResetLogo}
                                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent hover:border-red-500 hover:text-red-500 font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] rounded-none shadow-none cursor-pointer disabled:opacity-40"
                                            >
                                                {t('core_empresa.btn_reset_logo')}
                                            </button>
                                        )}
                                    </div>
                                </section>
                            ) : (
                                <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none">
                                    <p className="font-mono text-microcopy uppercase text-[#00AEEF]">
                                        {t('core_empresa.edu_logo_locked')}
                                    </p>
                                </section>
                            )}

                            {/* Confirmación HITL Obligatoria */}
                            <section className="border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <label htmlFor="empresa_confirm_word" className={LBL}>
                                    {t('core_empresa.hitl_confirm_label')}
                                </label>
                                <input
                                    id="empresa_confirm_word"
                                    type="text"
                                    value={confirmWord}
                                    onChange={(e) =>
                                        setConfirmWord(e.target.value.toUpperCase())
                                    }
                                    placeholder="ACTUALIZAR"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className={`${INP} font-mono font-bold text-center tracking-widest uppercase`}
                                />
                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={handleCancelEdit}
                                        className="flex-1 py-fib-8 px-fib-13 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white rounded-none shadow-none cursor-pointer"
                                    >
                                        {t('core_empresa.btn_cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving || confirmWord !== 'ACTUALIZAR'}
                                        className="flex-1 py-fib-8 px-fib-13 bg-[#C68346] hover:bg-[#B0743E] disabled:opacity-30 disabled:cursor-not-allowed text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                                    >
                                        {saving ? t('core_empresa.btn_saving') : t('core_empresa.btn_consolidate')}
                                    </button>
                                </div>
                            </section>
                        </div>
                    </div>
                </form>
            )}
        </div>
    );
};

export default EmpresaPage;
