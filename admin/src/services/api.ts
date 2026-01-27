import axios from 'axios';

const MI_IP_IMAC = "192.168.1.82";
const API_BASE = location.hostname === 'localhost' ? 'http://localhost:8080/api/admin' : `http://${MI_IP_IMAC}:8080/api/admin`;

const api = axios.create({
    baseURL: API_BASE,
});

// Interceptor to add Master Token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const adminLogin = (email: string, password: string) =>
    axios.post(`${API_BASE}/login`, { email, password });

export const getTenants = (status?: string) =>
    api.get('/tenants', { params: { status } });

export const updateTenantStatus = (uid: string, status: 'ACTIVE' | 'REJECTED') =>
    api.patch(`/tenants/${uid}`, { status });

interface LogoSet {
    isotype: string;
    logotype: string;
    imagotype: string;
    pwaIcon?: string;
    appIcon?: string;
}

interface BrandingSettings {
    light: LogoSet;
    dark: LogoSet;
}

export const getBrandingSettings = () => api.get<BrandingSettings>('/settings/branding');

export const updateBrandingSettings = (data: BrandingSettings) => api.put('/settings/branding', data);

export default api;
