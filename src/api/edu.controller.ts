import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { EduGatekeeper } from '../services/edu_gatekeeper';

/**
 * Handles the automated part of the Edu-Gatekeeper flow
 */
export const validateEduRequest = async (req: Request, res: Response) => {
    try {
        const { requestId } = req.params; // This is the Document ID in 'tenants'

        const requestSnap = await db.collection('tenants').doc(requestId).get();
        if (!requestSnap.exists) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const data = requestSnap.data()!;
        if (data.type !== 'EDUCATIONAL') {
            return res.status(400).json({ error: 'Not an educational request' });
        }

        // 1. Layer 1 Check (Domain)
        const domainCheck = await EduGatekeeper.verifyDomain(data.email);

        // 2. Layer 2 Check (HIPO List)
        const hipoCheck = await EduGatekeeper.verifyHipoList(data.run || '', data.email);

        // Update Request with findings
        await requestSnap.ref.update({
            'gatekeeperFindings': {
                domainValid: domainCheck.valid,
                hipoMatched: hipoCheck.matched,
                hipoData: hipoCheck.data || null,
                validatedAt: new Date().toISOString()
            },
            // Auto-approve if both Layer 1 and Layer 2 are perfect?
            // For now, just mark as 'VALIDATED' for admin review
            gatekeeperStatus: (domainCheck.valid && hipoCheck.matched) ? 'VERIFIED' : 'NEEDS_REVIEW'
        });

        return res.status(200).json({
            success: true,
            findings: {
                domain: domainCheck,
                hipo: hipoCheck
            }
        });

    } catch (error) {
        console.error('[EDU-GATEKEEPER] Validation Error:', error);
        return res.status(500).json({ error: 'Internal validation failure' });
    }
};

/**
 * Triggers AI document analysis (Layer 3)
 */
export const analyzeEduDocument = async (req: Request, res: Response) => {
    // This would receive a file or a reference to a file in GCS
    // For now, let's assume we use the URL stored in the request
    try {
        const { requestId } = req.body;
        const requestSnap = await db.collection('tenants').doc(requestId).get();

        if (!requestSnap.exists) return res.status(404).json({ error: 'Request not found' });

        // AI Logic would go here...
        const aiResult = await EduGatekeeper.verifyDocumentWithAI(
            Buffer.from(''),
            'application/pdf',
            requestSnap.data()?.institution_name || 'N/A'
        );

        await requestSnap.ref.update({
            'gatekeeperFindings.aiVerification': aiResult,
            'gatekeeperFindings.aiValidatedAt': new Date().toISOString()
        });

        return res.status(200).json({ success: true, aiResult });
    } catch (error) {
        return res.status(500).json({ error: 'AI Analysis failed' });
    }
};
