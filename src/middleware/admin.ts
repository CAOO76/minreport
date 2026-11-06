import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { env } from '../config/env';

export interface AuthRequest extends Request {
    user?: any;
}

export const requireSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No token provided' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: Empty token' });
        }

        // Prohibido decodificar JWT sin firma: toda validación pasa por Firebase Admin Auth
        const decodedToken = await auth.verifyIdToken(token);

        const emailLower = String(decodedToken.email || '').toLowerCase();
        const emailVerifiedOk = decodedToken.email_verified !== false;

        const hasVerifiedClaimOrMasterUid =
            decodedToken.role === 'SUPER_ADMIN' ||
            decodedToken.role === 'DEV_ROOT' ||
            decodedToken.admin === true ||
            decodedToken.isMasterDev === true ||
            decodedToken.uid === 'super-admin-uid' ||
            decodedToken.uid === 'dev-master-root-uid';

        const isVerifiedMasterEmail =
            emailVerifiedOk &&
            (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() ||
                emailLower === 'admin@minreport.com' ||
                emailLower === 'dev@minreport.com');

        if (!hasVerifiedClaimOrMasterUid && !isVerifiedMasterEmail) {
            console.warn(`[SECURITY] Unauthorized admin access attempt: ${decodedToken.uid} (${emailLower})`);
            return res.status(403).json({ error: 'Forbidden: Admin access only' });
        }

        req.user = decodedToken;
        return next();
    } catch (error) {
        console.error('[SECURITY] Token verification failed:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
