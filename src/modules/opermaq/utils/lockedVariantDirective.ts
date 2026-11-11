import type {
    AssetConfigurationProfile,
    AssetPhysicalTraits,
    CanonicalSpecSlot,
    OpticalIdentificationSummary,
    TransmissionCategory,
} from '../types/vault.types';

function stripAccentsLower(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function formatTransmissionCategoryLabelEs(category: TransmissionCategory | null | undefined): string | null {
    switch (category) {
        case 'AUTOMATIC_PLANETARY_CONVERTER':
            return 'Automática (Convertidor de par)';
        case 'AUTOMATED_MANUAL_AMT':
            return 'Automatizada (AMT)';
        case 'MANUAL_UNSYNCHRONIZED_FULLER':
            return 'Manual no sincronizada (Eaton Fuller)';
        case 'MANUAL_SYNCHRONIZED':
            return 'Manual sincronizada';
        case 'POWERSHIFT':
            return 'Servotransmisión (Powershift)';
        case 'HYDROSTATIC':
            return 'Hidrostática';
        case 'ELECTRIC_DRIVE':
            return 'Tracción eléctrica AC/DC';
        case 'DIRECT_MECHANICAL':
            return 'Acople mecánico directo';
        default:
            return null;
    }
}

export function detectTransmissionFromCorpus(rawCorpus: string): {
    category: TransmissionCategory | null;
    modelSpec: string | null;
} {
    const cleanOrig = String(rawCorpus || '').replace(/\s+/g, ' ').trim();
    const norm = stripAccentsLower(cleanOrig);
    if (!norm) {
        return { category: null, modelSpec: null };
    }

    // 1. Allison / Convertidor planetario automático
    const allisonMatch = cleanOrig.match(
        /\b(allison\s*(?:\d{4}\s*(?:rds|evs|hs|sp|mh|ors)?|serie\s*\d{4}|rugged\s+duty)?(?:\s*(?:automatic[ao]?|\d+\s*vel(?:ocidades)?))?)/i
    );
    if (allisonMatch) {
        return {
            category: 'AUTOMATIC_PLANETARY_CONVERTER',
            modelSpec: `Automática ${allisonMatch[1].trim()}`.replace(/\s+/g, ' ').slice(0, 120),
        };
    }

    // 2. Cajas automatizadas AMT (mDRIVE, I-Shift, Opticruise, TraXon, UltraShift, Endurant, DT12, PowerShift 3 vial)
    const amtModelMatch = cleanOrig.match(
        /\b((?:mack\s+)?m-?drive(?:\s+hd|\s+tmd\w+)?|(?:volvo\s+)?i-?shift(?:\s+crawler|\s+at\w+)?|(?:scania\s+)?opticruise(?:\s+grs\w+)?|(?:zf\s+)?(?:traxon|as[- ]?tronic)|(?:eaton\s+)?(?:ultrashift|endurant)|detroit\s+dt12|mercedes\s+powershift\s*3|g\s*330-12|g\s*281-12)\b/i
    );
    if (amtModelMatch) {
        return {
            category: 'AUTOMATED_MANUAL_AMT',
            modelSpec: `Automatizada AMT (${amtModelMatch[1].trim()})`.slice(0, 120),
        };
    }

    // 3. Manuales pesadas no sincronizadas Eaton Fuller / Roadranger
    const fullerMatch = cleanOrig.match(
        /\b((?:eaton\s+)?fuller(?:\s+[a-z]{2,5}-?\d{4,5}[a-z]?)?(?:\s*\d{1,2}\s*vel(?:ocidades)?)?|roadranger(?:\s*\d{1,2}\s*vel)?|rtlo-?\d{4,5}[a-z]?)\b/i
    );
    if (fullerMatch) {
        return {
            category: 'MANUAL_UNSYNCHRONIZED_FULLER',
            modelSpec: `Manual Eaton Fuller (${fullerMatch[1].trim()})`.slice(0, 120),
        };
    }

    // 4. Hidrostática (minicargadores, rodillos, bulldozers hidrostáticos, pavimentadoras)
    if (/\b(hidrostatic[ao]|hydrostatic|transmision\s+hidrostatica)\b/.test(norm)) {
        const speedsMatch = cleanOrig.match(/\bhidrost[aá]tica(?:\s+de)?\s+\d\s*(?:vel(?:ocidades)?|marchas|rangos)\b/i);
        return {
            category: 'HYDROSTATIC',
            modelSpec: speedsMatch ? speedsMatch[0].trim() : 'Hidrostática',
        };
    }

    // 5. Servotransmisión Powershift (maquinaria pesada fuera de ruta)
    if (/\b(powershift|power\s+shift|servotransmision|torqflow|autoshift\s+planetari)\b/.test(norm)) {
        const psMatch = cleanOrig.match(
            /\b((?:planetary\s+)?powershift(?:\s+\d+f\s*\/?\s*\d+r)?|servotransmisi[oó]n(?:\s+planetaria)?|torqflow)\b/i
        );
        return {
            category: 'POWERSHIFT',
            modelSpec: psMatch ? psMatch[1].trim() : 'Servotransmisión Powershift',
        };
    }

    // 6. Tracción eléctrica AC / DC (CAEX eléctricos, palas de cable, BEV)
    if (
        /\b(traccion\s+electrica\s+(?:ac|dc)|ac\s+drive|motores?\s+de\s+rueda\s+ac|propulsion\s+electrica\s+directa)\b/.test(
            norm
        )
    ) {
        return {
            category: 'ELECTRIC_DRIVE',
            modelSpec: 'Tracción eléctrica AC',
        };
    }

    // 7. Automatizada genérica (AMT)
    if (/\b(caja\s+automatizada|transmision\s+automatizada|manual\s+automatizada|\bamt\b)\b/.test(norm)) {
        return {
            category: 'AUTOMATED_MANUAL_AMT',
            modelSpec: 'Automatizada (AMT)',
        };
    }

    // 8. Automática genérica (cuidando falsos positivos como "engrase automático" o "climatizador automático")
    if (
        /\b((?:caja|transmision|cambio|version)\s+automatic[ao]|automatic\s+transmission|convertidor\s+de\s+par|automatic[ao]\s+(?:de\s+)?\d{1,2}\s*(?:vel|marchas|at))\b/.test(
            norm
        ) ||
        (/\bautomatic[ao]\b/.test(norm) &&
            !/\b(engrase\s+automatico|lubricacion\s+automatica|freno\s+automatico|apagado\s+automatico|nivelacion\s+automatica|ralenti\s+automatico|climatizador\s+automatico)\b/.test(
                norm
            ))
    ) {
        const autoSpeedMatch = cleanOrig.match(
            /\b(?:caja\s+|transmisi[oó]n\s+)?autom[aá]tica(?:\s+(?:de\s+)?\d{1,2}\s*(?:vel(?:ocidades)?|marchas|at))?\b/i
        );
        return {
            category: 'AUTOMATIC_PLANETARY_CONVERTER',
            modelSpec: autoSpeedMatch ? autoSpeedMatch[0].trim() : 'Automática (Convertidor de par)',
        };
    }

    // 9. Manual sincronizada / mecánica
    if (
        /\b((?:caja|transmision|cambio)\s+(?:manual|mecanic[ao])|manual\s+(?:sincronizada|(?:de\s+)?\d{1,2}\s*(?:vel|marchas|mt))|maxitorque)\b/.test(
            norm
        )
    ) {
        const manMatch = cleanOrig.match(
            /\b(?:caja\s+|transmisi[oó]n\s+)?(?:manual|mec[aá]nica)(?:\s+sincronizada)?(?:\s+(?:de\s+)?\d{1,2}\s*(?:vel(?:ocidades)?|marchas))?\b/i
        );
        return {
            category: 'MANUAL_SYNCHRONIZED',
            modelSpec: manMatch ? manMatch[0].trim() : 'Manual sincronizada',
        };
    }

    return { category: null, modelSpec: null };
}

export function detectAxleOrUndercarriageFromCorpus(
    rawCorpus: string,
    mobility?: AssetPhysicalTraits['mobility']
): {
    axleOrUndercarriage: string | null;
    tireOrTrackCount: number | null;
} {
    const cleanOrig = String(rawCorpus || '').replace(/\s+/g, ' ').trim();
    const norm = stripAccentsLower(cleanOrig);
    if (!norm) {
        return { axleOrUndercarriage: null, tireOrTrackCount: null };
    }

    const axleMatch = norm.match(/\b(10x6|10x4|8x8|8x6|8x4|6x6|6x4|6x2|4x4|4x2|awd|fwd|rwd)\b/i);
    if (axleMatch) {
        const code = axleMatch[1].toLowerCase() === 'awd' || axleMatch[1].toLowerCase() === 'fwd' || axleMatch[1].toLowerCase() === 'rwd'
            ? axleMatch[1].toUpperCase()
            : axleMatch[1].toLowerCase();

        const explicitTireMatch = norm.match(/\b(\d{1,2})\s*neumaticos\b/);
        const explicitTires = explicitTireMatch ? Number(explicitTireMatch[1]) : null;
        const isHeavyTruck = /\b(camion|tracto|tolva|volquete|aljibe|mixer|betonera|pluma|granite|gu813|gu812|fm\s*x|kerax|arocs|actros|t800|t880|workstar|paystar|hx\d|constellation|new\s+tgs|trakker)\b/.test(
            norm
        );

        if (code === '8x4') {
            return {
                axleOrUndercarriage: '8x4 (4 ejes: doble direccional delantero + tándem motriz trasero)',
                tireOrTrackCount: explicitTires ?? (isHeavyTruck ? 12 : null),
            };
        }
        if (code === '8x6' || code === '8x8') {
            return {
                axleOrUndercarriage: `${code} (4 ejes de servicio severo)`,
                tireOrTrackCount: explicitTires ?? (isHeavyTruck ? 12 : null),
            };
        }
        if (code === '6x4') {
            return {
                axleOrUndercarriage: '6x4 (3 ejes: direccional delantero simple + tándem motriz trasero)',
                tireOrTrackCount: explicitTires ?? (isHeavyTruck ? 10 : null),
            };
        }
        if (code === '6x6' || code === '6x2') {
            return {
                axleOrUndercarriage: code,
                tireOrTrackCount: explicitTires ?? (isHeavyTruck ? 10 : null),
            };
        }
        return {
            axleOrUndercarriage: code,
            tireOrTrackCount: explicitTires,
        };
    }

    if (mobility === 'SELF_PROPELLED_TRACKED' || /\b(orugas?|cadenas|crawler|compact\s+track|lgp)\b/.test(norm)) {
        if (/\blgp\b/.test(norm)) {
            return { axleOrUndercarriage: 'Orugas LGP (Baja presión sobre suelo)', tireOrTrackCount: 2 };
        }
        if (/\borugas?\s+(?:de\s+)?goma|compact\s+track\b/.test(norm)) {
            return { axleOrUndercarriage: 'Orugas de goma', tireOrTrackCount: 2 };
        }
        if (/\b(tren\s+largo|\blc\b)\b/.test(norm)) {
            return { axleOrUndercarriage: 'Orugas de acero LC (Tren largo)', tireOrTrackCount: 2 };
        }
        if (mobility === 'SELF_PROPELLED_TRACKED') {
            return { axleOrUndercarriage: 'Tren de rodaje sobre orugas', tireOrTrackCount: 2 };
        }
    }

    return { axleOrUndercarriage: null, tireOrTrackCount: null };
}

export function detectWorkBodyOrImplementFromCorpus(rawCorpus: string): string | null {
    const cleanOrig = String(rawCorpus || '').replace(/\s+/g, ' ').trim();
    const norm = stripAccentsLower(cleanOrig);
    if (!norm) return null;

    // Tolva / batea con volumen explícito (ej. Tolva 20 m³ / 20m3)
    const tolvaVolMatch = cleanOrig.match(
        /\b(?:tolva(?:\s+(?:minera|roquera|semirroquera|calefaccionada|harnera))?|volquete|batea)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m3|m³)\b/i
    );
    if (tolvaVolMatch) {
        return `Tolva ${tolvaVolMatch[1].replace(',', '.')} m³`;
    }

    const volBeforeTolvaMatch = cleanOrig.match(
        /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m3|m³)\b[^.;,\n]{0,28}\b(tolva|volquete|batea)\b/i
    );
    if (volBeforeTolvaMatch) {
        return `Tolva ${volBeforeTolvaMatch[1].replace(',', '.')} m³`;
    }

    // Aljibe / cisterna con volumen en L o m³
    const aljibeMatch = cleanOrig.match(
        /\b(?:aljibe|cisterna|estanque\s+agua)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d{3})*|\d{1,2}(?:[.,]\d)?)\s*(l|litros|m3|m³)\b/i
    );
    if (aljibeMatch) {
        return `Estanque aljibe ${aljibeMatch[1]} ${aljibeMatch[2].toUpperCase() === 'LITROS' ? 'L' : aljibeMatch[2]}`;
    }

    // Mixer / hormigonera
    const mixerMatch = cleanOrig.match(
        /\b(?:mixer|betonera|hormigonera)\s*(?:de\s*)?(\d{1,2}(?:[.,]\d)?)\s*(?:m3|m³)\b/i
    );
    if (mixerMatch) {
        return `Trompo mixer ${mixerMatch[1].replace(',', '.')} m³`;
    }

    // Pluma articulada (t·m)
    const craneMatch = cleanOrig.match(
        /\b(?:pluma|grua\s+articulada)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d)?)\s*(?:t[·.]?m|tm|kn[·.]?m)\b/i
    );
    if (craneMatch) {
        return `Grúa articulada ${craneMatch[1].replace(',', '.')} t·m`;
    }

    // Hidráulica XHP / High Flow (ej. CAT 272D XHP / 272D2 XHP)
    if (/\bxhp\b|extreme\s+high\s+flow|alto\s+caudal\s+xhp/.test(norm)) {
        return 'Hidráulica auxiliar de alto caudal XHP';
    }
    if (/\bhigh[- ]?flow\b|alto\s+caudal/.test(norm)) {
        return 'Hidráulica auxiliar High-Flow';
    }

    if (/\bcamion\s+tolva\b|\btolva\s+(?:minera|roquera)\b/.test(norm)) {
        const capM3 = cleanOrig.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:m3|m³)\b/i);
        return capM3 ? `Tolva ${capM3[1].replace(',', '.')} m³` : 'Carrocería tolva de volteo';
    }

    if (/\btractocamion\b|\bquinta\s+rueda\b/.test(norm)) {
        return 'Quinta rueda de arrastre (Tractocamión)';
    }

    return null;
}

export function detectEmissionOrGridSpecFromCorpus(rawCorpus: string): string | null {
    const cleanOrig = String(rawCorpus || '').replace(/\s+/g, ' ').trim();
    if (!cleanOrig) return null;

    const parts: string[] = [];
    const tierMatch = cleanOrig.match(
        /\b(EPA\s*Tier\s*\d\s*(?:Final|Interim|i|f)?(?:\s*\/\s*EU\s*Stage\s*[IVX]+[AB]?)?|Tier\s*[234]\s*(?:Final|Interim|i|f|A|B)?|EU\s*Stage\s*[IVX]+[AB]?|Euro\s*(?:III|IV|V|VI|[3456]))\b/i
    );
    if (tierMatch) {
        parts.push(tierMatch[1].replace(/\s+/g, ' ').trim());
    }
    if (/\bdpf\b/i.test(cleanOrig) && !parts.some((p) => /dpf/i.test(p))) {
        parts.push('DPF');
    }
    if (/\b(scr|adblue|\bdef\b)\b/i.test(cleanOrig) && !parts.some((p) => /scr|def/i.test(p))) {
        parts.push('SCR/DEF');
    }
    const hzMatch = cleanOrig.match(/\b(50\s*Hz|60\s*Hz|50\s*\/\s*60\s*Hz)\b/i);
    if (hzMatch) {
        parts.push(hzMatch[1].replace(/\s+/g, ' ').trim());
    }

    return parts.length > 0 ? parts.join(' · ').slice(0, 130) : null;
}

export function inferAssetConfigurationProfile(params: {
    make_oficial?: string | null;
    model_oficial?: string | null;
    tipo_equipo?: string | null;
    categoria_equipo?: string | null;
    version?: string | null;
    versions?: string[] | null;
    physical_traits?: AssetPhysicalTraits | null;
    canonical_specs?: CanonicalSpecSlot[] | null;
    caracteristicas_principales?: string[] | null;
    ambiente_operativo?: string[] | null;
    contexto_operativo?: string[] | null;
    chassis_versions?: string[] | null;
    existing_profile?: Partial<AssetConfigurationProfile> | null;
    optical_summary?: OpticalIdentificationSummary | null;
    extra_query_context?: string | null;
    extra_evidence_text?: string | null;
    identification_source?: AssetConfigurationProfile['identification_source'];
}): AssetConfigurationProfile {
    const prev = params.existing_profile || {};
    const slots = Array.isArray(params.canonical_specs) ? params.canonical_specs : [];
    const slotCorpus = slots
        .filter((s) => s && s.value_si && !s.value_si.startsWith('['))
        .map((s) => `${s.label_es}: ${s.value_si}`)
        .join(' | ');

    const transmissionSlot = slots.find(
        (s) =>
            s &&
            (s.axis_key === 'transmision_caja' || /\b(transmisi[oó]n|caja\s+de\s+cambios)\b/i.test(s.label_es)) &&
            s.value_si &&
            !s.value_si.startsWith('[')
    );
    const axleSlot = slots.find(
        (s) =>
            s &&
            (s.axis_key === 'traccion_ejes' ||
                s.axis_key === 'traccion' ||
                s.axis_key === 'configuracion_rodaje' ||
                /\b(configuraci[oó]n\s+ejes|tracci[oó]n|tren\s+de\s+rodaje)\b/i.test(s.label_es)) &&
            s.value_si &&
            !s.value_si.startsWith('[')
    );
    const tolvaSlot = slots.find(
        (s) =>
            s &&
            (s.axis_key === 'capacidad_tolva' ||
                s.axis_key === 'organo_trabajo_capacidad' ||
                /\b(capacidad\s+tolva|tolva\s+colmada)\b/i.test(s.label_es)) &&
            s.value_si &&
            !s.value_si.startsWith('[')
    );

    const primaryCorpus = [
        params.make_oficial || '',
        params.model_oficial || '',
        params.version && params.version !== 'ESTÁNDAR' ? params.version : '',
        params.tipo_equipo || '',
        params.optical_summary?.observed_axle_or_undercarriage || '',
        params.optical_summary?.observed_transmission || '',
        params.optical_summary?.observed_work_body_or_implement || '',
        params.optical_summary?.observed_engine_or_rating || '',
        params.optical_summary?.observed_emission_or_grid || '',
        transmissionSlot?.value_si || '',
        axleSlot?.value_si || '',
        tolvaSlot ? `Tolva ${tolvaSlot.value_si}` : '',
        slotCorpus,
        ...(Array.isArray(params.caracteristicas_principales) ? params.caracteristicas_principales : []),
        ...(Array.isArray(params.chassis_versions) ? params.chassis_versions : []),
        ...(Array.isArray(params.versions) ? params.versions : []),
        params.extra_query_context || '',
        params.extra_evidence_text || '',
    ]
        .filter(Boolean)
        .join(' · ');

    const detectedAxle = detectAxleOrUndercarriageFromCorpus(
        `${axleSlot?.value_si || ''} ${params.optical_summary?.observed_axle_or_undercarriage || ''} ${primaryCorpus}`,
        params.physical_traits?.mobility
    );
    const detectedTx = detectTransmissionFromCorpus(
        `${transmissionSlot?.value_si || ''} ${params.optical_summary?.observed_transmission || ''} ${primaryCorpus}`
    );
    const detectedBody =
        params.optical_summary?.observed_work_body_or_implement ||
        (tolvaSlot?.value_si ? `Tolva ${tolvaSlot.value_si}` : null) ||
        detectWorkBodyOrImplementFromCorpus(primaryCorpus);
    const detectedEmission =
        params.optical_summary?.observed_emission_or_grid ||
        detectEmissionOrGridSpecFromCorpus(primaryCorpus);

    const engineFeature = (params.caracteristicas_principales || []).find((f) =>
        /\b(motor\s+[a-z0-9]|cummins|mack\s+mp\d|cat\s+c\d|detroit\s+dd\d|volvo\s+d\d{2}|scania\s+dc\d{2}|perkins|deutz|isuzu|kubota|yanmar)\b/i.test(
            String(f || '')
        )
    );
    const auxBrakeFeature = (params.caracteristicas_principales || []).find((f) =>
        /\b(powerleash|jake\s+brake|freno\s+motor|retardador|retarder|intarder|veb\+?)\b/i.test(String(f || ''))
    );

    const source: AssetConfigurationProfile['identification_source'] =
        params.identification_source ||
        (params.optical_summary ? 'MULTIMODAL_PLATE_AND_PHOTO' : prev.identification_source || 'GROUNDED_OEM_SPEC');

    return {
        axle_or_undercarriage_config:
            prev.axle_or_undercarriage_config || detectedAxle.axleOrUndercarriage || axleSlot?.value_si || null,
        tire_or_track_count: prev.tire_or_track_count ?? detectedAxle.tireOrTrackCount ?? null,
        transmission_category: prev.transmission_category || detectedTx.category || null,
        transmission_model_spec:
            prev.transmission_model_spec ||
            detectedTx.modelSpec ||
            transmissionSlot?.value_si ||
            params.optical_summary?.observed_transmission ||
            null,
        work_body_or_implement: prev.work_body_or_implement || detectedBody || null,
        engine_or_prime_mover_spec:
            prev.engine_or_prime_mover_spec ||
            params.optical_summary?.observed_engine_or_rating ||
            (engineFeature ? String(engineFeature).slice(0, 150) : null),
        auxiliary_braking_spec:
            prev.auxiliary_braking_spec || (auxBrakeFeature ? String(auxBrakeFeature).slice(0, 130) : null),
        factory_emission_or_grid_spec: prev.factory_emission_or_grid_spec || detectedEmission || null,
        identification_source: source,
    };
}

/**
 * Construye el mandato determinista de configuración mecánica bloqueada (`LOCKED_CONFIGURATION_SIGNATURE`)
 * para inyectar en `ItemizerService` e `ItemHunterService` a través de los 5 pilares (`01..05`).
 */
export function buildLockedVariantDirective(assetData: Record<string, any> | null | undefined): string {
    if (!assetData || typeof assetData !== 'object') return '';

    const profile = inferAssetConfigurationProfile({
        make_oficial: assetData.make || assetData.make_oficial,
        model_oficial: assetData.model || assetData.model_oficial || assetData.make_model,
        tipo_equipo: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        version: assetData.version,
        physical_traits: assetData.physical_traits,
        canonical_specs: assetData.canonical_specs,
        caracteristicas_principales: assetData.caracteristicas_principales,
        chassis_versions: assetData.chassis_versions,
        existing_profile: assetData.configuration_profile,
    });

    const hasAnyTrait = Boolean(
        profile.axle_or_undercarriage_config ||
            profile.transmission_category ||
            profile.transmission_model_spec ||
            profile.work_body_or_implement ||
            profile.factory_emission_or_grid_spec
    );
    if (!hasAnyTrait) return '';

    const lines: string[] = [
        '=== PERFIL DE CONFIGURACIÓN MECÁNICA BLOQUEADA (MANDATO ESTRICTO DE VARIANTE) ===',
        'Este activo corresponde a una variante específica de fábrica. Queda ESTRICTAMENTE PROHIBIDO mezclar especificaciones, procedimientos, lubricantes o riesgos de otras configuraciones hermanas incompatibles:',
    ];

    if (profile.axle_or_undercarriage_config) {
        const tireNote = profile.tire_or_track_count
            ? ` | Dotación nominal de rodado: ${profile.tire_or_track_count} unidades`
            : '';
        lines.push(`- RODADO / EJES BLOQUEADOS: ${profile.axle_or_undercarriage_config}${tireNote}.`);
        if (/\b8x4\b/i.test(profile.axle_or_undercarriage_config)) {
            lines.push(
                '  * REGLA 8x4 OBLIGATORIA: Considerar SIEMPRE 4 ejes (2 ejes direccionales delanteros sincronizados + 2 ejes motrices en tándem trasero con divisor inter-ejes) y 12 neumáticos. PROHIBIDO redactar como chasis 6x4 de 3 ejes o 10 neumáticos.'
            );
        } else if (/\b6x4\b/i.test(profile.axle_or_undercarriage_config)) {
            lines.push(
                '  * REGLA 6x4 OBLIGATORIA: Considerar 3 ejes (1 eje direccional delantero + tándem trasero) y 10 neumáticos. PROHIBIDO mezclar tablas de chasis 8x4.'
            );
        }
    }

    if (profile.transmission_category || profile.transmission_model_spec) {
        const txLabel =
            profile.transmission_model_spec ||
            formatTransmissionCategoryLabelEs(profile.transmission_category) ||
            'Declarada';
        lines.push(`- TRANSMISIÓN / CAJA BLOQUEADA: ${txLabel}.`);

        if (profile.transmission_category === 'AUTOMATIC_PLANETARY_CONVERTER') {
            lines.push(
                '  * REGLA CAJA AUTOMÁTICA: Exigir convertidor de par, selector de marchas por botonera/palanca automática, fluido ATF sintético homologado, filtros de transmisión automática, gestión térmica de enfriador ATF/retardador y enclavamiento electrónico de Toma de Fuerza (PTO). PROHIBIDO incluir pedal de embrague, reglaje de embrague, doble embrague o patrón manual Eaton Fuller.'
            );
        } else if (profile.transmission_category === 'AUTOMATED_MANUAL_AMT') {
            lines.push(
                '  * REGLA CAJA AUTOMATIZADA (AMT): Exigir transmisión mecánica automatizada (ej. mDRIVE / I-Shift / Opticruise / TraXon), actuadores neumáticos/electrónicos de embrague y selección, modos Economy/Performance/Maniobra y suministro de aire limpio al módulo de caja. PROHIBIDO describir pedal de embrague o patrón Roadranger manual.'
            );
        } else if (profile.transmission_category === 'MANUAL_UNSYNCHRONIZED_FULLER') {
            lines.push(
                '  * REGLA CAJA MANUAL NO SINCRONIZADA (EATON FULLER): Exigir operación de rango y splitter (Roadranger), freno de embrague (clutch brake), técnica de revoluciones/doble embrague, inspección de juego libre de pedal de embrague y lubricante de transmisión manual pesada. PROHIBIDO describir convertidor de par o fluido ATF de caja automática.'
            );
        } else if (profile.transmission_category === 'MANUAL_SYNCHRONIZED') {
            lines.push(
                '  * REGLA CAJA MANUAL SINCRONIZADA: Exigir operación de embrague y marchas sincronizadas, descartando convertidor de par automático.'
            );
        } else if (profile.transmission_category === 'HYDROSTATIC') {
            lines.push(
                '  * REGLA TRANSMISIÓN HIDROSTÁTICA: Exigir bombas/motores hidrostáticos de desplazamiento variable, circuito cerrado de carga, filtros hidrostáticos de alta presión y control proporcional por joysticks/pedales.'
            );
        } else if (profile.transmission_category === 'POWERSHIFT') {
            lines.push(
                '  * REGLA SERVOTRANSMISIÓN POWERSHIFT: Exigir convertidor de par, paquetes de embragues hidráulicos modulados electrónicamente y aceite Powershift/TO-4 según especificación OEM.'
            );
        }
    }

    if (profile.work_body_or_implement) {
        lines.push(`- ÓRGANO DE TRABAJO / CARROCERÍA BLOQUEADA: ${profile.work_body_or_implement}.`);
        if (/\btolva\b/i.test(profile.work_body_or_implement)) {
            lines.push(
                '  * REGLA CARROCERÍA TOLVA: Incluir obligatoriamente acoplamiento PTO, bomba y cilindro telescópico de levante, seguros de portalón trasero, estabilidad lateral ante carga adherida en volteo y traba/puntal mecánico positivo de tolva alzada (LOTO). PROHIBIDO describir quinta rueda de tractocamión o tambor mixer.'
            );
        }
    }

    if (profile.engine_or_prime_mover_spec) {
        lines.push(`- MOTORIZACIÓN / ACCIONAMIENTO BASE: ${profile.engine_or_prime_mover_spec}.`);
    }

    if (profile.auxiliary_braking_spec) {
        lines.push(`- FRENADO AUXILIAR: ${profile.auxiliary_braking_spec}.`);
    }

    if (profile.factory_emission_or_grid_spec) {
        lines.push(
            `- CONFIGURACIÓN DE EMISIONES / RED ELÉCTRICA DE FÁBRICA: ${profile.factory_emission_or_grid_spec} (Documentar exclusivamente los sistemas físicos de postratamiento o alimentación realmente instalados de fábrica en esta unidad — incluso en importación directa — omitiendo por completo cualquier subsistema que no posea, sin agregar filas "No aplica" ni menciones "Sin SCR/AdBlue").`
        );
    }

    return lines.join('\n');
}

