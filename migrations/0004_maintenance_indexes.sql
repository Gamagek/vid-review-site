PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_discovery_request_visitors_created_at
  ON discovery_request_visitors (created_at);
