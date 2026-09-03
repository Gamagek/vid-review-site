PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits (window_started_at);

CREATE TABLE IF NOT EXISTS discovery_request_visitors (
  discovery_request_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (discovery_request_id, fingerprint),
  FOREIGN KEY (discovery_request_id) REFERENCES discovery_requests(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO discovery_request_visitors (discovery_request_id, fingerprint)
SELECT id, fingerprint FROM discovery_requests WHERE fingerprint <> '';
