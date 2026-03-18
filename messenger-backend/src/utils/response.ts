import { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function fail(res: Response, code: string, status = 400) {
  return res.status(status).json({ success: false, code, message: code });
}
