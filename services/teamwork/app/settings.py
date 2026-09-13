from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _hosts(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(
        item.strip().lower().lstrip(".")
        for item in os.getenv(name, default).split(",")
        if item.strip()
    )


@dataclass(frozen=True)
class Settings:
    api_key: str = os.getenv("TEAMWORK_API_KEY", "")
    data_dir: Path = Path(os.getenv("TEAMWORK_DATA_DIR", "/data"))
    media_hosts: tuple[str, ...] = _hosts("TEAMWORK_MEDIA_HOSTS", "home.vid.best")
    max_media_bytes: int = _integer("TEAMWORK_MAX_MEDIA_BYTES", 262_144_000, 1_048_576, 1_073_741_824)
    max_media_seconds: int = _integer("TEAMWORK_MAX_MEDIA_SECONDS", 1800, 10, 14_400)
    frame_interval_seconds: int = _integer("TEAMWORK_FRAME_INTERVAL_SECONDS", 8, 2, 120)
    max_frames: int = _integer("TEAMWORK_MAX_FRAMES", 120, 1, 500)
    task_timeout_seconds: int = _integer("TEAMWORK_TASK_TIMEOUT_SECONDS", 1800, 30, 7200)
    whisper_bin: str = os.getenv("WHISPER_CPP_BIN", "/opt/whisper.cpp/build/bin/whisper-cli")
    whisper_model: str = os.getenv("WHISPER_MODEL_PATH", "")
    whisper_threads: int = _integer("WHISPER_THREADS", 2, 1, 8)
    tesseract_languages: str = os.getenv("TESSERACT_LANGUAGES", "eng")
    fourget_search_url: str = os.getenv("FOURGET_SEARCH_URL_TEMPLATE", "")
    ollama_url: str = os.getenv("OLLAMA_URL", "")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "")


settings = Settings()
