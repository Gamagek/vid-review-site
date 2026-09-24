import asyncio
import json
import os
import re
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Vid.Best Authorized Media Transcoder")

RESULT_DIR = Path(os.getenv("RESULT_DIR", "/data/results"))
RESULT_BASE_URL = os.getenv("RESULT_BASE_URL", "").rstrip("/")
SERVICE_SECRET = os.getenv("SERVICE_SECRET", "")
SOURCE_ALLOWLIST = {
    host.strip().lower()
    for host in os.getenv("ALLOWED_SOURCE_HOSTS", "vid.best").split(",")
    if host.strip()
}
RESULT_MAX_BYTES = int(os.getenv("RESULT_MAX_BYTES", str(95 * 1024 * 1024)))

SEMAPHORE = asyncio.Semaphore(1)
JOBS: dict[str, dict] = {}

TIKTOK_HOST_RE = re.compile(r"(?:^|\\.)tiktok\\.com$", re.I)
SOCIAL_HOST_RE = re.compile(r"(?:^|\\.)(?:youtube|instagram|facebook|vimeo|dailymotion|twitch)\\.[a-z.]+$", re.I)


class Job(BaseModel):
    job_id: str = Field(min_length=1, max_length=80)
    source_url: str
    output_key: str
    profile: str = "360p"
    max_width: int = 640
    max_height: int = 640
    video_bitrate: str = "800k"
    audio_bitrate: str = "96k"
    callback_url: str
    callback_secret: str


def auth_ok(header: str | None) -> bool:
    return bool(SERVICE_SECRET) and header == f"Bearer {SERVICE_SECRET}"


def allowed_source(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        host = (parsed.hostname or "").lower()
        if TIKTOK_HOST_RE.search(host) or SOCIAL_HOST_RE.search(host):
            return False
        return any(host == allowed or host.endswith("." + allowed) for allowed in SOURCE_ALLOWLIST)
    except Exception:
        return False


@app.get("/health")
def health():
    return {"ok": True, "service": "vidbest-authorized-media-transcoder", "active": len(JOBS)}


@app.get("/results/{filename}.mp4")
def result_file(filename: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", filename):
        raise HTTPException(status_code=404, detail="Result not found")
    path = RESULT_DIR / (filename + ".mp4")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Result not found")
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "public, max-age=3600"})


@app.post("/v1/jobs", status_code=202)
async def create_job(job: Job, authorization: str | None = Header(default=None)):
    if not auth_ok(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if job.profile != "360p":
        raise HTTPException(status_code=400, detail="Only 360p cache jobs are supported")
    if not allowed_source(job.source_url):
        raise HTTPException(status_code=400, detail="Source host is not on the authorized media allowlist")
    if not RESULT_BASE_URL:
        raise HTTPException(status_code=503, detail="RESULT_BASE_URL is not configured")
    if not job.callback_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Callback URL must use HTTPS")

    existing = JOBS.get(job.job_id)
    if existing and existing.get("status") in {"queued", "processing", "complete"}:
        return {"ok": True, "status": existing["status"], "job_id": job.job_id}

    JOBS[job.job_id] = {"status": "queued", "error": None}
    asyncio.create_task(run_job(job))
    return {"ok": True, "status": "queued", "job_id": job.job_id}


async def run_job(job: Job):
    async with SEMAPHORE:
        JOBS[job.job_id]["status"] = "processing"
        safe_job = re.sub(r"[^A-Za-z0-9_-]", "_", job.job_id)
        output_path = RESULT_DIR / f"{safe_job}.mp4"
        try:
            output_path.unlink(missing_ok=True)

            scale_filter = (
                "scale="
                "w='if(gt(iw,ih),min(iw,640),-2)':"
                "h='if(gt(iw,ih),-2,min(ih,640))'"
            )
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-y",
                "-threads", "1",
                "-i", job.source_url,
                "-vf", scale_filter,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "28",
                "-maxrate", job.video_bitrate,
                "-bufsize", "1600k",
                "-c:a", "aac",
                "-b:a", job.audio_bitrate,
                "-movflags", "+faststart",
                str(output_path),
            ]

            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                message = stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(message[-1200:] or "ffmpeg failed")

            size = output_path.stat().st_size
            if size <= 0:
                raise RuntimeError("ffmpeg produced an empty output")
            if size > RESULT_MAX_BYTES:
                raise RuntimeError(f"output exceeds {RESULT_MAX_BYTES} byte safety limit")

            result_url = f"{RESULT_BASE_URL}/results/{safe_job}.mp4"
            await callback(job, {
                "job_id": job.job_id,
                "status": "complete",
                "result_url": result_url,
            })
            JOBS[job.job_id] = {"status": "complete", "error": None, "size": size}
        except Exception as exc:
            message = str(exc)[:1200]
            JOBS[job.job_id] = {"status": "failed", "error": message}
            try:
                await callback(job, {
                    "job_id": job.job_id,
                    "status": "failed",
                    "error": message,
                })
            except Exception:
                pass


async def callback(job: Job, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        job.callback_url,
        data=data,
        headers={
            "Authorization": f"Bearer {job.callback_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        lambda: urllib.request.urlopen(request, timeout=20).read(),
    )


@app.on_event("startup")
async def startup():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    for path in RESULT_DIR.glob("*.mp4"):
        try:
            if path.stat().st_size > RESULT_MAX_BYTES:
                path.unlink()
        except OSError:
            pass
