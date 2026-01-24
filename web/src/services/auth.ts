import { Capacitor } from '@capacitor/core';

// Dirección adaptativa: 10.0.2.2 para emulador, IP real para celular físico, localhost para web
const MI_IP_IMAC = "192.168.1.82";
const isEmulator = /sdk|emulator|google/i.test(navigator.userAgent);
const host = Capacitor.isNativePlatform()
    ? (isEmulator ? "10.0.2.2" : MI_IP_IMAC)
    : (location.hostname === MI_IP_IMAC ? MI_IP_IMAC : "localhost");

const API_URL = `http://${host}:8080/api`;

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
