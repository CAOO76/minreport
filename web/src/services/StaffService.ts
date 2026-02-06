import { db } from '../config/firebase';
import { collection, doc, getDoc, setDoc, updateDoc, arrayUnion, query, where, getDocs } from 'firebase/firestore';
import type { AccountReference, UserDirectory } from '../types/user_directory';

/**
 * WorkerData - Datos de entrada para alta de trabajador
 */
export interface WorkerData {
    run: string;           // RUN del trabajador (será normalizado)
    fullName: string;      // Nombre completo
    email: string;         // Email específico para esta cuenta
    jobProfileId: string;  // ID del perfil de cargo asignado
}

/**
 * RecruitResult - Resultado del proceso de onboarding
 */
export interface RecruitResult {
    success: boolean;
    userId?: string;
    isNewUser: boolean;
    error?: string;
}

/**
 * StaffService
 * 
 * Servicio para gestionar el onboarding de trabajadores en empresas B2B.
 * Implementa el flujo transaccional que conecta:
 * - Directorio de Identidad Global (user_directory)
 * - Perfiles de Cargo (job_profiles)
 * - Membresías de Cuenta (accounts/{accountId}/members)
 * 
 * Arquitectura "El Trabajador":
 * A. Consultar/crear en user_directory
 * B. Verificar/crear usuario en Firebase Auth (vía backend API)
 * C. Vincular cuenta en user_directory (arrayUnion)
 * D. Agregar miembro a accounts/{accountId}/members
 */
export class StaffService {
    private static API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

    /**
     * Normaliza un RUN/RUT para búsquedas consistentes
     */
    private static normalizeRun(run: string): string {
        return run.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    }

    /**
     * Alta de trabajador con vinculación al directorio global
     * 
     * @param accountId - ID de la cuenta B2B
     * @param workerData - Datos del trabajador
     * @param accountName - Nombre de la empresa (para mostrar en user_directory)
     * @param currentUserId - UID del usuario que realiza la invitación
     * @returns Promise con resultado del proceso
     */
    static async recruitWorker(
        accountId: string,
        workerData: WorkerData,
        accountName: string,
        currentUserId: string
    ): Promise<RecruitResult> {
        try {
            // Normalizar datos de entrada
            const normalizedRun = this.normalizeRun(workerData.run);
            const normalizedEmail = workerData.email.toLowerCase().trim();

            console.log('[StaffService] Iniciando onboarding:', {
                run: normalizedRun,
                email: normalizedEmail,
                accountId
            });

            // ========================================
            // PASO A: Consultar/Crear en user_directory
            // ========================================
            const userDirRef = doc(db, `user_directory/${normalizedRun}`);
            const userDirSnap = await getDoc(userDirRef);

            let userDirectory: UserDirectory;

            if (!userDirSnap.exists()) {
                // Crear nueva entrada en directorio global
                console.log('[StaffService] Creando nueva entrada en user_directory');

                userDirectory = {
                    run: normalizedRun,
                    fullName: workerData.fullName,
                    accounts: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };

                await setDoc(userDirRef, userDirectory);
            } else {
                // Usuario ya existe en directorio
                console.log('[StaffService] Usuario encontrado en user_directory');
                userDirectory = userDirSnap.data() as UserDirectory;
            }

            // Verificar si ya está vinculado a esta cuenta
            const existingLink = userDirectory.accounts?.find(
                acc => acc.accountId === accountId
            );

            if (existingLink) {
                return {
                    success: false,
                    isNewUser: false,
                    error: 'El trabajador ya está vinculado a esta empresa'
                };
            }

            // ========================================
            // PASO B: Verificar/Crear usuario en Firebase Auth
            // ========================================
            console.log('[StaffService] Verificando usuario en Auth...');

            // Buscar usuario existente por email en Firestore
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', normalizedEmail));
            const userSnap = await getDocs(q);

            let userId: string;
            let isNewUser = false;

            if (userSnap.empty) {
                // Usuario nuevo - crear en Firebase Auth vía backend
                console.log('[StaffService] Creando nuevo usuario en Auth');

                try {
                    const response = await fetch(`${this.API_URL}/api/staff/create-worker`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email: normalizedEmail,
                            displayName: workerData.fullName,
                            run: normalizedRun,
                            accountId: accountId
                        })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Error al crear usuario');
                    }

                    const { uid } = await response.json();
                    userId = uid;
                    isNewUser = true;

                    console.log('[StaffService] Usuario creado con UID:', userId);
                } catch (error) {
                    console.error('[StaffService] Error al crear usuario:', error);
                    throw new Error('No se pudo crear el usuario en Firebase Auth');
                }
            } else {
                // Usuario existente
                userId = userSnap.docs[0].id;
                console.log('[StaffService] Usuario existente encontrado:', userId);
            }

            // ========================================
            // PASO C: Vincular cuenta en user_directory
            // ========================================
            console.log('[StaffService] Vinculando cuenta en user_directory');

            const accountReference: AccountReference = {
                accountId: accountId,
                authEmail: normalizedEmail,
                role: 'OPERATOR',
                type: 'BUSINESS',
                accountName: accountName,
                avatar: undefined,
                jobProfileId: workerData.jobProfileId
            };

            await updateDoc(userDirRef, {
                accounts: arrayUnion(accountReference),
                updatedAt: Date.now()
            });

            // ========================================
            // PASO D: Agregar miembro a la cuenta
            // ========================================
            console.log('[StaffService] Agregando miembro a la cuenta');

            const memberRef = doc(db, `accounts/${accountId}/members/${userId}`);
            await setDoc(memberRef, {
                userId: userId,
                email: normalizedEmail,
                fullName: workerData.fullName,
                run: normalizedRun,
                jobProfileId: workerData.jobProfileId,
                role: 'OPERATOR',
                status: isNewUser ? 'PENDING' : 'ACTIVE',
                invitedAt: Date.now(),
                invitedBy: currentUserId
            });

            // También actualizar el documento del usuario en 'users' collection
            const userDocRef = doc(db, `users/${userId}`);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                // Actualizar memberships
                const userData = userDocSnap.data();
                const memberships = userData.memberships || [];

                // Verificar si ya tiene membership para esta cuenta
                const hasMembership = memberships.some((m: any) => m.accountId === accountId);

                if (!hasMembership) {
                    await updateDoc(userDocRef, {
                        memberships: arrayUnion({
                            accountId: accountId,
                            role: 'OPERATOR',
                            companyName: accountName,
                            joinedAt: Date.now(),
                            jobProfileId: workerData.jobProfileId
                        }),
                        updatedAt: Date.now()
                    });
                }
            } else {
                // Crear documento de usuario si no existe
                await setDoc(userDocRef, {
                    uid: userId,
                    email: normalizedEmail,
                    taxId: normalizedRun,
                    fullName: workerData.fullName,
                    role: 'USER',
                    memberships: [{
                        accountId: accountId,
                        role: 'OPERATOR',
                        companyName: accountName,
                        joinedAt: Date.now(),
                        jobProfileId: workerData.jobProfileId
                    }],
                    status: isNewUser ? 'PENDING' : 'ACTIVE',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            console.log('[StaffService] ✅ Onboarding completado exitosamente');

            return {
                success: true,
                userId: userId,
                isNewUser: isNewUser
            };

        } catch (error: any) {
            console.error('[StaffService] Error en onboarding:', error);
            return {
                success: false,
                isNewUser: false,
                error: error.message || 'Error desconocido en el proceso de onboarding'
            };
        }
    }

    /**
     * Obtiene los miembros de una cuenta
     */
    static async getAccountMembers(accountId: string): Promise<any[]> {
        try {
            const membersRef = collection(db, `accounts/${accountId}/members`);
            const snapshot = await getDocs(membersRef);

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('[StaffService] Error al obtener miembros:', error);
            return [];
        }
    }

    /**
     * Elimina un miembro de una cuenta
     */
    static async removeMember(_accountId: string, _userId: string): Promise<boolean> {
        try {
            // TODO: Implementar lógica de eliminación
            // - Remover de accounts/{accountId}/members
            // - Remover de user_directory.accounts (arrayRemove)
            // - Actualizar memberships en users/{userId}

            console.log('[StaffService] TODO: Implementar removeMember');
            return false;
        } catch (error) {
            console.error('[StaffService] Error al remover miembro:', error);
            return false;
        }
    }
}
