import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { db } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const sns = new SNSClient({ region: env.AWS_REGION });

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtp(phone: string, purpose: 'register' | 'login_reset'): Promise<void> {
  // Invalidate old OTPs for this phone + purpose
  await db.query(
    "UPDATE otp_codes SET used_at = NOW() WHERE phone = $1 AND purpose = $2 AND used_at IS NULL",
    [phone, purpose],
  );

  const code = generateOtp();
  const expiryMinutes = parseInt(env.OTP_EXPIRY_MINUTES, 10);

  await db.query(
    `INSERT INTO otp_codes (phone, code, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${expiryMinutes} minutes')`,
    [phone, code, purpose],
  );

  const message = `[Kwento] Your OTP code is: ${code}. Valid for ${expiryMinutes} minutes. Do not share this code.`;

  if (env.NODE_ENV === 'development') {
    // In dev mode, log OTP instead of actually sending SMS
    logger.info('DEV OTP (not sent via SMS)', { phone, code, purpose });
    return;
  }

  await sns.send(
    new PublishCommand({
      Message: message,
      PhoneNumber: phone,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'KWENTO' },
      },
    }),
  );

  logger.info('OTP sent', { phone: phone.slice(0, 7) + '***', purpose });
}

export async function verifyOtp(
  phone: string,
  code: string,
  purpose: 'register' | 'login_reset',
): Promise<boolean> {
  const result = await db.query(
    `SELECT id, attempts FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose],
  );

  if (!result.rows.length) return false;

  const { id, attempts } = result.rows[0];

  // Max 5 attempts
  if (attempts >= 5) {
    await db.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [id]);
    return false;
  }

  if (result.rows[0] && await checkCode(id, code)) {
    await db.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [id]);
    return true;
  }

  // Increment attempts
  await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [id]);
  return false;
}

async function checkCode(otpId: string, code: string): Promise<boolean> {
  const result = await db.query('SELECT code FROM otp_codes WHERE id = $1', [otpId]);
  return result.rows[0]?.code === code;
}
