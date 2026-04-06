CREATE TABLE channels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  handle           VARCHAR(50) UNIQUE NOT NULL,
  description      TEXT,
  avatar_url       TEXT,
  cover_url        TEXT,
  category         VARCHAR(50) NOT NULL DEFAULT 'general',
  is_public        BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE channel_subscribers (
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notifications BOOLEAN NOT NULL DEFAULT TRUE,
  subscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE channel_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT,
  type          VARCHAR(20) NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text','image','video','file','poll','album')),
  media_url     TEXT,
  media_type    VARCHAR(30),
  thumbnail_url TEXT,
  media_items   JSONB,
  view_count    INTEGER NOT NULL DEFAULT 0,
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE channel_post_reactions (
  post_id    UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE channel_post_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  reply_to_id UUID REFERENCES channel_post_comments(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_posts_channel_created
  ON channel_posts(channel_id, created_at DESC);

CREATE INDEX idx_channels_public_subscribers
  ON channels(is_public, subscriber_count DESC) WHERE is_public = TRUE;
