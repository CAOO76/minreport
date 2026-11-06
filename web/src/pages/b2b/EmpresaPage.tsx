import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../config/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import siiActivities from '../../data/sii_activities.json';
import { useGooglePlaces } from '../../hooks/useGooglePlaces';
import { CopyButton } from '../../components/common/CopyButton';

const UNDECLARED = '[Información técnica no declarada en ficha]';
const LBL = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const INP = 'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense text-[#0F172A] dark:text-[#F3F4F6] focus:outline-none focus:border-[#C68346] rounded-none shadow-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const SECTION_HEADER = 'px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between';

export const EmpresaPage: React.FC = () => {
    const { currentAccount } = useAuth();
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [addressSearchTerm, setAddressSearchTerm] = useState('');
    const [showAddressDropdown, setShowAddressDropdown] = useState(false);
    const [addressPredictions, setAddressPredictions] = useState<any[]>([]);
    const addressDropdownRef = useRef<HTMLDivElement>(null);
    const [confirmWord, setConfirmWord] = useState('');

    const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded: isGoogleLoaded, loadError: googleLoadError, getPredictions, getPlaceDetails } = useGooglePlaces(googleApiKey);

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
        }
    }, [currentAccount]);

    const isChilean = useMemo(() => {
        const rutPattern = /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/;
        return rutPattern.test(form.rut);
    }, [form.rut]);

    const filteredActivities = useMemo(() => {
        const list = Array.isArray(siiActivities) ? siiActivities : (siiActivities as any).default || [];
        if (!searchTerm) return list.slice(0, 10);
        const term = searchTerm.toLowerCase();
        return (list as any[]).filter(a =>
            a.label.toLowerCase().includes(term) || a.code.includes(term)
        ).slice(0, 15);
    }, [searchTerm]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
            if (addressDropdownRef.current && !addressDropdownRef.current.contains(event.target as Node)) {
                setShowAddressDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!addressSearchTerm || !showAddressDropdown) {
            setAddressPredictions([]);
            return;
        }
        const timer = setTimeout(async () => {
            const results = await getPredictions(addressSearchTerm);
            setAddressPredictions(results);
        }, 300);
        return () => clearTimeout(timer);
    }, [addressSearchTerm, getPredictions, showAddressDropdown]);

    const handleSelectAddress = async (placeId: string, description: string) => {
        f('direccionComercial', description);
        setAddressSearchTerm(description);
        setShowAddressDropdown(false);

        const details = await getPlaceDetails(placeId);
        if (!details || !details.address_components) return;

        let streetNumber = '';
        let route = '';
        let locality = '';
        let sublocality = '';
        let adminArea1 = '';
        let postalCode = '';

        for (const component of details.address_components) {
            const types = component.types;
            if (types.includes('street_number')) streetNumber = component.long_name;
            if (types.includes('route')) route = component.long_name;
            if (types.includes('locality')) locality = component.long_name;
            if (types.includes('administrative_area_level_3') || types.includes('sublocality')) {
                sublocality = component.long_name;
            }
            if (types.includes('administrative_area_level_1')) adminArea1 = component.long_name;
            if (types.includes('postal_code')) postalCode = component.long_name;
        }

        if (!sublocality) sublocality = locality;
        const formattedAddress = `${route} ${streetNumber}`.trim() || description;

        setForm(prev => ({
            ...prev,
            direccionComercial: formattedAddress,
            ciudadComercial: locality || prev.ciudadComercial,
            comunaComercial: sublocality || prev.comunaComercial,
            regionComercial: adminArea1 || prev.regionComercial,
            postalCode: postalCode || prev.postalCode,
        }));
    };

    const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

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
        }
        setSearchTerm('');
        setShowDropdown(false);
        setEditing(false);
        setConfirmWord('');
        setSaveError(null);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (confirmWord !== 'ACTUALIZAR') return;
        if (!currentAccount?.id) {
            setSaveError('No hay cuenta activa seleccionada.');
            return;
        }
        if (!form.razonSocial.trim()) {
            setSaveError('La Razón Social es obligatoria.');
            return;
        }

        setSaving(true);
        setSaveError(null);

        try {
            const accountRef = doc(db, 'accounts', currentAccount.id);
            await updateDoc(accountRef, {
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
            });

            try {
                const tenantRef = doc(db, 'tenants', currentAccount.id);
                await updateDoc(tenantRef, {
                    company_name: form.razonSocial.trim(),
                    updatedAt: serverTimestamp(),
                });
            } catch {
                // Sincronización opcional sobre colección espejo tenants
            }

            setSaveSuccess(true);
            setEditing(false);
            setConfirmWord('');
            setSearchTerm('');
            setShowDropdown(false);

            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setSaveError(`Error al persistir ficha legal: ${err?.message || 'Verifique permisos.'}`);
        } finally {
            setSaving(false);
        }
    };

    if (!currentAccount) return null;

    const renderReadField = (label: string, value: string, opts?: { mono?: boolean; copyable?: boolean }) => {
        const clean = value?.trim() || '';
        return (
            <div className="py-fib-13 px-fib-21 flex flex-col sm:flex-row sm:items-center justify-between gap-fib-8">
                <span className="text-data-dense text-[#475569] dark:text-[#8A93A6]">{label}</span>
                {clean ? (
                    <div className="inline-flex items-center gap-fib-8">
                        <span
                            className={`text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] ${
                                opts?.mono ? 'font-mono tabular-nums' : ''
                            } ${opts?.copyable ? 'select-text' : ''}`}
                        >
                            {clean}
                        </span>
                        {opts?.copyable && <CopyButton value={clean} title={`Copiar ${label}`} />}
                    </div>
                ) : (
                    <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        {UNDECLARED}
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
                        MINREPORT // FICHA TÉCNICA DE PERSONA JURÍDICA
                    </span>
                    <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        Datos Oficiales de la Empresa
                    </h1>
                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                        Registro tributario y operacional ante {isChilean ? 'el SII (Chile)' : 'el ente regulador nacional'}.
                    </p>
                </div>

                <div className="flex items-center gap-fib-13">
                    {saveSuccess && (
                        <span className="text-microcopy font-mono text-[#00AEEF] uppercase">
                            REGISTRO ACTUALIZADO
                        </span>
                    )}
                    {!editing ? (
                        <button
                            type="button"
                            onClick={() => setEditing(true)}
                            title="Activar edición quirúrgica"
                            aria-label="Activar edición quirúrgica"
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleCancelEdit}
                            title="Cancelar edición"
                            aria-label="Cancelar edición"
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    )}
                </div>
            </header>

            {saveError && (
                <div className="p-fib-13 bg-red-500/5 border border-red-500/30 rounded-none text-data-dense text-red-600 dark:text-red-400 font-mono">
                    {saveError}
                </div>
            )}

            {!editing ? (
                /* MODO INFORME TÉCNICO POR DEFECTO (SOLO LECTURA) — Proporción Áurea 61.8% / 38.2% */
                <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                    {/* ÁREA MAYOR (61.8%): Identificación Legal y Direcciones */}
                    <div className="space-y-fib-21">
                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    Identificación Legal y Tributaria
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">gavel</span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField('ID Cuenta (Tenant)', currentAccount.id, { mono: true, copyable: true })}
                                {renderReadField('Razón Social', form.razonSocial)}
                                {renderReadField(isChilean ? 'RUT Empresa' : 'Tax ID Empresa', form.rut, { mono: true, copyable: true })}
                                {renderReadField('Nombre de Fantasía', form.nombreFantasia)}
                                {renderReadField('Giro Comercial', form.giro)}
                            </div>
                        </section>

                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    Domicilio Legal y Sucursal Operativa
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">location_on</span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField('Dirección Sede Principal', form.direccionComercial)}
                                {renderReadField('Comuna', form.comunaComercial)}
                                {renderReadField('Ciudad', form.ciudadComercial)}
                                {renderReadField('Región', form.regionComercial)}
                                {renderReadField('Código Postal', form.postalCode, { mono: true })}
                                {renderReadField('Dirección Sucursal Faena', form.direccionSucursal)}
                            </div>
                        </section>
                    </div>

                    {/* ÁREA MENOR (38.2%): Contacto Oficial */}
                    <aside className="space-y-fib-21">
                        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
                            <div className={SECTION_HEADER}>
                                <h2 className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                    Canales Oficiales y DTE
                                </h2>
                                <span className="material-symbols-outlined text-[16px] text-[#C68346]">contact_mail</span>
                            </div>
                            <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {renderReadField('Email Comercial', form.emailComercial, { mono: true, copyable: true })}
                                {renderReadField(isChilean ? 'Email Tributario DTE / SII' : 'Email Tributario', form.emailTributario, { mono: true, copyable: true })}
                                {renderReadField('Dominio Corporativo', form.emailDomain, { mono: true, copyable: true })}
                                {renderReadField('Teléfono Principal', form.telefonoPrincipal, { mono: true })}
                                {renderReadField('Teléfono Secundario', form.telefonoSecundario, { mono: true })}
                            </div>
                        </section>
                    </aside>
                </div>
            ) : (
                /* MODO EDICIÓN QUIRÚRGICA CON CONFIRMACIÓN HITL "ACTUALIZAR" */
                <form onSubmit={handleSave} autoComplete="off" spellCheck={false} className="space-y-fib-21">
                    <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                        {/* ÁREA MAYOR (61.8%): Edición Legal y Direcciones */}
                        <div className="space-y-fib-21">
                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    1. Identificación Legal
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                    <div className="md:col-span-2">
                                        <label className={LBL}>Razón Social *</label>
                                        <input
                                            type="text"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.razonSocial}
                                            onChange={e => f('razonSocial', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>{isChilean ? 'RUT Empresa' : 'Tax ID'}</label>
                                        <input
                                            type="text"
                                            disabled
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.rut}
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Nombre de Fantasía</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.nombreFantasia}
                                            onChange={e => f('nombreFantasia', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className={LBL}>Giro Comercial {isChilean ? '· Código SII' : ''}</label>
                                        {isChilean ? (
                                            <div className="relative" ref={dropdownRef}>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    spellCheck={false}
                                                    placeholder="Buscar actividad económica SII..."
                                                    value={searchTerm || form.giro}
                                                    onFocus={() => setShowDropdown(true)}
                                                    onChange={e => {
                                                        setSearchTerm(e.target.value);
                                                        setShowDropdown(true);
                                                        if (!e.target.value) f('giro', '');
                                                    }}
                                                    className={INP}
                                                />
                                                {showDropdown && (
                                                    <div className="absolute z-[100] w-full mt-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] shadow-none max-h-60 overflow-y-auto rounded-none">
                                                        {filteredActivities.length > 0 ? (
                                                            filteredActivities.map((act: any) => (
                                                                <button
                                                                    key={act.code}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        f('giro', act.label);
                                                                        setSearchTerm(act.label);
                                                                        setShowDropdown(false);
                                                                    }}
                                                                    className="w-full text-left px-fib-13 py-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] last:border-0 transition-colors flex items-start justify-between gap-fib-8 cursor-pointer"
                                                                >
                                                                    <div className="flex flex-col">
                                                                        <span className="text-microcopy font-mono tabular-nums text-[#C68346]">{act.code}</span>
                                                                        <span className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] mt-0.5">{act.label}</span>
                                                                    </div>
                                                                </button>
                                                            ))
                                                        ) : (
                                                            <div className="px-fib-13 py-fib-13 text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                                                Sin coincidencias SII.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={form.giro}
                                                onChange={e => f('giro', e.target.value)}
                                                className={INP}
                                            />
                                        )}
                                    </div>
                                </div>
                            </section>

                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    2. Direcciones Operativas
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-fib-13">
                                    <div className="md:col-span-2" ref={addressDropdownRef}>
                                        <label className={LBL}>Dirección Sede Principal</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={showAddressDropdown ? addressSearchTerm : form.direccionComercial}
                                                onFocus={() => {
                                                    setAddressSearchTerm(form.direccionComercial);
                                                    setShowAddressDropdown(true);
                                                }}
                                                onChange={e => {
                                                    setAddressSearchTerm(e.target.value);
                                                    f('direccionComercial', e.target.value);
                                                    setShowAddressDropdown(true);
                                                }}
                                                className={INP}
                                            />
                                            {isGoogleLoaded && showAddressDropdown && addressSearchTerm && addressPredictions.length > 0 && (
                                                <div className="absolute z-[100] w-full mt-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] shadow-none max-h-60 overflow-y-auto rounded-none">
                                                    {addressPredictions.map((pred) => (
                                                        <button
                                                            key={pred.place_id}
                                                            type="button"
                                                            onClick={() => handleSelectAddress(pred.place_id, pred.description)}
                                                            className="w-full text-left px-fib-13 py-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#000000] border-b border-[#E2E8F0] dark:border-[#12151C] last:border-0 transition-colors cursor-pointer"
                                                        >
                                                            <p className="text-data-dense font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                                                {pred.structured_formatting.main_text}
                                                            </p>
                                                            <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] truncate">
                                                                {pred.structured_formatting.secondary_text}
                                                            </p>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {googleLoadError && (
                                            <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] mt-fib-8">
                                                Autocompletado postal no disponible — ingreso manual habilitado.
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <label className={LBL}>Código Postal</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.postalCode}
                                            onChange={e => f('postalCode', e.target.value)}
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Comuna</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.comunaComercial}
                                            onChange={e => f('comunaComercial', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Ciudad</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.ciudadComercial}
                                            onChange={e => f('ciudadComercial', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Región</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.regionComercial}
                                            onChange={e => f('regionComercial', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label className={LBL}>Dirección Sucursal Faena</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.direccionSucursal}
                                            onChange={e => f('direccionSucursal', e.target.value)}
                                            className={INP}
                                        />
                                    </div>
                                </div>
                            </section>
                        </div>

                        {/* ÁREA MENOR (38.2%): Contacto Oficial y Confirmación HITL */}
                        <div className="space-y-fib-21">
                            <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <h2 className="text-microcopy font-mono uppercase text-[#C68346] border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    3. Canales Oficiales
                                </h2>
                                <div className="space-y-fib-13">
                                    <div>
                                        <label className={LBL}>Email Comercial</label>
                                        <input
                                            type="email"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailComercial}
                                            onChange={e => f('emailComercial', e.target.value)}
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Email Tributario {isChilean ? 'DTE / SII' : ''}</label>
                                        <input
                                            type="email"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailTributario}
                                            onChange={e => f('emailTributario', e.target.value)}
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Dominio Corporativo</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.emailDomain}
                                            onChange={e => f('emailDomain', e.target.value)}
                                            className={`${INP} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Teléfono Principal</label>
                                        <input
                                            type="tel"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.telefonoPrincipal}
                                            onChange={e => f('telefonoPrincipal', e.target.value)}
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LBL}>Teléfono Secundario</label>
                                        <input
                                            type="tel"
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={form.telefonoSecundario}
                                            onChange={e => f('telefonoSecundario', e.target.value)}
                                            className={`${INP} font-mono tabular-nums`}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Confirmación HITL Obligatoria */}
                            <section className="border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                                <label className={LBL}>
                                    Confirmación HITL — Escriba &quot;ACTUALIZAR&quot;
                                </label>
                                <input
                                    type="text"
                                    value={confirmWord}
                                    onChange={e => setConfirmWord(e.target.value.toUpperCase())}
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
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving || confirmWord !== 'ACTUALIZAR'}
                                        className="flex-1 py-fib-8 px-fib-13 bg-[#C68346] hover:bg-[#B0743E] disabled:opacity-30 disabled:cursor-not-allowed text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                                    >
                                        {saving ? 'GUARDANDO...' : 'CONSOLIDAR'}
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
