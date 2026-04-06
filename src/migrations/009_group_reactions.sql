-- Add reactions to group messages (missing from 004_groups.sql)
CREATE TABLE IF NOT EXISTS group_message_reactions (
  message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_group_msg_reactions_msg ON group_message_reactions(message_id);
