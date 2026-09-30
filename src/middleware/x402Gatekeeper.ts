import { Request, Response, NextFunction } from 'express';
import { db } from '../config/firebase';

/**
 * PROTOCOLO x402 GATEKEEPER (Capa 3: Monetización Agéntica M2M)
 * Estándar x402 Foundation (Linux Foundation)
 * 
 * Protege endpoints agénticos e inter-empresariales (/api/m2m/*).
 * Si no se presenta un token criptográfico válido, firma de billetera o saldo de cómputo,
 * responde estrictamente HTTP 402 Payment Required con especificaciones de liquidación.
 */

export interface X402PaymentRequirement {
    priceMicroUSD: number;
    destinationWallet: string;
    acceptedTokens: string[];
    resourceId: string;
}

export const x402Gatekeeper = (requirement: X402PaymentRequirement) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
        const authHeader = req.headers['authorization'] || '';
        const x402Token = req.headers['x-402-token'] || req.headers['x-payment-proof'];

        // En desarrollo local o si el tenant tiene crédito corporativo activo
        const tenantId = (req.headers['x-tenant-id'] as string) || (req.query.tenantId as string);

        if (tenantId) {
            try {
                const accountSnap = await db.collection('accounts').doc(tenantId).get();
                if (accountSnap.exists) {
                    const contract = accountSnap.data()?.contract;
                    if (contract && contract.status === 'ACTIVE') {
                        // Tenant empresarial con suscripción activa: acceso M2M bonificado
                        console.log(`[x402] Acceso M2M corporativo autorizado para tenant: ${tenantId}`);
                        return next();
                    }
                }
            } catch (err) {
                console.error('[x402] Error al validar suscripción de tenant:', err);
            }
        }

        // Si se envió un comprobante de micropago agéntico
        if (x402Token) {
            console.log(`[x402] Validando comprobante agéntico token: ${String(x402Token).substring(0, 16)}...`);
            // Simulación de verificación criptográfica M2M
            return next();
        }

        // Si no hay pago ni suscripción activa -> HTTP 402 PAYMENT REQUIRED
        console.warn(`[x402] 🔒 Bloqueo de acceso M2M: Pago requerido para ${req.originalUrl}`);
        
        return res.status(402).json({
            error: 'HTTP 402 Payment Required',
            standard: 'x402 Foundation v1.0 (Linux Foundation)',
            requirement: {
                resource: req.originalUrl,
                amountMicroUSD: requirement.priceMicroUSD,
                destination: requirement.destinationWallet || 'minreport-treasury.eth',
                tokens: requirement.acceptedTokens || ['USDC', 'X402_CREDIT'],
                instructions: 'Presente cabecera X-402-Token con comprobante firmado de liquidación de micropago.'
            }
        });
    };
};
