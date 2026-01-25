
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9190";

initializeApp({
    projectId: "minreport-8f2a8"
});

const db = getFirestore();
const auth = getAuth();

async function createSuperAdmin() {
    const email = "admin@minreport.com";
    const password = "adminPassword123!";

    console.log(`Checking for user ${email}...`);

    let uid;
    try {
        const userRecord = await auth.getUserByEmail(email);
        uid = userRecord.uid;
        console.log(`User found with UID: ${uid}`);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            console.log("Creating new admin user...");
            const userRecord = await auth.createUser({
                email,
                password,
                displayName: "Super Admin"
            });
            uid = userRecord.uid;
            console.log(`Created user with UID: ${uid}`);
        } else {
            throw error;
        }
    }

    // Set Custom Claims (Optional but recommended)
    await auth.setCustomUserClaims(uid, { role: 'SUPER_ADMIN' });

    // Create User Profile in Firestore
    console.log("Updating Firestore profile...");
    await db.collection("users").doc(uid).set({
        uid: uid,
        email: email,
        displayName: "Super Admin",
        role: "SUPER_ADMIN",
        status: "ACTIVE", // Important for our logic
        entitlements: {
            pluginsEnabled: ['topografia', 'finanzas', 'transporte', 'perforacion'],
            canAssignRoles: true,
            storageLimit: 10737418240 // 10GB
        },
        stats: {
            storageUsed: 0,
            lastLogin: new Date().toISOString()
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log("✅ Super Admin configured successfully.");
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
}

createSuperAdmin().catch(console.error);
