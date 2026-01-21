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

export const sendOTP = async (email: string) => {
    const response = await fetch(`${API_URL}/user/otp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
    });

    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Failed to send OTP');
    return body;
};

export const completeSetup = async (token: string, data: any) => {
    const response = await fetch(`${API_URL}/user/setup`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
    });

    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Failed to complete setup');
    return body;
};
