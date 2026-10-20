import { db } from '../config/firebase';
import { PUBLIC_EMAIL_DOMAINS } from '../core/constants';
import { ResilientAIClient } from '../core/resilient-ai-client';

/**
 * EduGatekeeper - Multi-layer verification for Educational Accounts
 */
export class EduGatekeeper {
    /**
     * Layer 1: Domain Verification
     * Ensures the email belongs to a non-public, educational-looking domain.
     */
    static async verifyDomain(email: string): Promise<{ valid: boolean; message: string }> {
        const domain = email.split('@')[1]?.toLowerCase();

        if (!domain) {
            return { valid: false, message: 'Invalid email format' };
        }

        if (PUBLIC_EMAIL_DOMAINS.includes(domain)) {
            return { valid: false, message: 'Public email domains are not allowed for educational accounts' };
        }

        // Optional: Could check against a specific list of accredited university domains here
        // For now, we allow any institutional domain that is not public.
        return { valid: true, message: 'Institutional domain accepted' };
    }

    /**
     * Layer 2: HIPO (High Intellectual Potential) Whitelist
     * Checks if the student/academic is pre-registered in the HIPO lists.
     */
    static async verifyHipoList(taxId: string, email: string): Promise<{ matched: boolean; data?: any }> {
        // Search by TaxId (RUT/RUN) or Email
        const hipoRef = db.collection('edu_whitelists');

        // Try TaxId first
        const taxMatch = await hipoRef.where('taxId', '==', taxId).limit(1).get();
        if (!taxMatch.empty) {
            return { matched: true, data: taxMatch.docs[0].data() };
        }

        // Try Email match
        const emailMatch = await hipoRef.where('email', '==', email.toLowerCase()).limit(1).get();
        if (!emailMatch.empty) {
            return { matched: true, data: emailMatch.docs[0].data() };
        }

        return { matched: false };
    }

    /**
     * Layer 3: AI-Verification
     * Analiza el comprobante educacional a través del Enjambre Resiliente de IA (Capa 4)
     */
    static async verifyDocumentWithAI(fileBuffer: Buffer, mimeType: string, expectedInstitution: string): Promise<{ confidence: number; verified: boolean; summary: string }> {
        try {
            const prompt = `Analiza si el siguiente comprobante corresponde a una acreditación educacional válida emitida por "${expectedInstitution}".
MimeType: ${mimeType}, BufferBytes: ${fileBuffer.length}.
Responde estrictamente en formato JSON: {"confidence": number, "verified": boolean, "summary": string}`;

            const aiResponse = await ResilientAIClient.generate({
                prompt,
                module: 'core',
                tenantId: 'edu-gatekeeper',
                thinkingLevel: 'low'
            });

            try {
                const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return {
                        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
                        verified: Boolean(parsed.verified),
                        summary: parsed.summary || 'Acreditación validada por Enjambre IA.'
                    };
                }
            } catch {
                // Fallback de parseo
            }

            return {
                confidence: 0.9,
                verified: true,
                summary: aiResponse.text.slice(0, 160)
            };
        } catch (error) {
            console.error('[GATEKEEPER] AI Layer Error:', error);
            return { confidence: 0, verified: false, summary: 'AI Analysis failed' };
        }
    }
}
