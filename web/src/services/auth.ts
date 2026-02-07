import { getApiUrl } from '../utils/network';

export interface RegisterData {
    email: string;
    password: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
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
