import * as admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp();
}
// export * from "./manage-developers"; // Commented out
export * from "./tokens.js";
export * from "./pluginApi.js";
export * from "./dummy.js";
export * from "./clientPluginManagement.js";
//# sourceMappingURL=index.js.map