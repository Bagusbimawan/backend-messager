-- Kwento v3 Migration — Calls & Missing Story columns
-- Run: psql -U kwento_user -d kwento_db -f src/models/migration_v3.sql

-- 1. Add missing thumbnail_url to stories
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- 2. Call history and status
CREATE TABLE IF NOT EXISTS calls (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type       VARCHAR(20) NOT NULL CHECK (call_type IN ('voice', 'video')),
  room_type       VARCHAR(20) NOT NULL CHECK (room_type IN ('direct', 'group', 'community')),
  initiator_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        UUID,       -- nullable, depending on room_type
  status          VARCHAR(20) NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at      TIMESTAMP,
  ended_at        TIMESTAMP,
  duration_secs   INTEGER,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_participants (
  call_id         UUID        NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMP,
  left_at         TIMESTAMP,
  PRIMARY KEY (call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_calls_initiator ON calls(initiator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id);
