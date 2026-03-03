import { Request, Response } from 'express';
import { db, auth } from '../config/firebase';
import { verifyPassword } from '../utils/security';

/**
 * Normaliza un RUT/RUN chileno en todos los formatos posibles para búsqueda resiliente.
 * Ejemplo: '77.609.112-K' → ['77609112K', '77609112-K', '77.609.112-K']
 */
function getRutVariants(rawTaxId: string): string[] {
    const variants = new Set<string>();

    // 1. Completamente limpio (sin puntos, sin guión)
    const clean = rawTaxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    variants.add(clean);

    if (clean.length >= 2) {
        const body = clean.slice(0, -1); // números
        const dv = clean.slice(-1);     // dígito verificador

        // 2. Con guión: XXXXXXXX-K
        variants.add(`${body}-${dv}`);

        // 3. Con puntos y guión (formato estándar chileno): XX.XXX.XXX-K
        const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
        variants.add(formatted);
    }

    // 4. El valor original también, por si el usuario lo ingresó con formato válido
    const original = rawTaxId.trim().toUpperCase();
    variants.add(original);

    return Array.from(variants);
}

/**
 * @route POST /api/auth/tunnel/challenge
 * @desc Autentica un usuario por RUT/RUN + clave para una cuenta específica
 * @access Public (Step 2 of Login)
 * 
 * Arquitectura "Pasillo de Puertas Blindadas":
 * - Identidad primaria: RUT/RUN del usuario (Chile) — NO el email
 * - El email es solo canal de contacto, no un identificador de acceso
 * - Resolución: user_directory (RUT/RUN) → /users (memberships) → verificar hash
 */
export const challengeAccountAccess = async (req: Request, res: Response) => {
    try {
        const { accountId, taxId, password } = req.body;

        if (!accountId || !taxId || !password) {
            return res.status(400).json({ error: 'accountId, taxId (RUT/RUN) y password son requeridos.' });
        }

        const variants = getRutVariants(taxId);
        console.log(`[AUTH-TUNNEL] Challenge: accountId=${accountId}, RUT/RUN variants=${JSON.stringify(variants)}`);

        // ============================================================
        // PASO 1: Resolver la identidad por RUT/RUN en user_directory
        // ============================================================
        let matchedDirEntry: any = null;
        let foundVariant: string | null = null;

        for (const variant of variants) {
            const dirSnap = await db.collection('user_directory').doc(variant).get();
            if (dirSnap.exists) {
                const dirData = dirSnap.data();
                const accountEntry = (dirData?.accounts || []).find((a: any) => a.accountId === accountId);
                if (accountEntry) {
                    matchedDirEntry = accountEntry;
                    foundVariant = variant;
                    console.log(`[AUTH-TUNNEL] ✅ Identidad resuelta: user_directory["${variant}"]`);
                    break;
                }
            }
        }

        if (!matchedDirEntry) {
            console.warn(`[AUTH-TUNNEL] ❌ Identidad no encontrada para variants: ${JSON.stringify(variants)}`);
            return res.status(404).json({ error: 'RUT/RUN no registrado o sin acceso a esta cuenta.' });
        }

        // El ID del documento en Firestore AHORA ES SIEMPRE la variante limpia (sin puntos ni guion)
        const uid = taxId.replace(/[\.-]/g, '').trim().toUpperCase();

        // ============================================================
        // PASO 2: Buscar el perfil del usuario utilizando su UID fijo
        // ============================================================
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            console.warn(`[AUTH-TUNNEL] ❌ No user document para UID (RUT/RUN): ${uid}`);
            return res.status(404).json({ error: 'Cuenta no inicializada. Contacta a soporte.' });
        }

        const userData = userDoc.data()!;
        const memberships: any[] = userData.memberships || [];

        console.log(`[AUTH-TUNNEL] Usuario encontrado: UID=${userDoc.id}, memberships=${memberships.length}`);

        // ============================================================
        // PASO 3: Buscar el membership — priorizar el que tiene passwordHash
        // ============================================================
        const accountMemberships = memberships.filter((m: any) => m.accountId === accountId);

        if (accountMemberships.length === 0) {
            console.warn(`[AUTH-TUNNEL] ❌ UID ${userDoc.id} no tiene membership para ${accountId}. Cuentas: ${JSON.stringify(memberships.map((m: any) => m.accountId))}`);
            return res.status(403).json({ error: 'Sin acceso a esta cuenta.' });
        }

        // Preferir el membership con passwordHash activo
        const membership = accountMemberships.find((m: any) => !!m.passwordHash) || accountMemberships[0];

        // ============================================================
        // PASO 4: Verificar contraseña
        // ============================================================
        if (!membership.passwordHash) {
            console.warn(`[AUTH-TUNNEL] ❌ passwordHash ausente para account ${accountId}. UID: ${userDoc.id}`);
            return res.status(401).json({ error: 'Cuenta no activada. Revisa tu email de bienvenida para crear tu clave de acceso.' });
        }

        console.log(`[AUTH-TUNNEL-DEBUG] Verificando clave: input_len=${password.length}, hash_len=${membership.passwordHash.length}`);

        const isValid = verifyPassword(password, membership.passwordHash);

        if (!isValid) {
            console.warn(`[AUTH-TUNNEL] ❌ Contraseña incorrecta. account=${accountId}, UID=${userDoc.id}`);
            return res.status(401).json({ error: 'RUT/RUN o contraseña incorrectos.' });
        }

        // ============================================================
        // PASO 5: Emitir Custom Token con claims de sesión
        // ============================================================
        const customToken = await auth.createCustomToken(userDoc.id, {
            activeAccountId: accountId,
            role: membership.role,
            type: membership.type || 'BUSINESS'
        });

        await userDoc.ref.update({
            lastActiveAccountId: accountId,
            lastLogin: new Date().toISOString()
        });

        console.log(`[AUTH-TUNNEL] ✅ Login exitoso. UID=${userDoc.id}, account=${accountId}, role=${membership.role}`);

        return res.status(200).json({
            success: true,
            firebaseToken: customToken,
            user: {
                displayName: userData.displayName || userData.fullName,
                role: membership.role,
                activeAccountId: accountId
            }
        });

    } catch (error) {
        console.error('[AUTH-TUNNEL] Challenge Error:', error);
        return res.status(500).json({ error: 'Error interno durante el challenge de autenticación.' });
    }
};
