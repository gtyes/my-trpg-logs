#!/usr/bin/env python3
"""Serve the editor locally and run the existing TTS generator on request."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import generate


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIRECTORY = REPOSITORY_ROOT / ".tts-output"
TASK_FILE = OUTPUT_DIRECTORY / "tasks.json"
GENERATOR_SCRIPT = Path(__file__).with_name("generate.py")
MAX_REQUEST_BYTES = 64 * 1024
BLOCKED_STATIC_PATHS = {".git", ".tts-output", "tools", ".azure", "node_modules"}


@dataclass
class GenerationJob:
    job_id: str
    status: str = "running"
    output: deque[str] = field(default_factory=lambda: deque(maxlen=300))
    exit_code: int | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


JOBS: dict[str, GenerationJob] = {}
JOBS_LOCK = threading.Lock()
ACTIVE_JOB_ID: str | None = None


def job_to_payload(job: GenerationJob) -> dict[str, Any]:
    return {
        "jobId": job.job_id,
        "status": job.status,
        "exitCode": job.exit_code,
        "createdAt": job.created_at,
        "output": list(job.output),
    }


def monitor_process(job_id: str, process: subprocess.Popen[str]) -> None:
    global ACTIVE_JOB_ID
    if process.stdout is not None:
        for line in process.stdout:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job:
                    job.output.append(line.rstrip())
    exit_code = process.wait()
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.exit_code = exit_code
            job.status = "succeeded" if exit_code == 0 else "failed"
        if ACTIVE_JOB_ID == job_id:
            ACTIVE_JOB_ID = None


class LocalTtsHandler(SimpleHTTPRequestHandler):
    server_version = "TRPGLocalTTS/1"

    @property
    def local_origin(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def is_expected_host(self) -> bool:
        return self.headers.get("Host", "") == f"127.0.0.1:{self.server.server_port}"

    def is_expected_origin(self) -> bool:
        return self.headers.get("Origin", "") == self.local_origin

    def do_GET(self) -> None:
        if not self.is_expected_host():
            self.send_error(403, "Use the local 127.0.0.1 address.")
            return

        path = urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True, "taskFile": ".tts-output/tasks.json"})
            return
        if path.startswith("/api/tts/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self.send_json(404, {"error": "生成任务不存在或状态已过期。"})
                    return
                payload = job_to_payload(job)
            self.send_json(200, payload)
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "未知的本地 API 路径。"})
            return

        decoded_segments = [unquote(segment) for segment in path.split("/")]
        if any(segment in BLOCKED_STATIC_PATHS for segment in decoded_segments):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if not self.is_expected_host() or not self.is_expected_origin():
            self.send_json(403, {"error": "请求必须来自本机日志编辑器页面。"})
            return
        if urlsplit(self.path).path != "/api/tts/generate":
            self.send_json(404, {"error": "未知的本地 API 路径。"})
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(415, {"error": "请求必须使用 application/json。"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "请求长度无效。"})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(413, {"error": "请求内容为空或超出大小限制。"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "请求 JSON 格式无效。"})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "请求内容必须是 JSON 对象。"})
            return

        credentials = {
            "GOOGLE_TTS_API_KEY": payload.get("googleTtsApiKey"),
            "R2_ACCOUNT_ID": payload.get("r2AccountId"),
            "R2_ACCESS_KEY_ID": payload.get("r2AccessKeyId"),
            "R2_SECRET_ACCESS_KEY": payload.get("r2SecretAccessKey"),
            "R2_BUCKET_NAME": payload.get("r2BucketName"),
            "R2_ENDPOINT_URL": payload.get("r2EndpointUrl", ""),
            "R2_PUBLIC_BASE_URL": payload.get("r2PublicBaseUrl"),
        }
        invalid_fields = [
            name for name, value in credentials.items()
            if not isinstance(value, str)
        ]
        if invalid_fields:
            self.send_json(400, {"error": "连接设置格式无效。"})
            return
        credentials = {name: value.strip() for name, value in credentials.items()}
        required_fields = (
            "GOOGLE_TTS_API_KEY",
            "R2_ACCOUNT_ID",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
            "R2_BUCKET_NAME",
            "R2_PUBLIC_BASE_URL",
        )
        missing_fields = [name for name in required_fields if not credentials[name]]
        if missing_fields:
            self.send_json(400, {"error": "请填写 Google TTS 与 R2 所需的连接设置。"})
            return
        if not TASK_FILE.is_file():
            self.send_json(400, {"error": "找不到仓库 .tts-output\\tasks.json，请先更新任务清单。"})
            return
        try:
            _, tasks = generate.read_tasks(TASK_FILE)
        except generate.TtsError as error:
            self.send_json(400, {"error": str(error)})
            return
        if not tasks:
            self.send_json(400, {"error": "tasks.json 中没有待生成任务。"})
            return

        global ACTIVE_JOB_ID
        with JOBS_LOCK:
            if ACTIVE_JOB_ID:
                active_job = JOBS.get(ACTIVE_JOB_ID)
                if active_job and active_job.status == "running":
                    self.send_json(409, {
                        "error": "已有语音生成任务正在运行。",
                        "jobId": active_job.job_id,
                    })
                    return
                ACTIVE_JOB_ID = None

            try:
                environment = os.environ.copy()
                environment.update(credentials)
                process = subprocess.Popen(
                    [
                        sys.executable,
                        str(GENERATOR_SCRIPT),
                        str(TASK_FILE),
                        "--output-dir",
                        str(OUTPUT_DIRECTORY),
                    ],
                    cwd=REPOSITORY_ROOT,
                    env=environment,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
            except OSError as error:
                self.send_json(500, {"error": f"无法启动 TTS 生成脚本：{error}"})
                return

            job = GenerationJob(job_id=uuid.uuid4().hex)
            JOBS[job.job_id] = job
            ACTIVE_JOB_ID = job.job_id
            for old_job_id in list(JOBS):
                if len(JOBS) <= 20:
                    break
                if old_job_id != ACTIVE_JOB_ID and JOBS[old_job_id].status != "running":
                    del JOBS[old_job_id]

        threading.Thread(
            target=monitor_process,
            args=(job.job_id, process),
            daemon=True,
        ).start()
        self.send_json(202, job_to_payload(job))

    def list_directory(self, path: str) -> None:
        self.send_error(404)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765, help="本地服务端口（默认：8765）")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not 1 <= args.port <= 65535:
        print("端口必须在 1 到 65535 之间。", file=sys.stderr)
        return 2
    handler = partial(LocalTtsHandler, directory=str(REPOSITORY_ROOT))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        print(f"无法启动本地 TTS 服务：{error}", file=sys.stderr)
        return 2

    print(f"本地 TTS 服务已启动：{server.server_name}:{server.server_port}")
    print(f"请在浏览器打开：http://127.0.0.1:{server.server_port}/data/日志编辑器.html")
    print("按 Ctrl+C 停止服务；生成中的任务请等待完成后再关闭。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n本地 TTS 服务已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
