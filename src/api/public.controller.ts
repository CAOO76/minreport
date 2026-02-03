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
 */
export const getAccountsById = async (req: Request, res: Response) => {
  try {
    const { taxId } = req.params;

    // Normalize taxId formats for resilient lookup (Standard vs Clean vs Dash-only)
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

    console.log(`[RUT-DIAGNOSTIC] Searching for TaxID: "${taxId}"`);
    console.log(`[RUT-DIAGNOSTIC] Final variants:`, finalSearchValues);

    // 1. Search in 'users' collection
    const usersRef = db.collection('users');
    const userSnapshot = await usersRef.where('taxId', 'in', finalSearchValues).limit(1).get();

    console.log(`[RUT-DIAGNOSTIC] Users found: ${userSnapshot.size}`);

    let accounts: any[] = [];
    let fullName: string = '';

    if (!userSnapshot.empty) {
      const userData = userSnapshot.docs[0].data();
      fullName = userData.displayName || userData.fullName;
      const memberships = userData.memberships || [];

      const accountResults = await Promise.all(memberships.map(async (m: any) => {
        try {
          const accountSnap = await db.collection('accounts').doc(m.accountId).get();

          if (!accountSnap.exists) {
            console.warn(`[RUT-DIAGNOSTIC] Ghost membership excluded: ${m.accountId}`);
            return null;
          }

          const accountData = accountSnap.data();
          return {
            accountId: m.accountId,
            accountName: accountData?.name || `Cuenta ${m.accountId.slice(0, 4)}`,
            type: accountData?.type || 'PERSONAL',
            role: m.role || 'MEMBER'
          };
        } catch (err) {
          console.error(`[RUT-DIAGNOSTIC] Failed to read account ${m.accountId}:`, err);
          return null;
        }
      }));

      accounts = accountResults.filter(a => a !== null);
    }

    // 2. Search in 'accounts' for primaryOperator assignment (Delegates)
    const accountsRef = db.collection('accounts');
    const delegateSnapshot = await accountsRef.where('primaryOperator.taxId', 'in', finalSearchValues).get();

    if (!delegateSnapshot.empty) {
      delegateSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!fullName) fullName = data.primaryOperator?.name;

        // Add if not already present (avoid duplicates)
        if (!accounts.find(a => a.accountId === docSnap.id)) {
          accounts.push({
            accountId: docSnap.id,
            accountName: data.name || 'Empresa sin nombre',
            type: data.type || 'BUSINESS',
            role: 'ADMINISTRADOR OPERATIVO'
          });
        }
      });
    }

    if (accounts.length === 0) {
      console.warn(`[RUT-DIAGNOSTIC] No accounts found for variants:`, finalSearchValues);

      // Data Peek: What is actually in the DB?
      const peekUsers = await db.collection('users').limit(3).get();
      console.log(`[RUT-DIAGNOSTIC] Peek 'users' taxId:`, peekUsers.docs.map(d => d.data().taxId));

      const peekAccs = await db.collection('accounts').limit(3).get();
      console.log(`[RUT-DIAGNOSTIC] Peek 'accounts' taxId:`, peekAccs.docs.map(d => d.data().primaryOperator?.taxId));

      return res.status(404).json({ message: 'No accounts found for this ID.' });
    }

    res.status(200).json({
      fullName,
      accounts
    });

  } catch (error) {
    console.error('Error fetching accounts by ID:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
