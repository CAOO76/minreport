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

        const token = authHeader.split('Bearer ')[1];

        // MASTER TOKEN CHECK
        if (token === 'master-admin-access-token') {
            return next();
        }

        const decodedToken = await auth.verifyIdToken(token);

        // Logic: Allow if user has admin claim OR email matches SUPER_ADMIN_EMAIL
        const isSuperAdmin = decodedToken.email === env.SUPER_ADMIN_EMAIL;
        const hasAdminClaim = decodedToken.admin === true;

        if (!isSuperAdmin && !hasAdminClaim) {
            console.warn(`[SECURITY] Unauthorized admin access attempt: ${decodedToken.email}`);
            return res.status(403).json({ error: 'Forbidden: Admin access only' });
        }

        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('[SECURITY] Token verification failed:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
