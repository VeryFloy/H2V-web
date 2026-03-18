import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../types';
import * as contactService from './contact.service';
import { ok, fail } from '../../utils/response';

export async function addContactHandler(
  req: AuthRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    await contactService.addContact(req.user!.sub, String(req.params.userId));
    ok(res, { added: true }, 201);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'CANNOT_ADD_SELF') { fail(res, err.message, 400); return; }
      if (err.message === 'USER_NOT_FOUND') { fail(res, err.message, 404); return; }
    }
    next(err);
  }
}

export async function removeContactHandler(
  req: AuthRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    await contactService.removeContact(req.user!.sub, String(req.params.userId));
    ok(res, { removed: true });
  } catch (err) { next(err); }
}

export async function getContactsHandler(
  req: AuthRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const contacts = await contactService.getContacts(req.user!.sub);
    ok(res, contacts);
  } catch (err) { next(err); }
}

export async function checkContactHandler(
  req: AuthRequest, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const result = await contactService.checkContact(req.user!.sub, String(req.params.userId));
    ok(res, result);
  } catch (err) { next(err); }
}
