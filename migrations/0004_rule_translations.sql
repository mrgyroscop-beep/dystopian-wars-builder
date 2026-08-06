CREATE TABLE rule_translations (
  rule_id TEXT NOT NULL,
  language TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (rule_id, language),
  CHECK (language IN ('ru'))
);

CREATE INDEX idx_rule_translations_source
  ON rule_translations (language, source_hash);
