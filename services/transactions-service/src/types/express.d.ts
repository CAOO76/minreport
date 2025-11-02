import { Request } from 'express';
// import * as admin from 'firebase-admin'; // Eliminado para limpieza
import { ParamsDictionary } from 'express-serve-static-core';

declare global {
  namespace Express {
    interface Request {
  // user?: admin.auth.DecodedIdToken; // Eliminado para limpieza
      params: ParamsDictionary & { projectId?: string };
    }
  }
}
