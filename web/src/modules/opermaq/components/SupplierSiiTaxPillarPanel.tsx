import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    EMPTY_SUPPLIER_SII_TAX_PROFILE,
    MANUFACTURER_HITL_CONFIRM_KEYWORD,
    SII_DTE_DOCUMENT_TYPES,
    type SiiDteDocumentType,
    type SupplierEntity,
    type TenantSupplierBillingRule,
} from '../../../contracts/manufacturers.contracts';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { CopyButton } from '../../../components/common/CopyButton';
import { authFetch } from '../utils/authFetch';
import {
    BTN_COPPER_CLS,
    BTN_OUTLINE_CLS,
    deriveGiroRecep40Preview,
    FLAT_ICON_BTN_CLS,
    formatSiiProfileClipboardText,
    INPUT_BOX_CLS,
    MICRO_LABEL_CLS,
    MONO_INPUT_BOX_CLS,
} from '../utils/supplierUiHelpers';
import { M3LinearProgress } from './M3ProgressIndicator';
import { M3Switch } from './M3Switch';

export interface SupplierSiiTaxPillarPanelProps {
    supplier: SupplierEntity;
    isDevMaster: boolean;
    isEduSandbox: boolean;
    tenantId?: string | null;
    onSupplierUpdated: (updated: SupplierEntity) => void;
}

const DTE_LABELS: Record<SiiDteDocumentType, string> = {
    33: '33 · Factura Electrónica',
    34: '34 · Factura Exenta',
    46: '46 · Factura Compra',
    52: '52 · Guía Despacho',
    56: '56 · Nota Débito',
    61: '61 · Nota Crédito',
    110: '110 · Factura Exportación',
};

export const SupplierSiiTaxPillarPanel: React.FC<SupplierSiiTaxPillarPanelProps> = ({
    supplier,
    isDevMaster,
    isEduSandbox,
    tenantId,
    onSupplierUpdated,
}) => {
    const { t } = useTranslation();
    const undeclaredLabel = t('suppliers_v2.undeclared_technical_data', '[Información técnica no declarada en ficha]');

    const profile = supplier.siiTaxProfile || EMPTY_SUPPLIER_SII_TAX_PROFILE;
    const isIntlDefault = profile.taxRegimeScope === 'INTERNATIONAL' || supplier.countryIso2 !== 'CL';
    const readiness = supplier.taxReadiness || {
        scope: isIntlDefault ? ('INTERNATIONAL' as const) : ('SII_CL' as const),
        score: 0,
        total: isIntlDefault ? 4 : 6,
        isReady: false,
        checks: [],
    };
    const readinessPct = Math.round((readiness.score / Math.max(1, readiness.total)) * 100);

    // Edición quirúrgica Perfil Tributario SII (1º DEV)
    const [editingTax, setEditingTax] = useState(false);
    const [taxRegimeScope, setTaxRegimeScope] = useState<'SII_CL' | 'INTERNATIONAL'>(
        isIntlDefault ? 'INTERNATIONAL' : 'SII_CL'
    );
    const [siiRutInput, setSiiRutInput] = useState('');
    const [siiRznSoc, setSiiRznSoc] = useState('');
    const [siiGiroEmis, setSiiGiroEmis] = useState('');
    const [siiGiroRecep, setSiiGiroRecep] = useState('');
    const [giroRecepTouched, setGiroRecepTouched] = useState(false);
    const [actecoInput, setActecoInput] = useState('');
    const [taxAddressDir, setTaxAddressDir] = useState('');
    const [taxComuna, setTaxComuna] = useState('');
    const [taxCiudad, setTaxCiudad] = useState('');
    const [cdgSiiSucur, setCdgSiiSucur] = useState('');
    const [dteInterchangeEmail, setDteInterchangeEmail] = useState('');
    const [apBillingEmail, setApBillingEmail] = useState('');
    const [foreignTaxId, setForeignTaxId] = useState('');
    const [supportedDtes, setSupportedDtes] = useState<SiiDteDocumentType[]>([33, 52, 56, 61]);
    const [isDteCertified, setIsDteCertified] = useState(false);
    const [taxConfirmWord, setTaxConfirmWord] = useState('');
    const [taxBusy, setTaxBusy] = useState(false);
    const [taxBanner, setTaxBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
    const [copiedAllTax, setCopiedAllTax] = useState(false);

    // Reglas Contractuales Privadas B2B (4º B2B aislado)
    const [billingRule, setBillingRule] = useState<TenantSupplierBillingRule | null>(null);
    const [loadingRule, setLoadingRule] = useState(false);
    const [editingRule, setEditingRule] = useState(false);
    const [reqOc801, setReqOc801] = useState(true);
    const [reqContract803, setReqContract803] = useState(false);
    const [reqGuide52, setReqGuide52] = useState(false);
    const [reqTokenType, setReqTokenType] = useState<'NONE' | 'HES' | 'HEM' | 'HAS'>('HES');
    const [fmaPago, setFmaPago] = useState<1 | 2 | 3>(2);
    const [paymentTermDays, setPaymentTermDays] = useState<number>(30);
    const [hasExceptionalAgreement, setHasExceptionalAgreement] = useState(false);
    const [exceptionalNote, setExceptionalNote] = useState('');
    const [claimWindowDays, setClaimWindowDays] = useState<number>(8);
    const [rcvAlertEmail, setRcvAlertEmail] = useState('');
    const [allowFactoring, setAllowFactoring] = useState(true);
    const [billingPortalUrl, setBillingPortalUrl] = useState('');
    const [remittanceEmail, setRemittanceEmail] = useState('');
    const [defaultCentroCosto, setDefaultCentroCosto] = useState('');
    const [ruleNotes, setRuleNotes] = useState('');
    const [ruleConfirmWord, setRuleConfirmWord] = useState('');
    const [ruleBusy, setRuleBusy] = useState(false);
    const [ruleBanner, setRuleBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

    const hydrateTaxForm = useCallback(() => {
        const p = supplier.siiTaxProfile || EMPTY_SUPPLIER_SII_TAX_PROFILE;
        const intl = p.taxRegimeScope === 'INTERNATIONAL' || supplier.countryIso2 !== 'CL';
        setTaxRegimeScope(intl ? 'INTERNATIONAL' : 'SII_CL');
        setSiiRutInput(p.siiRutDisplay || p.siiRutNormalized || supplier.supplierTaxId || '');
        setSiiRznSoc(p.siiRznSoc || supplier.legalName || '');
        setSiiGiroEmis(p.siiGiroEmis || '');
        setSiiGiroRecep(p.siiGiroRecep || deriveGiroRecep40Preview(p.siiGiroEmis));
        setGiroRecepTouched(Boolean(p.siiGiroRecep));
        setActecoInput((p.actecoCodes || []).join(', '));
        setTaxAddressDir(p.taxAddressDir || '');
        setTaxComuna(p.taxComuna || '');
        setTaxCiudad(p.taxCiudad || '');
        setCdgSiiSucur(p.cdgSiiSucur || '');
        setDteInterchangeEmail(p.dteInterchangeEmail || '');
        setApBillingEmail(p.apBillingEmail || '');
        setForeignTaxId(p.foreignTaxId || (intl ? supplier.supplierTaxId || '' : ''));
        setSupportedDtes(p.supportedDteTypes?.length ? p.supportedDteTypes : [33, 52, 56, 61]);
        setIsDteCertified(Boolean(p.isDteCertified));
        setTaxConfirmWord('');
    }, [supplier]);

    useEffect(() => {
        hydrateTaxForm();
        setEditingTax(false);
        setTaxBanner(null);
    }, [supplier.supplierKey, hydrateTaxForm]);

    const loadBillingRule = useCallback(async () => {
        if (isEduSandbox || !tenantId) {
            setBillingRule(null);
            return;
        }
        setLoadingRule(true);
        try {
            const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/billing-rule`);
            const data = await res.json();
            const rule: TenantSupplierBillingRule | null = data?.billingRule || null;
            setBillingRule(rule);
            setReqOc801(rule ? rule.requiresPurchaseOrder801 : true);
            setReqContract803(rule ? rule.requiresContract803 : false);
            setReqGuide52(rule ? rule.requiresDispatchGuide52 : false);
            setReqTokenType(rule ? rule.requiresReceptionTokenType : 'HES');
            setFmaPago(rule ? rule.defaultFormaPagoDte : 2);
            setPaymentTermDays(rule ? rule.paymentTermDays : 30);
            setHasExceptionalAgreement(rule ? rule.hasExceptionalPaymentAgreement : false);
            setExceptionalNote(rule?.exceptionalAgreementNote || '');
            setClaimWindowDays(rule ? rule.dteClaimWindowDays : 8);
            setRcvAlertEmail(rule?.rcvClaimAlertEmail || '');
            setAllowFactoring(rule ? rule.allowFactoringCesion : true);
            setBillingPortalUrl(rule?.billingPortalUrl || '');
            setRemittanceEmail(rule?.remittanceEmail || '');
            setDefaultCentroCosto(rule?.defaultCentroCosto || '');
            setRuleNotes(rule?.notes || '');
        } catch {
            // Fallo silencioso sin inventar reglas
        } finally {
            setLoadingRule(false);
        }
    }, [isEduSandbox, tenantId, supplier.supplierKey]);

    useEffect(() => {
        setEditingRule(false);
        setRuleBanner(null);
        setRuleConfirmWord('');
        void loadBillingRule();
    }, [loadBillingRule]);

    const handleCopyFullTaxBlock = async () => {
        const text = formatSiiProfileClipboardText(supplier, undeclaredLabel);
        try {
            await navigator.clipboard.writeText(text);
            setCopiedAllTax(true);
            window.setTimeout(() => setCopiedAllTax(false), 1800);
        } catch {
            // Ignorar si clipboard bloqueado
        }
    };

    const toggleDteCode = (code: SiiDteDocumentType) => {
        setSupportedDtes((prev) =>
            prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code].sort((a, b) => a - b)
        );
    };

    const handleSaveTaxProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isDevMaster || isEduSandbox) return;
        if (taxConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setTaxBanner({ kind: 'err', msg: t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar.') });
            return;
        }

        const parsedActecos = actecoInput
            .split(/[,;\s]+/)
            .map((x) => x.replace(/\D/g, '').slice(0, 6))
            .filter((x) => /^\d{6}$/.test(x))
            .slice(0, 4);

        setTaxBusy(true);
        setTaxBanner(null);
        try {
            const res = await authFetch(`/api/manufacturers/suppliers/${supplier.supplierKey}/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplierTaxId: taxRegimeScope === 'SII_CL' ? siiRutInput.trim() || null : foreignTaxId.trim() || null,
                    siiTaxProfile: {
                        taxRegimeScope,
                        siiRutNormalized:
                            taxRegimeScope === 'SII_CL'
                                ? siiRutInput.replace(/[\s.]/g, '').toUpperCase().slice(0, 10) || null
                                : null,
                        siiRznSoc: siiRznSoc.trim().slice(0, 100) || null,
                        siiGiroEmis: siiGiroEmis.trim().slice(0, 80) || null,
                        siiGiroRecep: (siiGiroRecep.trim() || deriveGiroRecep40Preview(siiGiroEmis)).slice(0, 40) || null,
                        actecoCodes: parsedActecos,
                        taxAddressDir: taxAddressDir.trim().slice(0, 70) || null,
                        taxComuna: taxComuna.trim().slice(0, 20) || null,
                        taxCiudad: taxCiudad.trim().slice(0, 20) || null,
                        cdgSiiSucur: cdgSiiSucur.replace(/\D/g, '').slice(0, 9) || null,
                        dteInterchangeEmail: dteInterchangeEmail.trim().slice(0, 80) || null,
                        apBillingEmail: apBillingEmail.trim().slice(0, 180) || null,
                        supportedDteTypes: supportedDtes.length > 0 ? supportedDtes : [33],
                        isDteCertified,
                        foreignTaxId: taxRegimeScope === 'INTERNATIONAL' ? foreignTaxId.trim().slice(0, 48) || null : null,
                    },
                    confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || t('suppliers_v2.error_save_tax', 'Error al guardar perfil tributario SII.'));
            }
            if (data.supplier) {
                onSupplierUpdated(data.supplier);
            }
            setEditingTax(false);
            setTaxConfirmWord('');
            setTaxBanner({
                kind: 'ok',
                msg: t('suppliers_v2.tax_saved_ok', 'Perfil tributario DTE actualizado y auditado.'),
            });
        } catch (err: unknown) {
            setTaxBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_save_tax', 'Error al actualizar SII.'),
            });
        } finally {
            setTaxBusy(false);
        }
    };

    const handleSaveBillingRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isEduSandbox || !tenantId) return;
        if (paymentTermDays > 30 && !hasExceptionalAgreement) {
            setRuleBanner({
                kind: 'err',
                msg: t(
                    'suppliers_v2.error_ley21131_days',
                    'Ley N° 21.131: plazos mayores a 30 días exigen acreditar acuerdo excepcional inscrito en el MEFT.'
                ),
            });
            return;
        }
        if (ruleConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD) {
            setRuleBanner({ kind: 'err', msg: t('suppliers_v2.error_confirm_keyword', 'Escribe ACTUALIZAR para confirmar.') });
            return;
        }

        const payload = {
            requiresPurchaseOrder801: reqOc801,
            requiresContract803: reqContract803,
            requiresDispatchGuide52: reqGuide52,
            requiresReceptionTokenType: reqTokenType,
            defaultFormaPagoDte: fmaPago,
            paymentTermDays: Number(paymentTermDays) || 30,
            hasExceptionalPaymentAgreement: hasExceptionalAgreement,
            exceptionalAgreementNote: exceptionalNote.trim() || null,
            dteClaimWindowDays: Math.max(1, Math.min(8, Number(claimWindowDays) || 8)),
            rcvClaimAlertEmail: rcvAlertEmail.trim() || null,
            allowFactoringCesion: allowFactoring,
            billingPortalUrl: billingPortalUrl.trim() || null,
            remittanceEmail: remittanceEmail.trim() || null,
            defaultCentroCosto: defaultCentroCosto.trim() || null,
            notes: ruleNotes.trim() || null,
            confirmWord: MANUFACTURER_HITL_CONFIRM_KEYWORD,
        };

        const endpoint = `/api/manufacturers/suppliers/${supplier.supplierKey}/billing-rule`;
        setRuleBusy(true);
        setRuleBanner(null);

        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                await syncQueueEngine.enqueueApiMutation(endpoint, payload, 'opermaq:billing-rule-synced', tenantId, 'PUT');
                setEditingRule(false);
                setRuleConfirmWord('');
                setRuleBanner({
                    kind: 'ok',
                    msg: t('suppliers_v2.rule_queued_offline', 'Regla contractual B2B encolada para sincronización offline.'),
                });
                return;
            }

            try {
                const res = await authFetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || t('suppliers_v2.error_save_rule', 'Error al guardar regla contractual B2B.'));
                }
                if (data.billingRule) setBillingRule(data.billingRule);
                setEditingRule(false);
                setRuleConfirmWord('');
                setRuleBanner({
                    kind: 'ok',
                    msg: t('suppliers_v2.rule_saved_ok', 'Reglas contractuales B2B actualizadas.'),
                });
            } catch (netErr: any) {
                if (netErr instanceof TypeError) {
                    await syncQueueEngine.enqueueApiMutation(
                        endpoint,
                        payload,
                        'opermaq:billing-rule-synced',
                        tenantId,
                        'PUT'
                    );
                    setEditingRule(false);
                    setRuleConfirmWord('');
                    setRuleBanner({
                        kind: 'ok',
                        msg: t('suppliers_v2.rule_queued_offline', 'Regla contractual B2B encolada para sincronización offline.'),
                    });
                } else {
                    throw netErr;
                }
            }
        } catch (err: unknown) {
            setRuleBanner({
                kind: 'err',
                msg: err instanceof Error ? err.message : t('suppliers_v2.error_save_rule', 'Error al guardar regla B2B.'),
            });
        } finally {
            setRuleBusy(false);
        }
    };

    const renderTechRow = (label: string, val?: string | null, copyValue?: string | null) => {
        const display = val && val.trim() ? val.trim() : undeclaredLabel;
        const isMissing = display === undeclaredLabel;
        return (
            <div className="py-fib-13 grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-fib-8 sm:gap-fib-21 items-baseline">
                <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    {label}
                </span>
                <div className="flex items-baseline justify-between sm:justify-start gap-fib-8 min-w-0">
                    <span
                        className={`text-body-main font-mono tabular-nums break-words select-text min-w-0 ${isMissing ? 'text-[#94A3B8] dark:text-[#5A6072]' : 'text-[#0F172A] dark:text-[#F3F4F6]'
                            }`}
                    >
                        {display}
                    </span>
                    {!isMissing && <CopyButton value={copyValue || display} />}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-[34px]">
            {/* BLOQUE 1: IDENTIFICACIÓN TRIBUTARIA OFICIAL SII DTE / INTERNACIONAL */}
            <section className="space-y-[21px]">
                <div className="flex items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <div className="space-y-[6px] min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-[13px]">
                            <span className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                {readiness.scope === 'INTERNATIONAL'
                                    ? t('suppliers_v2.tax_intl_heading', 'PERFIL TRIBUTARIO INTERNACIONAL')
                                    : t('suppliers_v2.tax_sii_heading', 'PERFIL TRIBUTARIO SII · SCHEMA DTE_V10')}
                            </span>
                            <span
                                className={`text-[0.8125rem] font-mono font-bold tabular-nums ${readiness.isReady ? 'text-[#00AEEF]' : 'text-[#C68346]'
                                    }`}
                            >
                                {readiness.scope === 'INTERNATIONAL' ? 'INTL TAX' : 'SII DTE_V10'}: {readiness.score}/
                                {readiness.total}
                            </span>
                        </div>
                        <M3LinearProgress value={readinessPct} tone={readiness.isReady ? 'cyan' : 'copper'} />
                    </div>
                    <div className="flex items-center gap-[8px] shrink-0">
                        <button
                            type="button"
                            onClick={handleCopyFullTaxBlock}
                            title={t('suppliers_v2.copy_sii_block', 'Copiar bloque de facturación completo')}
                            aria-label={t('suppliers_v2.copy_sii_block', 'Copiar bloque de facturación')}
                            className={FLAT_ICON_BTN_CLS}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${copiedAllTax ? 'text-[#00AEEF]' : ''}`}>
                                {copiedAllTax ? 'check' : 'content_copy'}
                            </span>
                        </button>
                        {isDevMaster && !isEduSandbox && (
                            <button
                                type="button"
                                onClick={() => setEditingTax((prev) => !prev)}
                                title={t('common.edit', 'Editar')}
                                aria-label={t('common.edit', 'Editar perfil tributario SII')}
                                className={FLAT_ICON_BTN_CLS}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${editingTax ? 'text-[#C68346]' : ''}`}>
                                    {editingTax ? 'close' : 'edit'}
                                </span>
                            </button>
                        )}
                    </div>
                </div>

                {taxBanner && (
                    <div
                        className={`p-[13px] border text-[0.8125rem] font-mono ${taxBanner.kind === 'ok'
                                ? 'border-[#00AEEF] text-[#00AEEF]'
                                : 'border-[#C68346] text-[#C68346]'
                            } bg-[#F8FAFC] dark:bg-[#07090D]`}
                    >
                        {taxBanner.msg}
                    </div>
                )}

                {!editingTax ? (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C]">
                        {readiness.scope === 'INTERNATIONAL' ? (
                            <>
                                {renderTechRow(
                                    t('suppliers_v2.intl_tax_id_label', 'TAX ID / VAT / EIN'),
                                    profile.foreignTaxId || supplier.supplierTaxId
                                )}
                                {renderTechRow(t('suppliers_v2.sii_rzn_soc_label', 'RAZÓN SOCIAL LEGAL'), profile.siiRznSoc || supplier.legalName)}
                                {renderTechRow(t('suppliers_v2.sii_dir_label', 'DOMICILIO FISCAL'), profile.taxAddressDir)}
                                {renderTechRow(
                                    t('suppliers_v2.sii_city_label', 'CIUDAD / ESTADO'),
                                    [profile.taxCiudad, profile.taxComuna].filter(Boolean).join(' · ') || null
                                )}
                                {renderTechRow(
                                    t('suppliers_v2.intl_ap_email_label', 'CORREO FACTURACIÓN / INVOICE'),
                                    profile.apBillingEmail || profile.dteInterchangeEmail
                                )}
                            </>
                        ) : (
                            <>
                                {renderTechRow(
                                    t('suppliers_v2.sii_rut_label', 'RUT TRIBUTARIO'),
                                    profile.siiRutDisplay || profile.siiRutNormalized || supplier.supplierTaxId,
                                    profile.siiRutNormalized || profile.siiRutDisplay || supplier.supplierTaxId
                                )}
                                {renderTechRow(t('suppliers_v2.sii_rzn_soc_label', 'RAZÓN SOCIAL LEGAL'), profile.siiRznSoc || supplier.legalName)}
                                {renderTechRow(t('suppliers_v2.sii_giro_emis_label', 'GIRO EMISOR'), profile.siiGiroEmis)}
                                {renderTechRow(t('suppliers_v2.sii_giro_recep_label', 'GIRO RECEPTOR'), profile.siiGiroRecep)}
                                {renderTechRow(
                                    t('suppliers_v2.sii_acteco_label', 'CÓDIGOS ACTECO'),
                                    profile.actecoCodes?.length ? profile.actecoCodes.join(', ') : null
                                )}
                                {renderTechRow(t('suppliers_v2.sii_dir_label', 'DIRECCIÓN MATRIZ'), profile.taxAddressDir)}
                                {renderTechRow(
                                    t('suppliers_v2.sii_comuna_ciudad_label', 'COMUNA / CIUDAD'),
                                    profile.taxComuna || profile.taxCiudad
                                        ? `${profile.taxComuna || '—'} / ${profile.taxCiudad || '—'}`
                                        : null
                                )}
                                {renderTechRow(t('suppliers_v2.sii_sucur_label', 'SUCURSAL SII'), profile.cdgSiiSucur)}
                                {renderTechRow(
                                    t('suppliers_v2.sii_interchange_email_label', 'CASILLA INTERCAMBIO DTE XML'),
                                    profile.dteInterchangeEmail
                                )}
                                {renderTechRow(
                                    t('suppliers_v2.sii_ap_email_label', 'CORREO COBRANZA / PAGOS (AP)'),
                                    profile.apBillingEmail
                                )}
                                {renderTechRow(
                                    t('suppliers_v2.sii_dtes_label', 'DOCUMENTOS DTE HABILITADOS'),
                                    profile.supportedDteTypes?.length
                                        ? profile.supportedDteTypes.map((c) => DTE_LABELS[c] || String(c)).join(' · ')
                                        : null
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleSaveTaxProfile} autoComplete="off" spellCheck={false} className="space-y-[21px] p-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                        <div className="flex items-center justify-between gap-[13px]">
                            <M3Switch
                                checked={taxRegimeScope === 'INTERNATIONAL'}
                                onChange={(checked) => setTaxRegimeScope(checked ? 'INTERNATIONAL' : 'SII_CL')}
                                label={t('suppliers_v2.toggle_intl_scope', 'Régimen Internacional (Invoice / Exportación 110)')}
                            />
                            {taxRegimeScope === 'SII_CL' && (
                                <M3Switch
                                    checked={isDteCertified}
                                    onChange={setIsDteCertified}
                                    label={t('suppliers_v2.sii_certified_switch', 'Emisor DTE Certificado SII')}
                                />
                            )}
                        </div>

                        {taxRegimeScope === 'INTERNATIONAL' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-[13px]">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.intl_tax_id_label', 'TAX ID / VAT / EIN')}</label>
                                    <input
                                        type="text"
                                        value={foreignTaxId}
                                        onChange={(e) => setForeignTaxId(e.target.value)}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between">
                                        <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_rzn_soc_label', 'RAZÓN SOCIAL')}</label>
                                        <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{siiRznSoc.length}/100</span>
                                    </div>
                                    <input
                                        type="text"
                                        maxLength={100}
                                        value={siiRznSoc}
                                        onChange={(e) => setSiiRznSoc(e.target.value)}
                                        className={INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_dir_label', 'DOMICILIO FISCAL')}</label>
                                    <input
                                        type="text"
                                        maxLength={70}
                                        value={taxAddressDir}
                                        onChange={(e) => setTaxAddressDir(e.target.value)}
                                        className={INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.intl_ap_email_label', 'CORREO FACTURACIÓN AP')}</label>
                                    <input
                                        type="email"
                                        value={apBillingEmail}
                                        onChange={(e) => setApBillingEmail(e.target.value)}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-fib-13">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                    <div>
                                        <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rut_cl_label', 'RUT TRIBUTARIO (MÓDULO 11)')}</label>
                                        <input
                                            type="text"
                                            value={siiRutInput}
                                            onChange={(e) => setSiiRutInput(e.target.value)}
                                            placeholder="96.515.490-0"
                                            className={MONO_INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_rzn_soc_label', 'RAZÓN SOCIAL LEGAL')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{siiRznSoc.length}/100</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={100}
                                            value={siiRznSoc}
                                            onChange={(e) => setSiiRznSoc(e.target.value)}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_giro_emis_label', 'GIRO EMISOR')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{siiGiroEmis.length}/80</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={80}
                                            value={siiGiroEmis}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setSiiGiroEmis(v);
                                                if (!giroRecepTouched) {
                                                    setSiiGiroRecep(deriveGiroRecep40Preview(v));
                                                }
                                            }}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_giro_recep_label', 'GIRO RECEPTOR')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{siiGiroRecep.length}/40</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={40}
                                            value={siiGiroRecep}
                                            onChange={(e) => {
                                                setGiroRecepTouched(true);
                                                setSiiGiroRecep(e.target.value);
                                            }}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_acteco_label', 'CÓDIGOS ACTECO')}</label>
                                        <input
                                            type="text"
                                            value={actecoInput}
                                            onChange={(e) => setActecoInput(e.target.value)}
                                            placeholder="465902, 466302"
                                            className={MONO_INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_sucur_label', 'SUCURSAL SII')}</label>
                                        <input
                                            type="text"
                                            maxLength={9}
                                            value={cdgSiiSucur}
                                            onChange={(e) => setCdgSiiSucur(e.target.value)}
                                            placeholder="ej. 123456"
                                            className={MONO_INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                    <div className="md:col-span-1">
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_dir_label', 'DIRECCIÓN MATRIZ')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{taxAddressDir.length}/70</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={70}
                                            value={taxAddressDir}
                                            onChange={(e) => setTaxAddressDir(e.target.value)}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_comuna_label', 'COMUNA')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{taxComuna.length}/20</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={20}
                                            value={taxComuna}
                                            onChange={(e) => setTaxComuna(e.target.value)}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_ciudad_label', 'CIUDAD')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{taxCiudad.length}/20</span>
                                        </div>
                                        <input
                                            type="text"
                                            maxLength={20}
                                            value={taxCiudad}
                                            onChange={(e) => setTaxCiudad(e.target.value)}
                                            className={INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-[13px]">
                                    <div>
                                        <div className="flex justify-between">
                                            <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_interchange_email_label', 'CASILLA INTERCAMBIO DTE XML')}</label>
                                            <span className="text-microcopy font-mono tabular-nums text-[#94A3B8]">{dteInterchangeEmail.length}/80</span>
                                        </div>
                                        <input
                                            type="email"
                                            maxLength={80}
                                            value={dteInterchangeEmail}
                                            onChange={(e) => setDteInterchangeEmail(e.target.value)}
                                            placeholder="dte@..."
                                            className={MONO_INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_ap_email_label', 'CORREO COBRANZA / PAGOS')}</label>
                                        <input
                                            type="email"
                                            value={apBillingEmail}
                                            onChange={(e) => setApBillingEmail(e.target.value)}
                                            placeholder="cobranza@..."
                                            className={MONO_INPUT_BOX_CLS}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.sii_dtes_label', 'DOCUMENTOS DTE SOPORTADOS')}</label>
                                    <div className="flex flex-wrap gap-[8px]">
                                        {SII_DTE_DOCUMENT_TYPES.map((code) => {
                                            const active = supportedDtes.includes(code);
                                            return (
                                                <button
                                                    key={code}
                                                    type="button"
                                                    onClick={() => toggleDteCode(code)}
                                                    className={`px-[10px] py-[6px] text-microcopy font-mono border rounded-none cursor-pointer transition-colors ${active
                                                            ? 'border-[#C68346] text-[#C68346] bg-[#FFFFFF] dark:bg-[#000000]'
                                                            : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]'
                                                        }`}
                                                >
                                                    {DTE_LABELS[code]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {taxBusy && <M3LinearProgress indeterminate tone="copper" />}

                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-[13px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <div className="sm:w-[220px]">
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}</label>
                                <input
                                    type="text"
                                    value={taxConfirmWord}
                                    onChange={(e) => setTaxConfirmWord(e.target.value)}
                                    placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                    className={MONO_INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div className="flex items-center gap-[13px]">
                                <button type="button" onClick={() => setEditingTax(false)} className={BTN_OUTLINE_CLS}>
                                    {t('common.cancel', 'Cancelar')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={
                                        taxBusy ||
                                        taxConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                    }
                                    className={BTN_COPPER_CLS}
                                >
                                    {t('suppliers_v2.btn_save_tax', 'GUARDAR PERFIL SII')}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </section>

            {/* BLOQUE 2: REGLAS CONTRACTUALES PRIVADAS B2B (OCULTAS EN 5º EDU) */}
            {!isEduSandbox && Boolean(tenantId) && (
                <section className="space-y-[21px]">
                    <div className="flex items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
                        <div>
                            <div className="text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                                {t('suppliers_v2.b2b_billing_rules_heading', 'REGLAS CONTRACTUALES PRIVADAS DE FACTURACIÓN (B2B)')}
                            </div>
                            <div className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                {t(
                                    'suppliers_v2.b2b_billing_rules_sub',
                                    'Aislado por cuenta · OC 801 / Contrato 803 / HES · Ley N° 21.131 (30d) · Ley N° 19.983 (RCV 8d)'
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEditingRule((prev) => !prev)}
                            title={t('common.edit', 'Editar reglas B2B')}
                            aria-label={t('common.edit', 'Editar reglas B2B')}
                            className={FLAT_ICON_BTN_CLS}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${editingRule ? 'text-[#C68346]' : ''}`}>
                                {editingRule ? 'close' : 'edit'}
                            </span>
                        </button>
                    </div>

                    {loadingRule && <M3LinearProgress indeterminate tone="cyan" />}

                    {ruleBanner && (
                        <div
                            className={`p-[13px] border text-[0.8125rem] font-mono ${ruleBanner.kind === 'ok'
                                    ? 'border-[#00AEEF] text-[#00AEEF]'
                                    : 'border-[#C68346] text-[#C68346]'
                                } bg-[#F8FAFC] dark:bg-[#07090D]`}
                        >
                            {ruleBanner.msg}
                        </div>
                    )}

                    {!editingRule ? (
                        <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C]">
                            {renderTechRow(
                                t('suppliers_v2.rule_refs_label', 'DOCUMENTOS EXIGIDOS AL FACTURAR'),
                                [
                                    reqOc801 ? 'OC 801' : null,
                                    reqContract803 ? 'Contrato 803' : null,
                                    reqGuide52 ? 'Guía 52' : null,
                                    reqTokenType !== 'NONE' ? reqTokenType : null,
                                ]
                                    .filter(Boolean)
                                    .join(' · ') || 'Sin exigencia previa'
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_payment_ley21131_label', 'CONDICIÓN Y PLAZO DE PAGO (LEY 21.131)'),
                                `${fmaPago === 1 ? 'Contado' : fmaPago === 3 ? 'Sin costo' : 'Crédito'} · ${paymentTermDays} d${hasExceptionalAgreement ? ' (Acuerdo MEFT)' : ''
                                }`
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_claim_ley19983_label', 'VENTANA RECLAMO RCV · LEY N° 19.983'),
                                `${claimWindowDays} días corridos · ${allowFactoring ? 'Cesión AEC Habilitada' : 'Sin Factoring'
                                }`
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_rcv_alert_email', 'ALERTA INTERNA RCV (8 DÍAS)'),
                                rcvAlertEmail || billingRule?.rcvClaimAlertEmail
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_portal_label', 'PORTAL RECEPCIÓN FACTURAS'),
                                billingPortalUrl || billingRule?.billingPortalUrl
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_remittance_label', 'CORREO AVISO DE PAGO (AP)'),
                                remittanceEmail || billingRule?.remittanceEmail
                            )}
                            {renderTechRow(
                                t('suppliers_v2.rule_cc_label', 'CENTRO DE COSTO / IMPUTACIÓN'),
                                defaultCentroCosto || billingRule?.defaultCentroCosto
                            )}
                        </div>
                    ) : (
                        <form onSubmit={handleSaveBillingRule} autoComplete="off" spellCheck={false} className="space-y-[21px] p-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[13px]">
                                <M3Switch
                                    checked={reqOc801}
                                    onChange={setReqOc801}
                                    label={t('suppliers_v2.switch_oc_801', 'Exige OC (801)')}
                                />
                                <M3Switch
                                    checked={reqContract803}
                                    onChange={setReqContract803}
                                    label={t('suppliers_v2.switch_contract_803', 'Exige Contrato (803)')}
                                />
                                <M3Switch
                                    checked={reqGuide52}
                                    onChange={setReqGuide52}
                                    label={t('suppliers_v2.switch_guide_52', 'Exige Guía (52)')}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px]">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.token_type_label', 'RECEPCIÓN CONFORME')}</label>
                                    <select
                                        value={reqTokenType}
                                        onChange={(e) => setReqTokenType(e.target.value as 'NONE' | 'HES' | 'HEM' | 'HAS')}
                                        className={MONO_INPUT_BOX_CLS}
                                    >
                                        <option value="HES">HES</option>
                                        <option value="HEM">HEM</option>
                                        <option value="HAS">HAS</option>
                                        <option value="NONE">NONE</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.fmapago_label', 'FORMA DE PAGO DTE')}</label>
                                    <select
                                        value={fmaPago}
                                        onChange={(e) => setFmaPago(Number(e.target.value) as 1 | 2 | 3)}
                                        className={MONO_INPUT_BOX_CLS}
                                    >
                                        <option value={1}>Contado</option>
                                        <option value={2}>Crédito</option>
                                        <option value={3}>Sin costo</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.payment_days_label', 'PLAZO DÍAS (LEY 21.131)')}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={365}
                                        value={paymentTermDays}
                                        onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            </div>

                            {paymentTermDays > 30 && (
                                <div className="p-[13px] border border-[#C68346] space-y-[13px]">
                                    <M3Switch
                                        checked={hasExceptionalAgreement}
                                        onChange={setHasExceptionalAgreement}
                                        label={t(
                                            'suppliers_v2.switch_meft_agreement',
                                            'Acuerdo excepcional inscrito en el MEFT (Ley N° 21.131)'
                                        )}
                                    />
                                    <input
                                        type="text"
                                        maxLength={240}
                                        value={exceptionalNote}
                                        onChange={(e) => setExceptionalNote(e.target.value)}
                                        placeholder={t('suppliers_v2.meft_note_placeholder', 'Folio o referencia acuerdo MEFT...')}
                                        className={INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px] items-end">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rcv_days_label', 'VENTANA RCV (1..8 DÍAS)')}</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={8}
                                        value={claimWindowDays}
                                        onChange={(e) => setClaimWindowDays(Number(e.target.value))}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rule_rcv_alert_email', 'CORREO ALERTA RCV')}</label>
                                    <input
                                        type="email"
                                        value={rcvAlertEmail}
                                        onChange={(e) => setRcvAlertEmail(e.target.value)}
                                        placeholder="rcv@..."
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div className="pb-[8px]">
                                    <M3Switch
                                        checked={allowFactoring}
                                        onChange={setAllowFactoring}
                                        label={t('suppliers_v2.switch_factoring', 'Factoring / Cesión AEC')}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px]">
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rule_portal_label', 'PORTAL RECEPCIÓN')}</label>
                                    <input
                                        type="url"
                                        value={billingPortalUrl}
                                        onChange={(e) => setBillingPortalUrl(e.target.value)}
                                        placeholder="https://..."
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rule_remittance_label', 'CORREO AVISO PAGO')}</label>
                                    <input
                                        type="email"
                                        value={remittanceEmail}
                                        onChange={(e) => setRemittanceEmail(e.target.value)}
                                        placeholder="pagos@..."
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div>
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.rule_cc_label', 'CENTRO DE COSTO')}</label>
                                    <input
                                        type="text"
                                        maxLength={80}
                                        value={defaultCentroCosto}
                                        onChange={(e) => setDefaultCentroCosto(e.target.value)}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.notes_label', 'OBSERVACIONES CONTRACTUALES')}</label>
                                <textarea
                                    rows={2}
                                    value={ruleNotes}
                                    onChange={(e) => setRuleNotes(e.target.value)}
                                    className={INPUT_BOX_CLS}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>

                            {ruleBusy && <M3LinearProgress indeterminate tone="copper" />}

                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-[13px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
                                <div className="sm:w-[220px]">
                                    <label className={MICRO_LABEL_CLS}>{t('suppliers_v2.confirm_keyword_label', 'CONFIRMACIÓN HITL')}</label>
                                    <input
                                        type="text"
                                        value={ruleConfirmWord}
                                        onChange={(e) => setRuleConfirmWord(e.target.value)}
                                        placeholder={MANUFACTURER_HITL_CONFIRM_KEYWORD}
                                        className={MONO_INPUT_BOX_CLS}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </div>
                                <div className="flex items-center gap-[13px]">
                                    <button type="button" onClick={() => setEditingRule(false)} className={BTN_OUTLINE_CLS}>
                                        {t('common.cancel', 'Cancelar')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            ruleBusy ||
                                            ruleConfirmWord.trim().toUpperCase() !== MANUFACTURER_HITL_CONFIRM_KEYWORD
                                        }
                                        className={BTN_COPPER_CLS}
                                    >
                                        {t('suppliers_v2.btn_save_rule', 'GUARDAR REGLAS B2B')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </section>
            )}
        </div>
    );
};
