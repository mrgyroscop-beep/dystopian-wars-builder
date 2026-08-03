CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('feedback', 'bug', 'idea')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 4000),
  contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) BETWEEN 3 AND 254),
  source TEXT NOT NULL,
  app_version TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'retry', 'acknowledged', 'ignored')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  claim_token_hash TEXT,
  lease_expires_at INTEGER,
  processing_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE INDEX feedback_queue_idx
  ON feedback(state, available_at, created_at);
