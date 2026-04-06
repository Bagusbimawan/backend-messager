CREATE TABLE blocked_users (
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocked_users(blocker_id);
CREATE INDEX idx_blocks_blocked ON blocked_users(blocked_id);
