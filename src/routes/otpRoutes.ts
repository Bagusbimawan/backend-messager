import { Router } from 'express';
import { requestOtp, confirmOtp } from '../controllers/otpController';
import rateLimit from 'express-rate-limit';

const router = Router();

const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3, // 3 OTP requests per minute
  message: { success: false, error: 'Too many OTP requests. Wait a minute.' },
});

router.post('/request', otpLimiter, requestOtp);
router.post('/verify', otpLimiter, confirmOtp);

export default router;
