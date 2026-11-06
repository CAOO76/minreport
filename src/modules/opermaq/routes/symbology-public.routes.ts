import { Router, type Request, type Response } from 'express';
import { downloadSymbologyAssetBuffer } from '../services/SymbologyService';

/**
 * OPERMAQ — Proxy Público de Activos Gráficos y Simbología ISO 7000
 * Sirve iconos vectoriales/rasterizados y miniaturas técnicas desde Cloud Storage
 * con directivas de caché inmutable para activos definitivos (Capa 1).
 */

const symbologyPublicRouter = Router();

symbologyPublicRouter.get(
    ['/public/simbologia/image-proxy', '/api/public/simbologia/image-proxy'],
    async (req: Request, res: Response) => {
        const filePath = req.query.path;
        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'Parámetro path requerido.' });
        }

        // Prevención estricta de path traversal y restricción exclusiva a simbología pública (bloquea visual_inspections/ y vault_assets/ privados)
        const normalizedPath = filePath.replace(/^\/+/, '');
        if (
            normalizedPath.includes('..') ||
            (!normalizedPath.startsWith('assets/symbology/') &&
                !normalizedPath.startsWith('cas_blobs/symbology/'))
        ) {
            return res.status(403).json({ error: 'Ruta de almacenamiento no autorizada.' });
        }

        try {
            const { buffer, contentType } = await downloadSymbologyAssetBuffer(normalizedPath);
            const isTemp = normalizedPath.includes('/temp_') || normalizedPath.includes('_temp');

            res.setHeader('Content-Type', contentType);
            res.setHeader(
                'Cache-Control',
                isTemp ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable'
            );
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

            return res.status(200).send(buffer);
        } catch (err: any) {
            if (err?.code === 404 || String(err?.message || '').includes('No such object')) {
                return res.status(404).json({ error: 'Recurso gráfico no encontrado.' });
            }
            console.error('[OPERMAQ-IMAGE-PROXY] Error sirviendo activo:', err?.message || err);
            return res.status(500).json({ error: 'Error al recuperar recurso gráfico.' });
        }
    }
);

export default symbologyPublicRouter;

