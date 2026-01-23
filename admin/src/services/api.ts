import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8080/api/admin',
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
    axios.post('http://localhost:8080/api/admin/login', { email, password });

export const getTenants = (status?: string) =>
    api.get('/tenants', { params: { status } });

export const updateTenantStatus = (uid: string, status: 'ACTIVE' | 'REJECTED') =>
    api.patch(`/tenants/${uid}`, { status });

interface LogoSet {
  isotype: string;
  logotype: string;
  imagotype: string;
}

interface BrandingSettings {
  light: LogoSet;
  dark: LogoSet;
}

export const getBrandingSettings = () => api.get<BrandingSettings>('/settings/branding');

export const updateBrandingSettings = (data: BrandingSettings) => api.put('/settings/branding', data);

export default api;
