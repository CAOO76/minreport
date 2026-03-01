import { getApiUrl } from '../utils/network';

export interface RegisterData {
    email: string;
    password: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    address?: string;
    postal_code?: string;
    city?: string;
    commune?: string;
    region?: string;
    billing_email?: string;
    email_domain?: string;
    job_title?: string;
    [key: string]: any;
}

export const registerUser = async (data: RegisterData) => {
    const response = await fetch(getApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });

    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.error || 'Registration failed');
    }

    return body;
};

export const checkAccountsById = async (taxId: string): Promise<{ accounts: any[] }> => {
    const response = await fetch(getApiUrl(`/api/public/accounts-by-id/${encodeURIComponent(taxId)}`));

    // Si devuelve 404 significa que no hay cuentas. No es un error crítico para el registro.
    if (response.status === 404) {
        return { accounts: [] };
    }

    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.message || 'Identity check failed');
    }

    return body; // { fullName, accounts }
};
