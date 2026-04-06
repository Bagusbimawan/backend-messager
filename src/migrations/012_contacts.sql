-- Add phone discovery opt-in column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_phone_discovery BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE contacts (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, contact_id)
);

CREATE INDEX idx_contacts_user ON contacts(user_id);
