import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../config/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import siiActivities from '../../data/sii_activities.json';
import { Search, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useGooglePlaces } from '../../hooks/useGooglePlaces';

// ─── Estilos base reusables (Minimalismo Industrial) ────────────────────────
const LBL = 'block text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5';
const INP = 'w-full bg-transparent border border-gray-300 dark:border-gray-700 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#C68346] rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4 border-b border-gray-200 dark:border-gray-800 pb-1.5 flex items-center gap-2';

export const EmpresaPage = () => {
    const { currentAccount } = useAuth();
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // GOOGLE MAPS ADDRESS UI States
    const [addressSearchTerm, setAddressSearchTerm] = useState('');
    const [showAddressDropdown, setShowAddressDropdown] = useState(false);
    const [addressPredictions, setAddressPredictions] = useState<any[]>([]);
    const addressDropdownRef = useRef<HTMLDivElement>(null);

    const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded: isGoogleLoaded, loadError: googleLoadError, getPredictions, getPlaceDetails } = useGooglePlaces(googleApiKey);

    // Inicializar form desde Firestore account
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

    // Sincronizar form cuando cambia currentAccount (ej. post-guardado, otro tab)
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

    // Detectar si la empresa es Chilena (patrón RUT: XX.XXX.XXX-X)
    const isChilean = useMemo(() => {
        const rutPattern = /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/;
        return rutPattern.test(form.rut);
    }, [form.rut]);

    // Filtrar actividades SII
    const filteredActivities = useMemo(() => {
        const list = Array.isArray(siiActivities) ? siiActivities : (siiActivities as any).default || [];
        if (!searchTerm) return list.slice(0, 10);
        const term = searchTerm.toLowerCase();
        return (list as any[]).filter(a =>
            a.label.toLowerCase().includes(term) || a.code.includes(term)
        ).slice(0, 15);
    }, [searchTerm]);

    // Click fuera del dropdowns → cerrar
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

    // Debounced search for places
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
        // Revertir cambios no guardados
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
        setSaveError(null);
    };

    // ─── GUARDAR EN FIRESTORE (DUAL-WRITE: accounts + tenants) ──────────────────
    const handleSave = async () => {
        if (!currentAccount?.id) {
            setSaveError('Error: No hay cuenta activa. Recarga la página.');
            return;
        }
        if (!form.razonSocial.trim()) {
            setSaveError('La Razón Social es obligatoria.');
            return;
        }

        setSaving(true);
        setSaveError(null);

        try {
            // ① Actualizar colección `accounts` (leída por el portal B2B en tiempo real)
            const accountRef = doc(db, 'accounts', currentAccount.id);
            await updateDoc(accountRef, {
                name: form.razonSocial.trim(),          // ← campo principal Account (portal B2B)
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

            // ② Dual-write a colección `tenants` (leída por el panel MINREPORT admin)
            // El backend crea ambos documentos con el MISMO ID (accountId === tenantId)
            try {
                const tenantRef = doc(db, 'tenants', currentAccount.id);
                await updateDoc(tenantRef, {
                    company_name: form.razonSocial.trim(), // ← campo que muestra el admin
                    updatedAt: serverTimestamp(),
                });
                console.log('[EMPRESA-PAGE] tenants dual-write OK');
            } catch (tenantErr: any) {
                // Si el tenant no existe o no hay permisos, no bloqueamos el flujo
                console.warn('[EMPRESA-PAGE] tenants dual-write skipped:', tenantErr?.message);
            }

            setSaveSuccess(true);
            setEditing(false);
            setSearchTerm('');
            setShowDropdown(false);

            // Limpiar feedback de éxito a los 3s
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            console.error('[EMPRESA-PAGE] Firestore update error:', err);
            setSaveError(`Error al guardar: ${err?.message || 'Intente de nuevo.'} `);
        } finally {
            setSaving(false);
        }
    };


    if (!currentAccount) return null;

    return (
        <div className="max-w-4xl mx-auto py-8 px-6 space-y-10" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>

            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-800 pb-6">
                <div>
                    <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">Datos de la Empresa</h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Información registrada ante {isChilean ? 'el SII' : 'el ente regulador nacional'}. Utilizada en facturas y contratos.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {saveSuccess && (
                        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5 animate-in fade-in">
                            <Check className="w-3 h-3" /> Guardado
                        </span>
                    )}
                    {!editing ? (
                        <button
                            onClick={() => setEditing(true)}
                            className="text-xs font-bold uppercase tracking-wider px-4 py-2 border border-[#C68346] text-[#C68346] hover:bg-[#C68346]/10 transition-colors rounded-none"
                        >
                            Editar
                        </button>
                    ) : (
                        <button
                            onClick={handleCancelEdit}
                            className="text-xs font-bold uppercase tracking-wider px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors rounded-none"
                        >
                            Cancelar
                        </button>
                    )}
                </div>
            </div>

            {/* Error de guardado */}
            {saveError && (
                <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-none text-xs text-red-500 font-mono">
                    <span className="material-symbols-rounded text-base shrink-0">warning</span>
                    {saveError}
                </div>
            )}

            {/* ── Sección: Identificación Legal ── */}
            <section>
                <p className={SECTION_TITLE}>
                    <span className="material-symbols-rounded text-base">gavel</span>
                    Identificación Legal
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                        <label className={LBL}>
                            Razón Social <span className="text-[#C68346]">*</span>
                        </label>
                        <input type="text" disabled={!editing} autoComplete="off"
                            value={form.razonSocial} onChange={e => f('razonSocial', e.target.value)}
                            className={INP} placeholder="Nombre legal completo de la empresa" />
                    </div>
                    <div>
                        <label className={LBL}>{isChilean ? 'RUT' : 'Tax ID'} Empresa</label>
                        <input type="text" disabled className={INP + ' cursor-not-allowed opacity-50'}
                            value={form.rut} title="El ID tributario no puede modificarse" />
                        <p className="text-[10px] text-gray-400 mt-1">
                            Inmutable · Asignado por {isChilean ? 'vía SII' : 'Registro Nacional'}
                        </p>
                    </div>
                    <div>
                        <label className={LBL}>Nombre de Fantasía</label>
                        <input type="text" disabled={!editing} autoComplete="off"
                            value={form.nombreFantasia} onChange={e => f('nombreFantasia', e.target.value)}
                            className={INP} placeholder="Nombre comercial (si aplica)" />
                    </div>
                    <div className="md:col-span-2">
                        <label className={LBL}>
                            Giro Comercial {isChilean && <span className="text-gray-400 font-normal normal-case">· Código SII</span>}
                        </label>
                        {isChilean && editing ? (
                            <div className="relative" ref={dropdownRef}>
                                <div className="relative">
                                    <input
                                        type="text" autoComplete="off"
                                        placeholder="Buscar actividad económica SII..."
                                        value={searchTerm || form.giro}
                                        onFocus={() => setShowDropdown(true)}
                                        onChange={e => {
                                            setSearchTerm(e.target.value);
                                            setShowDropdown(true);
                                            if (!e.target.value) f('giro', '');
                                        }}
                                        className={INP + ' pr-10'}
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-gray-400 pointer-events-none">
                                        <Search className="w-3 h-3" />
                                        <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                                    </div>
                                </div>
                                {showDropdown && (
                                    <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#1a2233] border border-gray-200 dark:border-gray-800 shadow-xl max-h-60 overflow-y-auto rounded-none">
                                        {filteredActivities.length > 0 ? (
                                            filteredActivities.map((act: any) => (
                                                <button key={act.code} type="button"
                                                    onClick={() => { f('giro', act.label); setSearchTerm(act.label); setShowDropdown(false); }}
                                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors flex items-start justify-between gap-3"
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-mono font-bold text-[#C68346]">{act.code}</span>
                                                        <span className="text-xs text-gray-900 dark:text-white mt-0.5 leading-tight">{act.label}</span>
                                                    </div>
                                                    {form.giro === act.label && <Check className="w-3 h-3 text-[#C68346] mt-1 shrink-0" />}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="px-4 py-4 text-xs text-gray-500 italic">No se encontraron actividades...</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <input type="text" disabled={!editing} autoComplete="off"
                                value={form.giro} onChange={e => f('giro', e.target.value)}
                                className={INP} placeholder={isChilean ? 'Seleccione un giro comercial' : 'Giro comercial de la empresa'} />
                        )}
                    </div>
                </div>
            </section>

            {/* ── Sección: Direcciones ── */}
            <section>
                <p className={SECTION_TITLE}>
                    <span className="material-symbols-rounded text-base">location_on</span>
                    Direcciones
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                        <label className={LBL}>Dirección Sede Principal</label>
                        {editing ? (
                            <div className="relative" ref={addressDropdownRef}>
                                <div className="relative">
                                    <input
                                        type="text" autoComplete="off"
                                        placeholder="Buscar dirección principal..."
                                        value={showAddressDropdown ? addressSearchTerm : form.direccionComercial}
                                        onFocus={() => setShowAddressDropdown(true)}
                                        onChange={e => {
                                            setAddressSearchTerm(e.target.value);
                                            f('direccionComercial', e.target.value);
                                            setShowAddressDropdown(true);
                                        }}
                                        className={INP + ' pr-10 truncate'}
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-gray-400 pointer-events-none">
                                        {isGoogleLoaded ? <Search className="w-3 h-3" /> : (
                                            <div className="w-3 h-3 border border-gray-300 dark:border-gray-700 border-t-[#C68346] animate-spin rounded-full" />
                                        )}
                                    </div>
                                </div>
                                {googleLoadError && (
                                    <div className="mt-2 p-3 bg-red-500/5 border border-red-500/10 space-y-1">
                                        <p className="text-[9px] text-red-500 uppercase font-bold tracking-tighter flex items-center gap-2">
                                            <span className="material-symbols-rounded text-sm">warning</span>
                                            Error de Configuración Google Maps
                                        </p>
                                        <p className="text-[9px] text-red-500/70 uppercase font-medium leading-tight">
                                            {googleLoadError.includes('API_KEY_DENIED')
                                                ? 'La API Key requiere habilitar "Places API" (Legacy) en Google Cloud Console para búsqueda automática.'
                                                : googleLoadError}
                                        </p>
                                        <p className="text-[8px] opacity-40 uppercase font-bold tracking-widest pt-1">Continuar con ingreso manual:</p>
                                    </div>
                                )}
                                {showAddressDropdown && addressSearchTerm && addressPredictions.length > 0 && (
                                    <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#1a2233] border border-gray-200 dark:border-gray-800 shadow-xl max-h-60 overflow-y-auto rounded-none">
                                        {addressPredictions.map((pred) => (
                                            <button key={pred.place_id} type="button"
                                                onClick={() => handleSelectAddress(pred.place_id, pred.description)}
                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors"
                                            >
                                                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                                    {pred.structured_formatting.main_text}
                                                </p>
                                                <p className="text-[10px] text-gray-500 truncate mt-0.5">
                                                    {pred.structured_formatting.secondary_text}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <input type="text" disabled autoComplete="off"
                                value={form.direccionComercial} className={INP} placeholder="Dirección principal" />
                        )}
                    </div>
                    <div>
                        <label className={LBL}>Código Postal <span className="text-[8px] opacity-40 italic ml-1">(Auto)</span></label>
                        <input type="text" disabled autoComplete="off"
                            value={form.postalCode} className={INP + ' cursor-not-allowed opacity-50'} placeholder="Cód. Postal" />
                    </div>
                    <div>
                        <label className={LBL}>Región <span className="text-[8px] opacity-40 italic ml-1">(Auto)</span></label>
                        <input type="text" disabled autoComplete="off"
                            value={form.regionComercial} className={INP + ' cursor-not-allowed opacity-50'} />
                    </div>
                    <div>
                        <label className={LBL}>Ciudad <span className="text-[8px] opacity-40 italic ml-1">(Auto)</span></label>
                        <input type="text" disabled autoComplete="off"
                            value={form.ciudadComercial} className={INP + ' cursor-not-allowed opacity-50'} />
                    </div>
                    <div>
                        <label className={LBL}>Comuna <span className="text-[8px] opacity-40 italic ml-1">(Auto)</span></label>
                        <input type="text" disabled autoComplete="off"
                            value={form.comunaComercial} className={INP + ' cursor-not-allowed opacity-50'} />
                    </div>
                    <div className="md:col-span-3">
                        <label className={LBL}>Dirección Sucursal Operativa <span className="font-normal normal-case text-gray-400">(si aplica)</span></label>
                        <input type="text" disabled={!editing} autoComplete="off"
                            value={form.direccionSucursal} onChange={e => f('direccionSucursal', e.target.value)} className={INP} />
                    </div>
                </div>
            </section>

            {/* ── Sección: Contacto Oficial ── */}
            <section>
                <p className={SECTION_TITLE}>
                    <span className="material-symbols-rounded text-base">contact_mail</span>
                    Contacto Oficial
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={LBL}>Email Comercial</label>
                        <input type="email" disabled={!editing} autoComplete="off"
                            value={form.emailComercial} onChange={e => f('emailComercial', e.target.value)} className={INP} />
                    </div>
                    <div>
                        <label className={LBL}>Email Tributario {isChilean && '/ SII'}</label>
                        <input type="email" disabled={!editing} autoComplete="off"
                            value={form.emailTributario} onChange={e => f('emailTributario', e.target.value)} className={INP} placeholder="DTE / SII" />
                    </div>
                    <div>
                        <label className={LBL}>Dominio Corporativo</label>
                        <input type="text" disabled={!editing} autoComplete="off"
                            value={form.emailDomain} onChange={e => f('emailDomain', e.target.value)} className={INP} placeholder="ej. empresa.cl" />
                    </div>
                    <div>
                        <label className={LBL}>Teléfono Principal</label>
                        <input type="tel" disabled={!editing} autoComplete="off"
                            value={form.telefonoPrincipal} onChange={e => f('telefonoPrincipal', e.target.value)} className={INP} />
                    </div>
                    <div>
                        <label className={LBL}>Teléfono Secundario</label>
                        <input type="tel" disabled={!editing} autoComplete="off"
                            value={form.telefonoSecundario} onChange={e => f('telefonoSecundario', e.target.value)} className={INP} />
                    </div>
                </div>
            </section>

            {/* ── Sección: Identidad Visual ── */}
            <section>
                <p className={SECTION_TITLE}>
                    <span className="material-symbols-rounded text-base">image</span>
                    Identidad Visual
                </p>
                <div className="flex items-center gap-6">
                    <div className="border border-dashed border-gray-300 dark:border-gray-600 w-40 h-20 flex items-center justify-center cursor-pointer hover:border-[#C68346] transition-colors rounded-none">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Logo Corporativo</span>
                    </div>
                    <p className="text-xs text-gray-400">PNG, SVG o JPG · Máx. 2 MB<br />Se incluirá en reportes exportados.</p>
                </div>
            </section>

            {/* ── Botón Guardar ── */}
            {editing && (
                <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 bg-[#C68346] hover:bg-[#b0743e] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold uppercase tracking-wider text-xs py-2.5 px-8 rounded-none transition-colors"
                    >
                        {saving ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Guardando...</>
                        ) : (
                            <><Check className="w-3 h-3" /> Guardar Cambios</>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};
