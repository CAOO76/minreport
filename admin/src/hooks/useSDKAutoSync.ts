import { useState, useEffect, useRef } from 'react';
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { SDK_METADATA } from '../sdk-bundle/metadata';

/**
 * Hook to automatically synchronize the SDK version with Firestore.
 * Uses SDK_METADATA.version as the SOURCE OF TRUTH for version detection.
 * This is decoupled from the Admin app version (__APP_VERSION__) to ensure
 * that any SDK update is independently detected and registered.
 */
export const useSDKAutoSync = () => {
    const [isSyncing, setIsSyncing] = useState(true);
    const [newVersionDetected, setNewVersionDetected] = useState(false);
    const syncStarted = useRef(false);

    useEffect(() => {
        if (syncStarted.current) return;
        syncStarted.current = true;

        const syncSDK = async () => {
            // ✅ SDK_METADATA.version is the single source of truth
            const sdkVersion = SDK_METADATA.version;

            try {
                const versionsRef = collection(db, 'admin_sdk_versions');
                // Primary check: Document ID (Standard format v2_0_0)
                const docId = `v${sdkVersion.replace(/\./g, '_')}`;
                const versionDocRef = doc(db, 'admin_sdk_versions', docId);
                const versionSnap = await getDoc(versionDocRef);

                if (!versionSnap.exists()) {
                    // Secondary safety check: Search by field (for legacy random IDs)
                    const q = query(versionsRef, where('versionNumber', '==', sdkVersion));
                    const snapshot = await getDocs(q);

                    if (snapshot.empty) {
                        console.log(`🚀 [SDK Sync] New SDK version detected: v${sdkVersion}. Registering with ID ${docId}...`);

                        const changelogStr = Array.isArray(SDK_METADATA.changelog)
                            ? SDK_METADATA.changelog.join('\n')
                            : SDK_METADATA.changelog;

                        await setDoc(versionDocRef, {
                            versionNumber: sdkVersion,
                            changelog: changelogStr,
                            releaseDate: serverTimestamp(),
                            status: SDK_METADATA.status || 'BETA',
                            createdBy: 'System (Auto-Discovery)',
                            author: SDK_METADATA.author
                        });

                        setNewVersionDetected(true);
                        console.log(`✅ [SDK Sync] SDK v${sdkVersion} registered successfully.`);
                    } else {
                        // AUTO-MIGRATION: Merge and clean duplicates
                        console.log(`🧹 [SDK Sync] Legacy records found for v${sdkVersion}. Starting migration...`);

                        // Select the "best" data (STABLE > BETA > DEPRECATED)
                        const docs = snapshot.docs;
                        const stableDoc = docs.find(d => d.data().status === 'STABLE');
                        const betaDoc = docs.find(d => d.data().status === 'BETA');
                        const sourceDoc = stableDoc || betaDoc || docs[0];
                        const sourceData = sourceDoc.data();
                        const { id: _, ...sourceDataWithoutId } = sourceData;

                        // 1. Create the unique record first to ensure safety
                        await setDoc(versionDocRef, sourceDataWithoutId);

                        // 2. Delete ALL legacy records for this version number
                        const deletePromises = docs.map(d => deleteDoc(d.ref));
                        await Promise.all(deletePromises);

                        console.log(`✅ [SDK Sync] Migration of v${sdkVersion} complete. Duplicates removed.`);
                    }
                } else {
                    console.log(`🛡️ [SDK Sync] SDK v${sdkVersion} is already registered. Up to date.`);
                }
            } catch (error) {
                console.error('❌ [SDK Sync] Error during auto-synchronization:', error);
            } finally {
                setIsSyncing(false);
            }
        };

        syncSDK();
    }, []);

    return { isSyncing, newVersionDetected };
};
