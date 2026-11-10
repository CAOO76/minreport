import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyDeterministicProposalFallback } from '../src/modules/opermaq/services/AiAssistService';
import {
    computePillarContentDigestSha256,
    computePillarStructureDigestSha256,
    computeVaultMerkleRootSha256,
} from '../src/modules/opermaq/services/ItemizerService';
import { getPillarEditGovernancePrompt } from '../src/modules/opermaq/services/pillarAgents';
import { applySurgicalFragmentSplice } from '../src/modules/opermaq/services/vaultChatService';
import { deriveEnergyConsumptionProfile } from '../src/modules/opermaq/utils/canonicalArchetypeSpecs';
import type { PillarItem, ProposedUpdate } from '../src/modules/opermaq/types/vault.types';

async function main() {
    console.log('=== VERIFICACIÓN ETAPAS 1 Y 2: EDITORES IA POR PILAR, CADENA INDIRECTA Y NAVEGACIÓN ===\n');

    // 1. Invariantes de gobernanza de edición para los 5 pilares
    const gov01 = getPillarEditGovernancePrompt('ficha_tecnica');
    const gov02 = getPillarEditGovernancePrompt('manual_operaciones');
    const gov03 = getPillarEditGovernancePrompt('pauta_mantencion');
    const gov04 = getPillarEditGovernancePrompt('matriz_riesgos');
    const gov05 = getPillarEditGovernancePrompt('checklist_pre_op');

    assert.ok(gov01.includes('Parámetro / Especificación'), 'Pilar 01 debe exigir tabla de 3 columnas OEM');
    assert.ok(gov02.includes('Pilar 01'), 'Pilar 02 debe exigir coherencia con Pilar 01');
    assert.ok(gov03.includes('Código de parte OEM no declarado en fuente'), 'Pilar 03 debe prohibir códigos inventados');
    assert.ok(gov04.includes('TABLA 1') && gov04.includes('TABLA 2'), 'Pilar 04 debe exigir las 2 tablas IPER y LOTO');
    assert.ok(
        gov05.includes('CUMPLE | NO CUMPLE | OBSERVACIONES'),
        'Pilar 05 debe exigir la tabla binaria de 6 columnas'
    );
    console.log('  [OK] 1. Invariantes de edición de los 5 Agentes Especialistas por Pilar verificadas.');

    // 2. Reemplazo Quirúrgico Determinista de Fragmentos (`applySurgicalFragmentSplice`)
    const originalDoc = [
        '### Hidráulica Principal y Auxiliar XHP',
        '| Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |',
        '| :--- | :--- | :--- |',
        '| Caudal hidráulico estándar | 87 L/min (23 gpm) | @ 2.500 rpm |',
        '| Caudal hidráulico XHP | 125 L/min (33 gpm) | @ 230 bar |',
        '| Capacidad tanque hidráulico | 39 L (10,3 gal) | Nivel mirilla |',
    ].join('\n');

    const selectedFrag = '| Caudal hidráulico XHP | 125 L/min (33 gpm) | @ 230 bar |';
    const replacementFrag = '| Caudal hidráulico XHP | 150 L/min (40 gpm) | @ 280 bar (4.061 psi) |';

    const splicedDoc = applySurgicalFragmentSplice({
        currentContent: originalDoc,
        selectedFragment: selectedFrag,
        fragmentReplacement: replacementFrag,
    });

    assert.ok(splicedDoc, 'El reemplazo quirúrgico debe devolver documento válido');
    assert.ok(
        splicedDoc.includes('150 L/min (40 gpm)') && splicedDoc.includes('280 bar (4.061 psi)'),
        'El fragmento seleccionado debe actualizarse con el nuevo valor'
    );
    assert.ok(
        splicedDoc.includes('87 L/min (23 gpm)') && splicedDoc.includes('39 L (10,3 gal)'),
        'El resto de las filas fuera del fragmento seleccionado debe permanecer 100% intacto'
    );
    assert.ok(!splicedDoc.includes('125 L/min'), 'El valor antiguo del fragmento reemplazado no debe persistir');
    console.log('  [OK] 2. Reemplazo quirúrgico determinista de fragmentos (`applySurgicalFragmentSplice`) verificado.');

    // 3. Criptografía de Contenido (`content_digest_sha256`) y Raíz de Merkle (`vault_merkle_root_sha256`)
    const baseItems: PillarItem[] = [
        {
            item_id: 'ficha_motor_1',
            order: 1,
            title: 'Planta Motriz y Emisiones',
            section: 'PLANTA MOTRIZ',
            rationale: 'Motor diésel',
            priority: 'CRÍTICO',
            content_status: 'COMPLETADO',
            content: '| Potencia neta | 79 kW (106 HP) | SAE J1349 |',
            created_at: new Date().toISOString(),
            estado_aprobacion: 'GENERADO_IA',
            is_human_locked: false,
        },
    ];

    const editedItems: PillarItem[] = [
        {
            ...baseItems[0],
            content: '| Potencia neta | 82 kW (110 HP) | SAE J1349 |',
        },
    ];

    const lockedItems: PillarItem[] = [
        {
            ...editedItems[0],
            estado_aprobacion: 'APROBADO_HUMANO',
            is_human_locked: true,
        },
    ];

    const struct1 = computePillarStructureDigestSha256(baseItems);
    const struct2 = computePillarStructureDigestSha256(editedItems);
    assert.equal(struct1, struct2, 'structure_digest_sha256 se mantiene estable si no cambian títulos/secciones');

    const contentDigest1 = computePillarContentDigestSha256(baseItems);
    const contentDigest2 = computePillarContentDigestSha256(editedItems);
    const contentDigest3 = computePillarContentDigestSha256(lockedItems);

    assert.notEqual(contentDigest1, contentDigest2, 'content_digest_sha256 debe cambiar al editar el contenido del ítem');
    assert.notEqual(contentDigest2, contentDigest3, 'content_digest_sha256 debe cambiar al aprobar/bloquear un ítem HITL');

    const merkle1 = computeVaultMerkleRootSha256({
        ficha_tecnica: {
            items: baseItems,
            structure_digest_sha256: struct1,
            content_digest_sha256: contentDigest1,
        },
    });
    const merkle2 = computeVaultMerkleRootSha256({
        ficha_tecnica: {
            items: editedItems,
            structure_digest_sha256: struct2,
            content_digest_sha256: contentDigest2,
        },
    });
    assert.notEqual(
        merkle1,
        merkle2,
        'vault_merkle_root_sha256 debe reflejar cualquier edición en el contenido de los pilares'
    );
    console.log('  [OK] 3. Cadena criptográfica de contenido (`content_digest_sha256` + `vault_merkle_root_sha256`) verificada.');

    // 4. Propagación de ediciones en Pilar 01 hacia `deriveEnergyConsumptionProfile` (Prioridad de Markdown editado)
    const staleSlots = [
        {
            axis_key: 'fuente_energia',
            label_es: 'Fuente de energía',
            value_si: 'Diésel',
            unit_si: '',
            mandatory: true,
            is_differentiator: true,
            value_kind: 'CLOSED_ENUM' as const,
        },
        {
            axis_key: 'consumo_energetico_nominal',
            label_es: 'Consumo energético nominal',
            value_si: '14,0 L/h',
            unit_si: 'L/h',
            mandatory: true,
            is_differentiator: true,
            value_kind: 'PHYSICAL_MAGNITUDE' as const,
        },
        {
            axis_key: 'capacidad_energetica_autonomia',
            label_es: 'Capacidad estanque',
            value_si: '90 L',
            unit_si: 'L',
            mandatory: true,
            is_differentiator: false,
            value_kind: 'PHYSICAL_MAGNITUDE' as const,
        },
    ];

    const editedFichaMarkdown = [
        '### Consumos de Combustible, Energía y Autonomía Operativa',
        '| Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |',
        '| :--- | :--- | :--- |',
        '| Consumo horario nominal en carga media | 18,5 L/h | Factor de carga 55% |',
        '| Capacidad de estanque de combustible | 105 L | Capacidad total utilizable |',
    ].join('\n');

    const updatedProfile = deriveEnergyConsumptionProfile({
        tipo_equipo: 'MINICARGADOR SOBRE NEUMÁTICOS',
        categoria_equipo: 'CARGUÍO COMPACTO Y MOVIMIENTO DE TIERRA',
        canonical_specs: staleSlots,
        caracteristicas_principales: ['Consumo energético: 14,0 L/h', 'Capacidad energética: 90 L'],
        fichaTecnicaMarkdown: editedFichaMarkdown,
        official_url: 'https://www.cat.com/272d-xhp.pdf',
    });

    assert.equal(
        updatedProfile.hourly_consumption_by_load.medium_load_50_65pct,
        '18,5 L/h',
        'El consumo editado en el Markdown del Pilar 01 (18,5 L/h) debe prevalecer sobre el slot antiguo (14,0 L/h)'
    );
    assert.equal(
        updatedProfile.storage_and_autonomy.tank_or_battery_capacity,
        '105 L',
        'La capacidad de estanque editada en el Markdown del Pilar 01 (105 L) debe prevalecer sobre el slot antiguo (90 L)'
    );
    console.log('  [OK] 4. Propagación prioritaria de ediciones en Pilar 01 hacia Matriz Energética verificada.');

    // 5. Verificación Etapa 2: Navegación Determinista, Ciclo de Vida de Borradores y Purga de Amarillo en UI
    const dashboardPath = path.resolve(
        __dirname,
        '../web/src/modules/opermaq/components/KnowledgeVaultDashboard.tsx'
    );
    const detectorPath = path.resolve(
        __dirname,
        '../web/src/modules/opermaq/utils/pendingContentDetector.ts'
    );
    const dashboardSrc = fs.readFileSync(dashboardPath, 'utf8');
    const detectorSrc = fs.readFileSync(detectorPath, 'utf8');

    assert.ok(
        !/#FEF08A|#FACC15|#EAB308|#FFCD00/i.test(dashboardSrc),
        'KnowledgeVaultDashboard.tsx no debe contener colores amarillos prohibidos (#FEF08A, #FACC15, #EAB308, #FFCD00)'
    );
    assert.ok(
        !/#FEF08A|#FACC15|#EAB308|#FFCD00/i.test(detectorSrc),
        'pendingContentDetector.ts debe usar acento Cobre Oficial #C68346 sin amarillos prohibidos'
    );
    assert.ok(
        dashboardSrc.includes('const hasExpanded = items.some(it => expandedItems.has(it.item_id));'),
        'ItemizedItemsList debe calcular hasExpanded únicamente sobre los ítems de la lista activa actual'
    );
    assert.ok(
        dashboardSrc.includes('activeItemChatSessionMap'),
        'ItemContentBlock debe preservar la sesión de chat activa por ítem durante la navegación'
    );
    assert.ok(
        dashboardSrc.includes("msg.draftStatus === 'APPLIED'") &&
            dashboardSrc.includes("msg.draftStatus === 'DISCARDED'") &&
            dashboardSrc.includes('/vault/dismiss-assist-proposal'),
        'ItemContentBlock debe gestionar el ciclo de vida explícito de borradores (PENDING / APPLIED / DISCARDED)'
    );
    console.log(
        '  [OK] 5. Etapa 2 verificada: Navegación post-interacción, ciclo de borradores y purga 100% de amarillo.'
    );

    // 6. Verificación de Consolidación Inmediata de `Nuevos` y `Conflictos` y Descuento de Contadores
    const docWithUndeclaredAndConflict = [
        '### Hidráulica Principal',
        '| Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |',
        '| :--- | :--- | :--- |',
        '| Presión de alivio principal | 210 bar (3.045 psi) | SAE J1116 |',
        '| Caudal auxiliar de alto flujo | [Información técnica no declarada en ficha] | SAE J1116 |',
    ].join('\n');

    const conflictAndNewDeltas: ProposedUpdate[] = [
        {
            proposal_id: 'prop_conflict_1',
            zona: 'Hidráulica Principal',
            componente: 'Presión de alivio principal',
            valor_actual: '210 bar (3.045 psi)',
            valor_nuevo: '230 bar (3.336 psi)',
            condicion_esperada: 'SAE J1116 OEM',
            estado_fusion: 'CONFLICTO',
            is_oem: true,
            human_decision: 'APROBADO',
        },
        {
            proposal_id: 'prop_new_1',
            zona: 'Hidráulica Principal',
            componente: 'Caudal auxiliar de alto flujo',
            valor_actual: '[Información técnica no declarada en ficha]',
            valor_nuevo: '125 L/min (33 gpm)',
            condicion_esperada: 'Circuito XHP',
            estado_fusion: 'NUEVO',
            is_oem: true,
            human_decision: 'APROBADO',
        },
        {
            proposal_id: 'prop_new_2',
            zona: 'Hidráulica Principal',
            componente: 'Capacidad de estanque hidráulico',
            valor_nuevo: '| Capacidad de estanque hidráulico | 39 L (10,3 gal) | Nivel en mirilla |',
            condicion_esperada: 'Manual OEM',
            estado_fusion: 'NUEVO',
            is_oem: true,
            human_decision: 'APROBADO',
        },
    ];

    const consolidatedDoc = applyDeterministicProposalFallback(
        docWithUndeclaredAndConflict,
        conflictAndNewDeltas,
        'ficha_tecnica'
    );

    assert.ok(
        consolidatedDoc.includes('230 bar (3.336 psi)') && !consolidatedDoc.includes('210 bar (3.045 psi)'),
        'El conflicto aprobado debe sustituir el valor antiguo en el contenido del ítem'
    );
    assert.ok(
        consolidatedDoc.includes('125 L/min (33 gpm)') &&
            !consolidatedDoc.includes('[Información técnica no declarada en ficha]'),
        'El nuevo hallazgo aprobado debe sustituir el marcador de información técnica no declarada'
    );
    assert.ok(
        consolidatedDoc.includes('39 L (10,3 gal)'),
        'Los nuevos hallazgos sin valor previo deben insertarse en la sección correspondiente del documento'
    );

    const routesPath = path.resolve(__dirname, '../src/modules/opermaq/routes/vault.routes.ts');
    const routesSrc = fs.readFileSync(routesPath, 'utf8');
    assert.ok(
        routesSrc.includes('autoConsolidated: true') &&
            routesSrc.includes('matchPendingProposalIndex(currentPending, proposalId)'),
        'POST /vault/decide-proposal debe consolidar inmediatamente las propuestas aprobadas y soportar llaves fallback'
    );
    assert.ok(
        dashboardSrc.includes("p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'") &&
            dashboardSrc.includes("p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'"),
        'Los contadores de Nuevos y Conflictos deben descontar inmediatamente las propuestas aprobadas y eliminadas'
    );
    console.log(
        '  [OK] 6. Consolidación inmediata de Nuevos y Conflictos (`applyDeterministicProposalFallback` + `/decide-proposal` + contadores) verificada.'
    );

    console.log('\n=== TODAS LAS PRUEBAS UNITARIAS PASARON EXITOSAMENTE (6/6) ===');
}

main().catch((err) => {
    console.error('Error en verificación:', err);
    process.exit(1);
});

