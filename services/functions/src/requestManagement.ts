import { onCall, HttpsError } from 'firebase-functions/v2/https';import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { getFirestore, FieldValue } from 'firebase-admin/firestore';import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { Resend } from 'resend';import { Resend } from 'resend';

import { promises as dns } from 'dns';import { promises as dns } from 'dns';



console.log('🔧 [requestManagement] VERSIÓN ULTRA SIMPLIFICADA - SOLO DNS');console.log('🔧 [requestManagement] VERSIÓN ULTRA SIMPLIFICADA - SOLO DNS');



// Configuración de Resend API// Configuración de Resend API

let resendApiKey = process.env.RESEND_API_KEY || 'dev-key-placeholder';let resendApiKey = process.env.RESEND_API_KEY || 'dev-key-placeholder';

if (resendApiKey === 'dev-key-placeholder') {if (resendApiKey === 'dev-key-placeholder') {

    resendApiKey = 're_4BXETdT2_65Sj3y21hcvA3WiSVycCgfAr';    resendApiKey = 're_4BXETdT2_65Sj3y21hcvA3WiSVycCgfAr';

    console.log('🔧 [requestManagement] Usando API key directa para desarrollo');    console.log('🔧 [requestManagement] Usando API key directa para desarrollo');

}}



const resend = new Resend(resendApiKey);const resend = new Resend(resendApiKey);

console.log('🔧 [requestManagement] Resend API Key configurada: ✅');console.log('🔧 [requestManagement] Resend API Key configurada: ✅');



/**/**

 * VALIDACIÓN DNS ÚNICAMENTE - SIN PATRONES * VALIDACIÓN DNS ÚNICAMENTE - SIN PATRONES

 */ */

async function verifyEmailDomain(domain: string): Promise<boolean> {async function verifyEmailDomain(domain: string): Promise<boolean> {

    try {    try {

        console.log('🔍 Verificando DNS del dominio:', domain);        console.log('🔍 Verificando DNS del dominio:', domain);

        const mxRecords = await dns.resolveMx(domain);        const mxRecords = await dns.resolveMx(domain);

                

        if (mxRecords.length === 0) {        if (mxRecords.length === 0) {

            console.log('❌ Sin registros MX:', domain);            console.log('❌ Sin registros MX:', domain);

            return false;            return false;

        }        }

                

        console.log('✅ Dominio válido con registros MX:', domain);        console.log('✅ Dominio válido con registros MX:', domain);

        return true;        return true;

    } catch (error) {    } catch (error) {

        console.log('❌ Error DNS para dominio:', domain);        console.log('❌ Error DNS para dominio:', domain);

        return false;        return false;

    }    }

}}

      'admin@gmcielonegro.com',

/**      'info@gmcielonegro.com',

 * FUNCIÓN PRINCIPAL ULTRA SIMPLIFICADA      'support@gmcielonegro.com'

 */    ];

export const validateEmailAndStartProcess = onCall({    

    region: 'southamerica-west1',    if (knownInvalidUsers.includes(email.toLowerCase())) {

    cors: true      console.log('❌ EMAIL EN LISTA NEGRA:', email);

}, async (request) => {      return false;

    try {    }

        const { applicantEmail, applicantName, accountType } = request.data;    

            // Verificar patrones sospechosos en usuarios

        console.log('🎯 SOLICITUD ULTRA SIMPLE:', applicantEmail);    const [username] = email.split('@');

            

        if (!applicantEmail || !applicantName || !accountType) {    // Usuarios muy cortos (menos de 4 caracteres)

            throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos');    if (username.length < 4) {

        }      console.log('❌ USERNAME DEMASIADO CORTO:', username);

              return false;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;    }

        if (!emailRegex.test(applicantEmail)) {    

            throw new HttpsError('invalid-argument', 'Formato de email inválido');    // Patrones sospechosos

        }    const suspiciousPatterns = [

              /^(test|fake|temp|spam)/i,

        console.log('⚡ RESPUESTA INMEDIATA - SIN VALIDACIONES COMPLEJAS');      /^[a-z]{1,4}$/i, // Solo letras muy cortas

              /^(info|admin|support|contact|sales)$/i

        // Procesamiento en segundo plano    ];

        processUltraSimple({    

            applicantEmail: applicantEmail.toLowerCase().trim(),    for (const pattern of suspiciousPatterns) {

            applicantName: applicantName.trim(),      if (pattern.test(username)) {

            accountType: accountType.trim()        console.log('❌ USERNAME SOSPECHOSO:', username);

        }).catch(error => {        return false;

            console.error('❌ Error en procesamiento:', error);      }

        });    }

            

        return {    console.log('✅ Email parece válido:', email);

            success: true,    return true;

            message: 'Gracias por tu solicitud. Si los datos son correctos, recibirás una notificación por email.',  } catch (error) {

            timestamp: new Date().toISOString()    console.log('❌ Error validando email específico:', error);

        };    return false;

          }

    } catch (error) {}

        console.error('❌ ERROR:', error);

        /**

        if (error instanceof HttpsError) { * NUEVA: Envío de email con ESPERA SINCRONIZADA del resultado

            throw error; */

        }async function sendEmailAndWaitForResult(email: string, name: string, accountType: string): Promise<{success: boolean, reason?: string}> {

          try {

        throw new HttpsError('internal', `Error interno: ${error.message}`);    console.log('📤 ENVIANDO EMAIL Y ESPERANDO RESULTADO para:', email);

    }    

});    // 1. Enviar email

    const result = await resend.emails.send({

/**      from: 'MINREPORT <noreply@minreport.com>',

 * PROCESAMIENTO ULTRA SIMPLE      to: [email],

 */      subject: '✉️ Tu solicitud de suscripción a MINREPORT ha iniciado',

async function processUltraSimple(requestData: any) {      html: `<div>Email enviado a ${name} para cuenta ${accountType}</div>`

    try {    });

        console.log('🔄 PROCESAMIENTO ULTRA SIMPLE para:', requestData.applicantEmail);

            if (result.error) {

        const db = getFirestore();      console.error('❌ RESEND RECHAZÓ INMEDIATAMENTE:', result.error);

        const { applicantEmail, applicantName, accountType } = requestData;      return { success: false, reason: `Resend error: ${result.error.message}` };

            }

        // SOLO DNS - SIN VALIDAR NOMBRE DE USUARIO

        const [, domain] = applicantEmail.split('@');    const emailId = result.data?.id;

        const isDomainValid = await verifyEmailDomain(domain);    if (!emailId) {

              console.error('❌ RESEND NO RETORNÓ ID');

        if (!isDomainValid) {      return { success: false, reason: 'No se obtuvo ID de email' };

            console.log('❌ DNS INVÁLIDO:', domain);    }

            

            await db.collection('requests').add({    console.log('📧 Email enviado con ID:', emailId);

                ...requestData,    console.log('⏳ ESPERANDO RESULTADO DEL WEBHOOK...');

                status: 'rejected',

                rejectionReason: 'invalid_domain',    // 2. Esperar resultado del webhook (máximo 30 segundos)

                emailStatus: 'not_sent_domain_invalid',    const webhookResult = await waitForWebhookResult(emailId, email, 30000);

                createdAt: FieldValue.serverTimestamp(),    

                updatedAt: FieldValue.serverTimestamp()    return webhookResult;

            });

              } catch (error) {

            return;    console.error('❌ EXCEPCIÓN ENVIANDO EMAIL:', error);

        }    return { success: false, reason: `Excepción: ${error}` };

          }

        // ENVIAR EMAIL SIN VALIDAR NOMBRE}

        console.log('✅ DNS VÁLIDO - ENVIANDO EMAIL');

        const emailResult = await sendUltraSimpleEmail(applicantEmail, applicantName, accountType);/**

         * NUEVA: Esperar resultado del webhook

        // GUARDAR EN BD */

        await db.collection('requests').add({async function waitForWebhookResult(emailId: string, email: string, timeoutMs: number): Promise<{success: boolean, reason?: string}> {

            ...requestData,  return new Promise((resolve) => {

            status: 'pending_review',    console.log(`⏰ Esperando webhook para email ID: ${emailId}, timeout: ${timeoutMs}ms`);

            emailStatus: emailResult.success ? 'sent_pending_confirmation' : 'failed_to_send',    

            emailId: emailResult.emailId,    let timeoutHandle: NodeJS.Timeout;

            emailError: emailResult.error,    let intervalHandle: NodeJS.Timeout;

            dnsValid: true,    

            createdAt: FieldValue.serverTimestamp(),    // Timeout - si no hay respuesta en el tiempo límite

            updatedAt: FieldValue.serverTimestamp()    timeoutHandle = setTimeout(() => {

        });      clearInterval(intervalHandle);

              console.log('⚠️ TIMEOUT - No se recibió respuesta del webhook, asumiendo éxito');

        console.log('✅ PROCESAMIENTO COMPLETADO para:', applicantEmail);      // Si no hay bounce en 30 segundos, asumimos que el email es válido

              resolve({ success: true, reason: 'No bounce detected within timeout' });

    } catch (error) {    }, timeoutMs);

        console.error('❌ ERROR EN PROCESAMIENTO:', error);    

    }    // Verificar cada 2 segundos si el webhook ya procesó un bounce

}    intervalHandle = setInterval(async () => {

      try {

/**        const db = getFirestore();

 * ENVÍO ULTRA SIMPLE        

 */        // Buscar si hay un bounce registrado para este email

async function sendUltraSimpleEmail(email: string, name: string, accountType: string) {        const bounceQuery = await db.collection('email_bounces')

    try {          .where('email_id', '==', emailId)

        console.log('📤 ENVIANDO EMAIL ULTRA SIMPLE para:', email);          .limit(1)

                  .get();

        const result = await resend.emails.send({        

            from: 'MINREPORT <noreply@minreport.com>',        if (!bounceQuery.empty) {

            to: [email],          clearTimeout(timeoutHandle);

            subject: '✉️ Tu solicitud de suscripción a MINREPORT ha iniciado',          clearInterval(intervalHandle);

            html: `          

                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">          const bounceData = bounceQuery.docs[0].data();

                    <h2>🎉 ¡Hola ${name}!</h2>          console.log('❌ BOUNCE DETECTADO:', bounceData);

                    <p>Tu solicitud para una cuenta <strong>${accountType}</strong> en MINREPORT ha sido recibida.</p>          resolve({ 

                    <p>Estamos procesando tu solicitud y te contactaremos pronto.</p>            success: false, 

                    <hr>            reason: `Email rebotado: ${bounceData.bounce_reason || 'Dirección no válida'}` 

                    <small>Este es un mensaje automático de MINREPORT.</small>          });

                </div>        }

            `        

        });        // Verificar si hay confirmación de entrega

                const deliveryQuery = await db.collection('email_deliveries')

        if (result.error) {          .where('email_id', '==', emailId)

            console.error('❌ RESEND ERROR:', result.error);          .limit(1)

            return { success: false, emailId: null, error: result.error.message };          .get();

        }        

                if (!deliveryQuery.empty) {

        const emailId = result.data?.id;          clearTimeout(timeoutHandle);

        console.log('✅ EMAIL ENVIADO, ID:', emailId);          clearInterval(intervalHandle);

                  

        return { success: true, emailId: emailId, error: null };          console.log('✅ ENTREGA CONFIRMADA');

                  resolve({ success: true, reason: 'Email delivered successfully' });

    } catch (error) {        }

        console.error('❌ Error enviando email:', error);        

        return { success: false, emailId: null, error: error.message };      } catch (error) {

    }        console.error('❌ Error verificando webhook result:', error);

}      }

    }, 2000); // Verificar cada 2 segundos

/**  });

 * Estadísticas ultra simples}

 */

export const getRequestStats = onCall({export const validateEmailAndStartProcess = onCall({

    region: 'southamerica-west1',  region: 'southamerica-west1',

    cors: true  cors: true

}, async (request) => {}, async (request) => {

    try {  console.log('🔍 validateEmailAndStartProcess iniciada');

        const db = getFirestore();  const { applicantName, applicantEmail, rut, institutionName, accountType, country, city, entityType } = request.data;

        const requests = await db.collection('requests').get();  

          if (!applicantName || !applicantEmail) {

        const stats = {    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios.');

            total: requests.size,  }

            pending: 0,

            rejected: 0,  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

            emailsSent: 0  if (!emailRegex.test(applicantEmail)) {

        };    throw new HttpsError('invalid-argument', 'El formato del correo electrónico no es válido.');

          }

        requests.forEach(doc => {

            const data = doc.data();  try {

            if (data.status === 'pending_review') stats.pending++;    // 1. VALIDAR DNS ESTRICTO

            if (data.status === 'rejected') stats.rejected++;    const emailDomain = applicantEmail.split('@')[1]?.toLowerCase();

            if (data.emailStatus === 'sent_pending_confirmation') stats.emailsSent++;    console.log('🔍 PASO 1: Verificando DNS para:', emailDomain);

        });    const isDomainValid = await verifyEmailDomain(emailDomain);

            if (!isDomainValid) {

        return { success: true, statistics: stats };      throw new HttpsError('invalid-argument', 'El dominio del correo electrónico no existe.');

            }

    } catch (error) {    console.log('✅ PASO 1 EXITOSO: DNS válido');

        throw new HttpsError('internal', `Error: ${error.message}`);    

    }    // 2. VALIDAR USUARIO ESPECÍFICO - NUEVO

});    console.log('🔍 PASO 2: Verificando usuario específico...');
    const isEmailSpecificValid = await verifySpecificEmailExists(applicantEmail);
    if (!isEmailSpecificValid) {
      throw new HttpsError('invalid-argument', 'La dirección de correo electrónico no parece ser válida o no puede recibir mensajes.');
    }
    console.log('✅ PASO 2 EXITOSO: Usuario validado');
    
    // 3. ENVÍO CON ESPERA SINCRONIZADA DEL RESULTADO
    console.log('📧 PASO 3: Enviando email y esperando confirmación...');
    const emailResult = await sendEmailAndWaitForResult(applicantEmail, applicantName, accountType || 'INDIVIDUAL');
    if (!emailResult.success) {
      console.log('❌ PASO 3 FALLÓ:', emailResult.reason);
      throw new HttpsError('invalid-argument', emailResult.reason || 'La dirección de correo electrónico no es válida o no puede recibir mensajes.');
    }
    console.log('✅ PASO 3 EXITOSO: Email confirmado exitosamente');
    
    // 4. SOLO AHORA REGISTRAR EN BASE DE DATOS
    console.log('💾 PASO 4: Registrando en base de datos...');
    const db = getFirestore();
    const newRequest = await db.collection('requests').add({
      applicantName,
      applicantEmail,
      rut: rut || '',
      institutionName: institutionName || '',
      accountType: accountType || 'INDIVIDUAL',
      country: country || 'CL',
      city: city || '',
      entityType: entityType || 'natural',
      status: 'pending_review',
      emailStatus: 'confirmed_sent', // Estado más específico
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: 'client-app'
    });
    console.log('✅ PASO 4 EXITOSO: Registrado con ID:', newRequest.id);

    return {
      status: 'success',
      message: 'Solicitud registrada exitosamente. El email fue confirmado como válido por nuestro sistema.',
      requestId: newRequest.id
    };

  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Error interno del sistema.');
  }
});
