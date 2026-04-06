CREATE TABLE communities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  cover_url     TEXT,
  category      VARCHAR(50) NOT NULL DEFAULT 'general',
  invite_link   VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_public     BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  member_count  INTEGER NOT NULL DEFAULT 1,
  owner_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE community_topics (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id           UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name                   VARCHAR(100) NOT NULL,
  description            TEXT,
  icon                   VARCHAR(10),
  is_announcements_only  BOOLEAN NOT NULL DEFAULT FALSE,
  is_default             BOOLEAN NOT NULL DEFAULT FALSE,
  position               INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE community_members (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  is_banned    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE community_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      UUID NOT NULL REFERENCES community_topics(id) ON DELETE CASCADE,
  sender_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT,
  type          VARCHAR(20) NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text','image','video','audio','file')),
  media_url     TEXT,
  media_type    VARCHAR(30),
  thumbnail_url TEXT,
  reply_to_id   UUID REFERENCES community_messages(id) ON DELETE SET NULL,
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  is_edited     BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at     TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE community_message_reactions (
  message_id UUID NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_community_messages_topic_created
  ON community_messages(topic_id, created_at DESC);

CREATE INDEX idx_communities_public_members
  ON communities(is_public, member_count DESC) WHERE is_public = TRUE;

CREATE INDEX idx_community_members_user
  ON community_members(user_id);
