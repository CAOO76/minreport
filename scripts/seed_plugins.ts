
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";

initializeApp({
    projectId: "minreport-8f2a8"
});

const db = getFirestore();

interface Plugin {
    key: string;
    label: string;
    description: string;
    icon: string;
    status: 'OPERATIONAL' | 'TESTING';
    createdAt: Date;
    updatedAt: Date;
    observations: any[];
}

const INITIAL_PLUGINS: Plugin[] = [
    {
        key: 'stockpile-control',
        label: 'Control de Acopios',
        description: 'Gestión y monitoreo de inventario de mineral en tiempo real.',
        icon: 'inventory_2',
        status: 'OPERATIONAL',
        createdAt: new Date(),
        updatedAt: new Date(),
        observations: []
    }
];

async function seedPlugins() {
    console.log("Limpiando colección de plugins y re-sembrando sólo reales...");

    // 1. Borrar existentes para eliminar mocks
    const snapshot = await db.collection('plugins').get();
    const deleteBatch = db.batch();
    snapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
    console.log("🗑️ Mocks eliminados.");

    // 2. Sembrar reales
    const batch = db.batch();
    for (const plugin of INITIAL_PLUGINS) {
        const ref = db.collection('plugins').doc(plugin.key);
        batch.set(ref, {
            ...plugin,
            createdAt: Timestamp.fromDate(plugin.createdAt),
            updatedAt: Timestamp.fromDate(plugin.updatedAt)
        });
    }

    await batch.commit();
    console.log("✅ Catálogo de plugins reales actualizado.");
}

seedPlugins().catch(console.error);
