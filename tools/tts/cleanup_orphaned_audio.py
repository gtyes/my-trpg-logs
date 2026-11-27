#!/usr/bin/env python3
"""Find or delete old R2 audio objects not referenced by any data JSON."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import generate


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPOSITORY_ROOT / "data"
DEFAULT_OUTPUT_DIR = REPOSITORY_ROOT / ".tts-output"
AUDIO_KEY_PATTERN = re.compile(r"^audio/([0-9a-f]{2})/([0-9a-f]{64})\.mp3$", re.IGNORECASE)
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
URL_HASH_PATTERN = re.compile(r"([0-9a-f]{64})\.mp3$", re.IGNORECASE)


@dataclass(frozen=True)
class AudioObject:
    key: str
    content_hash: str
    size: int
    last_modified: dt.datetime


def collect_references(value: Any, references: set[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "ttsHash" and isinstance(item, str) and HASH_PATTERN.fullmatch(item):
                references.add(item.lower())
            elif key == "ttsAudioUrl" and isinstance(item, str):
                match = URL_HASH_PATTERN.search(urlparse(item).path)
                if match:
                    references.add(match.group(1).lower())
            collect_references(item, references)
    elif isinstance(value, list):
        for item in value:
            collect_references(item, references)


def scan_data_jsons(data_dir: Path) -> tuple[set[str], int]:
    if not data_dir.is_dir():
        raise generate.TtsError(f"data 目录不存在：{data_dir}")
    json_files = sorted(data_dir.rglob("*.json"))
    if not json_files:
        raise generate.TtsError(f"{data_dir} 中没有 JSON 文件；为避免误删，已中止。")

    references: set[str] = set()
    errors: list[str] = []
    for path in json_files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            errors.append(f"{path}: {error}")
            continue
        collect_references(payload, references)

    if errors:
        details = "\n".join(f"  - {error}" for error in errors)
        raise generate.TtsError(
            f"有 {len(errors)} 个 JSON 无法完整读取；为避免误删，已中止：\n{details}"
        )
    return references, len(json_files)


def list_audio_objects(client: Any, bucket: str) -> list[AudioObject]:
    from botocore.exceptions import BotoCoreError, ClientError

    objects: list[AudioObject] = []
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix="audio/"):
            for item in page.get("Contents", []):
                key = item.get("Key", "")
                match = AUDIO_KEY_PATTERN.fullmatch(key)
                if not match or match.group(1).lower() != match.group(2).lower()[:2]:
                    continue
                modified = item.get("LastModified")
                if not isinstance(modified, dt.datetime):
                    continue
                if modified.tzinfo is None:
                    modified = modified.replace(tzinfo=dt.timezone.utc)
                objects.append(AudioObject(
                    key=key,
                    content_hash=match.group(2).lower(),
                    size=int(item.get("Size", 0) or 0),
                    last_modified=modified,
                ))
    except (BotoCoreError, ClientError) as error:
        raise generate.TtsError(f"无法列出 R2 音频对象：{error}") from None
    return objects


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def create_backups(
    manifest_path: Path,
    local_manifest: dict[str, Any],
    remote_manifest: dict[str, Any],
) -> tuple[Path | None, Path]:
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    local_backup = None
    if manifest_path.exists():
        local_backup = manifest_path.with_name(
            f"{manifest_path.name}.backup-{timestamp}"
        )
        shutil.copy2(manifest_path, local_backup)
    remote_backup = manifest_path.with_name(f"manifest.remote-backup-{timestamp}.json")
    write_json(remote_backup, remote_manifest)
    return local_backup, remote_backup


def confirm_deletion(bucket: str) -> bool:
    try:
        response = input(f"输入 DELETE {bucket} 以确认删除并更新清单：").strip()
    except EOFError:
        return False
    return response == f"DELETE {bucket}"


def delete_objects(
    client: Any,
    bucket: str,
    objects: list[AudioObject],
) -> int:
    from botocore.exceptions import BotoCoreError, ClientError

    deleted = 0
    keys = [item.key for item in objects]
    try:
        for offset in range(0, len(keys), 1000):
            batch = keys[offset:offset + 1000]
            response = client.delete_objects(
                Bucket=bucket,
                Delete={
                    "Objects": [{"Key": key} for key in batch],
                    "Quiet": True,
                },
            )
            errors = response.get("Errors", [])
            if errors:
                details = "; ".join(
                    f"{item.get('Key', '(unknown)')}: {item.get('Message', 'unknown error')}"
                    for item in errors[:10]
                )
                raise generate.TtsError(f"R2 返回删除错误：{details}")
            deleted += len(batch)
    except (BotoCoreError, ClientError) as error:
        raise generate.TtsError(f"删除 R2 音频对象失败：{error}") from None
    return deleted


def run(args: argparse.Namespace) -> int:
    references, json_count = scan_data_jsons(Path(args.data_dir))
    client, bucket, _ = generate.create_s3_client()
    objects = list_audio_objects(client, bucket)

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.min_age_days)
    old_orphans = [
        item for item in objects
        if item.content_hash not in references and item.last_modified < cutoff
    ]
    recent_orphans = [
        item for item in objects
        if item.content_hash not in references and item.last_modified >= cutoff
    ]

    total_bytes = sum(item.size for item in old_orphans)
    print(f"扫描 JSON：{json_count} 个；引用哈希：{len(references)} 个")
    print(f"R2 audio/ 对象：{len(objects)} 个")
    print(
        f"超过 {args.min_age_days} 天且未被引用：{len(old_orphans)} 个"
        f"（{total_bytes / 1024 / 1024:.2f} MiB）"
    )
    print(f"未被引用但较新、暂时保留：{len(recent_orphans)} 个")
    for item in old_orphans[:20]:
        print(f"  {item.key}  {item.size} bytes  {item.last_modified.isoformat()}")
    if len(old_orphans) > 20:
        print(f"  ……另有 {len(old_orphans) - 20} 个对象")

    if not args.delete:
        print("仅为预览，未修改 R2 或本地清单。实际删除请加 --delete。")
        return 0
    if not old_orphans:
        print("没有符合条件的对象；未修改清单。")
        return 0
    if not confirm_deletion(bucket):
        print("未收到准确确认；未修改 R2 或本地清单。")
        return 1

    manifest_path = Path(args.output_dir) / "manifest.json"
    local_manifest = generate.read_manifest(manifest_path)
    from botocore.exceptions import BotoCoreError, ClientError
    try:
        remote_manifest = generate.read_remote_manifest(client, bucket)
    except (BotoCoreError, ClientError) as error:
        raise generate.TtsError(f"无法读取 R2 语音清单：{error}") from None
    candidate_hashes = {item.content_hash for item in old_orphans}
    filtered_local = dict(local_manifest)
    filtered_remote = dict(remote_manifest)
    filtered_local["entries"] = {
        key: value
        for key, value in local_manifest.get("entries", {}).items()
        if not isinstance(key, str) or key.lower() not in candidate_hashes
    }
    filtered_remote["entries"] = {
        key: value
        for key, value in remote_manifest.get("entries", {}).items()
        if not isinstance(key, str) or key.lower() not in candidate_hashes
    }

    local_backup, remote_backup = create_backups(
        manifest_path,
        local_manifest,
        remote_manifest,
    )
    try:
        generate.upload_manifest(client, bucket, filtered_remote)
    except (BotoCoreError, ClientError) as error:
        raise generate.TtsError(f"无法更新 R2 语音清单：{error}") from None
    generate.save_manifest(manifest_path, filtered_local)
    print(f"清单备份：{remote_backup}")
    if local_backup:
        print(f"本地清单备份：{local_backup}")

    try:
        deleted = delete_objects(client, bucket, old_orphans)
    except generate.TtsError as error:
        print(
            f"{error}\n清单已更新但对象删除未全部完成；"
            "请重新运行脚本检查剩余对象。",
            file=sys.stderr,
        )
        return 2
    print(f"已删除 {deleted} 个 R2 对象，并从本地及 R2 清单中移除对应条目。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        default=str(DEFAULT_DATA_DIR),
        help="包含日志 JSON 的目录（默认：仓库 data）",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="本地 TTS 输出目录（默认：仓库 .tts-output）",
    )
    parser.add_argument(
        "--min-age-days",
        type=int,
        default=30,
        help="只考虑至少这么旧的未引用对象（默认：30 天）",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="启用删除；仍需交互输入准确确认短语",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.min_age_days < 0:
        parser.error("--min-age-days 不能小于 0")
    try:
        return run(args)
    except generate.TtsError as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"文件操作失败：{error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("已中断。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
