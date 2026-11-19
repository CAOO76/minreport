import { db } from '../config/firebase';
import { PUBLIC_EMAIL_DOMAINS } from '../core/constants';
import { ResilientAIClient } from '../core/resilient-ai-client';

export interface EduDocumentVerificationInput {
    fileBuffer?: Buffer | null;
    mimeType?: string;
    documentText?: string;
    expectedInstitution: string;
}

/**
 * EduGatekeeper — Verificación multicapa en modo Fail-Closed para Cuentas Educacionales (EDU).
 */
export class EduGatekeeper {
    /**
     * Capa 1: Verificación de dominio institucional
     */
    static async verifyDomain(email: string): Promise<{ valid: boolean; message: string }> {
        const domain = email.split('@')[1]?.toLowerCase()?.trim();

        if (!domain) {
            return { valid: false, message: 'Formato de correo inválido' };
        }

        if (PUBLIC_EMAIL_DOMAINS.includes(domain)) {
            return { valid: false, message: 'No se permiten dominios de correo público para cuentas EDU' };
        }

        return { valid: true, message: 'Dominio institucional aceptado' };
    }

    /**
     * Capa 2: Lista blanca HIPO
     */
    static async verifyHipoList(taxId: string, email: string): Promise<{ matched: boolean; data?: any }> {
        const hipoRef = db.collection('edu_whitelists');

        if (taxId && taxId.trim()) {
            const taxMatch = await hipoRef.where('taxId', '==', taxId.trim()).limit(1).get();
            if (!taxMatch.empty) {
                return { matched: true, data: taxMatch.docs[0].data() };
            }
        }

        if (email && email.trim()) {
            const emailMatch = await hipoRef.where('email', '==', email.toLowerCase().trim()).limit(1).get();
            if (!emailMatch.empty) {
                return { matched: true, data: emailMatch.docs[0].data() };
            }
        }

        return { matched: false };
    }

    /**
     * Capa 3: Verificación documental IA en modo ESTRICTO FAIL-CLOSED.
     * Si el documento está vacío, el parseo falla o la inferencia falla -> `{ verified: false, confidence: 0 }`.
     */
    static async verifyDocumentWithAI(
        input: EduDocumentVerificationInput
    ): Promise<{ confidence: number; verified: boolean; summary: string }> {
        const hasBinary = Boolean(input.fileBuffer && input.fileBuffer.length > 0);
        const cleanText = (input.documentText || '').trim();

        if (!hasBinary && cleanText.length === 0) {
            return {
                confidence: 0,
                verified: false,
                summary: 'Sin contenido documental verificable (Fail-Closed).',
            };
        }

        const mimeType = (input.mimeType || 'application/pdf').split(';')[0].trim().toLowerCase();

        try {
            const inputText = [
                `Institución académica esperada: "${input.expectedInstitution}"`,
                cleanText
                    ? `\nContenido textual extraído del documento:\n"""\n${cleanText.slice(0, 12000)}\n"""`
                    : '',
            ]
                .filter(Boolean)
                .join('\n');

            const decisionRes = await ResilientAIClient.decide({
                module: 'core',
                tenantId: 'edu-gatekeeper',
                dataClassification: 'TENANT_PRIVATE',
                isEduSandbox: true,
                bypassCache: true,
                inputText,
                media: hasBinary
                    ? [
                          {
                              mimeType,
                              dataBase64: input.fileBuffer!.toString('base64'),
                              ...(mimeType.startsWith('image/') ? { resolution: 'medium' as const } : {}),
                          },
                      ]
                    : undefined,
                questions: {
                    is_valid_academic_certificate: {
                        type: 'noul',
                        instructions:
                            '¿El documento adjunto es legible y corresponde a un certificado de alumno regular, credencial académica o acreditación institucional vigente?',
                        criteria: {
                            true_description:
                                'Documento legible que acredita matrícula, condición vigente de estudiante o vínculo académico formal.',
                            false_description:
                                'Documento ilegible, vacío, irrelevante, expirado o sin respaldo académico verificable.',
                        },
                    },
                    matches_expected_institution: {
                        type: 'noul',
                        instructions: `¿El documento acredita vínculo académico directo con la institución "${input.expectedInstitution}"?`,
                        criteria: {
                            true_description: `El nombre, membrete, timbre o dominio oficial en el documento corresponde a "${input.expectedInstitution}".`,
                            false_description:
                                'Pertenece a otra institución, no menciona la institución esperada o no permite verificación.',
                        },
                    },
                },
            });

            const ansValid = decisionRes.answers.is_valid_academic_certificate;
            const ansInst = decisionRes.answers.matches_expected_institution;

            if (ansValid?.type !== 'noul' || ansInst?.type !== 'noul') {
                throw new Error('Respuesta incompleta desde compuerta Decisions EDU.');
            }

            const pValid = ansValid.noul;
            const pInst = ansInst.noul;
            const verified =
                pValid >= 0.7 &&
                pInst >= 0.7 &&
                ansValid.confidence >= 0.7 &&
                ansInst.confidence >= 0.7;
            const combinedScore = Number(Math.min(pValid, pInst).toFixed(3));
            const confidence = verified ? combinedScore : Math.min(combinedScore, 0.49);

            return {
                confidence,
                verified,
                summary: `Validación documental calibrada (${decisionRes.engineUsed}): P(certificado)=${pValid.toFixed(2)}, P(institución)=${pInst.toFixed(2)}.`,
            };
        } catch (error: any) {
            console.error('[EDU-GATEKEEPER] Fallo en verificación IA (Fail-Closed):', error?.message || error);
            return {
                confidence: 0,
                verified: false,
                summary: 'No fue posible validar el documento mediante IA (Fail-Closed).',
            };
        }
    }
}
