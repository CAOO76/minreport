"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.manageplugindeveloper = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const db = admin.firestore();
/**
 * Registra un nuevo desarrollador de plugins en el sistema.
 */
const registerDeveloper = async (data, context) => {
    if (!context.auth || !context.auth.token.admin) {
        throw new https_1.HttpsError("permission-denied", "Solo los administradores pueden registrar desarrolladores.");
    }
    const { developerName, developerEmail, companyName } = data;
    if (!developerName || !developerEmail || !companyName) {
        throw new https_1.HttpsError("invalid-argument", "Nombre, email y empresa son requeridos.");
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
const sendDeveloperInvitation = async (data, context) => {
    var _a, _b;
    if (!context.auth || !context.auth.token.admin) {
        throw new https_1.HttpsError("permission-denied", "Solo los administradores pueden enviar invitaciones.");
    }
    const { developerId } = data;
    if (!developerId) {
        throw new https_1.HttpsError("invalid-argument", "El ID del desarrollador es requerido.");
    }
    const developerRef = db.collection("plugin_developers").doc(developerId);
    const developerDoc = await developerRef.get();
    if (!developerDoc.exists) {
        throw new https_1.HttpsError("not-found", "El desarrollador no existe.");
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
Para: ${(_a = developerDoc.data()) === null || _a === void 0 ? void 0 : _a.developerEmail}
Asunto: Invitación al Portal de Desarrolladores de MINREPORT

Hola ${(_b = developerDoc.data()) === null || _b === void 0 ? void 0 : _b.developerName},

Has sido invitado a desarrollar plugins para MINREPORT. Accede a tu portal personal para descargar el SDK y la documentación:
${invitationLink}

Este enlace es de un solo uso y expira en 24 horas.
--------------------------
`);
    return { success: true, message: "Invitación enviada con éxito." };
};
exports.manageplugindeveloper = (0, https_1.onCall)({ region: "southamerica-west1" }, async (request) => {
    const { action, data } = request.data;
    switch (action) {
        case "registerDeveloper":
            return await registerDeveloper(data, request);
        case "sendDeveloperInvitation":
            return await sendDeveloperInvitation(data, request);
        // case "validateDeveloperToken":
        //   return await validateDeveloperToken(data, request);
        default:
            throw new https_1.HttpsError("invalid-argument", "Acción no válida.");
    }
});
//# sourceMappingURL=manage-developers.js.map