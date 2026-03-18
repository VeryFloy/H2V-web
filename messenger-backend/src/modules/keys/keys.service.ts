import { prisma } from '../../config/database';

interface UploadBundleInput {
  userId: string;
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySig: string;
  oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
}

export async function uploadBundle(input: UploadBundleInput) {
  await prisma.$transaction(async (tx) => {
    await tx.oneTimePreKey.deleteMany({ where: { userId: input.userId } });

    await tx.preKeyBundle.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        registrationId: input.registrationId,
        identityKey: input.identityKey,
        signedPreKeyId: input.signedPreKeyId,
        signedPreKey: input.signedPreKey,
        signedPreKeySig: input.signedPreKeySig,
      },
      update: {
        registrationId: input.registrationId,
        identityKey: input.identityKey,
        signedPreKeyId: input.signedPreKeyId,
        signedPreKey: input.signedPreKey,
        signedPreKeySig: input.signedPreKeySig,
      },
    });

    if (input.oneTimePreKeys.length > 0) {
      await tx.oneTimePreKey.createMany({
        data: input.oneTimePreKeys.map((k) => ({
          userId: input.userId,
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
      });
    }
  });
}

export async function fetchBundle(targetUserId: string) {
  const bundle = await prisma.preKeyBundle.findUnique({
    where: { userId: targetUserId },
  });

  if (!bundle) return null;

  // Atomically select and delete one OTP key inside a transaction
  // to prevent race conditions when multiple clients fetch simultaneously
  const otpKey = await prisma.$transaction(async (tx) => {
    const key = await tx.oneTimePreKey.findFirst({
      where: { userId: targetUserId },
      orderBy: { keyId: 'asc' },
    });
    if (key) {
      await tx.oneTimePreKey.delete({ where: { id: key.id } });
    }
    return key;
  });

  return {
    registrationId: bundle.registrationId,
    identityKey: bundle.identityKey,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySig: bundle.signedPreKeySig,
    preKey: otpKey ? { keyId: otpKey.keyId, publicKey: otpKey.publicKey } : null,
  };
}

export async function replenishPreKeys(
  userId: string,
  keys: Array<{ keyId: number; publicKey: string }>,
) {
  await prisma.oneTimePreKey.createMany({
    data: keys.map((k) => ({
      userId,
      keyId: k.keyId,
      publicKey: k.publicKey,
    })),
  });
}

export async function getPreKeyCount(userId: string): Promise<number> {
  return prisma.oneTimePreKey.count({ where: { userId } });
}

// Lightweight check — does not consume any OTP prekey
export async function hasBundle(userId: string): Promise<boolean> {
  const bundle = await prisma.preKeyBundle.findUnique({
    where: { userId },
    select: { userId: true },
  });
  return !!bundle;
}
