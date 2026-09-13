from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.security import UnsafeUrl, host_matches, validate_public_url
from app.store import JobStore


def test_media_host_allowlist_matches_only_host_or_subdomain() -> None:
    allowed = ("home.vid.best",)
    assert host_matches("home.vid.best", allowed)
    assert host_matches("media.home.vid.best", allowed)
    assert not host_matches("home.vid.best.attacker.example", allowed)


def test_private_network_urls_are_blocked() -> None:
    with pytest.raises(UnsafeUrl, match="blocked"):
        asyncio.run(validate_public_url("http://127.0.0.1/internal"))


def test_public_allowlisted_url_is_accepted() -> None:
    address = [(2, 1, 6, "", ("93.184.216.34", 443))]
    with patch("app.security.socket.getaddrinfo", return_value=address):
        result = asyncio.run(validate_public_url("https://home.vid.best/media/uploads/test.mp4", ("home.vid.best",)))
    assert result.endswith("/media/uploads/test.mp4")


def test_jobs_persist_and_interrupted_work_is_failed(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create({"source_url": "https://example.com/video"})
    store.running(job["id"])
    restarted = JobStore(tmp_path)
    saved = restarted.get(job["id"])
    assert saved is not None
    assert saved["status"] == "failed"
    assert "restarted" in saved["error"]
