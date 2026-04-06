import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';
import { randomUUID } from 'crypto';

const createPollSchema = z.object({
  conversationId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  is_multiple: z.boolean().default(false),
  is_anonymous: z.boolean().default(false),
  expires_in_hours: z.number().int().min(1).max(168).optional(), // max 7 days
});

export async function createPoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createPollSchema.parse(req.body);

    if (!body.conversationId && !body.topicId) {
      res.status(400).json({ success: false, error: 'conversationId or topicId required' });
      return;
    }

    const options = body.options.map((text) => ({ id: randomUUID(), text }));

    // Insert message first (type = 'poll')
    const msgResult = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, content, type, topic_id)
       VALUES ($1, $2, $3, 'poll', $4) RETURNING id`,
      [body.conversationId ?? null, req.user!.userId, body.question, body.topicId ?? null],
    );
    const messageId: string = msgResult.rows[0].id;

    const expiresAt = body.expires_in_hours
      ? new Date(Date.now() + body.expires_in_hours * 3600 * 1000)
      : null;

    const pollResult = await db.query(
      `INSERT INTO polls (message_id, question, options, is_multiple, is_anonymous, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [messageId, body.question, JSON.stringify(options), body.is_multiple, body.is_anonymous, expiresAt],
    );

    res.status(201).json({
      success: true,
      data: { messageId, poll: pollResult.rows[0] },
    });
  } catch (err) {
    next(err);
  }
}

export async function votePoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const pollId = z.string().uuid().parse(req.params['pollId']);
    const { optionIds } = z.object({ optionIds: z.array(z.string().uuid()).min(1) }).parse(req.body);

    const poll = await db.query(
      'SELECT id, options, is_multiple, expires_at FROM polls WHERE id = $1',
      [pollId],
    );
    if (!poll.rows.length) {
      res.status(404).json({ success: false, error: 'Poll not found' });
      return;
    }

    const { is_multiple, expires_at, options } = poll.rows[0];

    if (expires_at && new Date(expires_at) < new Date()) {
      res.status(400).json({ success: false, error: 'Poll has expired' });
      return;
    }

    if (!is_multiple && optionIds.length > 1) {
      res.status(400).json({ success: false, error: 'This poll only allows one choice' });
      return;
    }

    // Validate option IDs exist
    const validIds = (options as Array<{ id: string }>).map((o) => o.id);
    if (optionIds.some((id) => !validIds.includes(id))) {
      res.status(400).json({ success: false, error: 'Invalid option ID' });
      return;
    }

    await db.query(
      `INSERT INTO poll_votes (poll_id, user_id, option_ids)
       VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET option_ids = $3, voted_at = NOW()`,
      [pollId, req.user!.userId, JSON.stringify(optionIds)],
    );

    // Return updated results
    const results = await getPollResults(pollId);
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
}

export async function getPoll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const pollId = z.string().uuid().parse(req.params['pollId']);
    const results = await getPollResults(pollId, req.user!.userId);
    if (!results) {
      res.status(404).json({ success: false, error: 'Poll not found' });
      return;
    }
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
}

async function getPollResults(pollId: string, viewerId?: string) {
  const poll = await db.query('SELECT * FROM polls WHERE id = $1', [pollId]);
  if (!poll.rows.length) return null;

  const { id, question, options, is_multiple, is_anonymous, expires_at, created_at } = poll.rows[0];

  const votes = await db.query(
    'SELECT user_id, option_ids FROM poll_votes WHERE poll_id = $1',
    [id],
  );

  const totalVotes = votes.rows.length;
  const optionCounts: Record<string, number> = {};
  let myVote: string[] = [];

  for (const vote of votes.rows) {
    const chosen: string[] = vote.option_ids;
    for (const oid of chosen) {
      optionCounts[oid] = (optionCounts[oid] ?? 0) + 1;
    }
    if (viewerId && vote.user_id === viewerId) myVote = chosen;
  }

  const enrichedOptions = (options as Array<{ id: string; text: string }>).map((o) => ({
    ...o,
    votes: optionCounts[o.id] ?? 0,
    percentage: totalVotes > 0 ? Math.round(((optionCounts[o.id] ?? 0) / totalVotes) * 100) : 0,
  }));

  return {
    id,
    question,
    options: enrichedOptions,
    is_multiple,
    is_anonymous,
    expires_at,
    created_at,
    total_votes: totalVotes,
    my_vote: myVote,
    has_voted: myVote.length > 0,
  };
}
