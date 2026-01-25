
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
        key: 'topografia',
        label: 'Topografía',
        description: 'Módulo integral de levantamiento y análisis topográfico.',
        icon: 'landscape',
        status: 'OPERATIONAL',
        createdAt: new Date(),
        updatedAt: new Date(),
        observations: []
    },
    {
        key: 'finanzas',
        label: 'Finanzas',
        description: 'Gestión de costos, presupuestos y proyecciones financieras.',
        icon: 'account_balance_wallet',
        status: 'OPERATIONAL',
        createdAt: new Date(),
        updatedAt: new Date(),
        observations: []
    },
    {
        key: 'transporte',
        label: 'Transporte',
        description: 'Logística, flotas y control de rutas.',
        icon: 'local_shipping',
        status: 'OPERATIONAL',
        createdAt: new Date(),
        updatedAt: new Date(),
        observations: []
    },
    {
        key: 'perforacion',
        label: 'Perforación',
        description: 'Control de sondajes y operación de maquinaria de perforación.',
        icon: 'precision_manufacturing',
        status: 'OPERATIONAL',
        createdAt: new Date(),
        updatedAt: new Date(),
        observations: []
    }
];

async function seedPlugins() {
    console.log("Seeding plugins collection...");
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
    console.log("✅ Plugins seeded successfully.");
}

seedPlugins().catch(console.error);
