-- Kwento v2 Migration — Stories, Communities, Media, Reactions, Polls
-- Run: psql $DATABASE_URL -f src/models/migration_v2.sql

-- ── 1. Media columns on messages ──────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_url       TEXT,
  ADD COLUMN IF NOT EXISTS media_type      VARCHAR(20),  -- image|video|audio|file
  ADD COLUMN IF NOT EXISTS media_size      BIGINT,
  ADD COLUMN IF NOT EXISTS media_duration  INTEGER,      -- seconds (audio/video)
  ADD COLUMN IF NOT EXISTS thumbnail_url   TEXT,
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_id     UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS topic_id        UUID,         -- FK added after table created below
  ADD COLUMN IF NOT EXISTS is_edited       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disappears_at   TIMESTAMP;

-- ── 2. Stories ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url       TEXT        NOT NULL,
  media_type      VARCHAR(10) NOT NULL CHECK (media_type IN ('image','video','text')),
  caption         TEXT,
  bg_color        VARCHAR(30),
  overlays        JSONB,      -- [{type, text/emoji, x, y, scale, rotation}]
  privacy         VARCHAR(20) NOT NULL DEFAULT 'contacts' CHECK (privacy IN ('all','contacts','custom','closefriends')),
  custom_audience UUID[]      DEFAULT ARRAY[]::UUID[],
  expires_at      TIMESTAMP   NOT NULL,
  view_count      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_views (
  story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS story_replies (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   UUID      NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  sender_id  UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT      NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS close_friends (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

-- ── 3. Communities ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communities (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  cover_url    TEXT,
  invite_link  VARCHAR(50) UNIQUE DEFAULT LEFT(gen_random_uuid()::TEXT, 8),
  is_public    BOOLEAN     NOT NULL DEFAULT TRUE,
  category     VARCHAR(50),
  member_count INTEGER     NOT NULL DEFAULT 1,
  owner_id     UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slow_mode_seconds INTEGER DEFAULT 0,
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_topics (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id          UUID        NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name                  VARCHAR(100) NOT NULL,
  description           TEXT,
  is_announcements_only BOOLEAN     NOT NULL DEFAULT FALSE,
  position              INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_members (
  community_id UUID      NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  banned_at    TIMESTAMP,
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_join_requests (
  community_id UUID      NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

-- Add FK for topic_id on messages now that the table exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_messages_topic' AND table_name = 'messages'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT fk_messages_topic
      FOREIGN KEY (topic_id) REFERENCES community_topics(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_communities_public   ON communities(is_public, member_count DESC);
CREATE INDEX IF NOT EXISTS idx_community_topics_pos ON community_topics(community_id, position);
CREATE INDEX IF NOT EXISTS idx_community_members    ON community_members(community_id, role);

-- ── 4. Channels (broadcast, 1-way) ───────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  cover_url    TEXT,
  owner_id     UUID        NOT NULL REFERENCES users(id),
  is_public    BOOLEAN     NOT NULL DEFAULT TRUE,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_subscribers (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

-- Channel posts reuse messages table (sender_id = owner, conversation_id = NULL, topic_id = NULL)
-- But we add a channel_id column
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE CASCADE;

-- ── 5. Message Reactions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID      NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- ── 6. Polls ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS polls (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID      NOT NULL REFERENCES messages(id) ON DELETE CASCADE UNIQUE,
  question    TEXT      NOT NULL,
  options     JSONB     NOT NULL,    -- [{id: uuid, text: string}]
  is_multiple BOOLEAN   NOT NULL DEFAULT FALSE,
  is_anonymous BOOLEAN  NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    UUID      NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id    UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_ids JSONB     NOT NULL,   -- array of option id strings
  voted_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

-- ── 7. OTP / Phone verification ───────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(20) NOT NULL,
  code       VARCHAR(6) NOT NULL,
  purpose    VARCHAR(20) NOT NULL DEFAULT 'register', -- register|login_reset
  attempts   INTEGER   NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  used_at    TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, expires_at DESC);

-- ── 8. Disappearing message conversations setting ─────────────────
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS disappear_after VARCHAR(20) DEFAULT 'off';
  -- 'off' | '24h' | '7d' | '30d'
