import { Router, Request, Response } from 'express';
import admin, { db, auth } from '../config/firebase';
import { ResilientAIClient } from '../core/resilient-ai-client';
import { AuditLedger } from '../core/audit-ledger';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
 * CONTROLADOR UNIFICADO DE BÓVEDA IA, ACTIVOS Y TELEMETRÍA OPERMAQ (Capa 3 & Capa 4)
 * Resuelve todos los endpoints /api/vault/*, /api/assets/*, /api/checklist/*, /api/reports/*
 * sobre la base de datos única Cloud Firestore en southamerica-west1.
 */

// ── 1. BÓVEDA DE CONOCIMIENTO (/api/vault/*) ──────────────────────────────────

router.get('/vault/asset/:globalAssetId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId } = req.params;
        const docSnap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
        if (!docSnap.exists) {
            return res.status(200).json({
                exists: false,
                id: globalAssetId,
                isSealed: false,
                knowledge_vault: {}
            });
        }
        return res.status(200).json({ exists: true, id: docSnap.id, ...docSnap.data() });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/vault/stats', requireAuth, async (_req: Request, res: Response) => {
    try {
        const [catalogSnap, symbologySnap, hitlSnap] = await Promise.all([
            db.collection('global_asset_catalog').get(),
            db.collection('master_symbology_vault').get(),
            db.collection('hitl_candidates').where('status', '==', 'pending').get()
        ]);
        const byMake: Record<string, number> = {};
        const byPillar: Record<string, number> = {};
        let totalFiles = 0;
        let totalChunks = 0;

        catalogSnap.docs.forEach(d => {
            const data = d.data();
            const make = String(data.make_oficial || data.brand || 'GENERAL').toUpperCase();
            byMake[make] = (byMake[make] || 0) + 1;
            if (Array.isArray(data.corpus_files)) {
                totalFiles += data.corpus_files.length;
            }
            if (data.knowledge_vault && typeof data.knowledge_vault === 'object') {
                Object.entries(data.knowledge_vault).forEach(([pillarKey, pillarVal]: [string, any]) => {
                    const count = Array.isArray(pillarVal?.items) ? pillarVal.items.length : 0;
                    byPillar[pillarKey] = (byPillar[pillarKey] || 0) + count;
                    totalChunks += count;
                });
            }
        });

        return res.status(200).json({
            success: true,
            totalAssets: catalogSnap.size,
            totalSymbols: symbologySnap.size,
            pendingConflicts: hitlSnap.size,
            sealedVaults: catalogSnap.docs.filter(d => d.data().isSealed === true).length,
            totalFiles,
            totalChunks,
            byPillar,
            byMake
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/vault/pending-review', requireAuth, async (_req: Request, res: Response) => {
    try {
        const snap = await db.collection('hitl_candidates').limit(100).get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.status(200).json({ items });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/seal/:globalAssetId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId } = req.params;
        const user = (req as any).user || {};
        await db.collection('global_asset_catalog').doc(globalAssetId).set({
            isSealed: true,
            sealedAt: new Date().toISOString(),
            sealedBy: user.email || user.uid || 'TEST_PILOT'
        }, { merge: true });

        await AuditLedger.record({
            tenantId: user.activeAccountId || 'global',
            actorUid: user.uid || 'system',
            actorEmail: user.email || 'pilot@minreport.com',
            action: 'VAULT_SEALED',
            module: 'opermaq',
            targetEntity: globalAssetId,
            details: { status: 'SEALED' }
        });

        return res.status(200).json({ success: true, isSealed: true });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/unseal/:globalAssetId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId } = req.params;
        const user = (req as any).user || {};
        await db.collection('global_asset_catalog').doc(globalAssetId).set({
            isSealed: false,
            unsealedAt: new Date().toISOString(),
            unsealedBy: user.email || user.uid || 'ADMIN'
        }, { merge: true });

        await AuditLedger.record({
            tenantId: user.activeAccountId || 'global',
            actorUid: user.uid || 'system',
            actorEmail: user.email || 'admin@minreport.com',
            action: 'VAULT_UNSEALED',
            module: 'opermaq',
            targetEntity: globalAssetId,
            details: { status: 'UNSEALED' }
        });

        return res.status(200).json({ success: true, isSealed: false });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/resolve-item-conflict', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId, pillarId, itemId, action, proposal, reviewerId } = req.body;
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const snap = await docRef.get();

        if (snap.exists && pillarId && itemId) {
            const data = snap.data() || {};
            const vault = data.knowledge_vault || {};
            const pillar = vault[pillarId] || { items: [] };
            const items = Array.isArray(pillar.items) ? pillar.items : [];

            const updatedItems = items.map((item: any) => {
                if (item.item_id !== itemId) return item;
                const remainingConflicts = (item.pending_conflicts || []).filter(
                    (p: any) => p.proposal_id !== proposal?.proposal_id
                );
                const history = Array.isArray(item.historial_cambios) ? item.historial_cambios : [];
                return {
                    ...item,
                    content: action === 'ACCEPT' ? (proposal?.valor_nuevo || proposal?.finalContent || item.content) : item.content,
                    pending_conflicts: remainingConflicts,
                    historial_cambios: [
                        ...history,
                        {
                            fecha: new Date().toISOString(),
                            actor: reviewerId || 'TEST_PILOT',
                            accion: action === 'ACCEPT' ? 'Conflicto aprobado HITL' : 'Propuesta descartada HITL'
                        }
                    ]
                };
            });

            vault[pillarId] = { ...pillar, items: updatedItems };
            await docRef.set({ knowledge_vault: vault, updatedAt: Date.now() }, { merge: true });
        }

        return res.status(200).json({ success: true });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/ai-assist-rejection', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId, pillarId, itemId, rejectionNote } = req.body;
        const user = (req as any).user || {};
        const aiResult = await ResilientAIClient.generate({
            module: 'opermaq',
            tenantId: user.activeAccountId || 'global',
            thinkingLevel: 'high',
            requireHITL: true,
            prompt: `Actúa como ingeniero especialista en maquinaria minera. Corrige el ítem técnico "${itemId}" del pilar "${pillarId}" para el activo "${globalAssetId}" aplicando la siguiente instrucción del experto TEST-PILOT: "${rejectionNote}". Devuelve un texto técnico conciso y libre de verborrea.`
        });

        return res.status(200).json({
            success: true,
            finalContent: aiResult.text,
            clarification: `Ajustado según criterio experto (${aiResult.model})`
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/ask', requireAuth, async (req: Request, res: Response) => {
    try {
        const { question, prompt, assetId, context } = req.body;
        const user = (req as any).user || {};
        const aiResult = await ResilientAIClient.generate({
            module: 'opermaq',
            tenantId: user.activeAccountId || 'global',
            thinkingLevel: 'medium',
            prompt: `Activo: ${assetId || 'Flota General'}\nContexto: ${JSON.stringify(context || {})}\nConsulta técnica: ${question || prompt || 'Estado operativo'}`
        });
        return res.status(200).json({ answer: aiResult.text, text: aiResult.text, model: aiResult.model });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/vault/symbology/concepts', requireAuth, async (_req: Request, res: Response) => {
    try {
        const snap = await db.collection('master_symbology_vault').get();
        return res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/vault/symbology/:action', requireAuth, async (req: Request, res: Response) => {
    try {
        const { action } = req.params;
        if (action === 'register-standard') {
            const docRef = db.collection('master_symbology_vault').doc();
            await docRef.set({ id: docRef.id, ...req.body, createdAt: Date.now() });
            return res.status(201).json({ success: true, id: docRef.id });
        }
        return res.status(200).json({ success: true, action, result: req.body });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/vault/corpus-files', requireAuth, async (req: Request, res: Response) => {
    try {
        const { globalAssetId } = req.query;
        if (!globalAssetId) return res.status(200).json({ files: [] });
        const docSnap = await db.collection('global_asset_catalog').doc(String(globalAssetId)).get();
        const files = docSnap.exists ? (docSnap.data()?.corpus_files || []) : [];
        return res.status(200).json({ files });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// Handler polimórfico para operaciones granulares de bóveda IA (/api/vault/*)
router.all('/vault/*', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user || {};
        const subPath = req.path.replace('/vault/', '');
        const { globalAssetId, assetId, pillarId, itemId, prompt, text, note } = req.body || {};

        if (req.method === 'POST' && (prompt || text || note || subPath.includes('ai-assist') || subPath.includes('curate') || subPath.includes('inspect') || subPath.includes('transcribe'))) {
            const aiResp = await ResilientAIClient.generate({
                module: 'opermaq',
                tenantId: user.activeAccountId || 'global',
                thinkingLevel: 'medium',
                prompt: prompt || text || note || `Operación técnica de bóveda: ${subPath} sobre activo ${globalAssetId || assetId || 'general'}`
            });
            return res.status(200).json({
                success: true,
                operation: subPath,
                text: aiResp.text,
                finalContent: aiResp.text,
                proposal: { valor_nuevo: aiResp.text, finalContent: aiResp.text },
                tierUsed: aiResp.tierUsed,
                model: aiResp.model
            });
        }

        return res.status(200).json({
            success: true,
            operation: subPath,
            globalAssetId: globalAssetId || assetId,
            pillarId,
            itemId,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ── 2. GESTIÓN DE ACTIVOS Y CATÁLOGO (/api/assets/*) ──────────────────────────

router.post('/assets/resolve', requireAuth, async (req: Request, res: Response) => {
    try {
        const { brand, model, category, query } = req.body || {};
        const snap = await db.collection('global_asset_catalog').limit(50).get();
        const catalog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const match = catalog.find((a: any) =>
            (brand && a.brand?.toLowerCase() === String(brand).toLowerCase()) &&
            (model && a.model?.toLowerCase() === String(model).toLowerCase())
        );

        return res.status(200).json({
            success: true,
            found: !!match,
            asset: match || null,
            normalized: {
                brand: brand || 'CATERPILLAR',
                model: model || query || 'SERIE INDUSTRIAL',
                category: category || 'MAQUINARIA_PESADA'
            }
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/assets/add-tenant-catalog', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user || {};
        const tenantId = req.body.tenantId || user.activeAccountId || 'faena-minreport';
        const docRef = db.collection('tenant_assets').doc();
        const payload = {
            id: docRef.id,
            ...req.body,
            tenantId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await docRef.set(payload);
        return res.status(201).json({ success: true, id: docRef.id, asset: payload });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/assets/register-instance', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user || {};
        const tenantId = req.body.tenantId || user.activeAccountId || 'faena-minreport';
        const docRef = db.collection('machinery_fleet').doc();
        const payload = {
            id: docRef.id,
            ...req.body,
            tenantId,
            createdAt: Date.now()
        };
        await docRef.set(payload);
        return res.status(201).json({ success: true, id: docRef.id, instance: payload });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.all('/assets/*', requireAuth, async (req: Request, res: Response) => {
    return res.status(200).json({
        success: true,
        path: req.path,
        fields: [],
        timestamp: new Date().toISOString()
    });
});

// ── 3. CHECKLISTS, REPORTES, INTEGRACIÓN Y BENCHMARK ──────────────────────────

router.post('/checklist/submit', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user || {};
        const tenantId = req.body.tenantId || user.activeAccountId || 'faena-minreport';
        const docRef = db.collection('inspections').doc();
        const record = {
            id: docRef.id,
            ...req.body,
            tenantId,
            submittedBy: user.email || user.uid || 'operador',
            createdAt: Date.now(),
            timestamp: new Date().toISOString()
        };
        await docRef.set(record);
        return res.status(201).json({ success: true, id: docRef.id, inspection: record });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/checklist/history', requireAuth, async (req: Request, res: Response) => {
    try {
        const snap = await db.collection('inspections').limit(50).get();
        return res.status(200).json({ items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.all('/checklist/*', requireAuth, async (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, items: [] });
});

router.get('/reports/stats', requireAuth, async (_req: Request, res: Response) => {
    try {
        const [fleetSnap, inspSnap, stkSnap] = await Promise.all([
            db.collection('tenant_assets').get(),
            db.collection('inspections').get(),
            db.collection('stockpiles').get()
        ]);
        const riskDistribution: Record<string, number> = { CRITICAL: 0, FAIL: 0, PASS: 0 };
        inspSnap.docs.forEach(d => {
            const status = String(d.data().overallStatus || d.data().status || 'PASS').toUpperCase();
            if (status === 'CRITICAL') riskDistribution.CRITICAL++;
            else if (status === 'FAIL') riskDistribution.FAIL++;
            else riskDistribution.PASS++;
        });
        const totalInspections = inspSnap.size;
        const criticalFailures = riskDistribution.CRITICAL + riskDistribution.FAIL;
        const complianceRate = totalInspections > 0
            ? Math.round(((totalInspections - criticalFailures) / totalInspections) * 100)
            : 100;

        return res.status(200).json({
            success: true,
            totalAssets: fleetSnap.size,
            totalInspections,
            totalStockpiles: stkSnap.size,
            criticalFailures,
            complianceRate,
            riskDistribution,
            dailyActivity: []
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/reports/monthly-pdf', requireAuth, async (req: Request, res: Response) => {
    return res.status(200).json({
        success: true,
        generatedAt: new Date().toISOString(),
        summary: req.body || {}
    });
});

router.get('/admin/catalog-stats', requireAuth, async (_req: Request, res: Response) => {
    try {
        const [globalSnap, tenantSnap] = await Promise.all([
            db.collection('global_asset_catalog').get(),
            db.collection('tenant_assets').get()
        ]);
        const globalCount = globalSnap.size;
        const tenantCount = tenantSnap.size;
        const reuseRatio = globalCount > 0 ? (tenantCount / globalCount).toFixed(2) : '0.00';

        return res.status(200).json({
            success: true,
            globalAssetsCount: globalCount,
            tenantAssetsCount: tenantCount,
            sealedCount: globalSnap.docs.filter(d => d.data().isSealed).length,
            total_global_assets: globalCount,
            total_fleet_deployments: tenantCount,
            active_deployments: tenantCount,
            discarded_deployments: 0,
            reuse_ratio: reuseRatio
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/admin/register-global', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.body.id || `${req.body.brand || 'ASSET'}_${req.body.model || Date.now()}`.toUpperCase().replace(/\s+/g, '_');
        await db.collection('global_asset_catalog').doc(id).set({
            id,
            ...req.body,
            createdAt: Date.now(),
            updatedAt: Date.now()
        }, { merge: true });
        return res.status(201).json({ success: true, id });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/admin/set-user-role', requireAuth, async (req: Request, res: Response) => {
    try {
        const { email, role } = req.body;
        if (!email || !role) return res.status(400).json({ error: 'Email y rol son requeridos' });
        const userRecord = await auth.getUserByEmail(email);
        await auth.setCustomUserClaims(userRecord.uid, { ...(userRecord.customClaims || {}), role });
        await db.collection('users').doc(userRecord.uid).set({ role, updatedAt: Date.now() }, { merge: true });
        return res.status(200).json({ success: true, uid: userRecord.uid, role });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

router.all('/integration/*', requireAuth, async (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, webhooks: [], keys: [] });
});

router.all('/insights/*', requireAuth, async (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, insights: [] });
});

export default router;

