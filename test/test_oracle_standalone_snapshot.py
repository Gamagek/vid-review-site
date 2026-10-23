import importlib.util
import io
import json
import pathlib
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch

FILE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "oracle-standalone-snapshot.py"
SPEC = importlib.util.spec_from_file_location("oracle_snapshot", FILE)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


def row(n):
    return {"id": n, "slug": "review-" + str(n), "title": "Title " + str(n),
            "published": True, "review_text": "Real review " + str(n),
            "updated_at": "2026-10-23T00:00:00Z", "untrusted_internal": "omit me"}


class PublicSnapshotTests(unittest.TestCase):
    def test_complete_published_pages_only(self):
        rows = [row(i) for i in range(1, 51)]
        calls = []
        def fetch(offset):
            calls.append(offset)
            return 50, rows[offset:offset+48]
        result = mod.snapshot_records(fetch)
        self.assertEqual(len(result), 50)
        self.assertEqual(calls, [0, 48, 0])
        self.assertNotIn("untrusted_internal", result[0])

    def test_reject_incomplete_page(self):
        with self.assertRaisesRegex(RuntimeError, "Incomplete"):
            mod.snapshot_records(lambda offset: (2, [row(1)]))

    def test_reject_duplicate_ids(self):
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            mod.snapshot_records(lambda offset: (49, [row(1)] * 48 if offset == 0 else [row(1)]))

    def test_reject_drafts(self):
        invalid = row(1)
        invalid["published"] = False
        with self.assertRaisesRegex(RuntimeError, "Draft"):
            mod.snapshot_records(lambda offset: (1, [invalid]))

    def test_refuse_changing_source(self):
        seen = [0]
        def fetch(offset):
            seen[0] += 1
            return (1, [row(1)] if seen[0] == 1 else [row(2)])
        with self.assertRaisesRegex(RuntimeError, "Feed changed"):
            mod.snapshot_records(fetch)

    def test_sqlite_and_tar_integrity(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "test.sqlite"
            mod.make_sqlite([row(1), row(2)], path, "2026-10-23T00:00:00Z")
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM public_videos").fetchone()[0], 2)
                data = json.loads(db.execute("SELECT json_payload FROM public_videos WHERE id=1").fetchone()[0])
                self.assertEqual(data["slug"], "review-1")
            binary = path.read_bytes()
            packed = mod.archive({"safe.sqlite": binary})
            with tarfile.open(fileobj=io.BytesIO(packed)) as tar:
                self.assertEqual(tar.extractfile(tar.getmember("safe.sqlite")).read(), binary)

    def test_url_portainer_scope(self):
        with patch.dict("os.environ", {"PORTAINER_URL": "https://evil.example",
                                      "PORTAINER_ENDPOINT_ID": "3"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "Unexpected Portainer origin"):
                mod.management("/api/endpoints/3/docker/volumes/vidbest-d1-fallback-data")


if __name__ == "__main__":
    unittest.main()
