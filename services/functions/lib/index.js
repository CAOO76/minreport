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
exports.systemHealthCheck = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Healthcheck soberano minimalista de Cloud Functions Gen 2 (`southamerica-west1`).
 */
exports.systemHealthCheck = (0, https_1.onRequest)({
    region: "southamerica-west1",
    cors: ["https://minreport-access.web.app"],
    maxInstances: 5,
}, (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
        return;
    }
    const payload = {
        service: "minreport-functions-gen2",
        region: "southamerica-west1",
        timestamp: new Date().toISOString(),
    };
    logger.info("MINREPORT systemHealthCheck ejecutado", {
        region: payload.region,
        method: request.method,
    });
    response.status(200).json(payload);
});
//# sourceMappingURL=index.js.map