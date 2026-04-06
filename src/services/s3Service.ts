import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

const s3Client = new S3Client({ region: env.AWS_REGION });

function getCdnBaseUrl(): string {
  if (env.CDN_DOMAIN) {
    return env.CDN_DOMAIN.startsWith('http') ? env.CDN_DOMAIN : `https://${env.CDN_DOMAIN}`;
  }
  if (env.AWS_CLOUDFRONT_URL) {
    return env.AWS_CLOUDFRONT_URL;
  }
  return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`;
}

export function resolvePublicUrl(fileKey: string): string {
  return `${getCdnBaseUrl().replace(/\/$/, '')}/${fileKey}`;
}

export async function generatePresignedUrl(
  fileKey: string,
  fileType: string,
  expiresIn = 300,
): Promise<string> {
  if (!env.AWS_ACCESS_KEY_ID || env.NODE_ENV === 'development') {
    return `${resolvePublicUrl(fileKey)}?mockPresigned=true`;
  }

  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: fileKey,
    ContentType: fileType,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFile(url: string): Promise<void> {
  const cdnBase = getCdnBaseUrl().replace(/\/$/, '');
  const key = url.replace(`${cdnBase}/`, '');

  if (!key || !env.AWS_ACCESS_KEY_ID || env.NODE_ENV === 'development') {
    return;
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    }),
  );
}
