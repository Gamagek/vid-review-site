PRAGMA foreign_keys = ON;

-- Private installation-level values that must persist across Worker deploys.
-- This table is never exposed through a public or administrator API.
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
