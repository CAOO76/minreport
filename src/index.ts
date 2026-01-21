import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import './config/firebase'; // Import to trigger initialization
import { env } from './config/env';
import { register } from './api/auth.controller';
import { adminLogin, listTenants, updateTenantStatus } from './api/admin.controller'; // [UPDATED]
import { sendOTP, completeSetup } from './api/user.controller';
import { requireSuperAdmin } from './middleware/admin';
import { authenticate } from './middleware/auth';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: true })); // Allow all origins for now, strict later
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

// Routes
app.post('/api/auth/register', register);
app.post('/api/admin/login', adminLogin); // [NEW]

// User Setup Routes
app.post('/api/user/otp', sendOTP);
app.post('/api/user/setup', authenticate, completeSetup);

// Admin Routes (Protected)
app.get('/api/admin/tenants', requireSuperAdmin, listTenants);
app.patch('/api/admin/tenants/:uid', requireSuperAdmin, updateTenantStatus);

// Start Server
const port = parseInt(env.PORT, 10);
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
});
