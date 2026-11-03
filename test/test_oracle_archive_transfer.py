"""Mocked Docker archive integration tests: NEVER connect to production Portainer."""
import importlib.util
import io
import json
import pathlib
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote

MODULE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "oracle-standalone-snapshot.py"
spec = importlib.util.spec_from_file_location("oracle_snapshot_transfer", MODULE)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

ROW = {
    "id": 521, "slug": "simulated-only",
    "title": "Synthetic published review", "published": True,
    "review_text": "A test, never a production record",
    "created_at": "2026-10-23T00:00:00Z",
}


def tar_bytes(name, payload):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo(name)
        info.size = len(payload)
        tf.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


class ArchiveTransport:
    def __init__(self, corrupt=False):
        self.files = {}
        self.calls = []
        self.corrupt = corrupt

    def __call__(self, path, *, method="GET", data=None, **kwargs):
        self.calls.append((method, path))
        if "/archive?" not in path or "vidbest-d1-backup-helper" not in path:
            raise AssertionError("Unexpected Docker request: " + path)
        if method == "PUT":
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tf:
                for item in tf.getmembers():
                    if not item.isfile() or "/" in item.name:
                        raise AssertionError("Tar traversal forbidden")
                    self.files[item.name] = tf.extractfile(item).read()
            return 204, b""
        if method != "GET":
            raise AssertionError("Unexpected Docker method: " + method)
        name = unquote(path.split("path=", 1)[-1]).rsplit("/", 1)[-1]
        payload = self.files[name]
        if self.corrupt:
            payload = payload[:-1] + bytes([payload[-1] ^ 1])
        return 200, tar_bytes("backup/" + name, payload)


class ArchiveTests(unittest.TestCase):
    def test_simulated_oracle_copy_and_readback_checksum(self):
        mock = ArchiveTransport()
        with patch.object(app, "preflight", return_value="running"), \
             patch.object(app, "snapshot_records", return_value=[ROW]), \
             patch.object(app, "management", side_effect=mock), \
             patch.object(app.time, "time", return_value=1792751000):
            app.sync()
        self.assertEqual([method for method, _ in mock.calls], ["PUT", "GET"])
        keys = list(mock.files)
        self.assertEqual(len(keys), 2)
        dbname = next(k for k in keys if k.endswith(".sqlite"))
        manifest = json.loads(mock.files[dbname + ".json"])
        self.assertEqual(manifest["record_count"], 1)
        self.assertFalse(manifest["full_d1_backup"])
        with tempfile.NamedTemporaryFile(suffix=".sqlite") as fh:
            pathlib.Path(fh.name).write_bytes(mock.files[dbname])
            with sqlite3.connect(fh.name) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM public_videos").fetchone()[0], 1)

    def test_readback_corruption_detected_and_not_reported_success(self):
        mock = ArchiveTransport(corrupt=True)
        with patch.object(app, "preflight", return_value="running"), \
             patch.object(app, "snapshot_records", return_value=[ROW]), \
             patch.object(app, "management", side_effect=mock):
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                app.sync()

    def test_stopped_or_created_helper_refused_no_write(self):
        mock = ArchiveTransport()
        with patch.object(app, "preflight", return_value="created"), \
             patch.object(app, "management", side_effect=mock):
            with self.assertRaisesRegex(RuntimeError, "Helper must be Running"):
                app.sync()
        self.assertEqual(mock.calls, [])

    def test_readonly_preflight_and_start_requires_opt_in(self):
        with patch.object(app, "inspect", side_effect=["created","running"]) as inspected, \
             patch.object(app, "management", return_value=(204,b"")) as manager, \
             patch.dict("os.environ", {"ALLOW_HELPER_START":"true"}, clear=True):
            app.ensure()
        self.assertEqual(inspected.call_count, 2)
        self.assertEqual(manager.call_count, 1)
        path = manager.call_args.args[0]
        self.assertTrue(path.endswith("/containers/vidbest-d1-backup-helper/start"))
        self.assertEqual(manager.call_args.kwargs["method"], "POST")


if __name__ == "__main__":
    unittest.main()
