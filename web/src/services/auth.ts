import { getApiUrl } from '../utils/network';

export interface RegisterTitularB2BData {
    fullName: string;
    email: string;
    personalTaxId: string;
    jobTitle?: string;
    businessName: string;
    companyTaxId: string;
    billingEmail: string;
    legalAddress: string;
    commune: string;
    region: string;
    password?: string;
    acceptTermsAndPrivacy: boolean;
    [key: string]: any;
}

export interface RegisterData {
    email: string;
    password?: string;
    type?: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
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

export const registerUser = async (data: RegisterTitularB2BData | RegisterData) => {
    const response = await fetch(getApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });

    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.error || 'Fallo en el registro de la Cuenta Titular');
    }

    return body;
};

export const checkAccountsById = async (taxId: string): Promise<{ accounts: any[] }> => {
    const response = await fetch(getApiUrl(`/api/public/accounts-by-id/${encodeURIComponent(taxId)}`));

    if (response.status === 404) {
        return { accounts: [] };
    }

    const body = await response.json();

    if (!response.ok) {
        throw new Error(body.message || 'Identity check failed');
    }

    return body;
};
