import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { db } from './config/firebase-admin'; // Importamos la DB iniciada (Backend SDK)
import { Resend } from 'resend';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run requiere puerto 8080 por defecto

// ----------------------------------------------------
// 1. Middlewares de Seguridad y Configuración
// ----------------------------------------------------
app.use(helmet()); // Protege headers HTTP
app.use(cors({ origin: true })); // Permite peticiones (ajustar en producción)
app.use(express.json()); // Permite leer body JSON

// Inicializar Resend (Email) si existe la API Key
const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

// ----------------------------------------------------
// 2. Rutas (API Routes)
// ----------------------------------------------------

// Health Check (Vital para Cloud Run)
app.get('/', (req: Request, res: Response) => {
    res.status(200).send(`MinReport Core v${process.env.npm_package_version} is running 🚀`);
});

// Ejemplo: Endpoint para obtener Tenants (usando Firebase Admin)
app.get('/api/tenants', async (req: Request, res: Response) => {
    try {
        const snapshot = await db.collection('tenants').get();
        const tenants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(tenants);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching tenants' });
    }
});

// Ejemplo: Endpoint para enviar email (usando Resend)
app.post('/api/send-alert', async (req: Request, res: Response) => {
    if (!resend) return res.status(503).json({ error: 'Email service not configured' });

    const { email, subject, html } = req.body;

    try {
        const data = await resend.emails.send({
            from: 'MinReport <alertas@minreport.com>',
            to: [email],
            subject: subject,
            html: html,
        });
        res.json(data);
    } catch (error) {
        res.status(400).json(error);
    }
});

// ----------------------------------------------------
// 3. Iniciar Servidor
// ----------------------------------------------------
app.listen(PORT, () => {
    console.log(`\n📡 MinReport Backend listening on port ${PORT}`);
    console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
});