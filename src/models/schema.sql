-- Kwento Messenger — PostgreSQL Schema
-- Region: ap-southeast-1 (Singapore, closest to Philippines)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20) UNIQUE NOT NULL,        -- PH format: +63XXXXXXXXXX
  username      VARCHAR(50) UNIQUE NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  password_hash TEXT        NOT NULL,
  avatar_url    TEXT,
  bio           TEXT,
  is_online     BOOLEAN     DEFAULT FALSE,
  last_seen     TIMESTAMP,
  device_token  TEXT,                               -- FCM/APNs token for push notifications
  created_at    TIMESTAMP   DEFAULT NOW()
);

CREATE TABLE conversations (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversation_participants (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMP DEFAULT NOW(),
  last_read_at    TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT        NOT NULL,
  type            VARCHAR(20) DEFAULT 'text',       -- 'text' only for now
  status          VARCHAR(20) DEFAULT 'sent',       -- sent | delivered | read
  created_at      TIMESTAMP   DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_participants_user     ON conversation_participants(user_id);
CREATE INDEX idx_users_phone           ON users(phone);
CREATE INDEX idx_users_username        ON users(username);

-- Helpful view: conversations with last message (for ChatListScreen)
CREATE VIEW conversation_previews AS
SELECT
  cp.user_id,
  c.id              AS conversation_id,
  c.created_at,
  m.content         AS last_message,
  m.sender_id       AS last_sender_id,
  m.created_at      AS last_message_at,
  m.status          AS last_message_status,
  (
    SELECT COUNT(*)
    FROM messages m2
    WHERE m2.conversation_id = c.id
      AND m2.created_at > cp.last_read_at
      AND m2.sender_id <> cp.user_id
  )::INT            AS unread_count
FROM conversation_participants cp
JOIN conversations c ON c.id = cp.conversation_id
LEFT JOIN LATERAL (
  SELECT content, sender_id, created_at, status
  FROM messages
  WHERE conversation_id = c.id
  ORDER BY created_at DESC
  LIMIT 1
) m ON TRUE;
