import { onCall } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import * as dns from 'dns/promises';

// Inicializar Firebase Admin
const app = initializeApp();
const db = getFirestore(app);

// Configurar Resend
const resend = new Resend('re_9677oKjq_5nk7raGE8x7wFrLgHPFFNJ65');
console.log('🔧 [requestManagement] Resend API Key configurada: ✅');

/**
 * VALIDACIÓN DNS ÚNICAMENTE - SIN PATRONES
 */
async function verifyEmailDomain(domain: string): Promise<boolean> {
    try {
        console.log('🔍 Verificando DNS del dominio:', domain);
        const mxRecords = await dns.resolveMx(domain);
        
        if (mxRecords.length === 0) {
            console.log('❌ Sin registros MX:', domain);
            return false;
        }
        
        console.log('✅ Dominio válido con registros MX:', domain);
        return true;
    } catch (error) {
        console.log('❌ Error DNS para dominio:', domain);
        return false;
    }
}

/**
 * FUNCIÓN PRINCIPAL ULTRA SIMPLIFICADA
 */
export const validateEmailAndStartProcess = onCall({
    region: 'southamerica-west1',
    cors: true
}, async (request) => {
    try {
        const { 
            applicantEmail, 
            applicantName, 
            accountType,
            country,
            city,
            rut,
            institutionName,
            entityType
        } = request.data;

        console.log('🚀 [validateEmailAndStartProcess] Iniciando con datos:', {
            email: applicantEmail,
            name: applicantName,
            accountType,
            country,
            city,
            rut,
            institutionName,
            entityType
        });

        // Lista de emails problemáticos conocidos
        const knownInvalidUsers = [
            'admin@gmcielonegro.com',
            'info@gmcielonegro.com',
            'support@gmcielonegro.com'
        ];

        if (knownInvalidUsers.includes(applicantEmail.toLowerCase())) {
            console.log('❌ EMAIL EN LISTA NEGRA:', applicantEmail);
            return false;
        }

        // Validación básica de formato
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(applicantEmail)) {
            console.log('❌ Formato de email inválido:', applicantEmail);
            return false;
        }

        // Patrones sospechosos en username
        const suspiciousPatterns = [
            /^[a-z]{1,4}$/i, // Solo letras muy cortas
            /^\d+$/,         // Solo números
            /^(admin|test|demo)$/i // Palabras reservadas
        ];

        const username = applicantEmail.split('@')[0];
        for (const pattern of suspiciousPatterns) {
            if (pattern.test(username)) {
                console.log('❌ USERNAME SOSPECHOSO:', username);
                return false;
            }
        }

        console.log('✅ Email parece válido:', applicantEmail);

        // Guardar en Firestore con TODOS los campos
        await db.collection('requests').add({
            applicantEmail: applicantEmail.toLowerCase().trim(),
            applicantName: applicantName.trim(),
            accountType: accountType.trim(),
            country: country?.trim() || '',
            city: city?.trim() || '',
            rut: rut?.trim() || '',
            institutionName: institutionName?.trim() || '',
            entityType: entityType?.trim() || '',
            status: 'email_confirmed',
            emailStatus: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log('✅ Solicitud guardada exitosamente en Firestore');

        return {
            success: true,
            message: 'Gracias por tu solicitud. Si los datos son correctos, recibirás una notificación por email.',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Error en validateEmailAndStartProcess:', error);
        return {
            success: false,
            message: 'Error interno del servidor',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

/**
 * FUNCIÓN PARA DATOS ADICIONALES (segundo formulario)
 */
export const submitCompleteData = onCall({
    region: 'southamerica-west1',
    cors: true
}, async (request) => {
    try {
        const { 
            requestId,
            adminName,
            adminEmail,
            adminPhone,
            adminRole,
            run,
            streetAddress
        } = request.data;

        console.log('🚀 [submitCompleteData] Guardando datos adicionales para:', requestId);

        // Actualizar el documento existente con datos adicionales
        await db.collection('requests').doc(requestId).update({
            additionalData: {
                adminName: adminName?.trim() || '',
                adminEmail: adminEmail?.toLowerCase().trim() || '',
                adminPhone: adminPhone?.trim() || '',
                adminRole: adminRole?.trim() || '',
                run: run?.trim() || '',
                streetAddress: streetAddress?.trim() || ''
            },
            status: 'pending_review',
            updatedAt: new Date()
        });

        console.log('✅ Datos adicionales guardados exitosamente');

        return {
            success: true,
            message: 'Datos adicionales guardados correctamente',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Error en submitCompleteData:', error);
        return {
            success: false,
            message: 'Error al guardar datos adicionales',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

/**
 * FUNCIÓN PARA PROCESAR ACCIONES DE ADMIN
 */
export const processRequestAction = onCall({
    region: 'southamerica-west1',
    cors: true
}, async (request) => {
    try {
        const { requestId, decision, adminId, reason } = request.data;

        console.log(`🔄 Procesando acción: ${decision} para solicitud: ${requestId}`);

        const updateData: any = {
            status: decision,
            updatedAt: new Date(),
            lastActionBy: adminId
        };

        if (reason) {
            updateData.rejectionReason = reason;
        }

        await db.collection('requests').doc(requestId).update(updateData);

        // Agregar entrada al historial
        await db.collection('requests').doc(requestId).collection('history').add({
            action: decision,
            adminId,
            reason: reason || '',
            timestamp: new Date()
        });

        console.log(`✅ Acción ${decision} procesada exitosamente`);

        return {
            success: true,
            message: `Solicitud ${decision} exitosamente`,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Error en processRequestAction:', error);
        return {
            success: false,
            message: 'Error al procesar la acción',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

/**
 * FUNCIÓN PARA IMPORTAR RESULTADOS DE EMAIL
 */
export const importEmailResult = onCall({
    region: 'southamerica-west1',
    cors: true
}, async (request) => {
    try {
        const { emailId } = request.data;

        console.log('🔄 Importando resultado de email:', emailId);

        // Aquí iría la lógica para consultar Resend API
        // Por ahora retornamos un resultado simulado
        
        return {
            success: true,
            lastEvent: 'delivered',
            message: 'Estado del email actualizado',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Error en importEmailResult:', error);
        return {
            success: false,
            message: 'Error al importar resultado del email',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});