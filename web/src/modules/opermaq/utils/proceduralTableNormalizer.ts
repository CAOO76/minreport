/**
 * PROCEDURAL TABLE NORMALIZER — Estandarización Tabular Industrial (OPERMAQ)
 *
 * Convierte determinísticamente secuencias de procedimientos en texto plano
 * (listas numeradas `1. **Etapa:** Acción...` o viñetas técnicas `- **Etapa:** Acción...`)
 * en Tablas Operativas de Estándar Industrial de 4 columnas:
 * | Paso | Etapa / Punto de Intervención | Procedimiento Operativo de Control / Maniobra | Criterio de Verificación / Magnitud Nominal (SI) |
 */

function capitalizeFirst(str: string): string {
  const s = str.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeTableCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBERED_STEP_LINE_RE = /^\s*(?:\*\*\s*)?(?:paso\s+)?(\d{1,2})[.):-]\s*(.+)$/i;
const LABELED_BULLET_LINE_RE = /^\s*[-*•]\s+\*\*(?!\[\d+\])([^*]{3,80})\*\*\s*[:.—–-]\s*(.+)$/;
const PROCEDURAL_HEADING_RE =
  /\b(?:secuencia|procedimiento|protocolo|paso\s+a\s+paso|aislamiento|bloqueo|loto|energ[ií]a\s+cero|actuaci[oó]n|respuesta|emergencia|evacuaci[oó]n|purga|despresurizaci[oó]n|maniobra|verificaci[oó]n)\b/i;

function isStructuralMarkdownLine(trimmed: string): boolean {
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (trimmed.startsWith('|')) return true;
  if (trimmed.startsWith('![') || /^\[IMAGEN[_\s-]PENDIENTE:/i.test(trimmed)) return true;
  if (/^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(trimmed)) return true;
  if (/^---+$/.test(trimmed)) return true;
  if (/^(?:\*\*)?REGLA\s+DE\s+BLOQUEO/i.test(trimmed)) return true;
  if (/^\s*[-*•]\s+\*\*\[\d+\]\*\*/.test(trimmed)) return true;
  if (/^\*\*([A-ZÁÉÍÓÚÑ0-9\s—–()/.,:-]{10,})\*\*:?$/.test(trimmed)) return true;
  return false;
}

function normalizeStepRawBody(rawRest: string): string {
  // Si la línea original era `**1. Etapa:** Detalle`, al quitar `**1.` queda `Etapa:** Detalle` -> restaurar `**Etapa:** Detalle`
  const trimmed = rawRest.trim();
  if (!trimmed.startsWith('**') && /^[^*]{2,80}\*\*/.test(trimmed)) {
    return `**${trimmed}`;
  }
  return trimmed;
}

export function parseProceduralStepToColumns(
  stepNumber: number,
  rawStepText: string
): [string, string, string, string] {
  const pasoCol = String(stepNumber).padStart(2, '0');
  const normalized = normalizeStepRawBody(rawStepText);

  if (normalized.includes('|')) {
    const parts = normalized
      .split('|')
      .map((p) => escapeTableCell(p))
      .filter(Boolean);
    if (parts.length >= 3) {
      return [
        pasoCol,
        parts[0].startsWith('**') ? parts[0] : `**${parts[0].replace(/\*\*/g, '')}**`,
        parts[1],
        parts.slice(2).join(' — '),
      ];
    }
  }

  let stageLabel = 'Maniobra Operativa';
  let contentRest = normalized;

  const boldPrefixMatch = normalized.match(/^\*\*([^*]+)\*\*\s*[:.—–-]?\s*([\s\S]+)$/);
  if (boldPrefixMatch) {
    stageLabel = boldPrefixMatch[1].replace(/[:.—–-]+$/, '').trim();
    contentRest = boldPrefixMatch[2].trim();
  } else {
    const colonPrefixMatch = normalized.match(/^([^:.]{3,70}):\s*([\s\S]+)$/);
    if (colonPrefixMatch) {
      stageLabel = colonPrefixMatch[1].replace(/\*\*/g, '').replace(/[:.—–-]+$/, '').trim();
      contentRest = colonPrefixMatch[2].trim();
    }
  }

  const formattedStage = `**${escapeTableCell(stageLabel.replace(/\*\*/g, ''))}**`;
  let actionCol = contentRest;
  let verificationCol = '';

  // 1. Cláusulas explícitas de verificación (`para confirmar ...`, `para verificar ...`, `para comprobar ...`)
  const confirmRe =
    /\b(?:para\s+(?:confirmar|verificar|comprobar|asegurar)|confirmando|verificando)\s+([^.;]+?)(?=(?:\s+y\s+[a-záéíóúñ0-9]+\s+para\s+(?:confirmar|verificar|comprobar))|[.;]|$)/gi;
  const confirmCriteria: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = confirmRe.exec(contentRest)) !== null) {
    const crit = cm[1].trim();
    if (crit) confirmCriteria.push(capitalizeFirst(crit));
  }

  if (confirmCriteria.length > 0) {
    verificationCol = confirmCriteria.join(' — ');
    const strippedAction = contentRest
      .replace(
        /\s*\b(?:para\s+(?:confirmar|verificar|comprobar|asegurar)|confirmando|verificando)\s+[^.;]+?(?=(?:\s+y\s+[a-záéíóúñ0-9]+\s+para\s+(?:confirmar|verificar|comprobar))|[.;]|$)/gi,
        ''
      )
      .replace(/\s+\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (strippedAction.length >= 15) {
      actionCol = strippedAction;
    }
  } else {
    // 2. Cláusula terminal `hasta que ...`
    const hastaQueMatch = contentRest.match(/^([\s\S]+?)\s+hasta\s+que\s+([^.]+)\.?$/i);
    if (hastaQueMatch && hastaQueMatch[1].trim().length >= 15) {
      actionCol = `${hastaQueMatch[1].trim().replace(/\.$/, '')}.`;
      verificationCol = `${capitalizeFirst(hastaQueMatch[2].trim().replace(/\.$/, ''))}.`;
    } else {
      // 3. Sentencia única terminada en magnitud/estado entre paréntesis, ej. `Apagar el motor diésel Cat C3.8 DIT (0 RPM).`
      const sentences = contentRest
        .split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/)
        .map((s) => s.trim())
        .filter(Boolean);

      const trailingParenMatch =
        sentences.length === 1
          ? contentRest.match(
              /^([\s\S]+?)\s*\(([^)]*(?:\d|OFF|ON|CERO|BLOQUEADO|RPM|bar|psi|kPa|MPa|V|A|°C|°F|mm|N·m|kg|L)[^)]*)\)\.?$/i
            )
          : null;

      if (trailingParenMatch && trailingParenMatch[1].trim().length >= 10) {
        actionCol = `${trailingParenMatch[1].trim().replace(/\.$/, '')}.`;
        verificationCol = trailingParenMatch[2].trim();
      } else if (sentences.length >= 2) {
        actionCol = sentences.slice(0, -1).join(' ');
        verificationCol = sentences[sentences.length - 1];
      } else {
        actionCol = contentRest;
        const metricMatches = contentRest.match(
          /\b\d+(?:[.,]\d+)?\s*(?:bar|psi|kPa|MPa|V|VDC|RPM|°C|°F|N·m|lb[-·]ft|mm|cm|m|kg|lb|L|gal|dB\(A\)|m\/s²)\b|[<>]\s*\d+(?:[.,]\d+)?\s*(?:°[CF]|bar|psi|V|RPM)|\bISO\s+\d+(?:[-:]\d+)?(?:\s+[A-Z]\d{3})?\b|\bDS\s+\d+\b|\bEN\s+\d+\b/gi
        );
        if (metricMatches && metricMatches.length > 0) {
          verificationCol = Array.from(new Set(metricMatches.map((m) => m.trim()))).join(' / ');
        } else {
          verificationCol = 'Verificación operativa en el equipo';
        }
      }
    }
  }

  return [
    pasoCol,
    formattedStage,
    escapeTableCell(actionCol),
    escapeTableCell(verificationCol || 'Verificación operativa en el equipo'),
  ];
}

function buildProcedureMarkdownTable(rows: Array<[string, string, string, string]>): string[] {
  const out: string[] = [
    '| Paso | Etapa / Punto de Intervención | Procedimiento Operativo de Control / Maniobra | Criterio de Verificación / Magnitud Nominal (SI) |',
    '| :---: | :--- | :--- | :--- |',
  ];
  for (const [paso, stage, action, verification] of rows) {
    out.push(`| ${paso} | ${stage} | ${action} | ${verification} |`);
  }
  return out;
}

/**
 * Normaliza en Markdown:
 * 1. Títulos en negrita mayúscula aislados (`**SECUENCIA NORMATIVA DE...**`) -> `#### SECUENCIA NORMATIVA DE...`
 * 2. Bloques de pasos numerados (`1. **Etapa:** ...`, `2. ...`) -> Tabla Operativa de 4 columnas.
 * 3. Bloques de viñetas etiquetadas (`- **Etapa:** ...`) bajo subtítulos procedimentales o en `matriz_riesgos` -> Tabla Operativa de 4 columnas.
 */
export function normalizeProceduralStepsToMarkdownTable(
  markdown: string,
  options?: { pillarId?: string }
): string {
  if (!markdown) return '';
  const isRiskMatrix = options?.pillarId === 'matriz_riesgos';
  const rawLines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let lastHeadingText = '';
  let i = 0;

  while (i < rawLines.length) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    // 1. Promover subtítulos aislados en negrita mayúscula a `#### `
    const standaloneUpperBold = trimmed.match(/^\*\*([A-ZÁÉÍÓÚÑ0-9\s—–()/.,:-]{10,})\*\*:?$/);
    if (standaloneUpperBold && !/^REGLA\s+DE\s+BLOQUEO/i.test(standaloneUpperBold[1].trim())) {
      const cleanHeading = standaloneUpperBold[1].replace(/:$/, '').trim();
      lastHeadingText = cleanHeading;
      out.push(`#### ${cleanHeading}`);
      i++;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      lastHeadingText = trimmed.replace(/^#{1,6}\s+/, '').trim();
      out.push(rawLine);
      i++;
      continue;
    }

    // 2. Detectar secuencia de pasos numerados (`1. ...`, `2. ...`), incluso separados por líneas en blanco
    const stepMatch = trimmed.match(NUMBERED_STEP_LINE_RE);
    if (stepMatch) {
      const collectedSteps: Array<{ stepNum: number; text: string }> = [];
      let cursor = i;

      while (cursor < rawLines.length) {
        const curTrimmed = rawLines[cursor].trim();
        const m = curTrimmed.match(NUMBERED_STEP_LINE_RE);
        if (!m) break;

        let stepText = m[2].trim();
        const parsedNum = parseInt(m[1], 10);
        cursor++;

        // Unir líneas de continuación inmediata del mismo paso
        while (cursor < rawLines.length) {
          const contTrimmed = rawLines[cursor].trim();
          if (!contTrimmed) break;
          if (
            NUMBERED_STEP_LINE_RE.test(contTrimmed) ||
            LABELED_BULLET_LINE_RE.test(contTrimmed) ||
            isStructuralMarkdownLine(contTrimmed)
          ) {
            break;
          }
          stepText += ` ${contTrimmed}`;
          cursor++;
        }

        collectedSteps.push({
          stepNum: Number.isFinite(parsedNum) ? parsedNum : collectedSteps.length + 1,
          text: stepText,
        });

        // Saltar líneas en blanco intermedias solo si la siguiente línea no vacía es otro paso numerado
        let peek = cursor;
        while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
        if (peek < rawLines.length && NUMBERED_STEP_LINE_RE.test(rawLines[peek].trim())) {
          cursor = peek;
        } else {
          break;
        }
      }

      if (collectedSteps.length >= 2 || (collectedSteps.length === 1 && (isRiskMatrix || PROCEDURAL_HEADING_RE.test(lastHeadingText)))) {
        const tableRows = collectedSteps.map((st, idx) =>
          parseProceduralStepToColumns(idx + 1, st.text)
        );
        out.push('', ...buildProcedureMarkdownTable(tableRows), '');
        i = cursor;
        continue;
      }
    }

    // 3. Detectar lista de viñetas etiquetadas (`- **Etapa:** ...`) en `matriz_riesgos` o bajo encabezado procedimental
    const bulletMatch = trimmed.match(LABELED_BULLET_LINE_RE);
    if (bulletMatch && (isRiskMatrix || PROCEDURAL_HEADING_RE.test(lastHeadingText))) {
      const collectedBullets: string[] = [];
      let cursor = i;

      while (cursor < rawLines.length) {
        const curTrimmed = rawLines[cursor].trim();
        const bm = curTrimmed.match(LABELED_BULLET_LINE_RE);
        if (!bm) break;
        let bulletText = `**${bm[1].trim()}:** ${bm[2].trim()}`;
        cursor++;

        while (cursor < rawLines.length) {
          const contTrimmed = rawLines[cursor].trim();
          if (!contTrimmed) break;
          if (
            LABELED_BULLET_LINE_RE.test(contTrimmed) ||
            NUMBERED_STEP_LINE_RE.test(contTrimmed) ||
            isStructuralMarkdownLine(contTrimmed) ||
            /^\s*[-*•]\s+/.test(contTrimmed)
          ) {
            break;
          }
          bulletText += ` ${contTrimmed}`;
          cursor++;
        }

        collectedBullets.push(bulletText);

        let peek = cursor;
        while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
        if (peek < rawLines.length && LABELED_BULLET_LINE_RE.test(rawLines[peek].trim())) {
          cursor = peek;
        } else {
          break;
        }
      }

      if (collectedBullets.length >= 2) {
        const tableRows = collectedBullets.map((bt, idx) =>
          parseProceduralStepToColumns(idx + 1, bt)
        );
        out.push('', ...buildProcedureMarkdownTable(tableRows), '');
        i = cursor;
        continue;
      }
    }

    out.push(rawLine);
    i++;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * En pilares 100% tabulares (`matriz_riesgos` y `checklist_pre_op`), omite párrafos narrativos redundantes
 * de preámbulo cuando la sección ya cuenta con tablas estructuradas, conservando encabezados, tablas,
 * figuras, marcadores de imagen pendiente, leyendas de callouts y reglas de bloqueo.
 */
export function stripRedundantNarrativeInTabularPillar(
  markdown: string,
  pillarId?: string
): string {
  if (!markdown || (pillarId !== 'matriz_riesgos' && pillarId !== 'checklist_pre_op')) {
    return markdown;
  }

  const lines = markdown.split('\n');
  const hasAnyTable = lines.some((l) => l.trim().startsWith('|'));
  if (!hasAnyTable) return markdown;

  const filtered = lines.filter((rawLine) => {
    const t = rawLine.trim();
    if (!t) return true;
    if (/^#{1,6}\s/.test(t)) return true;
    if (t.startsWith('|')) return true;
    if (t.startsWith('![') || /^\[IMAGEN[_\s-]PENDIENTE:/i.test(t)) return true;
    if (/^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(t)) return true;
    if (/^\s*[-*•]\s+\*\*\[\d+\]\*\*/.test(t)) return true;
    if (/^(?:\*\*)?REGLA\s+DE\s+BLOQUEO/i.test(t)) return true;
    if (/^---+$/.test(t)) return true;
    return false;
  });

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

