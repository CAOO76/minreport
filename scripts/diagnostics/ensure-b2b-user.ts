import * as admin from 'firebase-admin';

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9190';

admin.initializeApp({
    projectId: 'minreport-8f2a8'
});

const ensureUser = async (email: string, password: string) => {
    try {
        const user = await admin.auth().getUserByEmail(email);
        console.log(`User ${email} already exists with UID: ${user.uid}`);
        // Ensure password is correct even if user exists
        await admin.auth().updateUser(user.uid, { password });
        console.log(`User ${email} password updated.`);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            const newUser = await admin.auth().createUser({
                email,
                password,
                emailVerified: true
            });
            console.log(`User ${email} created with UID: ${newUser.uid}`);
        } else {
            console.error('Error ensuring user:', error);
        }
    }
};

ensureUser('info@cabiseg.com', 'caoo1976')
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
