import { z } from 'zod';
import { db } from '../config/firebase';
import { PUBLIC_EMAIL_DOMAINS } from '../core/constants';
import { ResilientAIClient } from '../core/resilient-ai-client';

const eduAiResultSchema = z.object({
    confidence: z.number().min(0).max(1),
    verified: z.boolean(),
    summary: z.string().min(1).max(1000),
});

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

        const mimeType = (input.mimeType || 'application/pdf').trim();

        try {
            const textSection = cleanText
                ? `\nContenido textual extraído del documento:\n"""\n${cleanText.slice(0, 12000)}\n"""`
                : '';

            const prompt = `Evalúa rigurosamente si el documento adjunto constituye un certificado de alumno regular, credencial académica o acreditación institucional vigente emitida por "${input.expectedInstitution}".${textSection}
Si el documento es ilegible, vacío, irrelevante o no acredita vínculo académico con la institución indicada, debes responder verified: false y confidence: 0.
Responde estrictamente en JSON con las claves exactas: {"confidence": number (0 a 1), "verified": boolean, "summary": string}.`;

            const { data } = await ResilientAIClient.generateStructured(
                {
                    prompt,
                    module: 'core',
                    tenantId: 'edu-gatekeeper',
                    thinkingLevel: 'low',
                    bypassCache: true,
                    media: hasBinary
                        ? [
                              {
                                  mimeType,
                                  dataBase64: input.fileBuffer!.toString('base64'),
                              },
                          ]
                        : undefined,
                },
                eduAiResultSchema
            );

            return {
                confidence: data.verified ? data.confidence : Math.min(data.confidence, 0.49),
                verified: Boolean(data.verified && data.confidence >= 0.7),
                summary: data.summary,
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
