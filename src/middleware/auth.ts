import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';

export interface AuthRequest extends Request {
    user?: any;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No token provided' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: Empty token' });
        }

        // Verificación criptográfica estricta (soporta Auth Emulator cuando FIREBASE_AUTH_EMULATOR_HOST está activo)
        const decodedToken = await auth.verifyIdToken(token);

        req.user = decodedToken;
        return next();
    } catch (error) {
        console.error('[SECURITY] Token verification failed:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
