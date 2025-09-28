import { initializeApp, getApps } from 'firebase-admin/app';
if (!getApps().length) {
    initializeApp();
}
export * from "./tokens.js";
export * from "./pluginApi.js";
export * from "./dummy.js";
export * from "./clientPluginManagement.js";
//# sourceMappingURL=index.js.map