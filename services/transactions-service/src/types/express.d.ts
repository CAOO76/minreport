import { Request } from 'express';
import * as admin from 'firebase-admin';
import { ParamsDictionary } from 'express-serve-static-core';

declare global {
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
      params: ParamsDictionary & { projectId?: string };
    }
  }
}
