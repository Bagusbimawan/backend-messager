import {
  SNSClient,
  PublishCommand,
  CreatePlatformEndpointCommand,
} from '@aws-sdk/client-sns';
import { db } from '../config/db';
import { getPushTokens } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const sns = new SNSClient({ region: env.AWS_REGION });

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const tokens = await getPushTokens(userId);
    if (!Object.keys(tokens).length) return;

    const promises: Promise<void>[] = [];

    if (tokens['ios'] && env.AWS_SNS_PLATFORM_APP_ARN_IOS) {
      promises.push(sendToSNS(tokens['ios'], 'ios', payload));
    }
    if (tokens['android'] && env.AWS_SNS_PLATFORM_APP_ARN_ANDROID) {
      promises.push(sendToSNS(tokens['android'], 'android', payload));
    }

    await Promise.allSettled(promises);
  } catch (err) {
    logger.warn('Push notification failed', { userId, error: (err as Error).message });
  }
}

async function sendToSNS(
  deviceToken: string,
  platform: 'ios' | 'android',
  payload: PushPayload,
): Promise<void> {
  const arnKey = platform === 'ios'
    ? env.AWS_SNS_PLATFORM_APP_ARN_IOS
    : env.AWS_SNS_PLATFORM_APP_ARN_ANDROID;

  if (!arnKey) return;

  // Register endpoint
  const endpointResult = await sns.send(
    new CreatePlatformEndpointCommand({
      PlatformApplicationArn: arnKey,
      Token: deviceToken,
    }),
  );

  const endpointArn = endpointResult.EndpointArn;
  if (!endpointArn) return;

  // Build platform-specific payload
  const message = platform === 'ios'
    ? JSON.stringify({
        APNS: JSON.stringify({
          aps: {
            alert: { title: payload.title, body: payload.body },
            sound: 'default',
            badge: 1,
          },
          data: payload.data ?? {},
        }),
      })
    : JSON.stringify({
        GCM: JSON.stringify({
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
        }),
      });

  await sns.send(
    new PublishCommand({
      TargetArn: endpointArn,
      Message: message,
      MessageStructure: 'json',
    }),
  );
}

export async function registerDeviceToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android',
): Promise<void> {
  await db.query('UPDATE users SET device_token = $1 WHERE id = $2', [token, userId]);
  const { savePushToken } = await import('../config/redis');
  await savePushToken(userId, token, platform);
}
