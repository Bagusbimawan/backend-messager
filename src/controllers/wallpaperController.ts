import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import type { AuthRequest } from '../middleware/authMiddleware';
import { generatePresignedUrl, resolvePublicUrl } from '../services/s3Service';

const wallpaperConfigSchema = z.object({
  conversationType: z.enum(['dm', 'group', 'community_topic', 'global']),
  wallpaperType: z.enum(['color', 'gradient', 'pattern', 'photo', 'preset']),
  wallpaperValue: z.string().min(1),
  brightness: z.number().int().min(0).max(100).optional(),
  blurAmount: z.number().int().min(0).max(10).optional(),
  extraConfig: z.record(z.unknown()).optional(),
});

const wallpaperUploadSchema = z.object({
  fileType: z.string().min(1),
  fileSize: z.number().int().positive().max(100 * 1024 * 1024),
});

function normalizeWallpaperRow(row: Record<string, unknown>) {
  return {
    userId: row['user_id'],
    conversationId: row['conversation_id'],
    conversationType: row['conversation_type'],
    wallpaperType: row['wallpaper_type'],
    wallpaperValue: row['wallpaper_value'],
    brightness: row['brightness'],
    blurAmount: row['blur_amount'],
    extraConfig: row['extra_config'],
    updatedAt: row['updated_at'],
  };
}

export async function getWallpapers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await db.query(
      `SELECT user_id, conversation_id, conversation_type, wallpaper_type,
              wallpaper_value, brightness, blur_amount, extra_config, updated_at
       FROM user_wallpapers
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user!.userId],
    );

    res.json({ success: true, data: result.rows.map(normalizeWallpaperRow) });
  } catch (error) {
    next(error);
  }
}

export async function upsertGlobalWallpaper(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = wallpaperConfigSchema.parse({
      ...req.body,
      conversationType: 'global',
    });

    const result = await db.query(
      `INSERT INTO user_wallpapers
        (user_id, conversation_id, conversation_type, wallpaper_type, wallpaper_value, brightness, blur_amount, extra_config, updated_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, COALESCE(conversation_id, '00000000-0000-0000-0000-000000000000'::UUID))
       DO UPDATE SET
         conversation_type = EXCLUDED.conversation_type,
         wallpaper_type = EXCLUDED.wallpaper_type,
         wallpaper_value = EXCLUDED.wallpaper_value,
         brightness = EXCLUDED.brightness,
         blur_amount = EXCLUDED.blur_amount,
         extra_config = EXCLUDED.extra_config,
         updated_at = NOW()
       RETURNING user_id, conversation_id, conversation_type, wallpaper_type, wallpaper_value, brightness, blur_amount, extra_config, updated_at`,
      [
        req.user!.userId,
        body.conversationType,
        body.wallpaperType,
        body.wallpaperValue,
        body.brightness ?? 100,
        body.blurAmount ?? 0,
        body.extraConfig ? JSON.stringify(body.extraConfig) : null,
      ],
    );

    res.json({ success: true, data: normalizeWallpaperRow(result.rows[0] as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
}

export async function upsertConversationWallpaper(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conversationId = z.string().uuid().parse(req.params['conversationId']);
    const body = wallpaperConfigSchema.parse(req.body);

    const result = await db.query(
      `INSERT INTO user_wallpapers
        (user_id, conversation_id, conversation_type, wallpaper_type, wallpaper_value, brightness, blur_amount, extra_config, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id, COALESCE(conversation_id, '00000000-0000-0000-0000-000000000000'::UUID))
       DO UPDATE SET
         conversation_type = EXCLUDED.conversation_type,
         wallpaper_type = EXCLUDED.wallpaper_type,
         wallpaper_value = EXCLUDED.wallpaper_value,
         brightness = EXCLUDED.brightness,
         blur_amount = EXCLUDED.blur_amount,
         extra_config = EXCLUDED.extra_config,
         updated_at = NOW()
       RETURNING user_id, conversation_id, conversation_type, wallpaper_type, wallpaper_value, brightness, blur_amount, extra_config, updated_at`,
      [
        req.user!.userId,
        conversationId,
        body.conversationType,
        body.wallpaperType,
        body.wallpaperValue,
        body.brightness ?? 100,
        body.blurAmount ?? 0,
        body.extraConfig ? JSON.stringify(body.extraConfig) : null,
      ],
    );

    res.json({ success: true, data: normalizeWallpaperRow(result.rows[0] as Record<string, unknown>) });
  } catch (error) {
    next(error);
  }
}

export async function resetConversationWallpaper(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conversationId = z.string().uuid().parse(req.params['conversationId']);

    await db.query(
      `DELETE FROM user_wallpapers
       WHERE user_id = $1 AND conversation_id = $2`,
      [req.user!.userId, conversationId],
    );

    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
}

export async function resetAllWallpapers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await db.query('DELETE FROM user_wallpapers WHERE user_id = $1', [req.user!.userId]);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
}

export async function getWallpaperPresets(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await db.query(
      `SELECT id, category, label, label_ph, thumbnail_url, full_url, sort_order
       FROM wallpaper_presets
       WHERE is_active = TRUE
       ORDER BY category, sort_order, label`,
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function getWallpaperUploadPresignedUrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = wallpaperUploadSchema.parse(req.body);
    const ext = body.fileType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const fileKey = `wallpapers/user_uploads/${req.user!.userId}/wallpaper_${Date.now()}.${ext}`;
    const uploadUrl = await generatePresignedUrl(fileKey, body.fileType);

    res.json({
      success: true,
      data: {
        uploadUrl,
        fileKey,
        publicUrl: resolvePublicUrl(fileKey),
      },
    });
  } catch (error) {
    next(error);
  }
}
