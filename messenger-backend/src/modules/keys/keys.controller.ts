import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import { ok, fail } from '../../utils/response';
import * as keysService from './keys.service';

const bundleSchema = z.object({
  registrationId: z.number().int().positive(),
  identityKey: z.string().min(1),
  signedPreKeyId: z.number().int().nonnegative(),
  signedPreKey: z.string().min(1),
  signedPreKeySig: z.string().min(1),
  oneTimePreKeys: z.array(z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1),
  })).max(100).default([]),
});

const replenishSchema = z.object({
  preKeys: z.array(z.object({
    keyId: z.number().int().nonnegative(),
    publicKey: z.string().min(1),
  })).min(1).max(100),
});

export async function uploadBundleHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const body = bundleSchema.parse(req.body);

    await keysService.uploadBundle({
      userId,
      ...body,
    });

    ok(res, { uploaded: true }, 201);
  } catch (err) {
    next(err);
  }
}

export async function fetchBundleHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetUserId = String(req.params.userId);
    const bundle = await keysService.fetchBundle(targetUserId);

    if (!bundle) {
      fail(res, 'BUNDLE_NOT_FOUND', 404);
      return;
    }

    ok(res, bundle);
  } catch (err) {
    next(err);
  }
}

export async function replenishHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const { preKeys } = replenishSchema.parse(req.body);

    await keysService.replenishPreKeys(userId, preKeys);
    ok(res, { added: preKeys.length });
  } catch (err) {
    next(err);
  }
}

export async function hasBundleHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetUserId = String(req.params.userId);
    const has = await keysService.hasBundle(targetUserId);
    ok(res, { hasBundle: has });
  } catch (err) {
    next(err);
  }
}

export async function preKeyCountHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const count = await keysService.getPreKeyCount(userId);
    ok(res, { count });
  } catch (err) {
    next(err);
  }
}
