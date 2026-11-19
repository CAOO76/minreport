import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { getApiUrl } from '../../utils/network';
import { mediaDigestorClient } from '../../core/media/MediaDigestorClient';
import {
    AccountEntitlements,
    BasePackageTier,
    EduInstitution,
    EduInstitutionLogo,
    UpdateAccountEntitlementsPayloadSchema,
    UpsertEduInstitutionPayloadSchema,
} from '../../contracts';
import BrandLogo from '../../components/BrandLogo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { M3Switch } from '../../components/common/M3Switch';
import CopyButton from '../../components/common/CopyButton';

type AdminTab = 'B2B' | 'EDU' | 'INSTITUCIONES' | 'METRICAS' | 'MODULES' | 'LEDGER';

interface TenantRecord {
    id: string;
    uid?: string;
    accountId?: string;
    accountType?: 'B2B' | 'EDU';
    countryCode?: string;
    name?: string;
    companyName?: string;
    taxId?: string;
    rut?: string;
    email?: string;
    ownerEmail?: string;
    type?: string;
    classification?: string;
    status?: string;
    isEduSandbox?: boolean;
    academicRole?: string | null;
    eduInstitutionId?: string | null;
    eduInstitutionName?: string | null;
    eduInstitutionLogo?: EduInstitutionLogo | null;
    corporateLogo?: EduInstitutionLogo | null;
    gatekeeperStatus?: string;
    gatekeeperFindings?: Record<string, any>;
    entitlements?: AccountEntitlements | null;
    contract?: { activeModules?: { opermaq?: boolean; stockpile?: boolean } };
    institution?: string;
    academicDomain?: string;
    documentUrl?: string;
    enabledPlugins?: string[];
    enabledModules?: string[];
    createdAt?: number | string;
}

interface ModuleStatusEntry {
    id: 'opermaq' | 'stockpile';
    name: string;
    code: string;
    description: string;
    enabled: boolean;
    updatedAt?: string;
    updatedBy?: string;
}

interface AuditLogRecord {
    id: string;
    seq?: number;
    action?: string;
    actorEmail?: string;
    actorUid?: string;
    tenantId?: string;
    module?: string;
    targetEntity?: string;
    entryHash?: string;
    hash?: string;
    prevHash?: string;
    timestamp?: string | number;
    details?: Record<string, unknown>;
}

interface TenantMetricItem {
    accountId: string;
    accountName?: string | null;
    countryCode?: string | null;
    segment: 'B2B' | 'EDU';
    period: string;
    aiRequestsTotal: number;
    aiCacheHits: number;
    aiTokensInput: number;
    aiTokensOutput: number;
    aiTierPro: number;
    aiTierFlash: number;
    aiTierFlashLite: number;
    casOriginalBytes: number;
    casOptimizedBytes: number;
    casAssetsCount: number;
    m2mRequests: number;
    updatedAt?: number;
}

interface TenantMetricsSummary {
    aiRequestsTotal: number;
    aiCacheHits: number;
    aiTokensInput: number;
    aiTokensOutput: number;
    aiTierPro: number;
    aiTierFlash: number;
    aiTierFlashLite: number;
    casOriginalBytes: number;
    casOptimizedBytes: number;
    casAssetsCount: number;
    m2mRequests: number;
}

const getDefaultPeriod = (): string => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}_${m}`;
};

const resolveMediaSrc = (url?: string | null): string | null => {
    if (!url) return null;
    return url.startsWith('/api/') ? getApiUrl(url) : url;
};

const formatBytesCas = (bytes?: number | null): string => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const calcSavingsPct = (orig?: number | null, opt?: number | null): number => {
    const o = Number(orig || 0);
    const c = Number(opt || 0);
    if (!Number.isFinite(o) || o <= 0) return 0;
    const pct = ((o - c) / o) * 100;
    return Math.max(0, Math.round(pct * 10) / 10);
};

export const SuperAdminConsole: React.FC = () => {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const { user, isMfaVerified, signOut } = useAuth();
    const { session, isLoaded } = useMinReportSession();
    const missingValue = t('core_superadmin.common.undeclared_tech_value');

    const translateStatus = useCallback(
        (status?: string | null): string => {
            const key = String(status || 'PENDING').toUpperCase();
            return t(`core_superadmin.status.${key}`, { defaultValue: key });
        },
        [t]
    );

    const [activeTab, setActiveTab] = useState<AdminTab>('B2B');
    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [loadingData, setLoadingData] = useState(false);
    const [errorBanner, setErrorBanner] = useState<string | null>(null);
    const [statusBanner, setStatusBanner] = useState<string | null>(null);

    // Edición quirúrgica de Entitlements por Cuenta (B2B / EDU)
    const [editingEntitlements, setEditingEntitlements] = useState(false);
    const [entBasePackage, setEntBasePackage] = useState<BasePackageTier>('CORE_BASE');
    const [entAddonOpermaq, setEntAddonOpermaq] = useState(false);
    const [entAddonStockpile, setEntAddonStockpile] = useState(false);
    const [entMaxProjects, setEntMaxProjects] = useState<string>('');
    const [entEduInstitutionId, setEntEduInstitutionId] = useState<string>('');
    const [entKeyword, setEntKeyword] = useState('');
    const [entSubmitting, setEntSubmitting] = useState(false);
    const [gatekeeperLoading, setGatekeeperLoading] = useState(false);

    // Padrón de Instituciones EDU Acreditadas
    const [eduInstitutions, setEduInstitutions] = useState<EduInstitution[]>([]);
    const [instLoading, setInstLoading] = useState(false);
    const [instSearch, setInstSearch] = useState('');
    const [selectedInstitution, setSelectedInstitution] = useState<EduInstitution | null>(null);
    const [instMode, setInstMode] = useState<'VIEW' | 'EDIT' | 'CREATE'>('VIEW');
    const [instName, setInstName] = useState('');
    const [instCountry, setInstCountry] = useState('CL');
    const [instDomainsRaw, setInstDomainsRaw] = useState('');
    const [instMaxProjects, setInstMaxProjects] = useState<number>(3);
    const [instStatus, setInstStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
    const [instLogo, setInstLogo] = useState<EduInstitutionLogo | null>(null);
    const [instLogoUploading, setInstLogoUploading] = useState(false);
    const [instKeyword, setInstKeyword] = useState('');
    const [instSubmitting, setInstSubmitting] = useState(false);

    // Métricas Segmentadas por Cliente (4º B2B vs 5º EDU)
    const [metricsSegment, setMetricsSegment] = useState<'B2B' | 'EDU'>('B2B');
    const [metricsPeriod, setMetricsPeriod] = useState<string>(getDefaultPeriod);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [metricsItems, setMetricsItems] = useState<TenantMetricItem[]>([]);
    const [metricsSummary, setMetricsSummary] = useState<TenantMetricsSummary | null>(null);
    const [selectedMetricItem, setSelectedMetricItem] = useState<TenantMetricItem | null>(null);

    // Disponibilidad global de modulos (exclusivamente opermaq y stockpile)
    const [modulesState, setModulesState] = useState<ModuleStatusEntry[]>([
        {
            id: 'opermaq',
            name: 'OPERMAQ',
            code: 'MOD-OPERMAQ',
            description: 'Control de flota pesada, telemetria de horometros e inspecciones DS 132.',
            enabled: true,
        },
        {
            id: 'stockpile',
            name: 'STOCKPILE CONTROL',
            code: 'MOD-STOCKPILE',
            description: 'Cubicacion volumetrica 3D, fotogrametria y balance de tonelaje mineral.',
            enabled: true,
        },
    ]);
    const [pendingModuleToggle, setPendingModuleToggle] = useState<{
        moduleId: 'opermaq' | 'stockpile';
        current: boolean;
        next: boolean;
    } | null>(null);

    // Auditoria y Telemetria IA
    const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
    const [chainVerification, setChainVerification] = useState<{
        verified: boolean | null;
        checkedRecords?: number;
        serverMessage?: string;
        fallbackKey?: 'chain_valid_msg' | 'chain_invalid_msg' | 'chain_error_msg';
    } | null>(null);
    const [verifyingChain, setVerifyingChain] = useState(false);
    const [telemetryData, setTelemetryData] = useState<Record<string, any> | null>(null);

    // Confirmacion HITL ("ACTUALIZAR")
    const [hitlAction, setHitlAction] = useState<{
        kind: 'TENANT_STATUS' | 'MODULE_TOGGLE';
        targetUid?: string;
        currentStatus?: string;
        nextStatus?: 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
        moduleId?: 'opermaq' | 'stockpile';
        moduleName?: string;
        currentEnabled?: boolean;
        nextEnabled?: boolean;
    } | null>(null);
    const [hitlKeyword, setHitlKeyword] = useState('');
    const [hitlRejectionReason, setHitlRejectionReason] = useState('');
    const [hitlSubmitting, setHitlSubmitting] = useState(false);

    const fetchAdminApi = useCallback(async (path: string, init: RequestInit = {}): Promise<Response> => {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        return fetch(getApiUrl(path), {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...((init.headers as Record<string, string>) || {}),
            },
        });
    }, []);

    const syncEntitlementFormFromTenant = useCallback((tenant: TenantRecord | null) => {
        if (!tenant) return;
        const isEdu =
            tenant.accountType === 'EDU' ||
            (tenant.type || '').toUpperCase() === 'EDUCATIONAL' ||
            (tenant.classification || '').toLowerCase() === 'edu' ||
            Boolean(tenant.isEduSandbox);
        const defaultTier: BasePackageTier = isEdu ? 'ACADEMIC_SANDBOX' : 'CORE_BASE';
        setEntBasePackage(tenant.entitlements?.basePackage || defaultTier);
        setEntAddonOpermaq(Boolean(tenant.entitlements?.addonModules?.opermaq?.active));
        setEntAddonStockpile(Boolean(tenant.entitlements?.addonModules?.stockpile?.active));
        const maxProjVal = tenant.entitlements?.maxProjects;
        setEntMaxProjects(
            typeof maxProjVal === 'number' && Number.isFinite(maxProjVal)
                ? String(maxProjVal)
                : isEdu
                    ? '3'
                    : ''
        );
        setEntEduInstitutionId(tenant.eduInstitutionId || '');
        setEntKeyword('');
        setEditingEntitlements(false);
    }, []);

    const loadTenants = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const res = await fetchAdminApi('/api/admin/tenants');
            const data = await res.json().catch(() => ([]));
            if (!res.ok) {
                throw new Error(data?.error || t('core_superadmin.errors.http_tenants', { status: res.status }));
            }
            const list: TenantRecord[] = Array.isArray(data)
                ? data
                : Array.isArray(data?.tenants)
                    ? data.tenants
                    : Array.isArray(data?.items)
                        ? data.items
                        : [];
            setTenants(list);
            setSelectedTenant((prev) => {
                if (!prev) return null;
                const prevKey = prev.uid || prev.id;
                return list.find((item) => (item.uid || item.id) === prevKey) || prev;
            });
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.load_tenants'));
        } finally {
            setLoadingData(false);
        }
    }, [fetchAdminApi, t]);

    const loadEduInstitutions = useCallback(async () => {
        setInstLoading(true);
        try {
            const res = await fetchAdminApi('/api/admin/edu-institutions');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('core_superadmin.errors.http_institutions', { status: res.status }));
            }
            const list: EduInstitution[] = Array.isArray(data?.institutions) ? data.institutions : [];
            setEduInstitutions(list);
            setSelectedInstitution((prev) => {
                if (!prev) return null;
                return list.find((item) => item.id === prev.id) || null;
            });
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.load_institutions'));
        } finally {
            setInstLoading(false);
        }
    }, [fetchAdminApi, t]);

    const loadTenantMetrics = useCallback(async () => {
        setMetricsLoading(true);
        setErrorBanner(null);
        try {
            const cleanPeriod = metricsPeriod.trim() || getDefaultPeriod();
            const qs = new URLSearchParams({
                segment: metricsSegment,
                period: cleanPeriod,
            });
            const res = await fetchAdminApi(`/api/admin/metrics/tenants?${qs.toString()}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('core_superadmin.errors.http_metrics', { status: res.status }));
            }
            const items: TenantMetricItem[] = Array.isArray(data?.items) ? data.items : [];
            const rawSummary = data?.summary || data?.totals || null;
            setMetricsItems(items);
            setMetricsSummary(rawSummary);
            setSelectedMetricItem((prev) => {
                if (!prev) return items[0] || null;
                return items.find((i) => i.accountId === prev.accountId) || items[0] || null;
            });
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.load_metrics'));
        } finally {
            setMetricsLoading(false);
        }
    }, [fetchAdminApi, metricsSegment, metricsPeriod, t]);

    const loadModulesStatus = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const snap = await getDocs(collection(db, 'modules_status'));
            const map: Record<string, { enabled: boolean; updatedAt?: string; updatedBy?: string }> = {};
            snap.forEach((d) => {
                const raw = d.data();
                if (d.id === 'opermaq' || d.id === 'stockpile') {
                    map[d.id] = {
                        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
                        updatedAt: raw.updatedAt,
                        updatedBy: raw.updatedBy,
                    };
                }
            });
            setModulesState((prev) =>
                prev.map((m) => ({
                    ...m,
                    enabled: map[m.id]?.enabled ?? m.enabled,
                    updatedAt: map[m.id]?.updatedAt,
                    updatedBy: map[m.id]?.updatedBy,
                }))
            );
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.load_modules'));
        } finally {
            setLoadingData(false);
        }
    }, [t]);

    const loadLedgerAndTelemetry = useCallback(async () => {
        setLoadingData(true);
        setErrorBanner(null);
        try {
            const [logsRes, telResponse] = await Promise.all([
                fetchAdminApi('/api/admin/audit-logs'),
                fetchAdminApi('/api/admin/ai-telemetry'),
            ]);

            if (logsRes.ok) {
                const logsJson = await logsRes.json().catch(() => ([]));
                const rows: AuditLogRecord[] = Array.isArray(logsJson)
                    ? logsJson
                    : Array.isArray(logsJson?.logs)
                        ? logsJson.logs
                        : Array.isArray(logsJson?.items)
                            ? logsJson.items
                            : [];
                setAuditLogs(rows);
            } else {
                const errJson = await logsRes.json().catch(() => ({}));
                setErrorBanner(
                    errJson?.error || t('core_superadmin.errors.http_audit_logs', { status: logsRes.status })
                );
            }

            if (telResponse.ok) {
                const telJson = await telResponse.json().catch(() => null);
                setTelemetryData(telJson);
            } else {
                setTelemetryData(null);
            }
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.load_ledger'));
        } finally {
            setLoadingData(false);
        }
    }, [fetchAdminApi, t]);

    useEffect(() => {
        if (!isLoaded || !session || (!session.isSuperAdmin && !session.isDevRoot)) return;
        if (activeTab === 'B2B') {
            loadTenants();
        } else if (activeTab === 'EDU') {
            loadTenants();
            loadEduInstitutions();
        } else if (activeTab === 'INSTITUCIONES') {
            loadEduInstitutions();
        } else if (activeTab === 'METRICAS') {
            if (tenants.length === 0) {
                loadTenants();
            }
            loadTenantMetrics();
        } else if (activeTab === 'MODULES') {
            loadModulesStatus();
        } else if (activeTab === 'LEDGER') {
            loadLedgerAndTelemetry();
        }
    }, [
        activeTab,
        isLoaded,
        session,
        loadTenants,
        loadEduInstitutions,
        loadTenantMetrics,
        loadModulesStatus,
        loadLedgerAndTelemetry,
        tenants.length,
    ]);

    const tenantLookupMap = useMemo(() => {
        const map = new Map<string, TenantRecord>();
        tenants.forEach((t) => {
            if (t.id) map.set(t.id, t);
            if (t.uid) map.set(t.uid, t);
            if (t.accountId) map.set(t.accountId, t);
        });
        return map;
    }, [tenants]);

    const filteredTenants = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return tenants.filter((t) => {
            const isEduRow =
                t.accountType === 'EDU' ||
                (t.type || '').toUpperCase() === 'EDUCATIONAL' ||
                (t.classification || '').toLowerCase() === 'edu' ||
                Boolean(t.isEduSandbox);
            if (activeTab === 'EDU' && !isEduRow) return false;
            if (activeTab === 'B2B' && isEduRow) return false;
            if (!q) return true;
            const label = `${t.countryCode || ''} ${t.companyName || ''} ${t.name || ''} ${t.eduInstitutionName || ''} ${t.institution || ''} ${t.taxId || ''} ${t.rut || ''} ${t.email || ''} ${t.ownerEmail || ''}`.toLowerCase();
            return label.includes(q);
        });
    }, [tenants, activeTab, searchQuery]);

    const filteredInstitutions = useMemo(() => {
        const q = instSearch.trim().toLowerCase();
        if (!q) return eduInstitutions;
        return eduInstitutions.filter((inst) => {
            const haystack = `${inst.name} ${inst.countryCode} ${inst.domains.join(' ')}`.toLowerCase();
            return haystack.includes(q);
        });
    }, [eduInstitutions, instSearch]);

    const computedMetricsSummary = useMemo<TenantMetricsSummary>(() => {
        if (metricsSummary) return metricsSummary;
        return metricsItems.reduce<TenantMetricsSummary>(
            (acc, item) => ({
                aiRequestsTotal: acc.aiRequestsTotal + Number(item.aiRequestsTotal || 0),
                aiCacheHits: acc.aiCacheHits + Number(item.aiCacheHits || 0),
                aiTokensInput: acc.aiTokensInput + Number(item.aiTokensInput || 0),
                aiTokensOutput: acc.aiTokensOutput + Number(item.aiTokensOutput || 0),
                aiTierPro: acc.aiTierPro + Number(item.aiTierPro || 0),
                aiTierFlash: acc.aiTierFlash + Number(item.aiTierFlash || 0),
                aiTierFlashLite: acc.aiTierFlashLite + Number(item.aiTierFlashLite || 0),
                casOriginalBytes: acc.casOriginalBytes + Number(item.casOriginalBytes || 0),
                casOptimizedBytes: acc.casOptimizedBytes + Number(item.casOptimizedBytes || 0),
                casAssetsCount: acc.casAssetsCount + Number(item.casAssetsCount || 0),
                m2mRequests: acc.m2mRequests + Number(item.m2mRequests || 0),
            }),
            {
                aiRequestsTotal: 0,
                aiCacheHits: 0,
                aiTokensInput: 0,
                aiTokensOutput: 0,
                aiTierPro: 0,
                aiTierFlash: 0,
                aiTierFlashLite: 0,
                casOriginalBytes: 0,
                casOptimizedBytes: 0,
                casAssetsCount: 0,
                m2mRequests: 0,
            }
        );
    }, [metricsSummary, metricsItems]);

    const handleVerifyHashChain = async () => {
        setVerifyingChain(true);
        setErrorBanner(null);
        try {
            let res = await fetchAdminApi('/api/admin/audit-ledger/verify', { method: 'GET' });
            if (res.status === 404 || res.status === 405) {
                res = await fetchAdminApi('/api/admin/audit-ledger/verify', { method: 'POST', body: JSON.stringify({}) });
            }
            const data = await res.json().catch(() => ({}));
            if (
                res.status === 409 &&
                data &&
                typeof data === 'object' &&
                ('valid' in data || 'reason' in data || 'brokenAtSeq' in data)
            ) {
                const forensicParts: string[] = [];
                if (typeof data.brokenAtSeq === 'number') {
                    forensicParts.push(`seq=${data.brokenAtSeq}`);
                }
                if (typeof data.brokenAtDocId === 'string' && data.brokenAtDocId.trim()) {
                    forensicParts.push(`docId=${data.brokenAtDocId.trim()}`);
                }
                if (typeof data.reason === 'string' && data.reason.trim()) {
                    forensicParts.push(data.reason.trim());
                }
                const forensicMessage = forensicParts.length > 0 ? forensicParts.join(' · ') : undefined;
                setChainVerification({
                    verified: false,
                    checkedRecords:
                        typeof data.checkedCount === 'number'
                            ? data.checkedCount
                            : data.totalChecked ?? auditLogs.length,
                    serverMessage: forensicMessage,
                    fallbackKey: 'chain_invalid_msg',
                });
                return;
            }
            if (!res.ok) {
                throw new Error(data?.error || t('core_superadmin.errors.http_verify_chain', { status: res.status }));
            }
            const isValid = Boolean(data.valid ?? data.verified ?? data.intact ?? data.success);
            setChainVerification({
                verified: isValid,
                checkedRecords: typeof data.checkedCount === 'number' ? data.checkedCount : data.totalChecked ?? auditLogs.length,
                serverMessage: typeof data.message === 'string' && data.message.trim() ? data.message : undefined,
                fallbackKey: isValid ? 'chain_valid_msg' : 'chain_invalid_msg',
            });
        } catch (err: any) {
            setChainVerification({
                verified: null,
                serverMessage: err?.message || undefined,
                fallbackKey: 'chain_error_msg',
            });
        } finally {
            setVerifyingChain(false);
        }
    };

    const handleRunEduGatekeeper = async () => {
        if (!selectedTenant) return;
        const requestId = selectedTenant.uid || selectedTenant.id;
        setGatekeeperLoading(true);
        setErrorBanner(null);
        setStatusBanner(null);
        try {
            const res = await fetchAdminApi(`/api/edu/validate/${encodeURIComponent(requestId)}`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || t('core_superadmin.errors.http_gatekeeper', { status: res.status }));
            }
            const domValid = Boolean(data?.findings?.domain?.valid);
            const hipoMatch = Boolean(data?.findings?.hipo?.matched);
            const rawInstMatched = data?.findings?.domain?.matchedInstitution;
            const instMatchedLabel =
                typeof rawInstMatched === 'string'
                    ? rawInstMatched.trim() || missingValue
                    : rawInstMatched && typeof rawInstMatched === 'object'
                        ? [rawInstMatched.name, rawInstMatched.domainMatched].filter(Boolean).join(' · ') ||
                          rawInstMatched.id ||
                          missingValue
                        : missingValue;
            setStatusBanner(
                t('core_superadmin.edu.gatekeeper_result', {
                    requestId,
                    domainStatus: domValid
                        ? t('core_superadmin.edu.domain_valid')
                        : t('core_superadmin.edu.domain_unverified'),
                    hipoStatus: hipoMatch
                        ? t('core_superadmin.edu.hipo_match')
                        : t('core_superadmin.edu.hipo_no_match'),
                    institution: instMatchedLabel,
                })
            );
            await loadTenants();
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.gatekeeper_exec'));
        } finally {
            setGatekeeperLoading(false);
        }
    };

    const handleSaveAccountEntitlements = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTenant || entKeyword.trim() !== 'ACTUALIZAR') return;
        const accountTargetId = selectedTenant.accountId || selectedTenant.id || selectedTenant.uid;
        if (!accountTargetId) return;

        const parsedMaxProj = entMaxProjects.trim() === '' ? null : Number(entMaxProjects.trim());
        const payloadCandidate = {
            basePackage: entBasePackage,
            addonModules: {
                opermaq: entAddonOpermaq,
                stockpile: entAddonStockpile,
            },
            maxProjects: parsedMaxProj,
            ...(activeTab === 'EDU' ? { eduInstitutionId: entEduInstitutionId.trim() || null } : {}),
            confirmationKeyword: 'ACTUALIZAR' as const,
        };

        const validated = UpdateAccountEntitlementsPayloadSchema.safeParse(payloadCandidate);
        if (!validated.success) {
            setErrorBanner(validated.error.issues[0]?.message || t('core_superadmin.errors.invalid_entitlements'));
            return;
        }

        setEntSubmitting(true);
        setErrorBanner(null);
        setStatusBanner(null);
        try {
            const res = await fetchAdminApi(`/api/admin/accounts/${encodeURIComponent(accountTargetId)}/entitlements`, {
                method: 'PATCH',
                body: JSON.stringify(validated.data),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || t('core_superadmin.errors.http_entitlements', { status: res.status }));
            }
            setStatusBanner(t('core_superadmin.status_msg.entitlements_updated', { accountId: accountTargetId }));
            setEditingEntitlements(false);
            setEntKeyword('');
            await loadTenants();
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.save_entitlements'));
        } finally {
            setEntSubmitting(false);
        }
    };

    const openCreateInstitution = () => {
        setSelectedInstitution(null);
        setInstMode('CREATE');
        setInstName('');
        setInstCountry('CL');
        setInstDomainsRaw('');
        setInstMaxProjects(3);
        setInstStatus('ACTIVE');
        setInstLogo(null);
        setInstKeyword('');
        setErrorBanner(null);
        setStatusBanner(null);
    };

    const startEditInstitution = (inst: EduInstitution) => {
        setSelectedInstitution(inst);
        setInstMode('EDIT');
        setInstName(inst.name || '');
        setInstCountry(inst.countryCode || 'CL');
        setInstDomainsRaw(Array.isArray(inst.domains) ? inst.domains.join(', ') : '');
        setInstMaxProjects(typeof inst.defaultMaxProjects === 'number' ? inst.defaultMaxProjects : 3);
        setInstStatus(inst.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
        setInstLogo(inst.eduInstitutionLogo || null);
        setInstKeyword('');
        setErrorBanner(null);
    };

    const handleUploadInstitutionLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setInstLogoUploading(true);
        setErrorBanner(null);
        try {
            const { descriptor } = await mediaDigestorClient.digestAndUploadCas(file, {
                profile: 'IMAGE_ISO_SYMBOL',
                scope: 'SYMBOLOGY_MASTER',
            });
            if (
                !descriptor.downloadUrl ||
                descriptor.downloadUrl.startsWith('data:') ||
                descriptor.downloadUrl.startsWith('blob:') ||
                descriptor.downloadUrl.includes(';base64,')
            ) {
                throw new Error(t('core_superadmin.errors.invalid_cas_logo'));
            }
            const nextLogo: EduInstitutionLogo = {
                sha256: descriptor.sha256,
                downloadUrl: descriptor.downloadUrl,
                mimeType: descriptor.mimeType || 'image/webp',
                extension: descriptor.extension || 'webp',
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsPct:
                    typeof descriptor.savingsPct === 'number'
                        ? descriptor.savingsPct
                        : Math.round((descriptor.savingsRatio || 0) * 1000) / 10,
            };
            setInstLogo(nextLogo);
            setStatusBanner(
                t('core_superadmin.status_msg.logo_digested', {
                    orig: formatBytesCas(nextLogo.originalBytes),
                    opt: formatBytesCas(nextLogo.optimizedBytes),
                    pct: nextLogo.savingsPct,
                })
            );
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.logo_upload'));
        } finally {
            setInstLogoUploading(false);
            e.target.value = '';
        }
    };

    const handleSaveInstitution = async (e: React.FormEvent) => {
        e.preventDefault();
        if (instKeyword.trim() !== 'ACTUALIZAR') return;

        const domains = instDomainsRaw
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);

        const candidate = {
            name: instName.trim(),
            countryCode: instCountry.trim().toUpperCase(),
            domains,
            status: instStatus,
            defaultMaxProjects: Number(instMaxProjects) || 3,
            eduInstitutionLogo: instLogo,
            confirmationKeyword: 'ACTUALIZAR' as const,
        };

        const parsed = UpsertEduInstitutionPayloadSchema.safeParse(candidate);
        if (!parsed.success) {
            setErrorBanner(parsed.error.issues[0]?.message || t('core_superadmin.errors.invalid_institution'));
            return;
        }

        setInstSubmitting(true);
        setErrorBanner(null);
        setStatusBanner(null);
        try {
            const isEdit = instMode === 'EDIT' && selectedInstitution?.id;
            const endpoint = isEdit
                ? `/api/admin/edu-institutions/${encodeURIComponent(selectedInstitution.id)}`
                : '/api/admin/edu-institutions';
            const res = await fetchAdminApi(endpoint, {
                method: isEdit ? 'PATCH' : 'POST',
                body: JSON.stringify(parsed.data),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.error || t('core_superadmin.errors.http_institution_save', { status: res.status }));
            }
            const savedInst: EduInstitution | null = body?.institution || null;
            setStatusBanner(
                isEdit
                    ? t('core_superadmin.status_msg.institution_updated', { name: parsed.data.name })
                    : t('core_superadmin.status_msg.institution_created', { name: parsed.data.name })
            );
            setInstMode('VIEW');
            setInstKeyword('');
            await loadEduInstitutions();
            if (savedInst) {
                setSelectedInstitution(savedInst);
            }
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.save_institution'));
        } finally {
            setInstSubmitting(false);
        }
    };

    const executeHitlAction = async () => {
        if (!hitlAction || hitlKeyword.trim() !== 'ACTUALIZAR') return;
        setHitlSubmitting(true);
        setErrorBanner(null);
        setStatusBanner(null);

        try {
            if (hitlAction.kind === 'TENANT_STATUS' && hitlAction.targetUid && hitlAction.nextStatus) {
                const payload: Record<string, string> = {
                    status: hitlAction.nextStatus,
                    confirmationWord: 'ACTUALIZAR',
                };
                if (hitlAction.nextStatus === 'REJECTED' && hitlRejectionReason.trim()) {
                    payload.rejectionReason = hitlRejectionReason.trim();
                }

                const res = await fetchAdminApi(`/api/admin/tenants/${encodeURIComponent(hitlAction.targetUid)}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(body?.error || t('core_superadmin.errors.http_tenant_update', { status: res.status }));
                }
                setStatusBanner(
                    t('core_superadmin.status_msg.tenant_status_updated', {
                        targetUid: hitlAction.targetUid,
                        status: translateStatus(hitlAction.nextStatus),
                    })
                );
                await loadTenants();
                setSelectedTenant((prev) =>
                    prev && (prev.uid || prev.id) === hitlAction.targetUid ? { ...prev, status: hitlAction.nextStatus } : prev
                );
            } else if (hitlAction.kind === 'MODULE_TOGGLE' && hitlAction.moduleId && typeof hitlAction.nextEnabled === 'boolean') {
                const res = await fetchAdminApi('/api/admin/modules-status', {
                    method: 'PATCH',
                    body: JSON.stringify({
                        moduleId: hitlAction.moduleId,
                        enabled: hitlAction.nextEnabled,
                        confirmationWord: 'ACTUALIZAR',
                    }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(body?.error || t('core_superadmin.errors.http_module_update', { status: res.status }));
                }

                setPendingModuleToggle(null);
                setStatusBanner(
                    t('core_superadmin.status_msg.module_updated', {
                        module: hitlAction.moduleId.toUpperCase(),
                    })
                );
                await loadModulesStatus();
            }

            setHitlAction(null);
            setHitlKeyword('');
            setHitlRejectionReason('');
        } catch (err: any) {
            setErrorBanner(err?.message || t('core_superadmin.errors.admin_mutation'));
        } finally {
            setHitlSubmitting(false);
        }
    };

    if (!isLoaded) return null;
    if (!user) return <Navigate to="/access" replace />;
    if (!Capacitor.isNativePlatform() && !isMfaVerified && !session?.isDevRoot) {
        return <Navigate to="/access?step=otp" replace />;
    }
    if (session?.isTestPilot) return <Navigate to="/pilot" replace />;
    if (!session?.isSuperAdmin && !session?.isDevRoot) return <Navigate to="/dashboard" replace />;

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased">
            {/* Barra Superior Soberana 2º ADMIN */}
            <header className="h-14 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] flex items-center justify-between sticky top-0 z-40">
                <div className="flex items-center gap-fib-21">
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain pointer-events-none" />
                </div>

                <div className="flex items-center gap-fib-13">
                    {session.isDevRoot && (
                        <button
                            type="button"
                            onClick={() => navigate('/dev')}
                            title={t('core_superadmin.header.back_to_dev')}
                            aria-label={t('core_superadmin.header.back_to_dev')}
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-[#00AEEF] transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[20px]">terminal</span>
                        </button>
                    )}
                    <LanguageSwitch />
                    <ThemeSwitch />
                    <button
                        type="button"
                        onClick={() => signOut()}
                        title={t('core_superadmin.header.logout')}
                        aria-label={t('core_superadmin.header.logout')}
                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                    >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                    </button>
                </div>
            </header>

            {/* Navegacion Operativa de 6 Pestañas Limpias */}
            <nav
                aria-label={t('core_superadmin.tabs.nav_aria')}
                className="px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center gap-fib-21 overflow-x-auto"
            >
                {[
                    { id: 'B2B' as AdminTab, label: t('core_superadmin.tabs.b2b'), icon: 'domain' },
                    { id: 'EDU' as AdminTab, label: t('core_superadmin.tabs.edu'), icon: 'school' },
                    { id: 'INSTITUCIONES' as AdminTab, label: t('core_superadmin.tabs.institutions'), icon: 'account_balance' },
                    { id: 'METRICAS' as AdminTab, label: t('core_superadmin.tabs.metrics'), icon: 'monitoring' },
                    { id: 'MODULES' as AdminTab, label: t('core_superadmin.tabs.modules'), icon: 'tune' },
                    { id: 'LEDGER' as AdminTab, label: t('core_superadmin.tabs.ledger'), icon: 'verified_user' },
                ].map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab.id);
                                setSelectedTenant(null);
                                setEditingEntitlements(false);
                                setInstMode('VIEW');
                                setHitlAction(null);
                                setHitlKeyword('');
                                setHitlRejectionReason('');
                                setPendingModuleToggle(null);
                                setErrorBanner(null);
                                setStatusBanner(null);
                            }}
                            title={tab.label}
                            aria-label={tab.label}
                            className={`py-fib-13 px-fib-13 bg-transparent border-0 border-b-2 cursor-pointer transition-colors flex items-center justify-center ${
                                active
                                    ? 'border-[#C68346] text-[#C68346]'
                                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                            <span className="sr-only">{tab.label}</span>
                        </button>
                    );
                })}
            </nav>

            {/* Alertas Tecnicas */}
            {(errorBanner || statusBanner) && (
                <div className="px-fib-21 pt-fib-13 space-y-fib-8">
                    {errorBanner && (
                        <div
                            role="alert"
                            className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none"
                        >
                            {errorBanner}
                        </div>
                    )}
                    {statusBanner && (
                        <div
                            role="status"
                            className="p-fib-13 bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] text-xs font-mono rounded-none"
                        >
                            {statusBanner}
                        </div>
                    )}
                </div>
            )}

            {/* Macro-Layout en Proporcion Aurea (61.8% Area Mayor / 38.2% Area Menor) */}
            <main className="flex-1 flex flex-col lg:flex-row p-fib-21 gap-fib-21">
                {/* AREA MAYOR (61.8%) */}
                <section className="w-full lg:w-[61.8%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none flex flex-col gap-fib-21">
                    {(activeTab === 'B2B' || activeTab === 'EDU') && (
                        <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {activeTab === 'B2B'
                                            ? t('core_superadmin.tenants.title_b2b')
                                            : t('core_superadmin.tenants.title_edu')}
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        {t('core_superadmin.tenants.verified_count', { count: filteredTenants.length })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <input
                                        id="admin-tenants-search"
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={t('core_superadmin.tenants.search_placeholder')}
                                        aria-label={t('core_superadmin.tenants.search_aria')}
                                        className="bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-fib-13 py-2 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none w-64 select-text"
                                    />
                                    <button
                                        type="button"
                                        onClick={loadTenants}
                                        title={t('core_superadmin.tenants.refresh_aria')}
                                        aria-label={t('core_superadmin.tenants.refresh_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.tenants.col_country')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.tenants.col_tax_id')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.tenants.col_organization')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.tenants.col_package')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.tenants.col_status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {loadingData ? (
                                            <tr>
                                                <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.tenants.loading')}
                                                </td>
                                            </tr>
                                        ) : filteredTenants.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.tenants.empty')}
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredTenants.map((tenant) => {
                                                const tid = tenant.uid || tenant.id;
                                                const isSelected = (selectedTenant?.uid || selectedTenant?.id) === tid;
                                                const orgLabel =
                                                    tenant.companyName ||
                                                    tenant.name ||
                                                    tenant.eduInstitutionName ||
                                                    tenant.institution ||
                                                    missingValue;
                                                const taxLabel = tenant.taxId || tenant.rut || '';
                                                const emailLabel = tenant.ownerEmail || tenant.email || '';
                                                const countryCode = (tenant.countryCode || 'CL').toUpperCase();
                                                const pkg =
                                                    tenant.entitlements?.basePackage ||
                                                    (activeTab === 'EDU' ? 'ACADEMIC_SANDBOX' : 'CORE_BASE');
                                                const opqActive =
                                                    pkg === 'OPERMAQ_BASE' ||
                                                    pkg === 'FULL_SUITE' ||
                                                    pkg === 'ACADEMIC_SANDBOX' ||
                                                    Boolean(tenant.entitlements?.addonModules?.opermaq?.active);
                                                const stkActive =
                                                    pkg === 'FULL_SUITE' ||
                                                    Boolean(tenant.entitlements?.addonModules?.stockpile?.active);
                                                const maxProj = tenant.entitlements?.maxProjects;

                                                return (
                                                    <tr
                                                        key={tid}
                                                        onClick={() => {
                                                            setSelectedTenant(tenant);
                                                            syncEntitlementFormFromTenant(tenant);
                                                        }}
                                                        className={`cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? 'bg-[#C68346]/10'
                                                                : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                        }`}
                                                    >
                                                        <td className="py-fib-13 px-fib-8 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {countryCode}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 whitespace-nowrap">
                                                            {taxLabel ? (
                                                                <span className="inline-flex items-center gap-1 select-text">
                                                                    <span>{taxLabel}</span>
                                                                    <CopyButton
                                                                        value={taxLabel}
                                                                        title={t('core_superadmin.tenants.copy_tax_id')}
                                                                    />
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                                    {missingValue}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            <span className="block font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {orgLabel}
                                                            </span>
                                                            {emailLabel && (
                                                                <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                                    {emailLabel}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 text-microcopy">
                                                            <span className="block font-bold text-[#C68346]">{pkg}</span>
                                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                {opqActive ? 'OPQ' : '—'} · {stkActive ? 'STK' : '—'}
                                                                {activeTab === 'EDU'
                                                                    ? ` · ${t('core_superadmin.tenants.max_projects_edu', {
                                                                          count: maxProj ?? 3,
                                                                      })}`
                                                                    : maxProj
                                                                        ? ` · ${t('core_superadmin.tenants.max_projects_b2b', {
                                                                              count: maxProj,
                                                                          })}`
                                                                        : ''}
                                                            </span>
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            <span
                                                                className={`text-microcopy uppercase ${
                                                                    tenant.status === 'ACTIVE'
                                                                        ? 'text-[#00AEEF]'
                                                                        : tenant.status === 'REJECTED' || tenant.status === 'SUSPENDED'
                                                                            ? 'text-red-600 dark:text-red-400'
                                                                            : 'text-[#C68346]'
                                                                }`}
                                                            >
                                                                {translateStatus(tenant.status)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {activeTab === 'INSTITUCIONES' && (
                        <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('core_superadmin.institutions.title')}
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        {t('core_superadmin.institutions.registered_count', {
                                            count: filteredInstitutions.length,
                                        })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <input
                                        id="admin-institutions-search"
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={instSearch}
                                        onChange={(e) => setInstSearch(e.target.value)}
                                        placeholder={t('core_superadmin.institutions.search_placeholder')}
                                        aria-label={t('core_superadmin.institutions.search_aria')}
                                        className="bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-fib-13 py-2 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none w-56 select-text"
                                    />
                                    <button
                                        type="button"
                                        onClick={openCreateInstitution}
                                        className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase rounded-none border-0 cursor-pointer whitespace-nowrap"
                                    >
                                        {t('core_superadmin.institutions.new_btn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={loadEduInstitutions}
                                        title={t('core_superadmin.institutions.refresh_aria')}
                                        aria-label={t('core_superadmin.institutions.refresh_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_country')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_institution')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_domains')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_max_projects')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_logo_cas')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.institutions.col_status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {instLoading ? (
                                            <tr>
                                                <td colSpan={6} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.institutions.loading')}
                                                </td>
                                            </tr>
                                        ) : filteredInstitutions.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.institutions.empty')}
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredInstitutions.map((inst) => {
                                                const isSelected = selectedInstitution?.id === inst.id && instMode !== 'CREATE';
                                                const logo = inst.eduInstitutionLogo;
                                                return (
                                                    <tr
                                                        key={inst.id}
                                                        onClick={() => {
                                                            setSelectedInstitution(inst);
                                                            setInstMode('VIEW');
                                                            setInstKeyword('');
                                                        }}
                                                        className={`cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? 'bg-[#C68346]/10'
                                                                : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                        }`}
                                                    >
                                                        <td className="py-fib-13 px-fib-8 font-bold">{inst.countryCode}</td>
                                                        <td className="py-fib-13 px-fib-8 font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {inst.name}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                            {inst.domains.join(', ')}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">{inst.defaultMaxProjects}</td>
                                                        <td className="py-fib-13 px-fib-8 text-microcopy">
                                                            {logo ? (
                                                                <span className="text-[#00AEEF]">
                                                                    ORIG {formatBytesCas(logo.originalBytes)} ➔ CAS {formatBytesCas(logo.optimizedBytes)} (-{logo.savingsPct}%)
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                                    {t('core_superadmin.institutions.no_logo')}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            <span
                                                                className={`text-microcopy uppercase ${
                                                                    inst.status === 'ACTIVE'
                                                                        ? 'text-[#00AEEF]'
                                                                        : 'text-red-600 dark:text-red-400'
                                                                }`}
                                                            >
                                                                {translateStatus(inst.status)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {activeTab === 'METRICAS' && (
                        <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('core_superadmin.metrics.title', { segment: metricsSegment })}
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        {t('core_superadmin.metrics.subtitle', {
                                            period: metricsPeriod,
                                            count: metricsItems.length,
                                        })}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-fib-8">
                                    <div className="inline-flex border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                        <button
                                            type="button"
                                            onClick={() => setMetricsSegment('B2B')}
                                            className={`px-fib-13 py-2 text-xs font-mono uppercase cursor-pointer border-0 rounded-none transition-colors ${
                                                metricsSegment === 'B2B'
                                                    ? 'bg-[#C68346] text-white font-bold'
                                                    : 'bg-transparent text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                        >
                                            {t('core_superadmin.metrics.segment_b2b')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMetricsSegment('EDU')}
                                            className={`px-fib-13 py-2 text-xs font-mono uppercase cursor-pointer border-0 rounded-none transition-colors ${
                                                metricsSegment === 'EDU'
                                                    ? 'bg-[#C68346] text-white font-bold'
                                                    : 'bg-transparent text-[#475569] dark:text-[#8A93A6]'
                                            }`}
                                        >
                                            {t('core_superadmin.metrics.segment_edu')}
                                        </button>
                                    </div>

                                    <input
                                        id="admin-metrics-period"
                                        type="text"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={metricsPeriod}
                                        onChange={(e) => setMetricsPeriod(e.target.value.replace(/[^0-9_]/g, '').slice(0, 7))}
                                        placeholder="YYYY_MM"
                                        title={t('core_superadmin.metrics.period_title')}
                                        aria-label={t('core_superadmin.metrics.period_aria')}
                                        className="w-28 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] px-fib-13 py-2 text-xs font-mono tabular-nums text-center text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none select-text"
                                    />

                                    <button
                                        type="button"
                                        onClick={loadTenantMetrics}
                                        title={t('core_superadmin.metrics.refresh_aria')}
                                        aria-label={t('core_superadmin.metrics.refresh_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            {/* KPIs Superiores */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-fib-13 font-mono tabular-nums">
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_ai_total')}
                                    </span>
                                    <span className="block text-h1-header text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                        {computedMetricsSummary.aiRequestsTotal}
                                    </span>
                                    <span className="block text-microcopy text-[#00AEEF]">
                                        {t('core_superadmin.metrics.kpi_cache_hits', {
                                            count: computedMetricsSummary.aiCacheHits,
                                        })}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_swarm')}
                                    </span>
                                    <span className="block text-h1-header text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                        {computedMetricsSummary.aiTierPro} / {computedMetricsSummary.aiTierFlash} / {computedMetricsSummary.aiTierFlashLite}
                                    </span>
                                    <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_inferences')}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_cas_title')}
                                    </span>
                                    <span className="block text-h2-section font-bold text-[#C68346] mt-1">
                                        {formatBytesCas(computedMetricsSummary.casOriginalBytes)} ➔ {formatBytesCas(computedMetricsSummary.casOptimizedBytes)}
                                    </span>
                                    <span className="block text-microcopy text-[#00AEEF]">
                                        {t('core_superadmin.metrics.kpi_cas_savings', {
                                            pct: calcSavingsPct(
                                                computedMetricsSummary.casOriginalBytes,
                                                computedMetricsSummary.casOptimizedBytes
                                            ),
                                            count: computedMetricsSummary.casAssetsCount,
                                        })}
                                    </span>
                                </div>
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <span className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_m2m')}
                                    </span>
                                    <span className="block text-h1-header text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                        {computedMetricsSummary.m2mRequests}
                                    </span>
                                    <span className="block text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('core_superadmin.metrics.kpi_m2m_sub')}
                                    </span>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.metrics.col_org')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.metrics.col_country')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.metrics.col_ai_cache')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.metrics.col_tiers')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.metrics.col_cas')}</th>
                                            <th className="py-fib-13 px-fib-8 text-right">{t('core_superadmin.metrics.col_m2m')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {metricsLoading ? (
                                            <tr>
                                                <td colSpan={6} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.metrics.loading')}
                                                </td>
                                            </tr>
                                        ) : metricsItems.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.metrics.empty', {
                                                        segment: metricsSegment,
                                                        period: metricsPeriod,
                                                    })}
                                                </td>
                                            </tr>
                                        ) : (
                                            metricsItems.map((item) => {
                                                const matchedTenant = tenantLookupMap.get(item.accountId);
                                                const orgLabel =
                                                    item.accountName ||
                                                    matchedTenant?.companyName ||
                                                    matchedTenant?.name ||
                                                    item.accountId;
                                                const countryCode = (item.countryCode || matchedTenant?.countryCode || 'CL').toUpperCase();
                                                const savings = calcSavingsPct(item.casOriginalBytes, item.casOptimizedBytes);
                                                const isSelected = selectedMetricItem?.accountId === item.accountId;

                                                return (
                                                    <tr
                                                        key={item.accountId}
                                                        onClick={() => setSelectedMetricItem(item)}
                                                        className={`cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? 'bg-[#C68346]/10'
                                                                : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                        }`}
                                                    >
                                                        <td className="py-fib-13 px-fib-8">
                                                            <span className="block font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                                {orgLabel}
                                                            </span>
                                                            <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                                {item.accountId}
                                                            </span>
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 font-bold">{countryCode}</td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {item.aiRequestsTotal} / <span className="text-[#00AEEF]">{item.aiCacheHits}</span>
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {item.aiTierPro} / {item.aiTierFlash} / {item.aiTierFlashLite}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 text-microcopy">
                                                            ORIG {formatBytesCas(item.casOriginalBytes)} ➔ CAS {formatBytesCas(item.casOptimizedBytes)}{' '}
                                                            <span className="text-[#00AEEF]">(-{savings}%)</span>
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 text-right font-bold">{item.m2mRequests}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {activeTab === 'MODULES' && (
                        <div className="space-y-fib-21">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                    {t('core_superadmin.modules.title')}
                                </h1>
                                <p className="text-xs text-[#475569] dark:text-[#8A93A6]">
                                    {t('core_superadmin.modules.subtitle')}
                                </p>
                            </div>

                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                {modulesState.map((mod) => (
                                    <div key={mod.id} className="p-fib-21 flex items-center justify-between gap-fib-21">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-fib-13">
                                                <span className="font-mono text-xs font-bold text-[#C68346]">{mod.code}</span>
                                                <span className="text-sm font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">{mod.name}</span>
                                            </div>
                                            <p className="text-xs text-[#475569] dark:text-[#8A93A6]">
                                                {t(`core_superadmin.modules.${mod.id}_desc`)}
                                            </p>
                                            <p className="text-microcopy font-mono tabular-nums text-[#94A3B8] dark:text-[#5A6072]">
                                                {t('core_superadmin.modules.last_updated', {
                                                    date: mod.updatedAt || missingValue,
                                                })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-fib-13">
                                            <span className="font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {mod.enabled
                                                    ? t('core_superadmin.status.ENABLED')
                                                    : t('core_superadmin.status.SUSPENDED')}
                                            </span>
                                            <M3Switch
                                                checked={mod.enabled}
                                                aria-label={t('core_superadmin.modules.toggle_aria', { name: mod.name })}
                                                onChange={(nextVal) => {
                                                    setPendingModuleToggle({
                                                        moduleId: mod.id,
                                                        current: mod.enabled,
                                                        next: nextVal,
                                                    });
                                                    setHitlAction({
                                                        kind: 'MODULE_TOGGLE',
                                                        moduleId: mod.id,
                                                        moduleName: mod.name,
                                                        currentEnabled: mod.enabled,
                                                        nextEnabled: nextVal,
                                                    });
                                                    setHitlKeyword('');
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'LEDGER' && (
                        <div className="space-y-fib-21">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <div>
                                    <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        {t('core_superadmin.ledger.title')}
                                    </h1>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums">
                                        {t('core_superadmin.ledger.audited_count', { count: auditLogs.length })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-fib-8">
                                    <button
                                        type="button"
                                        onClick={handleVerifyHashChain}
                                        disabled={verifyingChain}
                                        className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer disabled:opacity-50"
                                    >
                                        {verifyingChain
                                            ? t('core_superadmin.ledger.verifying_btn')
                                            : t('core_superadmin.ledger.verify_btn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={loadLedgerAndTelemetry}
                                        title={t('core_superadmin.ledger.refresh_aria')}
                                        aria-label={t('core_superadmin.ledger.refresh_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                                    </button>
                                </div>
                            </div>

                            {chainVerification && (
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono tabular-nums space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="uppercase font-bold text-[#00AEEF]">
                                            {t('core_superadmin.ledger.chain_status_title')}
                                        </span>
                                        <span>
                                            {chainVerification.verified === true
                                                ? t('core_superadmin.ledger.chain_intact')
                                                : chainVerification.verified === false
                                                    ? t('core_superadmin.ledger.chain_altered')
                                                    : t('core_superadmin.ledger.chain_unconfirmed')}
                                        </span>
                                    </div>
                                    <p className="text-[#475569] dark:text-[#8A93A6]">
                                        {chainVerification.serverMessage ||
                                            t(`core_superadmin.ledger.${chainVerification.fallbackKey || 'chain_error_msg'}`)}
                                    </p>
                                </div>
                            )}

                            <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                                <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                                    <thead>
                                        <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-microcopy uppercase">
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.ledger.col_timestamp')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.ledger.col_action')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.ledger.col_actor')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.ledger.col_module')}</th>
                                            <th className="py-fib-13 px-fib-8">{t('core_superadmin.ledger.col_hash')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                        {auditLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                                    {t('core_superadmin.ledger.empty')}
                                                </td>
                                            </tr>
                                        ) : (
                                            auditLogs.map((entry) => {
                                                const resolvedHash = entry.entryHash || entry.hash;
                                                const formattedTs = typeof entry.timestamp === 'number'
                                                    ? new Date(entry.timestamp).toISOString()
                                                    : entry.timestamp
                                                        ? String(entry.timestamp)
                                                        : missingValue;
                                                return (
                                                    <tr key={entry.id} className="hover:bg-[#FFFFFF] dark:hover:bg-[#000000]">
                                                        <td className="py-fib-13 px-fib-8 whitespace-nowrap text-xs">
                                                            {formattedTs}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {entry.action || missingValue}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 select-text">
                                                            {entry.actorEmail || entry.actorUid || missingValue}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8 uppercase text-[#C68346]">
                                                            {entry.module || 'core'}
                                                        </td>
                                                        <td className="py-fib-13 px-fib-8">
                                                            {resolvedHash ? (
                                                                <span className="inline-flex items-center gap-1 select-text">
                                                                    <span>{resolvedHash.slice(0, 14)}...</span>
                                                                    <CopyButton
                                                                        value={resolvedHash}
                                                                        title={t('core_superadmin.ledger.copy_hash')}
                                                                    />
                                                                </span>
                                                            ) : (
                                                                <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                                    {missingValue}
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>

                {/* AREA MENOR (38.2%) - Ficha de Ingenieria / Entitlements / Instituciones / Metricas / HITL */}
                <aside className="w-full lg:w-[38.2%] bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none flex flex-col gap-fib-21">
                    {(activeTab === 'B2B' || activeTab === 'EDU') && (
                        <>
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 flex items-start justify-between gap-fib-13">
                                <div>
                                    <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                        {t('core_superadmin.tenant_detail.eyebrow')}
                                    </span>
                                    <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                        {selectedTenant
                                            ? (selectedTenant.companyName || selectedTenant.name || selectedTenant.eduInstitutionName || selectedTenant.institution || missingValue)
                                            : t('core_superadmin.tenant_detail.select_title')}
                                    </h2>
                                </div>
                                {selectedTenant && (selectedTenant.eduInstitutionLogo?.downloadUrl || selectedTenant.corporateLogo?.downloadUrl) && (
                                    <img
                                        src={resolveMediaSrc(selectedTenant.eduInstitutionLogo?.downloadUrl || selectedTenant.corporateLogo?.downloadUrl) || ''}
                                        alt={selectedTenant.companyName || selectedTenant.eduInstitutionName || t('core_superadmin.institutions.logo_alt')}
                                        draggable={false}
                                        onContextMenu={(e) => e.preventDefault()}
                                        style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                        className="h-10 max-w-[120px] object-contain border border-[#E2E8F0] dark:border-[#12151C] bg-white dark:bg-[#000000] p-1 select-none pointer-events-none shrink-0"
                                    />
                                )}
                            </div>

                            {!selectedTenant ? (
                                <p className="text-xs text-[#94A3B8] dark:text-[#5A6072] font-mono">
                                    {t('core_superadmin.tenant_detail.empty_prompt')}
                                </p>
                            ) : (
                                <div className="space-y-fib-21 text-xs font-mono tabular-nums">
                                    <dl className="space-y-fib-13">
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.tenant_detail.account_id')}
                                            </dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] flex items-center gap-1 select-text mt-0.5">
                                                <span>{selectedTenant.accountId || selectedTenant.uid || selectedTenant.id}</span>
                                                <CopyButton
                                                    value={selectedTenant.accountId || selectedTenant.uid || selectedTenant.id}
                                                    title={t('core_superadmin.common.copy_id')}
                                                />
                                            </dd>
                                        </div>
                                        <div className="grid grid-cols-2 gap-fib-13">
                                            <div>
                                                <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_superadmin.tenant_detail.country')}
                                                </dt>
                                                <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                                    {(selectedTenant.countryCode || 'CL').toUpperCase()}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_superadmin.tenant_detail.operational_status')}
                                                </dt>
                                                <dd className="text-[#00AEEF] uppercase mt-0.5">
                                                    {translateStatus(selectedTenant.status)}
                                                </dd>
                                            </div>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.tenant_detail.tax_id')}
                                            </dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 select-text">
                                                {selectedTenant.taxId || selectedTenant.rut || missingValue}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.tenant_detail.owner_email')}
                                            </dt>
                                            <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 select-text">
                                                {selectedTenant.ownerEmail || selectedTenant.email || missingValue}
                                            </dd>
                                        </div>

                                        {activeTab === 'EDU' && (
                                            <>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.tenant_detail.accredited_institution')}
                                                    </dt>
                                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">
                                                        {selectedTenant.eduInstitutionName || selectedTenant.institution || missingValue}
                                                        {selectedTenant.academicDomain ? ` (${selectedTenant.academicDomain})` : ''}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.tenant_detail.gatekeeper_edu')}
                                                    </dt>
                                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6] mt-0.5 flex items-center justify-between gap-fib-8">
                                                        <span>{selectedTenant.gatekeeperStatus || missingValue}</span>
                                                        <button
                                                            type="button"
                                                            disabled={gatekeeperLoading}
                                                            onClick={handleRunEduGatekeeper}
                                                            className="px-fib-13 py-1 bg-transparent border border-[#00AEEF] text-[#00AEEF] hover:bg-[#00AEEF]/10 text-microcopy font-mono uppercase rounded-none cursor-pointer disabled:opacity-40"
                                                        >
                                                            {gatekeeperLoading
                                                                ? t('core_superadmin.tenant_detail.validating')
                                                                : t('core_superadmin.tenant_detail.gatekeeper_btn')}
                                                        </button>
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.tenant_detail.document_backup')}
                                                    </dt>
                                                    <dd className="mt-0.5">
                                                        {selectedTenant.documentUrl ? (
                                                            <a
                                                                href={selectedTenant.documentUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-[#00AEEF] underline"
                                                            >
                                                                {t('core_superadmin.tenant_detail.open_certificate')}
                                                            </a>
                                                        ) : (
                                                            <span className="text-[#94A3B8] dark:text-[#5A6072]">
                                                                {missingValue}
                                                            </span>
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.tenant_detail.isolation_regime')}
                                                    </dt>
                                                    <dd className="text-[#C68346] mt-0.5">
                                                        {t('core_superadmin.tenant_detail.sandbox_regime_value', {
                                                            count: selectedTenant.entitlements?.maxProjects ?? 3,
                                                        })}
                                                    </dd>
                                                </div>
                                            </>
                                        )}
                                    </dl>

                                    {/* Acciones de Estado HITL */}
                                    <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap gap-fib-8">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    targetUid,
                                                    currentStatus: selectedTenant.status || 'PENDING',
                                                    nextStatus: 'ACTIVE',
                                                });
                                                setHitlKeyword('');
                                                setHitlRejectionReason('');
                                            }}
                                            className="px-fib-13 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase rounded-none border-0 cursor-pointer"
                                        >
                                            {t('core_superadmin.tenant_detail.activate_btn')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    targetUid,
                                                    currentStatus: selectedTenant.status || 'ACTIVE',
                                                    nextStatus: 'SUSPENDED',
                                                });
                                                setHitlKeyword('');
                                                setHitlRejectionReason('');
                                            }}
                                            className="px-fib-13 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-red-500 text-[#0F172A] dark:text-[#F3F4F6] text-xs font-mono uppercase rounded-none cursor-pointer"
                                        >
                                            {t('core_superadmin.tenant_detail.suspend_btn')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const targetUid = selectedTenant.uid || selectedTenant.id;
                                                setHitlAction({
                                                    kind: 'TENANT_STATUS',
                                                    targetUid,
                                                    currentStatus: selectedTenant.status || 'PENDING',
                                                    nextStatus: 'REJECTED',
                                                });
                                                setHitlKeyword('');
                                                setHitlRejectionReason('');
                                            }}
                                            className="px-fib-13 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-red-500 text-red-600 dark:text-red-400 text-xs font-mono uppercase rounded-none cursor-pointer"
                                        >
                                            {t('core_superadmin.tenant_detail.reject_btn')}
                                        </button>
                                    </div>

                                    {/* Bloque Paquete Base y Modulos Adicionales (Modo Informe + Edicion Quirurgica por Lapiz) */}
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-13">
                                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                            <span className="text-microcopy uppercase text-[#C68346] font-bold">
                                                {t('core_superadmin.entitlements.section_title')}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (editingEntitlements) {
                                                        syncEntitlementFormFromTenant(selectedTenant);
                                                    } else {
                                                        setEditingEntitlements(true);
                                                        setEntKeyword('');
                                                    }
                                                }}
                                                title={
                                                    editingEntitlements
                                                        ? t('core_superadmin.entitlements.cancel_edit')
                                                        : t('core_superadmin.entitlements.start_edit')
                                                }
                                                aria-label={
                                                    editingEntitlements
                                                        ? t('core_superadmin.entitlements.cancel_edit')
                                                        : t('core_superadmin.entitlements.start_edit')
                                                }
                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">
                                                    {editingEntitlements ? 'close' : 'edit'}
                                                </span>
                                            </button>
                                        </div>

                                        {!editingEntitlements ? (
                                            <dl className="space-y-fib-8 text-xs">
                                                <div className="flex items-center justify-between">
                                                    <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.base_package')}
                                                    </dt>
                                                    <dd className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {selectedTenant.entitlements?.basePackage || (activeTab === 'EDU' ? 'ACADEMIC_SANDBOX' : 'CORE_BASE')}
                                                    </dd>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.addon_opermaq')}
                                                    </dt>
                                                    <dd className={selectedTenant.entitlements?.addonModules?.opermaq?.active ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                                        {selectedTenant.entitlements?.addonModules?.opermaq?.active
                                                            ? t('core_superadmin.status.ENABLED')
                                                            : t('core_superadmin.status.DISABLED')}
                                                    </dd>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.addon_stockpile')}
                                                    </dt>
                                                    <dd className={selectedTenant.entitlements?.addonModules?.stockpile?.active ? 'text-[#00AEEF]' : 'text-[#94A3B8] dark:text-[#5A6072]'}>
                                                        {selectedTenant.entitlements?.addonModules?.stockpile?.active
                                                            ? t('core_superadmin.status.ENABLED')
                                                            : t('core_superadmin.status.DISABLED')}
                                                    </dd>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.max_projects')}
                                                    </dt>
                                                    <dd className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {selectedTenant.entitlements?.maxProjects ??
                                                            (activeTab === 'EDU'
                                                                ? 3
                                                                : t('core_superadmin.entitlements.unlimited'))}
                                                    </dd>
                                                </div>
                                                {activeTab === 'EDU' && (
                                                    <div className="flex items-center justify-between gap-2">
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_superadmin.entitlements.linked_institution')}
                                                        </dt>
                                                        <dd className="text-right text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                            {selectedTenant.eduInstitutionName || selectedTenant.eduInstitutionId || missingValue}
                                                        </dd>
                                                    </div>
                                                )}
                                            </dl>
                                        ) : (
                                            <form onSubmit={handleSaveAccountEntitlements} autoComplete="off" spellCheck={false} className="space-y-fib-13">
                                                <div>
                                                    <label
                                                        htmlFor="ent-base-package"
                                                        className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                                    >
                                                        {t('core_superadmin.entitlements.base_package')}
                                                    </label>
                                                    <select
                                                        id="ent-base-package"
                                                        value={entBasePackage}
                                                        onChange={(e) => setEntBasePackage(e.target.value as BasePackageTier)}
                                                        className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                    >
                                                        <option value="CORE_BASE">{t('core_superadmin.packages.CORE_BASE')}</option>
                                                        <option value="OPERMAQ_BASE">{t('core_superadmin.packages.OPERMAQ_BASE')}</option>
                                                        <option value="FULL_SUITE">{t('core_superadmin.packages.FULL_SUITE')}</option>
                                                        <option value="ACADEMIC_SANDBOX">{t('core_superadmin.packages.ACADEMIC_SANDBOX')}</option>
                                                    </select>
                                                </div>

                                                <div className="flex items-center justify-between py-1">
                                                    <span className="text-xs text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.addon_opermaq')}
                                                    </span>
                                                    <M3Switch
                                                        checked={entAddonOpermaq}
                                                        onChange={setEntAddonOpermaq}
                                                        aria-label={t('core_superadmin.entitlements.addon_opermaq')}
                                                    />
                                                </div>

                                                <div className="flex items-center justify-between py-1">
                                                    <span className="text-xs text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_superadmin.entitlements.addon_stockpile_full')}
                                                    </span>
                                                    <M3Switch
                                                        checked={entAddonStockpile}
                                                        onChange={setEntAddonStockpile}
                                                        aria-label={t('core_superadmin.entitlements.addon_stockpile_full')}
                                                    />
                                                </div>

                                                <div>
                                                    <label
                                                        htmlFor="ent-max-projects"
                                                        className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                                    >
                                                        {activeTab === 'EDU'
                                                            ? t('core_superadmin.entitlements.max_projects_quota_edu')
                                                            : t('core_superadmin.entitlements.max_projects_quota_b2b')}
                                                    </label>
                                                    <input
                                                        id="ent-max-projects"
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        value={entMaxProjects}
                                                        onChange={(e) => setEntMaxProjects(e.target.value)}
                                                        placeholder={
                                                            activeTab === 'EDU'
                                                                ? '3'
                                                                : t('core_superadmin.entitlements.unlimited_placeholder')
                                                        }
                                                        className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                    />
                                                </div>

                                                {activeTab === 'EDU' && (
                                                    <div>
                                                        <label
                                                            htmlFor="ent-edu-institution"
                                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                                        >
                                                            {t('core_superadmin.entitlements.link_edu_institution')}
                                                        </label>
                                                        <select
                                                            id="ent-edu-institution"
                                                            value={entEduInstitutionId}
                                                            onChange={(e) => setEntEduInstitutionId(e.target.value)}
                                                            className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                        >
                                                            <option value="">
                                                                {t('core_superadmin.entitlements.no_institution_option')}
                                                            </option>
                                                            {eduInstitutions.map((inst) => (
                                                                <option key={inst.id} value={inst.id}>
                                                                    {inst.countryCode} · {inst.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                <div>
                                                    <label
                                                        htmlFor="ent-hitl-keyword"
                                                        className="block text-microcopy uppercase text-[#C68346] mb-1"
                                                    >
                                                        {t('core_superadmin.entitlements.hitl_label')}
                                                    </label>
                                                    <input
                                                        id="ent-hitl-keyword"
                                                        type="text"
                                                        required
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        value={entKeyword}
                                                        onChange={(e) => setEntKeyword(e.target.value.toUpperCase())}
                                                        placeholder="ACTUALIZAR"
                                                        className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                                    />
                                                </div>

                                                <button
                                                    type="submit"
                                                    disabled={entKeyword.trim() !== 'ACTUALIZAR' || entSubmitting}
                                                    className="w-full py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {entSubmitting
                                                        ? t('core_superadmin.entitlements.saving_btn')
                                                        : t('core_superadmin.entitlements.save_btn')}
                                                </button>
                                            </form>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'INSTITUCIONES' && (
                        <>
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13 flex items-start justify-between gap-fib-13">
                                <div>
                                    <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                        {instMode === 'CREATE'
                                            ? t('core_superadmin.institutions.eyebrow_create')
                                            : instMode === 'EDIT'
                                                ? t('core_superadmin.institutions.eyebrow_edit')
                                                : t('core_superadmin.institutions.eyebrow_view')}
                                    </span>
                                    <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                        {instMode === 'CREATE'
                                            ? t('core_superadmin.institutions.title_create')
                                            : selectedInstitution
                                                ? selectedInstitution.name
                                                : t('core_superadmin.institutions.select_title')}
                                    </h2>
                                </div>
                                {instMode === 'VIEW' && selectedInstitution && (
                                    <button
                                        type="button"
                                        onClick={() => startEditInstitution(selectedInstitution)}
                                        title={t('core_superadmin.institutions.edit_aria')}
                                        aria-label={t('core_superadmin.institutions.edit_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">edit</span>
                                    </button>
                                )}
                                {instMode !== 'VIEW' && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setInstMode('VIEW');
                                            setInstKeyword('');
                                        }}
                                        title={t('core_superadmin.institutions.cancel_aria')}
                                        aria-label={t('core_superadmin.institutions.cancel_aria')}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                )}
                            </div>

                            {instMode === 'VIEW' && !selectedInstitution && (
                                <p className="text-xs text-[#94A3B8] dark:text-[#5A6072] font-mono">
                                    {t('core_superadmin.institutions.empty_prompt')}
                                </p>
                            )}

                            {instMode === 'VIEW' && selectedInstitution && (
                                <div className="space-y-fib-21 text-xs font-mono tabular-nums">
                                    {selectedInstitution.eduInstitutionLogo?.downloadUrl && (
                                        <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                            <img
                                                src={resolveMediaSrc(selectedInstitution.eduInstitutionLogo.downloadUrl) || ''}
                                                alt={selectedInstitution.name}
                                                draggable={false}
                                                onContextMenu={(e) => e.preventDefault()}
                                                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                className="h-14 max-w-full object-contain select-none pointer-events-none"
                                            />
                                            <p className="text-microcopy text-[#00AEEF]">
                                                ORIG {formatBytesCas(selectedInstitution.eduInstitutionLogo.originalBytes)} ➔ CAS{' '}
                                                {formatBytesCas(selectedInstitution.eduInstitutionLogo.optimizedBytes)} (-
                                                {selectedInstitution.eduInstitutionLogo.savingsPct}%)
                                            </p>
                                            <div className="flex items-center gap-1 text-microcopy text-[#475569] dark:text-[#8A93A6] select-text">
                                                <span className="truncate">SHA-256: {selectedInstitution.eduInstitutionLogo.sha256}</span>
                                                <CopyButton
                                                    value={selectedInstitution.eduInstitutionLogo.sha256}
                                                    title={t('core_superadmin.institutions.copy_sha256')}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <dl className="space-y-fib-13">
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.institutions.id_label')}
                                            </dt>
                                            <dd className="flex items-center gap-1 select-text mt-0.5">
                                                <span>{selectedInstitution.id}</span>
                                                <CopyButton
                                                    value={selectedInstitution.id}
                                                    title={t('core_superadmin.common.copy_id')}
                                                />
                                            </dd>
                                        </div>
                                        <div className="grid grid-cols-2 gap-fib-13">
                                            <div>
                                                <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_superadmin.institutions.country_iso')}
                                                </dt>
                                                <dd className="mt-0.5 font-bold">{selectedInstitution.countryCode}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_superadmin.institutions.status_label')}
                                                </dt>
                                                <dd
                                                    className={`mt-0.5 uppercase ${
                                                        selectedInstitution.status === 'ACTIVE'
                                                            ? 'text-[#00AEEF]'
                                                            : 'text-red-600 dark:text-red-400'
                                                    }`}
                                                >
                                                    {translateStatus(selectedInstitution.status)}
                                                </dd>
                                            </div>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.institutions.authorized_domains')}
                                            </dt>
                                            <dd className="mt-0.5 select-text">
                                                {selectedInstitution.domains.length > 0
                                                    ? selectedInstitution.domains.join(', ')
                                                    : missingValue}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.institutions.sandbox_quota')}
                                            </dt>
                                            <dd className="mt-0.5 text-[#C68346]">
                                                {t('core_superadmin.institutions.projects_count', {
                                                    count: selectedInstitution.defaultMaxProjects,
                                                })}
                                            </dd>
                                        </div>
                                    </dl>
                                </div>
                            )}

                            {(instMode === 'CREATE' || instMode === 'EDIT') && (
                                <form onSubmit={handleSaveInstitution} autoComplete="off" spellCheck={false} className="space-y-fib-13 text-xs font-mono">
                                    <div>
                                        <label
                                            htmlFor="inst-name"
                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                        >
                                            {t('core_superadmin.institutions.name_label')}
                                        </label>
                                        <input
                                            id="inst-name"
                                            type="text"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={instName}
                                            onChange={(e) => setInstName(e.target.value)}
                                            placeholder={t('core_superadmin.institutions.name_placeholder')}
                                            className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-fib-13">
                                        <div>
                                            <label
                                                htmlFor="inst-country"
                                                className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                            >
                                                {t('core_superadmin.institutions.country_label')}
                                            </label>
                                            <input
                                                id="inst-country"
                                                type="text"
                                                required
                                                maxLength={2}
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={instCountry}
                                                onChange={(e) => setInstCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))}
                                                className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label
                                                htmlFor="inst-max-projects"
                                                className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                            >
                                                {t('core_superadmin.institutions.max_projects_label')}
                                            </label>
                                            <input
                                                id="inst-max-projects"
                                                type="number"
                                                min={1}
                                                max={50}
                                                required
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={instMaxProjects}
                                                onChange={(e) => setInstMaxProjects(Number(e.target.value))}
                                                className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] tabular-nums text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label
                                            htmlFor="inst-domains"
                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                        >
                                            {t('core_superadmin.institutions.domains_label')}
                                        </label>
                                        <input
                                            id="inst-domains"
                                            type="text"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={instDomainsRaw}
                                            onChange={(e) => setInstDomainsRaw(e.target.value)}
                                            placeholder={t('core_superadmin.institutions.domains_placeholder')}
                                            className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label
                                            htmlFor="inst-status"
                                            className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                        >
                                            {t('core_superadmin.institutions.accreditation_status_label')}
                                        </label>
                                        <select
                                            id="inst-status"
                                            value={instStatus}
                                            onChange={(e) => setInstStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                                            className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                        >
                                            <option value="ACTIVE">{t('core_superadmin.status.ACTIVE')}</option>
                                            <option value="SUSPENDED">{t('core_superadmin.status.SUSPENDED')}</option>
                                        </select>
                                    </div>

                                    {/* Logo Oficial CAS (MediaDigestorClient) */}
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                                        <div className="flex items-center justify-between">
                                            <label
                                                htmlFor="inst-logo-upload"
                                                className="text-microcopy uppercase text-[#00AEEF]"
                                            >
                                                {t('core_superadmin.institutions.logo_cas_title')}
                                            </label>
                                            {instLogo && (
                                                <button
                                                    type="button"
                                                    onClick={() => setInstLogo(null)}
                                                    title={t('core_superadmin.institutions.remove_logo_aria')}
                                                    aria-label={t('core_superadmin.institutions.remove_logo_aria')}
                                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                </button>
                                            )}
                                        </div>

                                        <input
                                            id="inst-logo-upload"
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                            autoComplete="off"
                                            spellCheck={false}
                                            aria-label={t('core_superadmin.institutions.logo_upload_aria')}
                                            onChange={handleUploadInstitutionLogo}
                                            disabled={instLogoUploading}
                                            className="w-full text-microcopy text-[#475569] dark:text-[#8A93A6] file:mr-3 file:py-1.5 file:px-3 file:border file:border-[#E2E8F0] dark:file:border-[#12151C] file:bg-[#F8FAFC] dark:file:bg-[#07090D] file:text-[#0F172A] dark:file:text-[#F3F4F6] file:font-mono file:text-microcopy file:uppercase file:rounded-none cursor-pointer"
                                        />

                                        {instLogoUploading && (
                                            <p className="text-microcopy text-[#C68346]">
                                                {t('core_superadmin.institutions.logo_uploading')}
                                            </p>
                                        )}

                                        {instLogo && (
                                            <div className="pt-fib-8 space-y-1">
                                                <img
                                                    src={resolveMediaSrc(instLogo.downloadUrl) || ''}
                                                    alt={instName || t('core_superadmin.institutions.logo_alt')}
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                                                    className="h-12 max-w-full object-contain select-none pointer-events-none border border-[#E2E8F0] dark:border-[#12151C] p-1 bg-white dark:bg-[#07090D]"
                                                />
                                                <p className="text-microcopy tabular-nums text-[#00AEEF]">
                                                    ORIG: {formatBytesCas(instLogo.originalBytes)} ➔ CAS: {formatBytesCas(instLogo.optimizedBytes)} (-{instLogo.savingsPct}%)
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label
                                            htmlFor="inst-hitl-keyword"
                                            className="block text-microcopy uppercase text-[#C68346] mb-1"
                                        >
                                            {t('core_superadmin.institutions.hitl_label')}
                                        </label>
                                        <input
                                            id="inst-hitl-keyword"
                                            type="text"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={instKeyword}
                                            onChange={(e) => setInstKeyword(e.target.value.toUpperCase())}
                                            placeholder="ACTUALIZAR"
                                            className="w-full px-fib-13 py-2 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={instKeyword.trim() !== 'ACTUALIZAR' || instSubmitting || instLogoUploading}
                                        className="w-full py-2.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {instSubmitting
                                            ? t('core_superadmin.common.consolidating')
                                            : instMode === 'EDIT'
                                                ? t('core_superadmin.institutions.update_btn')
                                                : t('core_superadmin.institutions.create_btn')}
                                    </button>
                                </form>
                            )}
                        </>
                    )}

                    {activeTab === 'METRICAS' && (
                        <div className="space-y-fib-21 font-mono text-xs tabular-nums">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy uppercase text-[#00AEEF]">
                                    {t('core_superadmin.metrics.detail_eyebrow', { segment: metricsSegment })}
                                </span>
                                <h2 className="text-h2-section font-sans uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                    {selectedMetricItem
                                        ? (selectedMetricItem.accountName ||
                                            tenantLookupMap.get(selectedMetricItem.accountId)?.companyName ||
                                            selectedMetricItem.accountId)
                                        : t('core_superadmin.metrics.detail_select_title')}
                                </h2>
                            </div>

                            {!selectedMetricItem ? (
                                <p className="text-[#94A3B8] dark:text-[#5A6072]">
                                    {t('core_superadmin.metrics.detail_empty_prompt')}
                                </p>
                            ) : (
                                <dl className="space-y-fib-13">
                                    <div>
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.metrics.detail_account_id')}
                                        </dt>
                                        <dd className="flex items-center gap-1 select-text mt-0.5">
                                            <span>{selectedMetricItem.accountId}</span>
                                            <CopyButton
                                                value={selectedMetricItem.accountId}
                                                title={t('core_superadmin.common.copy_id')}
                                            />
                                        </dd>
                                    </div>
                                    <div className="grid grid-cols-2 gap-fib-13">
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.metrics.detail_segment')}
                                            </dt>
                                            <dd className="mt-0.5 text-[#C68346] font-bold">{selectedMetricItem.segment}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_superadmin.metrics.detail_period')}
                                            </dt>
                                            <dd className="mt-0.5">{selectedMetricItem.period}</dd>
                                        </div>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-1">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.metrics.detail_tokens_title')}
                                        </dt>
                                        <dd className="flex justify-between">
                                            <span>{t('core_superadmin.metrics.detail_tokens_in')}</span>
                                            <span>{selectedMetricItem.aiTokensInput.toLocaleString(i18n.language || undefined)}</span>
                                        </dd>
                                        <dd className="flex justify-between">
                                            <span>{t('core_superadmin.metrics.detail_tokens_out')}</span>
                                            <span>{selectedMetricItem.aiTokensOutput.toLocaleString(i18n.language || undefined)}</span>
                                        </dd>
                                        <dd className="flex justify-between text-[#00AEEF]">
                                            <span>{t('core_superadmin.metrics.detail_cache_hits')}</span>
                                            <span>{selectedMetricItem.aiCacheHits}</span>
                                        </dd>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-1">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.metrics.detail_cas_title')}
                                        </dt>
                                        <dd className="flex justify-between">
                                            <span>{t('core_superadmin.metrics.detail_cas_orig')}</span>
                                            <span>{formatBytesCas(selectedMetricItem.casOriginalBytes)}</span>
                                        </dd>
                                        <dd className="flex justify-between">
                                            <span>{t('core_superadmin.metrics.detail_cas_opt')}</span>
                                            <span>{formatBytesCas(selectedMetricItem.casOptimizedBytes)}</span>
                                        </dd>
                                        <dd className="flex justify-between text-[#00AEEF]">
                                            <span>{t('core_superadmin.metrics.detail_cas_assets')}</span>
                                            <span>
                                                {selectedMetricItem.casAssetsCount} (-{calcSavingsPct(selectedMetricItem.casOriginalBytes, selectedMetricItem.casOptimizedBytes)}%)
                                            </span>
                                        </dd>
                                    </div>
                                </dl>
                            )}
                        </div>
                    )}

                    {activeTab === 'MODULES' && (
                        <div className="space-y-fib-13 text-xs font-mono">
                            <span className="text-microcopy uppercase text-[#00AEEF]">
                                {t('core_superadmin.modules.policy_eyebrow')}
                            </span>
                            <h2 className="text-h2-section font-sans uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('core_superadmin.modules.policy_title')}
                            </h2>
                            <p className="text-[#475569] dark:text-[#8A93A6] font-sans leading-relaxed">
                                {t('core_superadmin.modules.policy_body')}
                            </p>
                            {pendingModuleToggle && (
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] space-y-1">
                                    <span className="text-microcopy uppercase text-[#C68346]">
                                        {t('core_superadmin.modules.pending_title')}
                                    </span>
                                    <p className="text-[#0F172A] dark:text-[#F3F4F6]">
                                        {pendingModuleToggle.moduleId.toUpperCase()}:{' '}
                                        {pendingModuleToggle.current
                                            ? t('core_superadmin.status.ENABLED')
                                            : t('core_superadmin.status.SUSPENDED')}{' '}
                                        <span className="material-symbols-outlined text-[14px] align-middle">arrow_forward</span>{' '}
                                        {pendingModuleToggle.next
                                            ? t('core_superadmin.status.ENABLED')
                                            : t('core_superadmin.status.SUSPENDED')}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'LEDGER' && (
                        <div className="space-y-fib-21">
                            <div className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                                <span className="text-microcopy font-mono uppercase text-[#00AEEF]">
                                    {t('core_superadmin.ledger.telemetry_eyebrow')}
                                </span>
                                <h2 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                    {t('core_superadmin.ledger.telemetry_title')}
                                </h2>
                            </div>

                            {!telemetryData ? (
                                <p className="text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    {missingValue}
                                </p>
                            ) : (
                                <dl className="grid grid-cols-1 gap-fib-13 font-mono text-xs tabular-nums">
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.ledger.telemetry_total_calls')}
                                        </dt>
                                        <dd className="text-kpi-display text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                                            {telemetryData.telemetrySummary?.totalCalls ?? telemetryData.totalRequests ?? 0}
                                        </dd>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.ledger.telemetry_cache_x402')}
                                        </dt>
                                        <dd className="text-h1-header text-[#00AEEF] mt-1">
                                            {t('core_superadmin.ledger.telemetry_cache_x402_val', {
                                                hits: telemetryData.telemetrySummary?.cacheHits ?? 0,
                                                receipts: telemetryData.protocolX402?.settledReceiptsCount ?? 0,
                                            })}
                                        </dd>
                                    </div>
                                    <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-1">
                                        <dt className="text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                            {t('core_superadmin.ledger.telemetry_swarm_state')}
                                        </dt>
                                        {telemetryData.swarmStatus ? (
                                            <dd className="space-y-1 pt-1 text-xs text-[#0F172A] dark:text-[#F3F4F6]">
                                                {(['pro', 'flash', 'flashLite'] as const).map((tierKey) => {
                                                    const item = telemetryData.swarmStatus?.[tierKey];
                                                    if (!item) return null;
                                                    return (
                                                        <div key={tierKey} className="flex items-center justify-between gap-2">
                                                            <span className="truncate">{item.model}</span>
                                                            <span className="text-[#475569] dark:text-[#8A93A6]">
                                                                {item.calls ?? 0} {t('core_superadmin.ledger.telemetry_req_unit')} ·{' '}
                                                                {item.avgLatencyMs !== null && item.avgLatencyMs !== undefined
                                                                    ? `${item.avgLatencyMs} ms`
                                                                    : t('core_superadmin.ledger.telemetry_na')}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </dd>
                                        ) : (
                                            <dd className="text-xs text-[#94A3B8] dark:text-[#5A6072]">
                                                {missingValue}
                                            </dd>
                                        )}
                                    </div>
                                </dl>
                            )}
                        </div>
                    )}

                    {/* Bloque Confirmacion Obligatoria HITL ("ACTUALIZAR") */}
                    {hitlAction && (
                        <div className="mt-auto p-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border border-[#C68346] space-y-fib-13">
                            <div className="flex items-center justify-between">
                                <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                    {t('core_superadmin.hitl.panel_title')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHitlAction(null);
                                        setPendingModuleToggle(null);
                                        setHitlKeyword('');
                                        setHitlRejectionReason('');
                                    }}
                                    title={t('core_superadmin.common.close')}
                                    aria-label={t('core_superadmin.common.close')}
                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>
                            <p className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {hitlAction.kind === 'TENANT_STATUS'
                                    ? hitlAction.nextStatus === 'ACTIVE'
                                        ? t('core_superadmin.hitl.activate_title')
                                        : hitlAction.nextStatus === 'SUSPENDED'
                                            ? t('core_superadmin.hitl.suspend_title')
                                            : t('core_superadmin.hitl.reject_title')
                                    : t('core_superadmin.hitl.module_title', {
                                          module: hitlAction.moduleName || hitlAction.moduleId?.toUpperCase() || '',
                                      })}
                            </p>
                            <p className="text-xs font-mono text-[#475569] dark:text-[#8A93A6]">
                                {hitlAction.kind === 'TENANT_STATUS'
                                    ? t('core_superadmin.hitl.status_diff', {
                                          current: translateStatus(hitlAction.currentStatus),
                                          next: translateStatus(hitlAction.nextStatus),
                                          uid: hitlAction.targetUid || '',
                                      })
                                    : t('core_superadmin.hitl.module_diff', {
                                          current: hitlAction.currentEnabled
                                              ? t('core_superadmin.status.ENABLED')
                                              : t('core_superadmin.status.SUSPENDED'),
                                          next: hitlAction.nextEnabled
                                              ? t('core_superadmin.status.ENABLED')
                                              : t('core_superadmin.status.SUSPENDED'),
                                      })}
                            </p>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    executeHitlAction();
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className="space-y-fib-13"
                            >
                                {hitlAction.kind === 'TENANT_STATUS' && hitlAction.nextStatus === 'REJECTED' && (
                                    <div>
                                        <label
                                            htmlFor="hitl-rejection-reason"
                                            className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1"
                                        >
                                            {t('core_superadmin.hitl.rejection_label')}
                                        </label>
                                        <input
                                            id="hitl-rejection-reason"
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={hitlRejectionReason}
                                            onChange={(e) => setHitlRejectionReason(e.target.value)}
                                            placeholder={t('core_superadmin.hitl.rejection_placeholder')}
                                            className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                        />
                                    </div>
                                )}

                                <label
                                    htmlFor="hitl-keyword"
                                    className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('core_superadmin.hitl.keyword_label')}
                                </label>
                                <input
                                    id="hitl-keyword"
                                    type="text"
                                    required
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={hitlKeyword}
                                    onChange={(e) => setHitlKeyword(e.target.value.toUpperCase())}
                                    placeholder="ACTUALIZAR"
                                    className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] outline-none rounded-none"
                                />
                                <button
                                    type="submit"
                                    disabled={hitlKeyword.trim() !== 'ACTUALIZAR' || hitlSubmitting}
                                    className="w-full py-2.5 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {hitlSubmitting
                                        ? t('core_superadmin.common.consolidating')
                                        : t('core_superadmin.hitl.confirm_btn')}
                                </button>
                            </form>
                        </div>
                    )}
                </aside>
            </main>
        </div>
    );
};

export default SuperAdminConsole;
