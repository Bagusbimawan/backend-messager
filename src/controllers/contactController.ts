import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// POST /api/contacts/sync
export async function syncContacts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { phoneNumbers } = z.object({
      phoneNumbers: z.array(z.string()).max(1000),
    }).parse(req.body);

    // Normalize PH numbers: 09XX → +639XX
    const normalized = phoneNumbers.map(n => {
      if (n.startsWith('09') && n.length === 11) return '+63' + n.slice(1);
      if (n.startsWith('9') && n.length === 10) return '+63' + n;
      return n;
    });

    const { rows } = await db.query(
      `SELECT id, display_name, username, avatar_url, phone
       FROM users
       WHERE phone = ANY($1::text[])
         AND id != $2
         AND allow_phone_discovery = TRUE`,
      [normalized, userId],
    );

    for (const user of rows) {
      await db.query(
        `INSERT INTO contacts (user_id, contact_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, user.id],
      );
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/contacts
export async function getContacts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.username, u.avatar_url, u.is_online, u.last_seen, c.created_at
       FROM contacts c
       INNER JOIN users u ON u.id = c.contact_id
       WHERE c.user_id = $1
       ORDER BY u.display_name ASC`,
      [userId],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// POST /api/contacts/:userId
export async function addContact(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const myId = req.user!.userId;
    const contactId = z.string().uuid().parse(req.params['userId']);

    if (myId === contactId) {
      res.status(400).json({ success: false, error: 'Cannot add yourself' });
      return;
    }

    const { rows: [user] } = await db.query(
      'SELECT id, display_name, username, avatar_url FROM users WHERE id = $1',
      [contactId],
    );

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    await db.query(
      'INSERT INTO contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [myId, contactId],
    );

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/contacts/:userId
export async function removeContact(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const myId = req.user!.userId;
    const contactId = z.string().uuid().parse(req.params['userId']);

    await db.query(
      'DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2',
      [myId, contactId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/contacts/qr/:userId
export async function getQrData(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const targetId = z.string().uuid().parse(req.params['userId']);

    const { rows: [user] } = await db.query(
      'SELECT username FROM users WHERE id = $1',
      [targetId],
    );

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: { qrValue: `kwento://profile/${user.username as string}` },
    });
  } catch (err) {
    next(err);
  }
}
