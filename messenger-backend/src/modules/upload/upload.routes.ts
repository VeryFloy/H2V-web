import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import FileType from 'file-type';
import { authMiddleware } from '../../middleware/auth.middleware';
import { AuthRequest } from '../../types';
import { ok, fail } from '../../utils/response';
import { isS3Enabled, uploadToS3 } from '../../config/s3';

const UPLOADS_DIR = path.join(__dirname, '../../../../uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
const MEDIUM_DIR = path.join(UPLOADS_DIR, 'medium');

for (const dir of [UPLOADS_DIR, AVATARS_DIR, THUMBS_DIR, MEDIUM_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const memStorage = multer.memoryStorage();

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const ALLOWED_MIME = [
  ...IMAGE_MIME,
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/webm',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const fileUpload = multer({
  storage: memStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const avatarUpload = multer({
  storage: memStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images allowed for avatars'));
  },
});

async function saveBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
  if (isS3Enabled()) {
    await uploadToS3(key, buffer, contentType);
  } else {
    const fullPath = path.join(UPLOADS_DIR, '..', key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }
}

async function processImage(buffer: Buffer, baseName: string) {
  const webpName = `${baseName}.webp`;

  const originalBuf = await sharp(buffer)
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const thumbBuf = await sharp(buffer)
    .resize(200, 200, { fit: 'cover', position: 'centre' })
    .webp({ quality: 60 })
    .toBuffer();

  const mediumBuf = await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  await Promise.all([
    saveBuffer(`uploads/${webpName}`, originalBuf, 'image/webp'),
    saveBuffer(`uploads/thumbs/${webpName}`, thumbBuf, 'image/webp'),
    saveBuffer(`uploads/medium/${webpName}`, mediumBuf, 'image/webp'),
  ]);

  return {
    url: `/uploads/${webpName}`,
    thumbUrl: `/uploads/thumbs/${webpName}`,
    mediumUrl: `/uploads/medium/${webpName}`,
    size: originalBuf.length,
  };
}

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many uploads, try again later' },
});

const router = Router();
router.use(authMiddleware);
router.use(uploadLimiter);

router.post(
  '/',
  fileUpload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) { fail(res, 'No file provided', 400); return; }

      const detected = await FileType.fromBuffer(req.file.buffer);
      if (detected) {
        if (!ALLOWED_MIME.includes(detected.mime)) {
          fail(res, 'File type not allowed', 400); return;
        }
      } else if (req.file.mimetype !== 'text/plain') {
        fail(res, 'File type not allowed', 400); return;
      }
      const mime = detected?.mime ?? req.file.mimetype;
      const isImage = mime.startsWith('image/');

      if (isImage) {
        const baseName = `${Date.now()}-${crypto.randomUUID()}`;
        const versions = await processImage(req.file.buffer, baseName);

        ok(res, {
          ...versions,
          type: 'IMAGE' as const,
          name: req.file.originalname,
        }, 201);
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
      const key = `uploads/${filename}`;

      await saveBuffer(key, req.file.buffer, mime);

      let type: 'VIDEO' | 'AUDIO' | 'FILE' = 'FILE';
      // WebM is a video container; file-type detects audio-only WebM as video/webm.
      // Trust the browser's original MIME when it says audio/*.
      if (mime.startsWith('audio/') || req.file.mimetype.startsWith('audio/')) type = 'AUDIO';
      else if (mime.startsWith('video/')) type = 'VIDEO';

      ok(res, {
        url: `/uploads/${filename}`,
        type,
        name: req.file.originalname,
        size: req.file.size,
      }, 201);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/avatar',
  avatarUpload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) { fail(res, 'No file provided', 400); return; }

      const detected = await FileType.fromBuffer(req.file.buffer);
      if (!detected || !IMAGE_MIME.includes(detected.mime)) {
        fail(res, 'Only images allowed for avatars', 400); return;
      }

      const name = `${Date.now()}-${crypto.randomUUID()}.webp`;
      const buffer = await sharp(req.file.buffer)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();

      await saveBuffer(`uploads/avatars/${name}`, buffer, 'image/webp');

      ok(res, {
        url: `/uploads/avatars/${name}`,
        type: 'IMAGE',
        name,
        size: buffer.length,
      }, 201);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
