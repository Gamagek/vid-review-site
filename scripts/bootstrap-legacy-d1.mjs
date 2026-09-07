import { readFile } from "node:fs/promises";

const token = process.env.CLOUDFLARE_API_TOKEN || "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";

if (!token || !accountId) {
  console.log("Cloudflare credentials are not configured; skipping legacy D1 bootstrap.");
  process.exit(0);
}

const wranglerToml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
const databaseId = wranglerToml.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if (!databaseId) throw new Error("Could not find D1 database_id in wrangler.toml");

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

async function callD1(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  const apiErrors = Array.isArray(payload.errors) ? payload.errors : [];
  const failedResult = Array.isArray(payload.result)
    ? payload.result.find((entry) => entry?.success === false)
    : null;

  if (!response.ok || payload.success === false || apiErrors.length || failedResult) {
    const detail = apiErrors.map((entry) => entry?.message).filter(Boolean).join("; ") ||
      failedResult?.error || `HTTP ${response.status}`;
    throw new Error(`D1 request failed: ${detail}`);
  }

  return Array.isArray(payload.result) ? payload.result : [];
}

async function query(sql, params = []) {
  return callD1({ sql, params });
}

async function rows(sql, params = []) {
  const result = await query(sql, params);
  return Array.isArray(result[0]?.results) ? result[0].results : [];
}

async function tableColumns(tableName) {
  return (await rows(`PRAGMA table_info(${tableName})`)).map((row) => String(row.name));
}

async function tableExists(tableName) {
  const result = await rows("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [tableName]);
  return result.length > 0;
}

async function tableCount(tableName) {
  const result = await rows(`SELECT COUNT(*) AS total FROM ${tableName}`);
  return Number(result[0]?.total || 0);
}

const modernColumns = [
  "id", "slug", "title", "source_url", "media_type", "primary_category",
  "subcategory", "published", "created_at", "updated_at",
];
const legacyColumns = [
  "id", "title", "embed_link", "category", "subcategory", "review_text",
  "seo_tags", "meta_desc", "created_at",
];

const currentColumns = await tableColumns("videos");
if (currentColumns.length === 0) {
  console.log("No existing videos table found; normal migrations will create the current schema.");
  process.exit(0);
}

if (modernColumns.every((column) => currentColumns.includes(column))) {
  console.log("D1 videos table already uses the current schema; no legacy bootstrap needed.");
  process.exit(0);
}

if (!legacyColumns.every((column) => currentColumns.includes(column))) {
  throw new Error(
    `Unrecognized videos schema (${currentColumns.join(", ")}). Refusing automatic database changes.`,
  );
}

if (await tableExists("videos_legacy_backup")) {
  throw new Error("videos_legacy_backup already exists while videos is still legacy; refusing to guess after a partial migration.");
}
if (await tableExists("videos_v2")) {
  throw new Error("videos_v2 already exists; refusing to overwrite a possible partial migration.");
}

const legacyVideoCount = await tableCount("videos");
const hasLegacyReviews = await tableExists("video_reviews");
let legacyReviewCount = 0;
if (hasLegacyReviews) {
  const reviewColumns = await tableColumns("video_reviews");
  if (!["id", "title", "video_url"].every((column) => reviewColumns.includes(column))) {
    throw new Error(`Unrecognized video_reviews schema (${reviewColumns.join(", ")}). Refusing automatic database changes.`);
  }
  legacyReviewCount = await tableCount("video_reviews");
}

console.log(`Legacy D1 detected: ${legacyVideoCount} videos row(s), ${legacyReviewCount} video_reviews row(s).`);
console.log("Preparing a new table without modifying the legacy tables yet...");

const createModernTable = `
CREATE TABLE videos_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  embed_url TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('youtube', 'tiktok', 'facebook', 'raw', 'r2')),
  r2_key TEXT,
  primary_category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  review_text TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  seo_tags TEXT NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  trending INTEGER NOT NULL DEFAULT 0 CHECK (trending IN (0, 1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  views INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

try {
  await query(createModernTable);

  await query(`
    INSERT INTO videos_v2 (
      slug, title, source_url, embed_url, media_type, r2_key,
      primary_category, subcategory, description, review_text,
      seo_title, seo_description, seo_tags, thumbnail_url,
      featured, trending, published, views, reaction_count, comments_count,
      created_at, updated_at
    )
    SELECT
      'legacy-video-' || rowid,
      COALESCE(NULLIF(TRIM(title), ''), 'Untitled video'),
      COALESCE(NULLIF(TRIM(embed_link), ''), 'legacy://video/' || rowid),
      NULLIF(TRIM(embed_link), ''),
      CASE
        WHEN lower(COALESCE(embed_link, '')) LIKE '%youtube.com%' OR lower(COALESCE(embed_link, '')) LIKE '%youtu.be%' THEN 'youtube'
        WHEN lower(COALESCE(embed_link, '')) LIKE '%tiktok.com%' THEN 'tiktok'
        WHEN lower(COALESCE(embed_link, '')) LIKE '%facebook.com%' OR lower(COALESCE(embed_link, '')) LIKE '%fb.watch%' THEN 'facebook'
        ELSE 'raw'
      END,
      NULL,
      COALESCE(NULLIF(TRIM(category), ''), 'Other'),
      COALESCE(NULLIF(TRIM(subcategory), ''), 'General'),
      COALESCE(meta_desc, ''),
      COALESCE(review_text, ''),
      COALESCE(NULLIF(TRIM(title), ''), 'Untitled video'),
      COALESCE(meta_desc, ''),
      CASE WHEN json_valid(COALESCE(seo_tags, '')) THEN seo_tags ELSE '[]' END,
      NULL,
      0, 0, 0, 0, 0, 0,
      COALESCE(CAST(created_at AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      COALESCE(CAST(created_at AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    FROM videos
  `);

  if (hasLegacyReviews) {
    await query(`
      INSERT INTO videos_v2 (
        slug, title, source_url, embed_url, media_type, r2_key,
        primary_category, subcategory, description, review_text,
        seo_title, seo_description, seo_tags, thumbnail_url,
        featured, trending, published, views, reaction_count, comments_count,
        created_at, updated_at
      )
      SELECT
        'legacy-review-' || id,
        COALESCE(NULLIF(TRIM(title), ''), 'Untitled video'),
        COALESCE(NULLIF(TRIM(video_url), ''), 'legacy://review/' || id),
        NULLIF(TRIM(video_url), ''),
        CASE
          WHEN lower(COALESCE(video_url, '')) LIKE '%youtube.com%' OR lower(COALESCE(video_url, '')) LIKE '%youtu.be%' THEN 'youtube'
          WHEN lower(COALESCE(video_url, '')) LIKE '%tiktok.com%' THEN 'tiktok'
          WHEN lower(COALESCE(video_url, '')) LIKE '%facebook.com%' OR lower(COALESCE(video_url, '')) LIKE '%fb.watch%' THEN 'facebook'
          ELSE 'raw'
        END,
        NULL,
        COALESCE(NULLIF(TRIM(primary_category), ''), 'Other'),
        COALESCE(NULLIF(TRIM(subcategory), ''), 'General'),
        COALESCE(description, ''),
        COALESCE(review_text, ''),
        COALESCE(NULLIF(TRIM(title), ''), 'Untitled video'),
        COALESCE(seo_description, description, ''),
        CASE WHEN json_valid(COALESCE(seo_tags, '')) THEN seo_tags ELSE '[]' END,
        NULL,
        0, 0, 0,
        MAX(COALESCE(views, 0), 0),
        MAX(COALESCE(reactions, 0), 0),
        0,
        COALESCE(CAST(created_at AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        COALESCE(CAST(created_at AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      FROM video_reviews
    `);
  }

  const copiedCount = await tableCount("videos_v2");
  const expectedCount = legacyVideoCount + legacyReviewCount;
  if (copiedCount !== expectedCount) {
    throw new Error(`Legacy copy verification failed: expected ${expectedCount} row(s), copied ${copiedCount}.`);
  }

  console.log(`Verified ${copiedCount} migrated draft row(s). Swapping tables atomically...`);
  await callD1({
    batch: [
      { sql: "ALTER TABLE videos RENAME TO videos_legacy_backup", params: [] },
      { sql: "ALTER TABLE videos_v2 RENAME TO videos", params: [] },
    ],
  });

  const finalColumns = await tableColumns("videos");
  if (!modernColumns.every((column) => finalColumns.includes(column))) {
    throw new Error("Post-swap verification failed: the videos table is not using the expected modern schema.");
  }

  console.log("Legacy D1 bootstrap complete. Original videos data remains in videos_legacy_backup; video_reviews is also retained.");
} catch (error) {
  if (await tableExists("videos_v2").catch(() => false)) {
    await query("DROP TABLE videos_v2").catch(() => {});
  }
  throw error;
}
