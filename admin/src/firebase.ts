// src/admin/firebase.ts
/**
 * This file acts as a proxy to the main Firebase initialization file in the 'web' project.
 * This allows admin-side components to import Firebase services from a consistent, local path
 * (`../firebase`) instead of a fragile relative path (`../../web/firebase`).
 */
import { auth, db, storage } from '../../web/src/firebase';

export { auth, db, storage };
