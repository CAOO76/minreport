import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

const db = admin.firestore();

/**
 * Registra un nuevo desarrollador de plugins en el sistema.
 */
const registerDeveloper = async (data: any, context: any) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new HttpsError("permission-denied", "Solo los administradores pueden registrar desarrolladores.");
  }

  const { developerName, developerEmail, companyName } = data;
  if (!developerName || !developerEmail || !companyName) {
    throw new HttpsError("invalid-argument", "Nombre, email y empresa son requeridos.");
  }

  const newDeveloper = {
    developerName,
    developerEmail,
    companyName,
    status: "pending_invitation",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const developerRef = await db.collection("plugin_developers").add(newDeveloper);

  // Log del evento
  await developerRef.collection("development_logs").add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    event: "developer_registered",
    actor: context.auth.uid,
  });

  return { developerId: developerRef.id, message: "Desarrollador registrado con éxito." };
};

/**
 * Envía una invitación por email a un desarrollador con un token de acceso único.
 */
const sendDeveloperInvitation = async (data: any, context: any) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new HttpsError("permission-denied", "Solo los administradores pueden enviar invitaciones.");
  }

  const { developerId } = data;
  if (!developerId) {
    throw new HttpsError("invalid-argument", "El ID del desarrollador es requerido.");
  }

  const developerRef = db.collection("plugin_developers").doc(developerId);
  const developerDoc = await developerRef.get();

  if (!developerDoc.exists) {
    throw new HttpsError("not-found", "El desarrollador no existe.");
  }

  // Generar token seguro
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas de expiración

  await developerRef.update({
    status: "invited",
    invitationToken: { hash, expiresAt: admin.firestore.Timestamp.fromDate(expiresAt) },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Log del evento
  await developerRef.collection("development_logs").add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    event: "invitation_sent",
    actor: context.auth.uid,
  });

  // Simulación de envío de email
  const invitationLink = `https://minreport-access.web.app/developer-portal?token=${token}`;
  console.log(`
--- SIMULACIÓN DE EMAIL ---
Para: ${developerDoc.data()?.developerEmail}
Asunto: Invitación al Portal de Desarrolladores de MINREPORT

Hola ${developerDoc.data()?.developerName},

Has sido invitado a desarrollar plugins para MINREPORT. Accede a tu portal personal para descargar el SDK y la documentación:
${invitationLink}

Este enlace es de un solo uso y expira en 24 horas.
--------------------------
`);

  return { success: true, message: "Invitación enviada con éxito." };
};


export const manageplugindeveloper = onCall({ region: "southamerica-west1" }, async (request) => {
  const { action, data } = request.data;

  switch (action) {
    case "registerDeveloper":
      return await registerDeveloper(data, request);
    case "sendDeveloperInvitation":
      return await sendDeveloperInvitation(data, request);
    // case "validateDeveloperToken":
    //   return await validateDeveloperToken(data, request);
    default:
      throw new HttpsError("invalid-argument", "Acción no válida.");
  }
});
