import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET;

let s3: S3Client | null = null;

if (S3_ENDPOINT && S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET) {
  s3 = new S3Client({
    endpoint: S3_ENDPOINT.startsWith('http') ? S3_ENDPOINT : `https://${S3_ENDPOINT}`,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  console.log(`[S3] Connected → ${S3_ENDPOINT} / ${S3_BUCKET}`);
} else {
  console.warn('[S3] Not configured — files will be stored locally');
}

export function isS3Enabled(): boolean {
  return s3 !== null && !!S3_BUCKET;
}

export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (!s3 || !S3_BUCKET) throw new Error('S3 not configured');

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return key;
}

export async function getS3Object(key: string): Promise<GetObjectCommandOutput> {
  if (!s3 || !S3_BUCKET) throw new Error('S3 not configured');

  return s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }));
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!s3 || !S3_BUCKET) return;
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => {});
}

const PRESIGN_EXPIRES = 3600;

export async function getPresignedUrl(key: string): Promise<string> {
  if (!s3 || !S3_BUCKET) throw new Error('S3 not configured');

  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }), { expiresIn: PRESIGN_EXPIRES });
}
