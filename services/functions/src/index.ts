import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export * from "./manage-developers";
export * from "./tokens";
export * from "./pluginApi";
export * from "./tokens";
export * from "./pluginApi";
