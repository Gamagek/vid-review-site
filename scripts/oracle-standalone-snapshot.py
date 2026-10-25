#!/usr/bin/env python3
"""Isolated, fail-closed public Vid.Best SQLite snapshot to an existing Portainer volume.

Never touches video-site / comparison-api2 / old containers, D1 records, or Cloudflare configuration.
The snapshot is PUBLIC-ONLY; it is not a full D1 backup and does not activate website failover.
"""
import argparse
import hashlib
import io
import json
import os
import pathlib
import sqlite3
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://portainer.megasale.win"
SOURCE = "https://vid.best"
CONTAINER = "vidbest-d1-backup-helper"
VOLUME = "vidbest-d1-fallback-data"
MOUNT = "/backup"
EXPECTED_IMAGE = "alpine:3.21"
FIELDS = (
    "id", "slug", "title", "description", "review_text", "seo_title",
    "seo_description", "seo_tags", "thumbnail_url", "source_url",
    "source_page_url", "embed_url", "media_type", "r2_key",
    "primary_category", "subcategory", "created_at", "updated_at",
    "featured", "trending", "views", "provider", "review_artwork_url",
    "review_preview_url", "preview_poster_url", "published",
)
PAGE_SIZE = 48
MAX_VIDEOS = 5000
# A fixed 48-slot ring limits disk use without deleting other Oracle files.
MAX_PAYLOAD = 20 * 1024 * 1024


def required(key):
    value = os.environ.get(key, "").strip()
    if not value:
        raise RuntimeError("Missing required GitHub environment setting: " + key)
    return value


def request(url, *, method="GET", headers=None, data=None, timeout=30):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    # urllib verifies TLS by default. No redirects for authenticated management calls.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return 404, b""
        raise RuntimeError("HTTP " + str(exc.code) + " for " + method + " " +
                           urllib.parse.urlsplit(url).path) from None


def management(path, *, method="GET", data=None, content_type="application/json"):
    base = required("PORTAINER_URL").rstrip("/")
    if base != BASE:
        raise RuntimeError("Unexpected Portainer origin: refused")
    endpoint = required("PORTAINER_ENDPOINT_ID")
    if endpoint != "3":
        raise RuntimeError("Portainer endpoint mismatch: refused")
    if not path.startswith("/api/endpoints/3/docker/"):
        raise RuntimeError("Request outside isolated Docker endpoint refused")
    headers = {
        "X-API-Key": required("PORTAINER_API_KEY"),
        "CF-Access-Client-Id": required("CF_ACCESS_CLIENT_ID"),
        "CF-Access-Client-Secret": required("CF_ACCESS_CLIENT_SECRET"),
        "Accept": "application/json",
    }
    if data is not None:
        headers["Content-Type"] = content_type
    return request(base + path, method=method, headers=headers, data=data, timeout=35)


def json_get(path):
    status, body = management(path)
    if status == 404:
        raise RuntimeError("Required Portainer resource missing: " + path.split("?")[0])
    if status != 200:
        raise RuntimeError("Unexpected Docker GET status: " + str(status))
    return json.loads(body)


def inspect():
    vol = json_get("/api/endpoints/3/docker/volumes/" + VOLUME)
    if vol.get("Name") != VOLUME or vol.get("Driver") != "local":
        raise RuntimeError("Unexpected named volume: refused")
    obj = json_get("/api/endpoints/3/docker/containers/" + CONTAINER + "/json")
    if obj.get("Name") != "/" + CONTAINER:
        raise RuntimeError("Wrong container identity: refused")
    cfg = obj.get("Config") or {}
    if cfg.get("Image") != EXPECTED_IMAGE or cfg.get("Cmd") != ["sleep", "2147483647"]:
        raise RuntimeError("Unexpected helper image or command: refused")
    mounts = obj.get("Mounts") or []
    if not any(m.get("Type") == "volume" and m.get("Name") == VOLUME and
               m.get("Destination") == MOUNT and m.get("RW") is True for m in mounts):
        raise RuntimeError("Expected writable persistent volume not mounted: refused")
    if (obj.get("HostConfig") or {}).get("Privileged"):
        raise RuntimeError("Privileged container refused")
    state = (obj.get("State") or {}).get("Status", "unknown")
    if state not in ("created", "running"):
        raise RuntimeError("Helper state " + state + " requires human diagnosis, no restarts")
    return state


def preflight():
    state = inspect()
    print("READ-ONLY PREFLIGHT OK: helper=" + CONTAINER + ", state=" + state +
          ", volume=" + VOLUME + "; no other containers modified.")
    return state


def ensure():
    state = preflight()
    if state == "running":
        print("Existing helper already running; no action.")
        return
    if os.environ.get("ALLOW_HELPER_START") != "true":
        raise RuntimeError("Start disabled; require explicit ALLOW_HELPER_START=true")
    path = "/api/endpoints/3/docker/containers/" + CONTAINER + "/start"
    status, _ = management(path, method="POST", data=b"{}")
    if status not in (200, 204):
        raise RuntimeError("Unexpected Docker start status: " + str(status))
    if inspect() != "running":
        raise RuntimeError("Start returned but helper not verified running")
    print("Started only the isolated backup helper; no replacement or stack update.")


# Direct read-only D1 queries avoid returning a stale R2/edge-cache public listing.
# This reuses the existing GitHub deployment Cloudflare token; it is never sent
# to Portainer or written to disk. Stop on exhausted D1 quota.
D1_ID = "d1a91eb2-1c41-44b8-aff1-24166f2c91f4"
D1_COLUMNS = (
    "id,slug,title,description,review_text,seo_title,seo_description,seo_tags,"
    "thumbnail_url,source_url,source_page_url,embed_url,media_type,r2_key,"
    "primary_category,subcategory,created_at,updated_at,featured,trending,views,published"
)


def d1_query(sql, params=()):
    account = required("CLOUDFLARE_ACCOUNT_ID")
    if not account.isalnum() or len(account) != 32:
        raise RuntimeError("Cloudflare account ID invalid")
    url = ("https://api.cloudflare.com/client/v4/accounts/" + account +
           "/d1/database/" + D1_ID + "/query")
    token = required("CLOUDFLARE_API_TOKEN")
    payload = json.dumps({"sql": sql, "params": list(params)}).encode()
    status, body = request(url, method="POST", data=payload, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json",
        "Accept": "application/json",
    }, timeout=35)
    if status != 200 or len(body) > 15 * 1024 * 1024:
        raise RuntimeError("D1 read quota or Cloudflare query failed; last Oracle snapshot preserved")
    data = json.loads(body)
    results = data.get("result")
    if not data.get("success") or not isinstance(results, list) or len(results) != 1 or (
        results[0].get("success") is False
    ) or not isinstance(results[0].get("results"), list):
        raise RuntimeError("D1 query rejected; last Oracle snapshot preserved")
    return results[0]["results"]


def d1_public_page(offset):
    total_rows = d1_query("SELECT COUNT(*) AS total FROM videos WHERE published=1")
    if len(total_rows) != 1:
        raise RuntimeError("D1 count unavailable")
    total = int(total_rows[0]["total"])
    rows = d1_query(
        "SELECT " + D1_COLUMNS +
        " FROM videos WHERE published=1 ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
        [PAGE_SIZE, offset],
    )
    for row in rows:
        if row.get("published") != 1:
            raise RuntimeError("Unexpected nonpublic D1 record")
        row["published"] = True
    return total, rows


def read_public_page(offset):
    query = urllib.parse.urlencode({"sort": "newest", "limit": PAGE_SIZE, "offset": offset})
    status, body = request(SOURCE + "/api/videos?" + query, headers={
        "Accept": "application/json", "User-Agent": "VidBestPublicBackup/1.0",
    }, timeout=25)
    if status != 200 or len(body) > 12 * 1024 * 1024:
        raise RuntimeError("Public video API unavailable or oversized; preserving prior backup")
    payload = json.loads(body)
    if not isinstance(payload, dict) or not isinstance(payload.get("videos"), list):
        raise RuntimeError("Unexpected public API shape; preserving prior backup")
    total = (payload.get("pagination") or {}).get("total")
    if type(total) is not int or not 1 <= total <= MAX_VIDEOS:
        raise RuntimeError("Invalid public total; preserving prior backup")
    return total, payload["videos"]


def snapshot_records(page_fetcher=read_public_page):
    total, first = page_fetcher(0)
    pages = [first]
    for offset in range(PAGE_SIZE, total, PAGE_SIZE):
        next_total, videos = page_fetcher(offset)
        if next_total != total:
            raise RuntimeError("Public video count changed during pagination; abort")
        pages.append(videos)
    records, seen = [], set()
    for row in (v for page in pages for v in page):
        if not isinstance(row, dict) or row.get("published") is not True:
            raise RuntimeError("Draft/private or malformed record; refuse snapshot")
        vid, slug = row.get("id"), row.get("slug")
        if type(vid) is not int or vid < 1 or not isinstance(slug, str) or not 1 <= len(slug) <= 255:
            raise RuntimeError("Invalid video identity; refuse snapshot")
        if vid in seen:
            raise RuntimeError("Duplicate video ID across pages; refuse snapshot")
        seen.add(vid)
        records.append({name: row.get(name) for name in FIELDS if name in row})
    if len(records) != total:
        raise RuntimeError("Incomplete public pagination: " + str(len(records)) + "/" + str(total))
    next_total, current_first = page_fetcher(0)
    if next_total != total or [r.get("id") for r in current_first] != [r.get("id") for r in first]:
        raise RuntimeError("Feed changed while syncing; retry next scheduled run")
    return records


def make_sqlite(records, destination, created_at):
    db = sqlite3.connect(destination)
    try:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("""CREATE TABLE public_videos (
            id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
            updated_at TEXT, json_payload TEXT NOT NULL)""")
        db.execute("CREATE INDEX idx_public_videos_updated ON public_videos(updated_at)")
        db.executemany("INSERT INTO public_videos VALUES (?, ?, ?, ?)", [
            (r["id"], r["slug"], str(r.get("updated_at") or ""),
             json.dumps(r, ensure_ascii=False, separators=(",", ":"))) for r in records
        ])
        db.executemany("INSERT INTO meta VALUES (?, ?)", [
            ("captured_at", created_at), ("record_count", str(len(records))),
            ("source", "Cloudflare D1 direct, published-only"), ("scope", "public-published-only"),
        ])
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        if db.execute("SELECT COUNT(*) FROM public_videos").fetchone()[0] != len(records):
            raise RuntimeError("SQLite record count mismatch")
    finally:
        db.close()


def archive(files):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w") as tar:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o600
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(content))
    return out.getvalue()


def sync():
    if preflight() != "running":
        raise RuntimeError("Helper must be Running; no implicit start or recreation during sync")
    records = snapshot_records(d1_public_page)
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with tempfile.TemporaryDirectory() as folder:
        path = pathlib.Path(folder) / "snapshot.sqlite"
        make_sqlite(records, path, created)
        binary = path.read_bytes()
    if len(binary) > MAX_PAYLOAD:
        raise RuntimeError("SQLite snapshot too large; old snapshots preserved")
    digest = hashlib.sha256(binary).hexdigest()
    # Fixed rolling slots (4h x 48 = 8 days). Other files/volumes are never pruned.
    slot = int(time.time() // (4 * 60 * 60)) % 48
    name = "vidbest-public-slot-" + str(slot).zfill(2) + ".sqlite"
    manifest_name = name + ".json"
    manifest = {
        "format": "vidbest-public-sqlite-v1", "filename": name,
        "sha256": digest, "size": len(binary), "record_count": len(records),
        "captured_at": created, "scope": "published-public-only",
        "read_only": True, "full_d1_backup": False, "website_failover_active": False,
    }
    packed = archive({name: binary, manifest_name: json.dumps(manifest, sort_keys=True).encode()})
    if len(packed) > MAX_PAYLOAD + 20480:
        raise RuntimeError("Archive unexpectedly large")
    target = urllib.parse.quote(MOUNT, safe="/")
    status, _ = management("/api/endpoints/3/docker/containers/" + CONTAINER +
                           "/archive?path=" + target, method="PUT", data=packed,
                           content_type="application/x-tar")
    if status not in (200, 201, 204):
        raise RuntimeError("Docker archive upload returned " + str(status))
    # Strong readback is required; an API write acknowledgment is insufficient.
    quoted = urllib.parse.quote(MOUNT + "/" + name, safe="/")
    status, response = management("/api/endpoints/3/docker/containers/" + CONTAINER +
                                  "/archive?path=" + quoted)
    if status != 200:
        raise RuntimeError("Oracle upload unverified; preserve previous snapshots")
    with tarfile.open(fileobj=io.BytesIO(response), mode="r:*") as tar:
        matching = [m for m in tar.getmembers() if pathlib.PurePosixPath(m.name).name == name and m.isfile()]
        if len(matching) != 1:
            raise RuntimeError("Oracle readback missing expected SQLite file")
        actual = hashlib.sha256(tar.extractfile(matching[0]).read()).hexdigest()
    if actual != digest:
        raise RuntimeError("Oracle readback checksum mismatch")
    print("VERIFIED ORACLE PUBLIC SNAPSHOT: records=" + str(len(records)) +
          ", size=" + str(len(binary)) + ", sha256=" + digest +
          ", filename=" + name + ". No D1 writes; no production failover changes.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("preflight", "ensure", "sync"), default="preflight")
    mode = parser.parse_args().mode
    if mode == "preflight":
        preflight()
    elif mode == "ensure":
        ensure()
    else:
        sync()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never print secrets, response bodies, request query strings or credentials.
        print("SAFE FAIL: " + str(exc), file=sys.stderr)
        sys.exit(1)
