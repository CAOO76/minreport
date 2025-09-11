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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const admin = __importStar(require("firebase-admin"));
const core_1 = require("@minreport/core");
// Initialize Firebase Admin SDK
// This will be initialized once when the Cloud Run instance starts
admin.initializeApp();
const app = (0, express_1.default)();
app.use(express_1.default.json()); // Enable JSON body parsing
// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).send('Service is running.');
});
// Endpoint for initial registration requests
app.post('/requestInitialRegistration', async (req, res) => {
    try {
        // Call the core function with the request body
        const result = await (0, core_1.requestInitialRegistration)(req.body);
        res.status(200).json(result);
    }
    catch (error) {
        // Handle HttpsError from Firebase Functions
        if (error.code && error.message) {
            res.status(400).json({ code: error.code, message: error.message });
        }
        else {
            console.error('Error:', error);
            res.status(500).json({ code: 'internal-error', message: 'An unexpected error occurred.' });
        }
    }
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
