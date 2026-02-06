import { db } from '../config/firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, query, getDocs } from 'firebase/firestore';
import type { JobProfile } from '../types/job_profile';

/**
 * ProfileService
 * 
 * Servicio para gestionar Job Profiles (Perfiles de Cargo) a nivel de cuenta B2B.
 * Cada cuenta tiene su propia subcolección de perfiles completamente aislada.
 * 
 * Estructura Firestore: accounts/{accountId}/job_profiles/{profileId}
 */
export class ProfileService {
    /**
     * Obtiene perfiles de cargo de una cuenta B2B (observable en tiempo real)
     * @param accountId - ID de la cuenta B2B
     * @param callback - Función que recibe la lista actualizada de perfiles
     * @returns Función unsubscribe para detener la escucha
     */
    static getProfiles(accountId: string, callback: (profiles: JobProfile[]) => void): () => void {
        const profilesRef = collection(db, `accounts/${accountId}/job_profiles`);

        return onSnapshot(profilesRef, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as JobProfile[];

            callback(profiles);
        }, (error) => {
            console.error('[ProfileService] Error listening to profiles:', error);
            callback([]);
        });
    }

    /**
     * Obtiene todos los perfiles de una cuenta (una sola vez, no observable)
     * @param accountId - ID de la cuenta B2B
     * @returns Promise con array de perfiles
     */
    static async getProfilesOnce(accountId: string): Promise<JobProfile[]> {
        try {
            const profilesRef = collection(db, `accounts/${accountId}/job_profiles`);
            const q = query(profilesRef);
            const snapshot = await getDocs(q);

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as JobProfile[];
        } catch (error) {
            console.error('[ProfileService] Error fetching profiles:', error);
            return [];
        }
    }

    /**
     * Guarda o actualiza un perfil de cargo
     * @param accountId - ID de la cuenta B2B
     * @param profile - Datos del perfil (parcial para updates)
     * @returns Promise con el ID del perfil guardado
     */
    static async saveProfile(accountId: string, profile: Partial<JobProfile>): Promise<string> {
        try {
            // Generar ID si es un perfil nuevo
            const profileId = profile.id || doc(collection(db, 'temp')).id;
            const profileRef = doc(db, `accounts/${accountId}/job_profiles/${profileId}`);

            const data: Partial<JobProfile> = {
                ...profile,
                id: profileId,
                updatedAt: Date.now(),
                createdAt: profile.createdAt || Date.now()
            };

            await setDoc(profileRef, data, { merge: true });

            console.log('[ProfileService] Profile saved:', profileId);
            return profileId;
        } catch (error) {
            console.error('[ProfileService] Error saving profile:', error);
            throw error;
        }
    }

    /**
     * Elimina un perfil de cargo
     * @param accountId - ID de la cuenta B2B
     * @param profileId - ID del perfil a eliminar
     */
    static async deleteProfile(accountId: string, profileId: string): Promise<void> {
        try {
            const profileRef = doc(db, `accounts/${accountId}/job_profiles/${profileId}`);
            await deleteDoc(profileRef);

            console.log('[ProfileService] Profile deleted:', profileId);
        } catch (error) {
            console.error('[ProfileService] Error deleting profile:', error);
            throw error;
        }
    }

    /**
     * Obtiene un perfil específico por ID
     * @param accountId - ID de la cuenta B2B
     * @param profileId - ID del perfil
     * @param callback - Función que recibe el perfil actualizado
     * @returns Función unsubscribe
     */
    static getProfileById(
        accountId: string,
        profileId: string,
        callback: (profile: JobProfile | null) => void
    ): () => void {
        const profileRef = doc(db, `accounts/${accountId}/job_profiles/${profileId}`);

        return onSnapshot(profileRef, (snapshot) => {
            if (snapshot.exists()) {
                callback({
                    id: snapshot.id,
                    ...snapshot.data()
                } as JobProfile);
            } else {
                callback(null);
            }
        }, (error) => {
            console.error('[ProfileService] Error listening to profile:', error);
            callback(null);
        });
    }
}
