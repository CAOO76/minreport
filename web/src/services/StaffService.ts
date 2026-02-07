import { db } from '../config/firebase';
import { getApiUrl } from '../utils/network';
import { collection, doc, getDoc, setDoc, updateDoc, arrayUnion, query, where, getDocs, limit } from 'firebase/firestore';
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
 */
export class StaffService {
    private static get API_URL() {
        return getApiUrl('/api');
    }

    /**
     * Normaliza un RUN/RUT para búsquedas consistentes
     */
    private static normalizeRun(run: string): string {
        return run.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    }

    /**
     * Alta de trabajador con vinculación al directorio global
     */
    static async recruitWorker(
        accountId: string,
        workerData: WorkerData,
        accountName: string,
        currentUserId: string
    ): Promise<RecruitResult> {
        try {
            const normalizedRun = this.normalizeRun(workerData.run);
            const normalizedEmail = workerData.email.toLowerCase().trim();

            console.log('[StaffService] Iniciando onboarding:', {
                run: normalizedRun,
                email: normalizedEmail,
                accountId
            });

            // PASO A: Consultar/Crear en user_directory
            const userDirRef = doc(db, 'user_directory', normalizedRun);
            const userDirSnap = await getDoc(userDirRef);

            let userDirectory: UserDirectory;

            if (!userDirSnap.exists()) {
                userDirectory = {
                    run: normalizedRun,
                    fullName: workerData.fullName,
                    accounts: [],
                    accountId: accountId,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                await setDoc(userDirRef, userDirectory);
            } else {
                userDirectory = userDirSnap.data() as UserDirectory;
            }

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

            // PASO B: Verificar/Crear usuario en Firebase Auth
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', normalizedEmail), limit(1));
            const userSnap = await getDocs(q);

            let userId: string;
            let isNewUser = false;

            if (userSnap.empty) {
                const response = await fetch(`${this.API_URL}/staff/create-worker`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
            } else {
                userId = userSnap.docs[0].id;
            }

            // PASO C: Vincular cuenta en user_directory
            const accountReference: AccountReference = {
                accountId: accountId,
                authEmail: normalizedEmail,
                role: 'OPERATOR',
                type: 'BUSINESS',
                accountName: accountName,
                jobProfileId: workerData.jobProfileId
            };

            await updateDoc(userDirRef, {
                accounts: arrayUnion(accountReference),
                accountId: accountId,
                updatedAt: Date.now()
            });

            // PASO D: Agregar miembro a la cuenta
            const memberRef = doc(db, 'accounts', accountId, 'members', userId);
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
                error: error.message || 'Error desconocido'
            };
        }
    }

    static async getAccountMembers(accountId: string): Promise<any[]> {
        try {
            const membersRef = collection(db, 'accounts', accountId, 'members');
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

    static async removeMember(_accountId: string, _userId: string): Promise<boolean> {
        return false;
    }
}
