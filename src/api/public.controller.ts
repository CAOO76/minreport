import { Request, Response } from 'express';
import { db } from '../config/firebase';

/**
 * @route GET /api/settings/branding
 * @desc Get public branding settings
 * @access Public
 */
export const getPublicBrandingSettings = async (req: Request, res: Response) => {
  try {
    const docRef = db.collection('settings').doc('branding');
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      // Si no existe la configuración, es importante devolver un 404
      // para que el frontend pueda manejarlo como 'no configurado'.
      return res.status(404).json({ message: 'Branding settings not found.' });
    }

    // Devuelve solo los datos del documento.
    res.status(200).json(docSnap.data());
  } catch (error) {
    console.error('Error getting public branding settings:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
import { formatRut } from '../utils/rut';

/**
 * @route GET /api/public/accounts-by-id/:taxId
 * @desc Get accounts associated with a Tax ID (RUT/RUN)
 * @access Public
 * 
 * Arquitectura "Pasillo de Puertas Blindadas":
 * 1. Consulta user_directory (nuevo sistema)
 * 2. Fallback a búsqueda legacy (users + accounts)
 */
export const getAccountsById = async (req: Request, res: Response) => {
  try {
    const { taxId } = req.params;

    // Normalize taxId formats for resilient lookup
    const cleanTaxId = taxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    const formattedTaxId = formatRut(cleanTaxId);

    const searchValues = new Set([formattedTaxId, cleanTaxId]);

    // Add semi-clean variant (12345678-9) if possible
    if (cleanTaxId.length >= 2) {
      const body = cleanTaxId.slice(0, -1);
      const dv = cleanTaxId.slice(-1);
      searchValues.add(`${body}-${dv}`);
    }

    const finalSearchValues = Array.from(searchValues);

    console.log(`[AUTH-DIRECTORY] Searching for TaxID: "${taxId}"`);
    console.log(`[AUTH-DIRECTORY] Normalized variants:`, finalSearchValues);

    // ============================================================
    // PRIORITY 1: Consultar user_directory (Nuevo Sistema)
    // ============================================================
    for (const variant of finalSearchValues) {
      const userDirRef = db.collection('user_directory').doc(variant);
      const userDirSnap = await userDirRef.get();

      console.log(`[AUTH-DIRECTORY] 🔍 Checking variant "${variant}" in user_directory: ${userDirSnap.exists ? 'FOUND' : 'NOT FOUND'}`);

      if (userDirSnap.exists) {
        const userData = userDirSnap.data();
        console.log(`[AUTH-DIRECTORY] ✅ Found in user_directory: ${variant}`);

        return res.status(200).json({
          fullName: userData?.fullName || '',
          accounts: userData?.accounts || []
        });
      }
    }

    console.log(`[AUTH-DIRECTORY] ⚠️ Not found in user_directory, falling back to legacy search`);

    // ============================================================
    // FALLBACK: Búsqueda Legacy (users + accounts)
    // ============================================================
    let accounts: any[] = [];
    let fullName: string = '';

    // 1. Search in 'users' collection
    const usersRef = db.collection('users');
    const userSnapshot = await usersRef.where('taxId', 'in', finalSearchValues).limit(1).get();

    console.log(`[AUTH-DIRECTORY] Legacy users found: ${userSnapshot.size}`);

    if (!userSnapshot.empty) {
      const userData = userSnapshot.docs[0].data();
      fullName = userData.displayName || userData.fullName;
      const memberships = userData.memberships || [];

      const accountResults = await Promise.all(memberships.map(async (m: any) => {
        try {
          const accountSnap = await db.collection('accounts').doc(m.accountId).get();

          if (!accountSnap.exists) {
            console.warn(`[AUTH-DIRECTORY] Ghost membership excluded: ${m.accountId}`);
            return null;
          }

          const accountData = accountSnap.data();

          return {
            accountId: m.accountId,
            accountName: accountData?.name || `Cuenta ${m.accountId.slice(0, 4)}`,
            type: accountData?.type || 'PERSONAL',
            role: m.role || 'MEMBER',
            authEmail: userData.email || '',
            avatar: userData.photoURL || accountData?.avatar,
            status: userData.status || 'ACTIVE'
          };
        } catch (err) {
          console.error(`[AUTH-DIRECTORY] Failed to read account ${m.accountId}:`, err);
          return null;
        }
      }));

      accounts = accountResults.filter(a => a !== null);
    }

    // 2. Search in 'accounts' for primaryOperator assignment
    const accountsRef = db.collection('accounts');
    const delegateSnapshot = await accountsRef.where('primaryOperator.taxId', 'in', finalSearchValues).get();

    if (!delegateSnapshot.empty) {
      delegateSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!fullName) fullName = data.primaryOperator?.name;

        if (!accounts.find(a => a.accountId === docSnap.id)) {
          accounts.push({
            accountId: docSnap.id,
            accountName: data.name || 'Empresa sin nombre',
            type: data.type || 'BUSINESS',
            role: 'ADMINISTRADOR OPERATIVO',
            authEmail: data.primaryOperator?.email || '',
            avatar: data.primaryOperator?.avatar,
            status: data.status || 'ACTIVE'
          });
        }
      });
    }

    // 3. Search in 'tenants' (Pending requests)
    const tenantsRef = db.collection('tenants');

    // Search by rut
    const tenantRutSnapshot = await tenantsRef.where('rut', 'in', finalSearchValues).get();
    tenantRutSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (!fullName) fullName = data.applicant_name || data.full_name;

      if (!accounts.find(a => a.accountId === docSnap.id)) {
        accounts.push({
          accountId: docSnap.id,
          accountName: data.company_name || data.institution_name || 'Solicitud Pendiente',
          type: data.type,
          role: 'APPLICANT',
          authEmail: data.email,
          status: data.status || 'PENDING_APPROVAL'
        });
      }
    });

    // Search by run
    const tenantRunSnapshot = await tenantsRef.where('run', 'in', finalSearchValues).get();
    tenantRunSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (!fullName) fullName = data.full_name || data.applicant_name;

      if (!accounts.find(a => a.accountId === docSnap.id)) {
        accounts.push({
          accountId: docSnap.id,
          accountName: data.type === 'PERSONAL' ? 'Cuenta Personal' : (data.institution_name || 'Solicitud Educacional'),
          type: data.type,
          role: 'APPLICANT',
          authEmail: data.email,
          status: data.status || 'PENDING_APPROVAL'
        });
      }
    });

    if (accounts.length === 0) {
      console.warn(`[AUTH-DIRECTORY] ❌ No accounts found for variants:`, finalSearchValues);
      return res.status(404).json({ message: 'No accounts found for this ID.' });
    }

    // 3. Final Safety Deduplication & Integrity Filter (Maximum Isolation)
    // Rules: Max 1 PERSONAL, Max 1 EDUCATIONAL, N BUSINESS. Exclude replaced/deleted.
    const finalAccounts = new Map();
    let personalAccountFound = false;
    let educationalAccountFound = false;

    // Sort by status priority (ACTIVE > APPROVED) to ensure we pick the most useful account
    const sortedAccounts = [...accounts].sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
      return 0;
    });

    sortedAccounts.forEach(acc => {
      // Exclude deactivated or replaced accounts
      if (['REPLACED_BY_NEW_ENROLLMENT', 'DELETED', 'REJECTED'].includes(acc.status)) return;

      if (acc.type === 'PERSONAL') {
        if (!personalAccountFound) {
          finalAccounts.set(acc.accountId, acc);
          personalAccountFound = true;
        }
      } else if (acc.type === 'EDUCATIONAL') {
        if (!educationalAccountFound) {
          finalAccounts.set(acc.accountId, acc);
          educationalAccountFound = true;
        }
      } else {
        // BUSINESS/ENTERPRISE/OTHERS: Unique by accountId
        finalAccounts.set(acc.accountId, acc);
      }
    });

    res.status(200).json({
      fullName: fullName || '',
      accounts: Array.from(finalAccounts.values())
    });

  } catch (error: any) {
    console.error('[AUTH-DIRECTORY] ❌ Error fetching accounts by ID:', error);
    res.status(500).json({
      message: 'Internal server error.',
      error: error.message
    });
  }
};
