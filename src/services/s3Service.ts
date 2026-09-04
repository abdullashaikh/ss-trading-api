import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export function isS3Configured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
}

let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client | null {
  if (!isS3Configured()) {
    return null;
  }
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    });
  }
  return s3ClientInstance;
}

export async function uploadBillPdf(
  filePath: string,
  fileName: string
): Promise<{ s3Url: string | null; localPath: string; s3Key?: string }> {
  const localPath = `/uploads/bills/${fileName}`;
  const s3Client = getS3Client();

  if (!s3Client) {
    return { s3Url: null, localPath };
  }

  try {
    const fileContent = fs.readFileSync(filePath);
    const bucket = process.env.AWS_S3_BUCKET!;
    const key = `bills/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: 'application/pdf'
    });

    await s3Client.send(command);
    const s3Url = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
    return { s3Url, localPath, s3Key: key };
  } catch (error) {
    console.warn('S3 upload skipped/failed, using local fallback:', error);
    return { s3Url: null, localPath };
  }
}

/**
 * Generate a temporary AWS S3 presigned GET URL for secure viewing/downloading of a bill.
 * The S3 bucket remains strictly private.
 * Default expiration is 1 hour (3600 seconds).
 */
export async function generateBillPresignedUrl(
  key: string,
  expiresInSeconds: number = 3600,
  isAttachment: boolean = false
): Promise<string | null> {
  const s3Client = getS3Client();
  if (!s3Client) {
    return null;
  }

  try {
    const bucket = process.env.AWS_S3_BUCKET!;
    const fileName = path.basename(key);
    const dispositionType = isAttachment ? 'attachment' : 'inline';

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: `${dispositionType}; filename="${fileName}"`
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds
    });

    return signedUrl;
  } catch (error) {
    console.error('[S3] Error generating presigned URL:', error);
    return null;
  }
}

/**
 * Resolves an S3 key from either a stored S3 key ('bills/ST-2026-00011.pdf')
 * or a legacy full URL ('https://.../bills/ST-2026-00011.pdf').
 */
export function resolveS3Key(s3UrlOrKey: string | null | undefined, billNumber: string): string {
  if (!s3UrlOrKey || typeof s3UrlOrKey !== 'string') {
    return `bills/${billNumber}.pdf`;
  }
  if (s3UrlOrKey.startsWith('http://') || s3UrlOrKey.startsWith('https://')) {
    try {
      const parsed = new URL(s3UrlOrKey);
      const cleaned = parsed.pathname.replace(/^\/+/, '');
      return cleaned || `bills/${billNumber}.pdf`;
    } catch {
      return `bills/${billNumber}.pdf`;
    }
  }
  return s3UrlOrKey.trim();
}
