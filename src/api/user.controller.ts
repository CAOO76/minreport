import { Request, Response } from 'express';
import { Resend } from 'resend';
import admin, { db } from '../config/firebase';
import { setupSchema } from '../core/schemas';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

/**
 * POST /api/user/otp
 * Generates and sends a 6-digit OTP to the user's email (simulating SMS delivery)
 */
export const sendOTP = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP in Firestore with 10-minute TTL
        const otpRef = db.collection('otps').doc(email.toLowerCase());
        await otpRef.set({
            code: otp,
            expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send OTP via Resend
        await resend.emails.send({
            from: 'MinReport Security <auth@minreport.com>',
            to: email,
            subject: 'Tu código de verificación MinReport',
            html: `
                <div style="font-family: sans-serif; max-width: 500px; color: #334155;">
                    <h2 style="color: #4F46E5;">Verificación de Identidad</h2>
                    <p>Tu código de seguridad para activar tu cuenta MinReport es:</p>
                    <div style="background: #F1F5F9; padding: 20px; text-align: center; border-radius: 12px; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1E293B; margin: 20px 0;">
                        ${otp}
                    </div>
                    <p style="font-size: 14px; color: #64748b;">Este código expirará en 10 minutos.</p>
                </div>
            `
        });

        return res.status(200).json({ success: true, message: 'OTP sent successfully' });

    } catch (error: any) {
        console.error('OTP send error:', error);
        return res.status(500).json({ error: 'Failed to send OTP' });
    }
};

/**
 * POST /api/user/setup
 * Validates OTP and completes user profile setup
 */
export const completeSetup = async (req: Request, res: Response) => {
    try {
        const userEmail = (req as any).user?.email;
        if (!userEmail) return res.status(401).json({ error: 'Unauthorized' });

        // 1. Validate Input
        const validation = setupSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Validation Error', details: validation.error.format() });
        }

        const { otp_code, ...profileData } = validation.data;

        // 2. Validate OTP
        const otpDoc = await db.collection('otps').doc(userEmail.toLowerCase()).get();
        if (!otpDoc.exists) {
            return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
        }

        const otpData = otpDoc.data();
        if (otpData?.code !== otp_code) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        if (otpData?.expiresAt.toDate() < new Date()) {
            return res.status(400).json({ error: 'Verification code expired' });
        }

        // 3. Update User Profile in Firestore
        const userRef = db.collection('tenants').doc(userEmail.toLowerCase());
        await userRef.update({
            ...profileData,
            is_setup_completed: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. Delete OTP after successful use
        await db.collection('otps').doc(userEmail.toLowerCase()).delete();

        return res.status(200).json({
            success: true,
            message: 'Perfil completado con éxito'
        });

    } catch (error: any) {
        console.error('Setup completion error:', error);
        return res.status(500).json({ error: 'Error al completar el perfil' });
    }
};
