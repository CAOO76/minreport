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
exports.generatePluginLoadToken = void 0;
const functions = __importStar(require("firebase-functions/v2"));
const jwt = __importStar(require("jsonwebtoken"));
exports.generatePluginLoadToken = functions.https.onCall({ region: "southamerica-west1" }, async (request) => {
    const { pluginId } = request.data;
    const context = request; // Corrected: context is the request object itself
    // 1. Ensure the user is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    if (typeof pluginId !== 'string' || !pluginId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid "pluginId".');
    }
    // 2. Check for granular permission using Custom Claims.
    const userClaims = context.auth.token;
    const activePlugins = userClaims.activePlugins;
    if (!activePlugins || !activePlugins.includes(pluginId)) {
        throw new functions.https.HttpsError('permission-denied', 'You do not have permission to load this plugin.');
    }
    // 3. Generate a short-lived JWT (ticket).
    const payload = {
        uid: context.auth.uid,
        pluginId: pluginId,
    };
    const options = {
        expiresIn: '1h', // Ticket valid for 1 hour
    };
    // Use a strong, unique secret for signing. This should be stored securely (e.g., Firebase Config).
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new functions.https.HttpsError('internal', 'JWT_SECRET is not configured.');
    }
    const ticket = jwt.sign(payload, jwtSecret, options);
    console.log(`Generated load token for user ${context.auth.uid} for plugin ${pluginId}.`);
    return { ticket };
});
//# sourceMappingURL=tokens.js.map