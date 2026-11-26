#!/usr/bin/env python3
"""Generate deduplicated Google Cloud TTS audio tasks and upload them to Cloudflare R2."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ENGINE_VERSION = "google-cloud-tts-v1"
AUDIO_ENCODING = "MP3"
MAX_TEXT_BYTES = 4500
MAX_SENTENCE_CHARS = 80
MANIFEST_OBJECT_KEY = "manifest.json"


class TtsError(RuntimeError):
    """Raised when an input, quota, Google API, or R2 operation fails."""


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(" ".join(line.split()) for line in normalized.split("\n")).strip()


def js_number(value: Any) -> int | float:
    number = float(value)
    if not number == number or number in (float("inf"), float("-inf")):
        raise TtsError("语音参数必须是有效数字。")
    return int(number) if number.is_integer() else number


def normalize_voice(voice: dict[str, Any]) -> dict[str, Any]:
    try:
        normalized = {
            "voiceName": str(voice["voiceName"]),
            "languageCode": str(voice["languageCode"]),
            "speakingRate": js_number(voice["speakingRate"]),
            "pitch": js_number(voice["pitch"]),
            "volumeGainDb": js_number(voice["volumeGainDb"]),
            "pitchSupported": voice.get("pitchSupported") is not False,
        }
    except (KeyError, TypeError, ValueError) as error:
        raise TtsError(f"任务缺少有效的语音配置：{error}") from None
    if not normalized["voiceName"] or not normalized["languageCode"]:
        raise TtsError("任务必须指定音色和语言代码。")
    return normalized


def content_hash(text: str, voice: dict[str, Any]) -> str:
    voice = normalize_voice(voice)
    payload = {
        "text": normalize_text(text),
        "voiceName": voice["voiceName"],
        "languageCode": voice["languageCode"],
        "speakingRate": voice["speakingRate"],
    }
    if voice["pitchSupported"]:
        payload["pitch"] = voice["pitch"]
    else:
        payload["pitchSupported"] = False
    payload["volumeGainDb"] = voice["volumeGainDb"]
    payload["audioEncoding"] = AUDIO_ENCODING
    payload["engineVersion"] = ENGINE_VERSION
    canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def deduplicate_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for task in tasks:
        if not isinstance(task, dict):
            raise TtsError("生成任务格式无效。")
        text = task.get("text")
        if not isinstance(text, str) or not normalize_text(text):
            raise TtsError("生成任务的 text 不能为空。")
        voice = normalize_voice(task.get("voice") or {})
        expected_hash = content_hash(text, voice)
        if task.get("hash") != expected_hash:
            raise TtsError(f"任务哈希校验失败：{task.get('hash', '(缺失)')}")

        normalized = dict(task)
        normalized["text"] = normalize_text(text)
        normalized["voice"] = voice
        normalized["characterCount"] = len(normalized["text"])
        prior = unique.get(expected_hash)
        if prior:
            if prior["text"] != normalized["text"] or prior["voice"] != voice:
                raise TtsError(f"发现哈希冲突：{expected_hash}")
            prior["messageCount"] = int(prior.get("messageCount", 1)) + int(task.get("messageCount", 1))
            prior["roles"] = sorted(set(prior.get("roles", [])) | set(task.get("roles", [])))
            prior["channels"] = sorted(set(prior.get("channels", [])) | set(task.get("channels", [])))
        else:
            unique[expected_hash] = normalized
    return list(unique.values())


def ensure_within_budget(
    generated_characters: int,
    preview_characters: int,
    pending_characters: int,
    monthly_budget: int,
) -> None:
    projected = generated_characters + preview_characters + pending_characters
    if monthly_budget <= 0 or projected > monthly_budget:
        raise TtsError(
            "月度字符预算不足：已用 "
            f"{generated_characters + preview_characters:,}，待生成 {pending_characters:,}，"
            f"预算 {monthly_budget:,}。未调用 Google API。"
        )


def _split_oversized_piece(
    text: str,
    max_bytes: int,
    max_chars: int = MAX_SENTENCE_CHARS,
) -> list[str]:
    pieces: list[str] = []
    current: list[str] = []
    current_bytes = 0
    for character in text:
        char_bytes = len(character.encode("utf-8"))
        if current and (current_bytes + char_bytes > max_bytes or len(current) >= max_chars):
            pieces.append("".join(current))
            current = []
            current_bytes = 0
        if char_bytes > max_bytes:
            raise TtsError("单个 Unicode 字符超过 Google TTS 单次请求字节上限。")
        current.append(character)
        current_bytes += char_bytes
    if current:
        pieces.append("".join(current))
    return pieces


def split_text(text: str, max_bytes: int = MAX_TEXT_BYTES) -> list[str]:
    """Split at sentence boundaries, then clause boundaries for long sentences."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    if (len(normalized.encode("utf-8")) <= max_bytes
            and len(normalized) <= MAX_SENTENCE_CHARS):
        return [normalized]

    sentences = re.split(r"(?<=[。！？!?；;])|(?<=\n)", normalized)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        candidate = current + sentence
        if (len(sentence) <= MAX_SENTENCE_CHARS
                and len(sentence.encode("utf-8")) <= max_bytes
                and len(candidate.encode("utf-8")) <= max_bytes):
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        clauses = re.split(r"(?<=[，,、：:])", sentence)
        clause_chunk = ""
        for clause in clauses:
            if not clause:
                continue
            combined = clause_chunk + clause
            if (len(combined) <= MAX_SENTENCE_CHARS
                    and len(combined.encode("utf-8")) <= max_bytes):
                clause_chunk = combined
                continue
            if clause_chunk:
                chunks.append(clause_chunk)
                clause_chunk = ""
            if (len(clause) <= MAX_SENTENCE_CHARS
                    and len(clause.encode("utf-8")) <= max_bytes):
                clause_chunk = clause
            else:
                chunks.extend(_split_oversized_piece(clause, max_bytes))
        if clause_chunk:
            chunks.append(clause_chunk)
    if current:
        chunks.append(current)

    if any(
        len(chunk.encode("utf-8")) > max_bytes
        or any(
            len(sentence) > MAX_SENTENCE_CHARS
            for sentence in re.split(r"(?<=[。！？!?；;])|(?<=\n)", chunk)
        )
        for chunk in chunks
    ):
        raise TtsError("长文本切分失败，仍有句子超过单次请求上限。")
    return chunks


def _google_request(api_key: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    endpoint = "https://texttospeech.googleapis.com/v1/text:synthesize"
    url = f"{endpoint}?key={urllib.parse.quote(api_key, safe='')}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body).get("error", {}).get("message", "Google API 请求失败")
        except json.JSONDecodeError:
            detail = "Google API 请求失败"
        detail = str(detail).replace(api_key, "[已隐藏]")
        raise TtsError(f"Google TTS 返回 HTTP {error.code}：{detail}") from None
    except urllib.error.URLError as error:
        raise TtsError(f"无法连接 Google TTS：{error.reason}") from None


def synthesize_piece(text: str, voice: dict[str, Any], api_key: str) -> bytes:
    audio_config = {
        "audioEncoding": AUDIO_ENCODING,
        "speakingRate": voice["speakingRate"],
        "volumeGainDb": voice["volumeGainDb"],
    }
    if voice["pitchSupported"]:
        audio_config["pitch"] = voice["pitch"]

    try:
        result = _google_request(api_key, {
            "input": {"text": text},
            "voice": {
                "name": voice["voiceName"],
                "languageCode": voice["languageCode"],
            },
            "audioConfig": audio_config,
        })
    except TtsError as error:
        if voice["pitchSupported"] and "does not support pitch parameters" in str(error).lower():
            raise TtsError(
                f"{error} 请先在日志编辑器中试听该音色，让编辑器识别不支持音调，"
                "再重新扫描并导出任务。"
            ) from None
        raise
    try:
        audio = base64.b64decode(result["audioContent"], validate=True)
    except (KeyError, ValueError) as error:
        raise TtsError(f"Google TTS 响应中没有有效音频：{error}") from None
    if not audio:
        raise TtsError("Google TTS 返回了空音频。")
    return audio


def _split_sentence_too_long(text: str) -> tuple[str, str]:
    midpoint = len(text) // 2
    boundary_positions = [
        index + 1
        for index, character in enumerate(text[:-1])
        if character in "，,、：:；;。！？!?\n"
    ]
    if boundary_positions:
        split_at = min(boundary_positions, key=lambda position: abs(position - midpoint))
    else:
        split_at = midpoint
    return text[:split_at], text[split_at:]


def synthesize_piece_with_fallback(
    text: str,
    voice: dict[str, Any],
    api_key: str,
) -> list[bytes]:
    try:
        return [synthesize_piece(text, voice, api_key)]
    except TtsError as error:
        if "sentences that are too long" not in str(error).lower() or len(text) < 2:
            raise

    left, right = _split_sentence_too_long(text)
    if not left or not right:
        raise TtsError("无法进一步拆分 Google TTS 拒绝的长句。") from None
    return (
        synthesize_piece_with_fallback(left, voice, api_key)
        + synthesize_piece_with_fallback(right, voice, api_key)
    )


def _ffmpeg_quote(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", r"'\''")


def merge_mp3_segments(segments: list[Path], output_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise TtsError("长文本需要合并音频，但没有找到 ffmpeg；请安装 ffmpeg 并加入 PATH。")

    list_path = output_path.with_suffix(".concat.txt")
    list_path.write_text(
        "".join(f"file '{_ffmpeg_quote(segment)}'\n" for segment in segments),
        encoding="utf-8",
    )
    try:
        result = subprocess.run(
            [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(list_path),
                "-c", "copy", str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        if result.returncode != 0:
            raise TtsError(f"ffmpeg 合并音频失败：{result.stderr.strip() or '未知错误'}")
    finally:
        list_path.unlink(missing_ok=True)


def synthesize_task(task: dict[str, Any], api_key: str, output_path: Path) -> None:
    chunks = split_text(task["text"])
    if not chunks:
        raise TtsError("任务文本为空，无法生成音频。")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="trpg-tts-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        segment_paths: list[Path] = []
        for chunk in chunks:
            audio_pieces = synthesize_piece_with_fallback(chunk, task["voice"], api_key)
            for audio in audio_pieces:
                segment_path = temporary_path / f"part-{len(segment_paths):04d}.mp3"
                segment_path.write_bytes(audio)
                segment_paths.append(segment_path)

        if len(segment_paths) == 1:
            temporary_output = temporary_path / "complete.mp3"
            shutil.copyfile(segment_paths[0], temporary_output)
        else:
            temporary_output = temporary_path / "complete.mp3"
            merge_mp3_segments(segment_paths, temporary_output)

        output_path.with_suffix(".mp3.tmp").write_bytes(temporary_output.read_bytes())
        output_path.with_suffix(".mp3.tmp").replace(output_path)


def new_manifest() -> dict[str, Any]:
    return {"schemaVersion": 1, "entries": {}, "usage": {}}


def read_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return new_manifest()
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TtsError(f"无法读取本地语音清单 {path}：{error}") from None
    if not isinstance(manifest, dict) or not isinstance(manifest.get("entries", {}), dict):
        raise TtsError(f"本地语音清单格式无效：{path}")
    manifest.setdefault("schemaVersion", 1)
    manifest.setdefault("entries", {})
    manifest.setdefault("usage", {})
    return manifest


def merge_manifests(local: dict[str, Any], remote: dict[str, Any]) -> dict[str, Any]:
    merged = new_manifest()
    merged["entries"] = {**remote.get("entries", {}), **local.get("entries", {})}
    months = set(remote.get("usage", {})) | set(local.get("usage", {}))
    for month in months:
        left = local.get("usage", {}).get(month, {})
        right = remote.get("usage", {}).get(month, {})
        left = left if isinstance(left, dict) else {}
        right = right if isinstance(right, dict) else {}
        generated = max(
            int(left.get("generatedCharacters", 0) or 0),
            int(right.get("generatedCharacters", 0) or 0),
        )
        preview = max(
            int(left.get("previewCharacters", 0) or 0),
            int(right.get("previewCharacters", 0) or 0),
        )
        merged["usage"][month] = {
            "generatedCharacters": generated,
            "previewCharacters": preview,
            "totalCharacters": generated + preview,
            "generationCount": max(
                int(left.get("generationCount", 0) or 0),
                int(right.get("generationCount", 0) or 0),
            ),
        }
    for month, usage in merged["usage"].items():
        generated_from_entries = sum(
            int(entry.get("characterCount", 0) or 0)
            for entry in merged["entries"].values()
            if isinstance(entry, dict)
            and str(entry.get("generatedAt", "")).startswith(month)
        )
        usage["generatedCharacters"] = max(
            usage["generatedCharacters"],
            generated_from_entries,
        )
        usage["totalCharacters"] = (
            usage["generatedCharacters"] + usage["previewCharacters"]
        )
    return merged


def month_usage(manifest: dict[str, Any], month: str, task_preview_chars: int) -> dict[str, int]:
    usage = manifest.get("usage", {}).get(month, {})
    if isinstance(usage, (int, float)):
        return {
            "generatedCharacters": int(usage),
            "previewCharacters": max(0, int(task_preview_chars)),
        }
    usage = usage if isinstance(usage, dict) else {}
    generated = max(0, int(usage.get("generatedCharacters", 0) or 0))
    preview = max(0, int(usage.get("previewCharacters", 0) or 0), int(task_preview_chars))
    return {
        "generatedCharacters": generated,
        "previewCharacters": preview,
        "totalCharacters": generated + preview,
        "generationCount": max(0, int(usage.get("generationCount", 0) or 0)),
    }


def save_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def create_s3_client() -> tuple[Any, str, str]:
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    bucket = os.environ.get("R2_BUCKET_NAME", "").strip()
    endpoint = os.environ.get("R2_ENDPOINT_URL", "").strip()
    if not all((account_id, access_key, secret_key, bucket)):
        raise TtsError(
            "R2 配置不完整；需要 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、"
            "R2_SECRET_ACCESS_KEY、R2_BUCKET_NAME。"
        )
    if not endpoint:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    try:
        import boto3
    except ImportError:
        raise TtsError("缺少 boto3，请运行：python -m pip install -r tools/tts/requirements.txt") from None
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )
    return client, bucket, os.environ.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")


def read_remote_manifest(client: Any, bucket: str) -> dict[str, Any]:
    from botocore.exceptions import ClientError

    try:
        response = client.get_object(Bucket=bucket, Key=MANIFEST_OBJECT_KEY)
    except ClientError as error:
        code = str(error.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return new_manifest()
        raise TtsError(f"无法从 R2 读取语音清单：{code or type(error).__name__}") from None
    try:
        manifest = json.loads(response["Body"].read().decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TtsError(f"R2 中的语音清单格式无效：{error}") from None
    if not isinstance(manifest, dict) or not isinstance(manifest.get("entries", {}), dict):
        raise TtsError("R2 中的语音清单格式无效：entries 必须是哈希映射。")
    manifest.setdefault("entries", {})
    manifest.setdefault("usage", {})
    return manifest


def upload_manifest(client: Any, bucket: str, manifest: dict[str, Any]) -> None:
    body = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    client.put_object(
        Bucket=bucket,
        Key=MANIFEST_OBJECT_KEY,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl="no-cache",
    )


def upload_audio(client: Any, bucket: str, object_key: str, path: Path) -> None:
    client.upload_file(
        str(path),
        bucket,
        object_key,
        ExtraArgs={
            "ContentType": "audio/mpeg",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )


def read_tasks(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TtsError(f"无法读取任务文件 {path}：{error}") from None
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise TtsError("不支持的生成任务格式；请从日志编辑器重新导出。")
    if payload.get("engineVersion") != ENGINE_VERSION or payload.get("audioEncoding") != AUDIO_ENCODING:
        raise TtsError("任务中的 TTS 引擎或音频格式与当前生成脚本不一致。")
    tasks = payload.get("tasks")
    if not isinstance(tasks, list):
        raise TtsError("任务文件中缺少 tasks 列表。")
    return payload, deduplicate_tasks(tasks)


def run(args: argparse.Namespace) -> int:
    task_path = Path(args.task_file)
    output_directory = Path(args.output_dir)
    manifest_path = Path(args.manifest) if args.manifest else output_directory / "manifest.json"
    payload, tasks = read_tasks(task_path)
    if not tasks:
        print("没有待生成任务。")
        return 0

    upload_enabled = not args.no_upload and not args.dry_run
    s3_client = None
    bucket = ""
    public_base_url = ""
    if upload_enabled:
        s3_client, bucket, public_base_url = create_s3_client()
        if not public_base_url:
            raise TtsError("请设置 R2_PUBLIC_BASE_URL，否则生成的音频没有可回填的公开地址。")

    local_manifest = read_manifest(manifest_path)
    if upload_enabled:
        remote_manifest = read_remote_manifest(s3_client, bucket)
        manifest = merge_manifests(local_manifest, remote_manifest)
    else:
        manifest = local_manifest

    missing = [
        task for task in tasks
        if not (manifest["entries"].get(task["hash"]) or {}).get("url")
    ]
    month = payload.get("month") or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    preview_characters = max(0, int(payload.get("previewCharactersUsed", 0) or 0))
    usage = month_usage(manifest, month, preview_characters)
    monthly_budget = int(payload.get("monthlyBudgetChars", 0) or 0)
    try:
        env_budget = int(os.environ.get("TTS_MONTHLY_CHAR_LIMIT", "0") or 0)
    except ValueError:
        raise TtsError("TTS_MONTHLY_CHAR_LIMIT 必须是整数。") from None
    if env_budget > 0:
        monthly_budget = min(monthly_budget, env_budget) if monthly_budget > 0 else env_budget

    pending_characters = sum(task["characterCount"] for task in missing)
    ensure_within_budget(
        usage["generatedCharacters"],
        usage["previewCharacters"],
        pending_characters,
        monthly_budget,
    )
    if args.dry_run:
        print(
            f"预检通过：{len(missing)} 个任务，{pending_characters:,} 个新字符；"
            f"本月预计使用 {usage['generatedCharacters'] + usage['previewCharacters'] + pending_characters:,}"
            f"/{monthly_budget:,}。未调用 Google API。"
        )
        return 0

    api_key = os.environ.get("GOOGLE_TTS_API_KEY", "").strip()
    if missing and not api_key:
        raise TtsError("请通过环境变量 GOOGLE_TTS_API_KEY 设置 Google TTS API Key。")

    current_usage = month_usage(manifest, month, preview_characters)
    for index, task in enumerate(missing, start=1):
        object_key = f"audio/{task['hash'][:2]}/{task['hash']}.mp3"
        audio_path = output_directory / object_key
        if not audio_path.exists():
            print(f"[{index}/{len(missing)}] 生成 {task['hash'][:12]}…")
            synthesize_task(task, api_key, audio_path)
        else:
            print(f"[{index}/{len(missing)}] 使用本地音频 {task['hash'][:12]}…")

        if upload_enabled:
            upload_audio(s3_client, bucket, object_key, audio_path)
            audio_url = f"{public_base_url}/{object_key}"
        else:
            audio_url = object_key

        generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
        manifest["entries"][task["hash"]] = {
            "hash": task["hash"],
            "url": audio_url,
            "objectKey": object_key,
            "characterCount": task["characterCount"],
            "voiceName": task["voice"]["voiceName"],
            "languageCode": task["voice"]["languageCode"],
            "speakingRate": task["voice"]["speakingRate"],
            "pitch": task["voice"]["pitch"],
            "pitchSupported": task["voice"]["pitchSupported"],
            "volumeGainDb": task["voice"]["volumeGainDb"],
            "audioEncoding": AUDIO_ENCODING,
            "engineVersion": ENGINE_VERSION,
            "generatedAt": generated_at,
            "textSummary": task["text"][:120],
        }
        current_usage["generatedCharacters"] += task["characterCount"]
        current_usage["generationCount"] += 1
        current_usage["previewCharacters"] = max(
            current_usage["previewCharacters"],
            preview_characters,
        )
        current_usage["totalCharacters"] = (
            current_usage["generatedCharacters"] + current_usage["previewCharacters"]
        )
        current_usage["updatedAt"] = generated_at
        manifest["usage"][month] = current_usage
        manifest["updatedAt"] = generated_at
        save_manifest(manifest_path, manifest)

    if month not in manifest["usage"]:
        manifest["usage"][month] = current_usage
    save_manifest(manifest_path, manifest)
    if upload_enabled:
        upload_manifest(s3_client, bucket, manifest)

    print(
        f"完成：新生成 {len(missing)} 个任务，共 {pending_characters:,} 个字符。"
    )
    print(f"语音清单：{manifest_path}")
    print("可将该清单导入日志编辑器以回填消息音频地址。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task_file", help="日志编辑器导出的生成任务 JSON")
    parser.add_argument("--output-dir", default=".tts-output", help="音频和本地清单输出目录")
    parser.add_argument("--manifest", help="本地清单路径，默认位于输出目录")
    parser.add_argument("--no-upload", action="store_true", help="仅写本地音频，不上传 R2")
    parser.add_argument("--dry-run", action="store_true", help="只校验任务和预算，不调用外部 API")
    return parser


def main() -> int:
    try:
        return run(build_parser().parse_args())
    except TtsError as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("已中断；已完成任务保留在本地清单中。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
