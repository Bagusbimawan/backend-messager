import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const s3 = new S3Client({ region: env.AWS_REGION });

export type MediaFolder = 'messages' | 'stories' | 'avatars' | 'covers' | 'voices';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/quicktime', 'video/webm'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg'];
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function detectMediaType(contentType: string): 'image' | 'video' | 'audio' | 'file' | null {
  if (ALLOWED_IMAGE_TYPES.includes(contentType)) return 'image';
  if (ALLOWED_VIDEO_TYPES.includes(contentType)) return 'video';
  if (ALLOWED_AUDIO_TYPES.includes(contentType)) return 'audio';
  if (ALLOWED_FILE_TYPES.includes(contentType)) return 'file';
  return null;
}

export function getAllowedTypes(folder: MediaFolder): string[] {
  if (folder === 'voices') return ALLOWED_AUDIO_TYPES;
  if (folder === 'avatars' || folder === 'covers') return ALLOWED_IMAGE_TYPES;
  return [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES, ...ALLOWED_FILE_TYPES];
}

export function resolveMediaUrl(key: string): string {
  if (env.AWS_CLOUDFRONT_URL) return `${env.AWS_CLOUDFRONT_URL}/${key}`;
  return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

export async function generateUploadUrl(
  folder: MediaFolder,
  userId: string,
  contentType: string,
  filename?: string,
): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  const allowed = getAllowedTypes(folder);
  if (!allowed.includes(contentType)) {
    throw new Error(`Content type ${contentType} not allowed for ${folder}`);
  }

  const ext = contentType.split('/')[1].replace('quicktime', 'mov').replace('mpeg', 'mp3');
  const timestamp = Date.now();
  const key = `${folder}/${userId}/${timestamp}.${ext}`;

  // In dev mode without real AWS credentials, return a mock URL
  if (!env.AWS_ACCESS_KEY_ID || env.NODE_ENV === 'development') {
    const publicUrl = `http://localhost:3000/dev-media/${key}`;
    return { uploadUrl: publicUrl, key, publicUrl };
  }

  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: contentType,
    Metadata: filename ? { filename } : {},
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }); // 10 min
  const publicUrl = resolveMediaUrl(key);

  return { uploadUrl, key, publicUrl };
}

export async function deleteS3Object(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }));
  } catch (err) {
    logger.warn('Failed to delete S3 object', { key, error: (err as Error).message });
  }
}

// Kick off MediaConvert transcoding for a video (to HLS)
export async function transcodeVideo(
  inputKey: string,
  outputPrefix: string,
): Promise<void> {
  if (!env.AWS_MEDIACONVERT_ENDPOINT) {
    logger.warn('MediaConvert endpoint not configured — skipping transcode');
    return;
  }

  const mc = new MediaConvertClient({
    region: env.AWS_REGION,
    endpoint: env.AWS_MEDIACONVERT_ENDPOINT,
  });

  const inputUri = `s3://${env.AWS_S3_BUCKET}/${inputKey}`;
  const outputUri = `s3://${env.AWS_S3_BUCKET}/${outputPrefix}/`;

  await mc.send(
    new CreateJobCommand({
      Role: `arn:aws:iam::${process.env['AWS_ACCOUNT_ID']}:role/MediaConvertRole`,
      Settings: {
        Inputs: [{ FileInput: inputUri, AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } } }],
        OutputGroups: [
          {
            Name: 'Apple HLS',
            OutputGroupSettings: {
              Type: 'HLS_GROUP_SETTINGS',
              HlsGroupSettings: {
                Destination: outputUri,
                SegmentLength: 6,
                MinSegmentLength: 0,
              },
            },
            Outputs: [
              {
                VideoDescription: {
                  Width: 720,
                  Height: 1280,
                  CodecSettings: {
                    Codec: 'H_264',
                    H264Settings: { RateControlMode: 'QVBR', MaxBitrate: 2000000 },
                  },
                },
                AudioDescriptions: [
                  {
                    CodecSettings: {
                      Codec: 'AAC',
                      AacSettings: { Bitrate: 96000, SampleRate: 44100 },
                    },
                  },
                ],
                ContainerSettings: { Container: 'M3U8', M3u8Settings: {} },
                NameModifier: '_720p',
              },
            ],
          },
        ],
      },
    }),
  );

  logger.info('MediaConvert job created', { inputKey, outputPrefix });
}
