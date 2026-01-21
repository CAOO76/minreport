const API_URL = 'http://localhost:8080/api';

export interface RegisterData {
    email: string;
    password: string;
    type: 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
    [key: string]: any;
}

export const registerUser = async (data: RegisterData) => {
    const response = await fetch(`${API_URL}/auth/register`, {
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
