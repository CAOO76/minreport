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
 * Generates all possible RUT/RUN formats for resilient lookup.
 */
function getRutVariants(rawTaxId: string): string[] {
  const variants = new Set<string>();
  const clean = rawTaxId.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
  variants.add(clean);
  if (clean.length >= 2) {
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    variants.add(`${body}-${dv}`);
    const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
    variants.add(formatted);
  }
  variants.add(rawTaxId.trim().toUpperCase());
  return Array.from(variants);
}

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

    // Use shared resilient variant generator
    const finalSearchValues = getRutVariants(taxId);

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
          accounts: (userData?.accounts || []).map((acc: any) => ({
            ...acc,
            status: acc.status || 'ACTIVE' // Defensive fallback
          }))
        });
      }
    }

    console.log(`[AUTH-DIRECTORY] ⚠️ Not found in user_directory, falling back to tenants only`);

    // ============================================================
    // FALLBACK 2: Pending Applications (Tenants)
    // ============================================================
    let accounts: any[] = [];
    let fullName: string = '';

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
      return res.status(404).json({ message: 'No accounts found for the provided Tax ID.' });
    }

    // 3. Final Safety Deduplication & Integrity Filter
    // Rules: Max 1 PERSONAL, Max 1 EDUCATIONAL, N BUSINESS.
    const finalAccounts = new Map();
    let personalAccountFound = false;
    let educationalAccountFound = false;

    // Sort by status priority (ACTIVE > APPROVED) to ensure we pick the most useful account
    const sortedAccounts = [...accounts].sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
      return 0;
    });

    for (const acc of sortedAccounts) {
      // Prevent duplicates by Account ID
      if (finalAccounts.has(acc.accountId)) continue;

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
        // Business / Enterprise accounts have no limit per RUN
        finalAccounts.set(acc.accountId, acc);
      }
    }

    const resultArray = Array.from(finalAccounts.values());

    console.log(`[AUTH-DIRECTORY] ✅ Returning ${resultArray.length} legacy/tenant accounts`);
    return res.status(200).json({ fullName, accounts: resultArray });

  } catch (error: any) {
    console.error('[AUTH-DIRECTORY] ❌ Error fetching accounts by ID:', error);
    res.status(500).json({
      message: 'Internal server error.',
      error: error.message
    });
  }
};
