import { db, auth } from '../config/firebase';
import { getApiUrl } from '../utils/network';
import { collection, doc, getDoc, setDoc, updateDoc, arrayUnion, query, where, getDocs, limit, deleteDoc } from 'firebase/firestore';
import type { AccountReference, UserDirectory } from '../types/user_directory';

export interface WorkerData {
    run: string;
    fullName: string;
    email: string;
    jobProfileId: string;
}

export interface RecruitResult {
    success: boolean;
    userId?: string;
    isNewUser: boolean;
    error?: string;
}

export class StaffService {
    private static get API_URL() {
        return getApiUrl('/api');
    }

    private static normalizeRun(run: string): string {
        return run.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    }

    private static async getAuthHeaders(accountId?: string): Promise<Record<string, string>> {
        let idToken = '';
        if (auth.currentUser) {
            idToken = await auth.currentUser.getIdToken();
        } else if (typeof window !== 'undefined') {
            idToken = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token') || '';
        }

        if (!idToken) {
            throw new Error('Sesion autenticada requerida para gestionar personal.');
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        };

        if (accountId) {
            headers['X-Active-Account-Id'] = accountId;
        }

        return headers;
    }

    static async recruitWorker(
        accountId: string,
        workerData: WorkerData,
        accountName: string
    ): Promise<RecruitResult> {
        try {
            const normalizedRun = this.normalizeRun(workerData.run);
            const normalizedEmail = workerData.email.toLowerCase().trim();

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
                    error: 'El trabajador ya esta vinculado a esta empresa'
                };
            }

            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', normalizedEmail), limit(1));
            const userSnap = await getDocs(q);

            let userId: string;
            let isNewUser = false;

            if (userSnap.empty) {
                const headers = await this.getAuthHeaders(accountId);
                const response = await fetch(`${this.API_URL}/staff/create-worker`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        email: normalizedEmail,
                        displayName: workerData.fullName,
                        run: normalizedRun,
                        accountId: accountId,
                        accountName: accountName,
                        jobProfileId: workerData.jobProfileId
                    })
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.error || 'Error al crear trabajador en el servidor');
                }

                const { uid } = await response.json();
                userId = uid;
                isNewUser = true;
            } else {
                userId = userSnap.docs[0].id;
                await setDoc(
                    doc(db, 'accounts', accountId, 'members', userId),
                    {
                        userId,
                        email: normalizedEmail,
                        fullName: workerData.fullName,
                        run: normalizedRun,
                        role: 'OPERATOR',
                        jobProfileId: workerData.jobProfileId,
                        status: 'ACTIVE',
                        invitedAt: Date.now(),
                        invitedBy: auth.currentUser?.uid || 'system',
                    },
                    { merge: true }
                );
            }

            const accountReference: AccountReference = {
                accountId: accountId,
                authEmail: normalizedEmail,
                role: 'OPERATOR',
                type: 'BUSINESS',
                accountName: accountName,
                status: 'PENDING',
                jobProfileId: workerData.jobProfileId
            };

            await updateDoc(userDirRef, {
                accounts: arrayUnion(accountReference),
                accountId: accountId,
                updatedAt: Date.now()
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

    static async designateAdmin(
        accountId: string,
        adminData: { run: string, name: string, lastName: string, email: string },
        accountName: string
    ): Promise<RecruitResult> {
        try {
            const normalizedRun = this.normalizeRun(adminData.run);
            const normalizedEmail = adminData.email.toLowerCase().trim();
            const fullName = `${adminData.name} ${adminData.lastName}`.trim();

            const headers = await this.getAuthHeaders(accountId);
            const response = await fetch(`${this.API_URL}/staff/designate-admin`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    email: normalizedEmail,
                    displayName: fullName,
                    run: normalizedRun,
                    accountId: accountId,
                    accountName: accountName
                })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Error al procesar designacion en servidor');
            }

            const { uid, isNewUser } = await response.json();

            const memberRef = doc(db, 'accounts', accountId, 'members', uid);
            await setDoc(memberRef, {
                userId: uid,
                email: normalizedEmail,
                fullName: fullName,
                run: normalizedRun,
                role: 'ADMIN',
                status: 'PENDING',
                invitedAt: Date.now(),
                invitedBy: auth.currentUser?.uid || 'system'
            }, { merge: true });

            return {
                success: true,
                userId: uid,
                isNewUser: isNewUser
            };
        } catch (error: any) {
            console.error('[StaffService] Error en designacion admin:', error);
            return {
                success: false,
                isNewUser: false,
                error: error.message || 'Error inesperado'
            };
        }
    }

    static async getAccountMembers(accountId: string): Promise<any[]> {
        try {
            const membersRef = collection(db, 'accounts', accountId, 'members');
            const snapshot = await getDocs(membersRef);

            return snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            }));
        } catch (error) {
            console.error('[StaffService] Error al obtener miembros:', error);
            return [];
        }
    }

    static async removeMember(accountId: string, userId: string): Promise<boolean> {
        try {
            await deleteDoc(doc(db, 'accounts', accountId, 'members', userId));
            return true;
        } catch (error) {
            console.error('[StaffService] Error al desvincular miembro:', error);
            return false;
        }
    }
}
