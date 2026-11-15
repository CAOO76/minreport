import type {
    CommercialChannelType,
    ManufacturerRecord,
    SupplierContactEntry,
    SupplierEntity,
    TenantPrivateSupplierContact,
} from '../../../contracts/manufacturers.contracts';

export interface CountryDirectoryOption {
    code: string;
    name: string;
    label: string;
}

export const SUPPLIER_COUNTRY_OPTIONS: CountryDirectoryOption[] = [
    { code: 'CL', name: 'Chile', label: 'CL · Chile' },
    { code: 'PE', name: 'Perú', label: 'PE · Perú' },
    { code: 'AR', name: 'Argentina', label: 'AR · Argentina' },
    { code: 'BR', name: 'Brasil', label: 'BR · Brasil' },
    { code: 'CO', name: 'Colombia', label: 'CO · Colombia' },
    { code: 'MX', name: 'México', label: 'MX · México' },
    { code: 'EC', name: 'Ecuador', label: 'EC · Ecuador' },
    { code: 'BO', name: 'Bolivia', label: 'BO · Bolivia' },
    { code: 'UY', name: 'Uruguay', label: 'UY · Uruguay' },
    { code: 'PY', name: 'Paraguay', label: 'PY · Paraguay' },
    { code: 'PA', name: 'Panamá', label: 'PA · Panamá' },
    { code: 'CR', name: 'Costa Rica', label: 'CR · Costa Rica' },
    { code: 'US', name: 'Estados Unidos', label: 'US · Estados Unidos' },
    { code: 'CA', name: 'Canadá', label: 'CA · Canadá' },
    { code: 'AU', name: 'Australia', label: 'AU · Australia' },
    { code: 'DE', name: 'Alemania', label: 'DE · Alemania' },
    { code: 'JP', name: 'Japón', label: 'JP · Japón' },
    { code: 'SE', name: 'Suecia', label: 'SE · Suecia' },
    { code: 'FI', name: 'Finlandia', label: 'FI · Finlandia' },
    { code: 'AT', name: 'Austria', label: 'AT · Austria' },
    { code: 'CH', name: 'Suiza', label: 'CH · Suiza' },
    { code: 'NL', name: 'Países Bajos', label: 'NL · Países Bajos' },
    { code: 'BE', name: 'Bélgica', label: 'BE · Bélgica' },
    { code: 'GB', name: 'Reino Unido', label: 'GB · Reino Unido' },
    { code: 'IE', name: 'Irlanda', label: 'IE · Irlanda' },
    { code: 'ES', name: 'España', label: 'ES · España' },
    { code: 'FR', name: 'Francia', label: 'FR · Francia' },
    { code: 'IT', name: 'Italia', label: 'IT · Italia' },
    { code: 'CN', name: 'China', label: 'CN · China' },
    { code: 'KR', name: 'Corea del Sur', label: 'KR · Corea del Sur' },
    { code: 'TW', name: 'Taiwán', label: 'TW · Taiwán' },
    { code: 'IN', name: 'India', label: 'IN · India' },
    { code: 'ZA', name: 'Sudáfrica', label: 'ZA · Sudáfrica' },
    { code: 'NO', name: 'Noruega', label: 'NO · Noruega' },
    { code: 'PL', name: 'Polonia', label: 'PL · Polonia' },
];

/**
 * Mapea un área abierta ingresada por el usuario B2B al enum mínimo compatible
 * con el contrato de aportes comunitarios sin imponer listas cerradas en UI.
 */
export function inferContributionChannelFromArea(areaText: string): CommercialChannelType {
    const norm = (areaText || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (/usad|used|reman|semi\s*nuev/.test(norm)) return 'USED';
    if (/arriend|rent|alquil|locac/.test(norm)) return 'RENTAL';
    if (/nuev|new|venta\s*equip|comercial/.test(norm)) return 'NEW';
    if (/servic|taller|mantenc|postventa|garant|support/.test(norm)) return 'SERVICE';
    return 'PARTS';
}

export function getCountryHeadingLabel(iso2?: string | null): string {
    const code = String(iso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';
    const match = SUPPLIER_COUNTRY_OPTIONS.find((c) => c.code === code);
    return match ? `${match.code} · ${match.name.toUpperCase()}` : code;
}

export function extractDomainHost(rawUrl?: string | null): string | null {
    if (!rawUrl) return null;
    try {
        const u = new URL(rawUrl);
        return u.hostname.replace(/^www\./i, '');
    } catch {
        return rawUrl;
    }
}

export function formatBytesCompact(bytes?: number | null): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function deriveGiroRecep40Preview(giroEmis?: string | null): string {
    const collapsed = String(giroEmis || '').replace(/\s+/g, ' ').trim();
    if (!collapsed) return '';
    if (collapsed.length <= 40) return collapsed;
    const sliced = collapsed.slice(0, 40);
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace >= 20) return sliced.slice(0, lastSpace).trim();
    return sliced.trim();
}

export function formatSiiProfileClipboardText(supplier: SupplierEntity, undeclaredLabel: string): string {
    const p = supplier.siiTaxProfile;
    const isIntl = p?.taxRegimeScope === 'INTERNATIONAL' || supplier.countryIso2 !== 'CL';
    if (isIntl) {
        return [
            `PROVEEDOR: ${supplier.tradeName}`,
            `RAZON SOCIAL: ${p?.siiRznSoc || supplier.legalName || undeclaredLabel}`,
            `PAIS ISO: ${supplier.countryIso2}`,
            `TAX ID / VAT / EIN: ${p?.foreignTaxId || supplier.supplierTaxId || undeclaredLabel}`,
            `DOMICILIO FISCAL: ${p?.taxAddressDir || undeclaredLabel}`,
            `CIUDAD / ESTADO: ${[p?.taxCiudad, p?.taxComuna].filter(Boolean).join(' · ') || undeclaredLabel}`,
            `CORREO FACTURACION (AP): ${p?.apBillingEmail || p?.dteInterchangeEmail || undeclaredLabel}`,
        ].join('\n');
    }

    return [
        `PROVEEDOR: ${supplier.tradeName}`,
        `RUT TRIBUTARIO SII: ${p?.siiRutDisplay || supplier.supplierTaxId || undeclaredLabel}`,
        `RAZON SOCIAL: ${p?.siiRznSoc || supplier.legalName || undeclaredLabel}`,
        `GIRO COMERCIAL: ${p?.siiGiroEmis || undeclaredLabel}`,
        `GIRO ABREVIADO EN FACTURA: ${p?.siiGiroRecep || undeclaredLabel}`,
        `ACTIVIDAD ECONOMICA (ACTECO): ${p?.actecoCodes?.length ? p.actecoCodes.join(', ') : undeclaredLabel}`,
        `DIRECCION TRIBUTARIA: ${p?.taxAddressDir || undeclaredLabel}`,
        `COMUNA / CIUDAD: ${[p?.taxComuna, p?.taxCiudad].filter(Boolean).join(' / ') || undeclaredLabel}`,
        `CODIGO SUCURSAL SII: ${p?.cdgSiiSucur || undeclaredLabel}`,
        `CORREO RECEPCION DTE (SII): ${p?.dteInterchangeEmail || undeclaredLabel}`,
        `COBRANZA / PAGOS (AP): ${p?.apBillingEmail || undeclaredLabel}`,
        `DOCUMENTOS DTE HABILITADOS: ${p?.supportedDteTypes?.length ? p.supportedDteTypes.join(', ') : undeclaredLabel}`,
    ].join('\n');
}

export interface MergedContactItem {
    id: string;
    scope: 'GLOBAL' | 'TENANT_PRIVATE';
    areaName: string;
    areaKey: string;
    contactLabel: string | null;
    phone: string | null;
    roleEmail: string | null;
    portalUrl: string | null;
    cityRegion: string | null;
    notes: string | null;
    globalContact?: SupplierContactEntry;
    privateContact?: TenantPrivateSupplierContact;
}

export interface MergedAreaGroup {
    areaName: string;
    areaKey: string;
    items: MergedContactItem[];
}

export function groupSupplierContactsByOpenArea(
    supplier: SupplierEntity,
    privateContacts: TenantPrivateSupplierContact[],
    searchQuery = ''
): MergedAreaGroup[] {
    const q = searchQuery.trim().toLowerCase();
    const groupsMap = new Map<string, MergedAreaGroup>();

    const pushItem = (item: MergedContactItem) => {
        if (q) {
            const haystack = [
                item.areaName,
                item.contactLabel || '',
                item.phone || '',
                item.roleEmail || '',
                item.portalUrl || '',
                item.cityRegion || '',
                item.notes || '',
            ]
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(q)) return;
        }
        const existingGroup = groupsMap.get(item.areaKey);
        if (existingGroup) {
            existingGroup.items.push(item);
        } else {
            groupsMap.set(item.areaKey, {
                areaName: item.areaName,
                areaKey: item.areaKey,
                items: [item],
            });
        }
    };

    for (const cnt of supplier.contacts || []) {
        pushItem({
            id: `g_${cnt.contactId}`,
            scope: 'GLOBAL',
            areaName: cnt.areaName,
            areaKey: cnt.areaKey,
            contactLabel: cnt.contactLabel ?? null,
            phone: cnt.phone ?? null,
            roleEmail: cnt.roleEmail ?? null,
            portalUrl: cnt.portalUrl ?? null,
            cityRegion: cnt.cityRegion ?? null,
            notes: cnt.notes ?? null,
            globalContact: cnt,
        });
    }

    const supplierNameNorm = supplier.tradeName.trim().toLowerCase();
    for (const priv of privateContacts || []) {
        const matchesSupplier =
            (priv.supplierKey && priv.supplierKey === supplier.supplierKey) ||
            (!priv.supplierKey && priv.distributorName.trim().toLowerCase() === supplierNameNorm);
        if (!matchesSupplier) continue;
        const areaName = (priv.areaName || priv.channelType || 'Privado').trim();
        const areaKey =
            (priv.areaKey || areaName)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '') || 'privado';
        const isUrl = Boolean(priv.emailOrWeb && /^https?:\/\//i.test(priv.emailOrWeb.trim()));
        pushItem({
            id: `p_${priv.contactId}`,
            scope: 'TENANT_PRIVATE',
            areaName,
            areaKey,
            contactLabel: priv.contactLabel ?? null,
            phone: priv.phone ?? null,
            roleEmail: !isUrl ? priv.emailOrWeb ?? null : null,
            portalUrl: isUrl ? priv.emailOrWeb ?? null : null,
            cityRegion: priv.cityRegion || null,
            notes: priv.notes ?? null,
            privateContact: priv,
        });
    }

    const groups = Array.from(groupsMap.values());
    groups.sort((a, b) => a.areaName.localeCompare(b.areaName, 'es'));
    return groups;
}

export function buildManufacturersMap(list: ManufacturerRecord[]): Map<string, ManufacturerRecord> {
    const map = new Map<string, ManufacturerRecord>();
    for (const item of list) {
        map.set(item.manufacturerKey, item);
    }
    return map;
}

export const INPUT_BOX_CLS =
    'w-full min-h-[42px] px-fib-13 py-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none focus:border-[#C68346]';
export const MONO_INPUT_BOX_CLS = `${INPUT_BOX_CLS} font-mono tabular-nums`;
export const INPUT_LINE_CLS =
    'w-full min-h-[38px] py-fib-8 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none shadow-none outline-none focus:border-[#C68346]';
export const MICRO_LABEL_CLS =
    'block text-microcopy font-mono font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] mb-[6px]';
export const FLAT_ICON_BTN_CLS =
    'min-w-[40px] min-h-[40px] bg-transparent border-0 outline-none p-1.5 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none inline-flex items-center justify-center shrink-0';
export const BTN_COPPER_CLS =
    'min-h-[42px] px-fib-21 py-fib-8 bg-[#C68346] text-[#FFFFFF] text-data-dense font-mono font-bold uppercase tracking-[0.04em] rounded-none shadow-none cursor-pointer disabled:opacity-40 transition-colors whitespace-nowrap inline-flex items-center justify-center';
export const BTN_OUTLINE_CLS =
    'min-h-[42px] px-fib-21 py-fib-8 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] text-data-dense font-mono font-bold uppercase tracking-[0.04em] rounded-none shadow-none cursor-pointer hover:border-[#C68346] transition-colors whitespace-nowrap inline-flex items-center justify-center';
export const PILLAR_CALLOUT_CLS =
    'pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-none absolute left-0 top-full mt-1 z-50 px-fib-8 py-1 bg-[#0F172A] dark:bg-[#F3F4F6] text-[#FFFFFF] dark:text-[#0F172A] font-mono text-microcopy uppercase tracking-[0.04em] whitespace-nowrap rounded-none shadow-none border border-[#C68346]';
