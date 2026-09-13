from __future__ import annotations

import asyncio
import secrets
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl

from .pipeline import analyze
from .settings import settings
from .store import JobStore


store = JobStore(settings.data_dir)
worker_slot = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(
    title="Vid.Best Teamwork API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


class AnalysisRequest(BaseModel):
    source_url: HttpUrl
    title: str = Field(default="", max_length=160)
    media_owned: bool = False
    scan_frames: bool = True
    transcribe: bool = True
    crawl_page: bool = True
    ground_search: bool = False
    search_query: str = Field(default="", max_length=200)


class JobResponse(BaseModel):
    id: str
    status: Literal["queued", "running", "complete", "failed"]
    result: dict | None = None
    error: str | None = None
    created_at: str
    updated_at: str


def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = settings.api_key
    supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
    if len(expected) < 32:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="TEAMWORK_API_KEY is not configured")
    if not secrets.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def process_job(job_id: str) -> None:
    async with worker_slot:
        store.running(job_id)
        try:
            request = store.request(job_id)
            result = await asyncio.wait_for(analyze(request, settings), timeout=settings.task_timeout_seconds)
            store.complete(job_id, result)
        except Exception as error:
            store.fail(job_id, str(error) or error.__class__.__name__)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "vidbest-teamwork",
        "deep_media_hosts": list(settings.media_hosts),
        "transcription_ready": bool(settings.whisper_model),
        "reasoner_ready": bool(settings.ollama_url and settings.ollama_model),
    }


@app.post("/v1/jobs", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(authorize)])
async def create_job(request: AnalysisRequest, background_tasks: BackgroundTasks) -> dict:
    job = store.create(request.model_dump(mode="json"))
    background_tasks.add_task(process_job, job["id"])
    return job


@app.get("/v1/jobs/{job_id}", response_model=JobResponse, dependencies=[Depends(authorize)])
async def get_job(job_id: str) -> dict:
    if len(job_id) != 32 or any(character not in "0123456789abcdef" for character in job_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job
