
import { User } from 'firebase/auth';
import { Firestore, collection, query, where, getDocs, writeBatch, doc, arrayUnion, getDoc } from 'firebase/firestore';

/**
 * Busca invitaciones pendientes para el usuario y las vincula automáticamente.
 * 
 * @param user Usuario autenticado de Firebase
 * @param db Instancia de Firestore
 * @returns Número de invitaciones reclamadas
 */
export const checkAndClaimInvitations = async (user: User, db: Firestore): Promise<number> => {
    if (!user.email) return 0;

    try {
        const accountsRef = collection(db, 'accounts');
        // Buscar cuentas donde el email esté como 'PENDING' en primaryOperator
        const q = query(
            accountsRef,
            where('primaryOperator.email', '==', user.email),
            where('primaryOperator.status', '==', 'PENDING')
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) return 0;

        const batch = writeBatch(db);
        const userRef = doc(db, 'users', user.uid);
        const newMemberships: any[] = [];

        snapshot.docs.forEach(accountDoc => {
            const accountData = accountDoc.data();

            // 1. Actualizar Cuenta: Validar operador -> ACTIVE
            const accountRef = doc(db, 'accounts', accountDoc.id);
            batch.update(accountRef, {
                'primaryOperator.status': 'ACTIVE',
                'primaryOperator.uid': user.uid
            });

            // 2. Preparar Membership
            newMemberships.push({
                accountId: accountDoc.id,
                role: 'ADMIN', // Asignamos rol ADMIN (Operativo Total) por defecto al reclamar
                companyName: accountData.name,
                joinedAt: Date.now()
            });
        });

        // 3. Pre-flight Check: Evitar Duplicados en User
        // arrayUnion fallaba porque 'joinedAt' cambiaba siempre, haciéndolo un objeto "nuevo"
        if (newMemberships.length > 0) {
            const userDoc = await getDoc(userRef); // Leer perfil actual
            const currentUserData = userDoc.exists() ? userDoc.data() : {};
            const currentMemberships = currentUserData.memberships || [];

            // Filtrar solo las memberships que NO tiene ya
            const uniqueNewMemberships = newMemberships.filter(nm =>
                !currentMemberships.some((cm: any) => cm.accountId === nm.accountId)
            );

            if (uniqueNewMemberships.length > 0) {
                batch.update(userRef, {
                    memberships: arrayUnion(...uniqueNewMemberships)
                });
                console.log(`[InvitationHandler] Added ${uniqueNewMemberships.length} new memberships.`);
            } else {
                console.log(`[InvitationHandler] Memberships already exist, skipping user update.`);
            }
        }

        await batch.commit();
        console.log(`[InvitationHandler] Processed ${snapshot.size} pending invitations.`);
        return snapshot.size;

    } catch (error) {
        console.error("[InvitationHandler] Error procesando invitaciones:", error);
        return 0;
    }
};
