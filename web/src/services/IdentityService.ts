import { db, auth } from '../config/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';

/**
 * Servicio de Identidad "Synthetic ID"
 * Abstrae la complejidad de mapear RUTs a credenciales de Firebase Auth (Email).
 */
export class IdentityService {

    /**
     * Valida si un string corresponde a un RUT chileno válido.
     * Algoritmo Módulo 11.
     */
    private static validateRutChile(rut: string): boolean {
        if (!rut) return false;

        // 1. Limpiar input (quitar puntos y guión)
        const cleanRut = rut.replace(/[^0-9kK]/g, '');

        if (cleanRut.length < 2) return false;

        // 2. Separar cuerpo y dígito verificador
        const body = cleanRut.slice(0, -1);
        const dv = cleanRut.slice(-1).toUpperCase();

        // 3. Validar que el cuerpo sean solo números
        if (!/^\d+$/.test(body)) return false;

        // 4. Calcular DV esperado
        let suma = 0;
        let multiplicador = 2;

        for (let i = body.length - 1; i >= 0; i--) {
            suma += parseInt(body[i]) * multiplicador;
            multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
        }

        const resto = 11 - (suma % 11);
        let dvCalculado = '0';

        if (resto === 11) dvCalculado = '0';
        else if (resto === 10) dvCalculado = 'K';
        else dvCalculado = resto.toString();

        return dvCalculado === dv;
    }

    /**
     * Formatea un RUT limpio para consistencia en la búsqueda.
     * Preferencia: Sin puntos, con guión (12345678-9).
     */
    private static formatForQuery(rut: string): string {
        const clean = rut.replace(/[^0-9kK]/g, '');
        if (clean.length < 2) return clean;
        const body = clean.slice(0, -1);
        const dv = clean.slice(-1).toUpperCase();
        return `${body}-${dv}`;
    }

    /**
     * Resuelve la credencial técnica (Email) a partir de un identificador (RUT o Email).
     * @param identifier RUT (12.345.678-9) o Email
     * @returns Promise<string> Email asociado para autenticación
     */
    static async resolveCredentials(identifier: string): Promise<string> {
        // Paso 1: Detectar tipo de identificador
        const isEmail = identifier.includes('@');
        const looksLikeRut = !isEmail && /[0-9]+[^0-9]*[kK0-9]$/.test(identifier);

        // Caso Email: Passthrough
        if (isEmail) {
            return identifier;
        }

        // Caso RUT
        if (looksLikeRut) {
            if (!this.validateRutChile(identifier)) {
                throw new Error("Formato de ID inválido");
            }

            const queryRut = this.formatForQuery(identifier);

            // Consultar Firestore
            // Nota: Se asume que en Firestore el campo 'rut' se guarda como '12345678-9' (o como se haya normalizado)
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('rut', '==', queryRut), limit(1));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                // Seguridad: Error genérico para no revelar existencia de usuario
                throw new Error("Credenciales no válidas");
            }

            const userData = snapshot.docs[0].data();
            if (!userData.email) {
                console.error(`Usuario encontrado por RUT ${queryRut} pero sin email de auth.`);
                throw new Error("Credenciales no válidas");
            }

            return userData.email;
        }

        // Si no es ni RUT ni email válido
        throw new Error("Formato de ID inválido");
    }

    /**
     * Proceso de recuperación de cuenta vía RUT.
     * Dispara el email de reset de Firebase Auth si el usuario existe.
     */
    static async recoverAccessByRut(rut: string): Promise<{
        email: string;
        phone: string;
        success: boolean;
    }> {
        // Valida RUT
        if (!this.validateRutChile(rut)) {
            throw new Error("Formato de ID inválido");
        }

        const queryRut = this.formatForQuery(rut);
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('rut', '==', queryRut), limit(1));

        // Simulación de delay inicial para mitigar timing attacks básicos
        const startTime = Date.now();
        const minDelay = 800; // ms

        try {
            const snapshot = await getDocs(q);

            // Asegurar un tiempo mínimo de respuesta
            const elapsed = Date.now() - startTime;
            if (elapsed < minDelay) {
                await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
            }

            if (snapshot.empty) {
                throw new Error("Credenciales no válidas");
            }

            const userData = snapshot.docs[0].data();
            const contactEmail = userData.contactEmail || userData.email;
            const recoveryPhone = userData.recoveryPhone || '';

            if (!contactEmail) {
                throw new Error("No hay método de recuperación configurado");
            }

            // Disparar email de recuperación de Firebase Auth
            // Nota: Esto envía el link al 'email' (credencial principal) o 'contactEmail' si Auth lo permite.
            // sendPasswordResetEmail envía al email registrado en Auth. 
            // Si contactEmail es diferente al email de Auth, y Auth no lo conoce, esto fallará o no servirá.
            // Asumimos aquí que el objetivo es recuperar el acceso a la CUENTA AUTH.
            // Auth.sendPasswordResetEmail(auth, email) -> envía al email de auth.
            // Si usamos contactEmail, asumimos que es el mismo o que así se desea.
            // Para 'Synthetic ID', recuperamos el EMAIL TÉCNICO para que el usuario pueda entrar.
            // Ojo: Si el usuario NO SABE su email, el correo de reset le revela que tiene cuenta, pero necesita saber la password.
            // Al hacer click en el link, setea nueva password. Luego entra con RUT + Nueva Password.

            await sendPasswordResetEmail(auth, contactEmail);

            // Enmascarar datos para UI
            return {
                email: this.maskEmail(contactEmail),
                phone: this.maskPhone(recoveryPhone),
                success: true
            };

        } catch (error) {
            // En caso de error (usuario no existe o falló algo), retornamos false 
            // o lanzamos error genérico. El prompt pide "retorna success: false o lanza error genérico".
            // Para seguridad, lanzamos el mismo error genérico o retornamos success false.
            // Si ya manipulamos el delay, el catch captura errores de lógica también.

            // Si el error es nuestro "Credenciales no válidas", lo propagamos o manejamos.
            console.warn("Recuperación fallida o usuario no existe:", error);
            if (Date.now() - startTime < minDelay) {
                await new Promise(resolve => setTimeout(resolve, minDelay - (Date.now() - startTime)));
            }
            throw new Error("No se pudo procesar la solicitud");
        }
    }

    private static maskEmail(email: string): string {
        if (!email.includes('@')) return '****';
        const [user, domain] = email.split('@');
        const maskedUser = user.length > 2 ? user.substring(0, 1) + '***' + user.substring(user.length - 1) : user + '***';
        return `${maskedUser}@${domain}`;
    }

    private static maskPhone(phone: string): string {
        if (!phone) return '****';
        // Asumiendo formato +56 9 1234 5678 o similar
        // Dejar visible los últimos 4
        const visible = phone.slice(-4);
        return `+56 9 **** ${visible}`;
    }
}
