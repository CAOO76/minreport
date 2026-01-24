import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import './config/firebase'; // Import to trigger initialization
import { env } from './config/env';
import { register } from './api/auth.controller';
import { adminLogin, listTenants, updateTenantStatus, getBrandingSettings, updateBrandingSettings } from './api/admin.controller';
import { getPublicBrandingSettings } from './api/public.controller';
import { requireSuperAdmin } from './middleware/admin';

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Deshabilitar CSP en dev para facilitar emuladores
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// Header Security for Cloud Run
app.disable('x-powered-by');

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'MINREPORT CORE ONLINE',
        region: 'southamerica-west1',
        timestamp: new Date().toISOString()
    });
});

// Public Routes
app.get('/api/settings/branding', getPublicBrandingSettings);

// Routes
app.post('/api/auth/register', register);
app.post('/api/admin/login', adminLogin); // [NEW]

// Admin Routes (Protected)
app.get('/api/admin/tenants', requireSuperAdmin, listTenants);
app.patch('/api/admin/tenants/:uid', requireSuperAdmin, updateTenantStatus);
app.get('/api/admin/settings/branding', requireSuperAdmin, getBrandingSettings);
app.put('/api/admin/settings/branding', requireSuperAdmin, updateBrandingSettings);

// Start Server
const port = parseInt(env.PORT, 10);
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📡 Host: 0.0.0.0 (¡Acceso Móvil Habilitado!)`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
