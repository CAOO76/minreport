import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

function assertSafeScriptEnvironment(): void {
    const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (!isEmulator && process.env.CONFIRM_PRODUCTION_SCRIPT !== "ACTUALIZAR") {
        console.error(
            "[ABORTADO] Ejecución fuera del emulador bloqueada. Defina FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST o establezca explícitamente CONFIRM_PRODUCTION_SCRIPT=ACTUALIZAR."
        );
        process.exit(1);
    }
}

assertSafeScriptEnvironment();

if (getApps().length === 0) {
    initializeApp({
        projectId: process.env.GCP_PROJECT_ID || "minreport-8f2a8",
    });
}

const db = getFirestore();
const auth = getAuth();

async function createSuperAdmin(): Promise<void> {
    const email = (process.env.SUPER_ADMIN_EMAIL || "admin@minreport.com").trim().toLowerCase();
    const password = (process.env.SUPER_ADMIN_PASSWORD || "").trim();

    if (!password || password.length < 10) {
        throw new Error(
            "La variable de entorno SUPER_ADMIN_PASSWORD (mínimo 10 caracteres) es obligatoria. Cero contraseñas hardcodeadas."
        );
    }

    console.log(`[CREATE-ADMIN] Verificando cuenta ${email}...`);

    let uid: string;
    try {
        const userRecord = await auth.getUserByEmail(email);
        uid = userRecord.uid;
        console.log(`[CREATE-ADMIN] Usuario existente con UID: ${uid}`);
    } catch (error: any) {
        if (error.code === "auth/user-not-found") {
            const userRecord = await auth.createUser({
                email,
                password,
                emailVerified: true,
                displayName: "Super Admin",
            });
            uid = userRecord.uid;
            console.log(`[CREATE-ADMIN] Usuario creado con UID: ${uid}`);
        } else {
            throw error;
        }
    }

    await auth.setCustomUserClaims(uid, { role: "SUPER_ADMIN", admin: true });

    await db.collection("users").doc(uid).set(
        {
            uid,
            email,
            displayName: "Super Admin",
            role: "SUPER_ADMIN",
            status: "ACTIVE",
            entitlements: {
                pluginsEnabled: ["opermaq", "stockpile"],
                canAssignRoles: true,
                storageLimit: 10737418240,
            },
            stats: {
                storageUsed: 0,
                lastLogin: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
        },
        { merge: true }
    );

    console.log(`[CREATE-ADMIN] Super Admin configurado correctamente para ${email} (credenciales omitidas de consola).`);
}

createSuperAdmin().catch((err) => {
    console.error("[CREATE-ADMIN] Error:", err.message || err);
    process.exit(1);
});
