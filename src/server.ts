import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';
import { logger } from './utils/logger';
import { errorHandler, notFound } from './middleware/errorHandler';
import { startBackgroundJobs } from './jobs/storyCleanup';

import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import messageRoutes from './routes/messageRoutes';
import storyRoutes from './routes/storyRoutes';
import communityRoutes from './routes/communityRoutes';
import groupRoutes from './routes/groupRoutes';
import channelRoutes from './routes/channelRoutes';
import mediaRoutes from './routes/mediaRoutes';
import otpRoutes from './routes/otpRoutes';
import wallpaperRoutes from './routes/wallpaperRoutes';
import callRoutes from './routes/callRoutes';
import stickerRoutes from './routes/stickerRoutes';
import contactRoutes from './routes/contactRoutes';
import blockRoutes from './routes/blockRoutes';
import { registerSocketHandlers } from './socket/socketHandler';

const app = express();
const server = http.createServer(app);

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(helmet());

// Dev: accept story/media uploads when S3 is mocked to http://localhost:3000/dev-media/...
app.use(
  '/dev-media',
  express.raw({ limit: '100mb', type: '*/*' }),
  (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'PUT' && req.method !== 'POST') {
      res.sendStatus(405);
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      res.sendStatus(200);
      return;
    }
    // GET/HEAD: minimal transparent PNG so <Image uri={publicUrl}> does not loop on hard errors
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQU9lX7DZwAAAABJRU5ErkJggg==',
      'base64',
    );
    res.type('image/png').send(pixel);
  },
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Routes ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/users', userRoutes);
app.use('/api', messageRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api', mediaRoutes);
app.use('/api/wallpapers', wallpaperRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/stickers', stickerRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/blocks', blockRoutes);

app.use(notFound);
app.use(errorHandler);

// ── Socket.IO ──────────────────────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: { origin: allowedOrigins.length > 0 ? allowedOrigins : '*', credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.set('io', io);
registerSocketHandlers(io);

async function start(): Promise<void> {
  await connectDB();
  await connectRedis();
  startBackgroundJobs();

  const port = parseInt(env.PORT, 10);
  server.listen(port, () => {
    logger.info(`Kwento v2 backend running on port ${port} [${env.NODE_ENV}]`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: (err as Error).message });
  process.exit(1);
});

export { io };
