import type { ExtractedFigureRef } from '../types/vault.types';

/**
 * OPERMAQ SVG BLUEPRINT GUARD v5.0 — Cortafuegos Determinista Anti-Figuras Sintéticas
 *
 * Purga figuras sintéticas legacy (`bp_*`, `fig_tbl_*`, siluetas/planos dimensionales genéricos)
 * garantizando que `items[].figures` solo contenga recortes reales `box_2d` o evidencia OEM verificada en CAS.
 */

export type BlueprintKind =
    | 'DIMENSION_SPEC_SHEET'
    | 'PERFORMANCE_CURVE'
    | 'PM_HOROMETER_TIMELINE'
    | 'WALKAROUND_LOTO_MAP'
    | 'ISO_SAFETY_PLAQUE'
    | 'TECHNICAL_SPEC_BAR_CHART';

export function isDeprecatedSyntheticBlueprintFigure(fig?: ExtractedFigureRef | null): boolean {
    if (!fig) return true;
    const fid = String(fig.figure_id || '');
    if (fid.startsWith('bp_') || fid.startsWith('fig_tbl_')) return true;
    const combined = `${fig.title_es || ''} ${fig.caption_es || ''}`;
    if (
        /Plano Dimensional Acotado|Plano Dimensional y Par[aá]metros|Mapa de Inspecci[oó]n 360|Matriz Cronol[oó]gica PM|OpermaqSvgBlueprintEngine|Comparativa\s+de\s+magnitudes|Comparativa\s+Param[eé]trica\s+SI/i.test(
            combined
        )
    ) {
        return true;
    }
    if (fig.is_parametric_svg && fig.figure_type === 'DIAGRAMA_ACOTADO') {
        return true;
    }
    return false;
}
