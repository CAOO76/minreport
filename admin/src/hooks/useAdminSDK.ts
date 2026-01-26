import { useState, useCallback } from 'react';
import {
    collection,
    query,
    orderBy,
    getDocs,
    addDoc,
    where,
    limit,
    Timestamp,
    doc,
    updateDoc,
    deleteDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { SDKVersion, NewSDKVersion, SDKStatus } from '../types/sdk-admin';

/**
 * Hook to manage SDK versions in the Admin Panel.
 * Handles fetching list, publishing new versions, and getting the latest stable version.
 */
export const useAdminSDK = () => {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [versions, setVersions] = useState<SDKVersion[]>([]);

    /**
     * Fetches all SDK versions from Firestore ordered by release date descending.
     */
    const fetchVersions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const versionsRef = collection(db, 'admin_sdk_versions');
            const q = query(versionsRef, orderBy('releaseDate', 'desc'));
            const querySnapshot = await getDocs(q);

            const docs = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as SDKVersion[];

            setVersions(docs);
            return docs;
        } catch (err: any) {
            console.error('Error fetching SDK versions:', err);
            setError(err.message || 'Error fetching SDK versions');
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Publishes a new SDK version document to Firestore.
     */
    const publishVersion = useCallback(async (versionData: NewSDKVersion) => {
        setLoading(true);
        setError(null);
        try {
            const versionsRef = collection(db, 'admin_sdk_versions');
            const docRef = await addDoc(versionsRef, {
                ...versionData,
                releaseDate: versionData.releaseDate || Timestamp.now()
            });

            // Re-fetch to update local state
            await fetchVersions();
            return docRef.id;
        } catch (err: any) {
            console.error('Error publishing SDK version:', err);
            setError(err.message || 'Error publishing SDK version');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [fetchVersions]);

    /**
     * Updates the status of an existing SDK version.
     */
    const updateVersionStatus = useCallback(async (id: string, newStatus: SDKStatus) => {
        setLoading(true);
        setError(null);
        try {
            const versionRef = doc(db, 'admin_sdk_versions', id);
            await updateDoc(versionRef, { status: newStatus });

            // Re-fetch to update local state
            await fetchVersions();
        } catch (err: any) {
            console.error('Error updating SDK version status:', err);
            setError(err.message || 'Error updating status');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [fetchVersions]);

    /**
     * Deletes an SDK version (useful for cleaning duplicates).
     */
    const deleteVersion = useCallback(async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            const versionRef = doc(db, 'admin_sdk_versions', id);
            await deleteDoc(versionRef);

            // Re-fetch to update local state
            await fetchVersions();
        } catch (err: any) {
            console.error('Error deleting SDK version:', err);
            setError(err.message || 'Error deleting version');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [fetchVersions]);

    /**
     * Gets the latest SDK version marked as 'STABLE'.
     */
    const getLatestVersion = useCallback(async () => {
        // ... (existing implementation)
        setLoading(true);
        setError(null);
        try {
            const versionsRef = collection(db, 'admin_sdk_versions');
            const q = query(
                versionsRef,
                where('status', '==', 'STABLE'),
                orderBy('releaseDate', 'desc'),
                limit(1)
            );
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const doc = querySnapshot.docs[0];
                return {
                    id: doc.id,
                    ...doc.data()
                } as SDKVersion;
            }
            return null;
        } catch (err: any) {
            console.error('Error getting latest stable SDK version:', err);
            setError(err.message || 'Error getting latest stable SDK version');
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        loading,
        error,
        versions,
        fetchVersions,
        publishVersion,
        updateVersionStatus,
        deleteVersion,
        getLatestVersion
    };
};
