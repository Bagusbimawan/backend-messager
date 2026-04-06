CREATE TABLE calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type       VARCHAR(10) NOT NULL CHECK (call_type IN ('voice', 'video')),
  room_type       VARCHAR(10) NOT NULL CHECK (room_type IN ('direct', 'group')),
  initiator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  group_id        UUID REFERENCES groups(id) ON DELETE SET NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'ringing'
                    CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at      TIMESTAMP,
  ended_at        TIMESTAMP,
  duration_secs   INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE call_participants (
  call_id   UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP,
  left_at   TIMESTAMP,
  PRIMARY KEY (call_id, user_id)
);

CREATE INDEX idx_calls_initiator     ON calls(initiator_id, created_at DESC);
CREATE INDEX idx_calls_conversation  ON calls(conversation_id);
