CREATE TABLE groups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     VARCHAR(100) NOT NULL,
  description              TEXT,
  avatar_url               TEXT,
  invite_link              VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  max_members              INTEGER NOT NULL DEFAULT 1024,
  is_private               BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  disappearing_messages_ttl INTEGER,
  slow_mode_ttl            INTEGER,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member')),
  joined_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  muted_until TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT,
  type          VARCHAR(20) NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text','image','video','audio','file','system')),
  media_url     TEXT,
  media_type    VARCHAR(30),
  media_size    INTEGER,
  thumbnail_url TEXT,
  reply_to_id   UUID REFERENCES group_messages(id) ON DELETE SET NULL,
  is_edited     BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at     TIMESTAMP,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  system_event  VARCHAR(50),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE group_message_reactions (
  message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE group_message_reads (
  message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_group_messages_group_created
  ON group_messages(group_id, created_at DESC);

CREATE INDEX idx_group_members_user
  ON group_members(user_id);
