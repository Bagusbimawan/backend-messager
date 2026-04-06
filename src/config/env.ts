import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DB_HOST: z.string(),
  DB_PORT: z.string().default('5432'),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  REDIS_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),

  AWS_REGION: z.string().default('ap-southeast-1'),
  AWS_S3_BUCKET: z.string().default('kwento-media-bucket'),
  AWS_CLOUDFRONT_URL: z.string().default(''),   // https://cdn.kwento.app
  CDN_DOMAIN: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  AWS_MEDIACONVERT_ENDPOINT: z.string().default(''),

  AWS_SNS_PLATFORM_APP_ARN_IOS: z.string().optional(),
  AWS_SNS_PLATFORM_APP_ARN_ANDROID: z.string().optional(),

  ALLOWED_ORIGINS: z.string().default(''),
  OTP_EXPIRY_MINUTES: z.string().default('5'),
  MAX_STORY_VIDEO_DURATION: z.string().default('30'),
  MAX_FILE_SIZE_MB: z.string().default('100'),
  MAX_GROUP_MEMBERS: z.string().default('1024'),
  MAX_COMMUNITY_MEMBERS: z.string().default('10000'),
  STORY_EXPIRY_HOURS: z.string().default('24'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
