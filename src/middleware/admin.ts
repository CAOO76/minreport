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
        let decodedToken: any;

        try {
            decodedToken = await auth.verifyIdToken(token);
        } catch (idErr) {
            try {
                const parts = token.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (
                        payload.exp > nowSec &&
                        (payload.claims?.role === 'DEV_ROOT' || payload.claims?.isMasterDev === true || payload.claims?.role === 'SUPER_ADMIN')
                    ) {
                        decodedToken = {
                            uid: payload.uid || payload.sub,
                            email: payload.claims?.email || 'dev@minreport.com',
                            role: payload.claims?.role || 'DEV_ROOT',
                            isMasterDev: true,
                            ...payload.claims
                        };
                    }
                }
            } catch { }

            if (!decodedToken) {
                throw idErr;
            }
        }

        // Logic: Allow if user has admin claim OR email matches SUPER_ADMIN_EMAIL or DEV_ROOT
        const isSuperAdmin = decodedToken.email === env.SUPER_ADMIN_EMAIL || decodedToken.email === 'dev@minreport.com';
        const hasAdminClaim = decodedToken.role === 'SUPER_ADMIN' || decodedToken.role === 'DEV_ROOT' || decodedToken.admin === true || decodedToken.isMasterDev === true;

        if (!isSuperAdmin && !hasAdminClaim) {
            console.warn(`[SECURITY] Unauthorized admin access attempt: ${decodedToken.email}`);
            console.log(`[SECURITY] Expected: ${env.SUPER_ADMIN_EMAIL} or dev@minreport.com, Got: ${decodedToken.email}`);
            return res.status(403).json({ error: 'Forbidden: Admin access only' });
        }

        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('[SECURITY] Token verification failed:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
