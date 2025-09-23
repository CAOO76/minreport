import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// export * from "./manage-developers"; // Commented out
export * from "./tokens";
export * from "./pluginApi";
export * from "./dummy";
