import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendOtp, verifyOtp } from '../services/otpService';

const phPhoneSchema = z.string().regex(/^(\+63|0)\d{9,11}$/, 'Invalid Philippine mobile number');

function normalizePhone(phone: string): string {
  if (phone.startsWith('0')) return `+63${phone.slice(1)}`;
  return phone;
}

export async function requestOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, purpose } = z.object({
      phone: phPhoneSchema,
      purpose: z.enum(['register', 'login_reset']).default('register'),
    }).parse(req.body);

    await sendOtp(normalizePhone(phone), purpose);
    res.json({ success: true, data: { message: 'OTP sent via SMS' } });
  } catch (err) {
    next(err);
  }
}

export async function confirmOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, code, purpose } = z.object({
      phone: phPhoneSchema,
      code: z.string().length(6).regex(/^\d{6}$/),
      purpose: z.enum(['register', 'login_reset']).default('register'),
    }).parse(req.body);

    const valid = await verifyOtp(normalizePhone(phone), code, purpose);
    if (!valid) {
      res.status(400).json({ success: false, error: 'Invalid or expired OTP code' });
      return;
    }

    res.json({ success: true, data: { verified: true } });
  } catch (err) {
    next(err);
  }
}
