#!/usr/bin/env python3
"""Import a downloaded TTS task list into .tts-output/tasks.json."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

import generate


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPOSITORY_ROOT / ".tts-output"


def has_manifest_audio(manifest: dict[str, Any], task_hash: str) -> bool:
    entries = manifest.get("entries", {})
    entry = entries.get(task_hash) if isinstance(entries, dict) else None
    return isinstance(entry, dict) and bool(entry.get("url") or entry.get("audioUrl"))


def build_summary(payload: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    raw_summary = payload.get("summary")
    if raw_summary is not None and not isinstance(raw_summary, dict):
        raise generate.TtsError("任务文件的 summary 必须是对象。")
    summary = dict(raw_summary or {})
    try:
        pending_characters = sum(int(task.get("characterCount", 0) or 0) for task in tasks)
        message_count = sum(int(task.get("messageCount", 1) or 1) for task in tasks)
        monthly_used = int(summary.get("monthlyUsedCharacters", 0) or 0)
        monthly_budget = int(payload.get("monthlyBudgetChars", 0) or 0)
    except (TypeError, ValueError):
        raise generate.TtsError("任务文件的摘要数值字段格式无效。") from None
    roles = {
        role
        for task in tasks
        for role in task.get("roles", [])
        if isinstance(role, str) and role
    }
    estimated_seconds = pending_characters / 4
    projected = monthly_used + pending_characters

    summary.update({
        "taskCount": len(tasks),
        "pendingCharacters": pending_characters,
        "messageCount": message_count,
        "roleCount": len(roles),
        "projectedMonthlyCharacters": projected,
        "limitExceeded": bool(monthly_budget and projected > monthly_budget),
        "estimatedMinutes": round(estimated_seconds / 60, 1),
        "estimatedSizeMb": round(estimated_seconds * 64000 / 8 / 1024 / 1024, 2),
    })
    summary["budgetPercent"] = (
        f"{projected / monthly_budget * 100:.1f}" if monthly_budget else "0.0"
    )
    summary.pop("byRole", None)
    summary.pop("byChannel", None)
    return summary


def write_payload(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def run(args: argparse.Namespace) -> int:
    if args.confirm_replace and not args.replace:
        raise generate.TtsError("--confirm-replace 只能与 --replace 一起使用。")
    if args.replace and not args.confirm_replace and not args.dry_run:
        raise generate.TtsError(
            "--replace 会覆盖现有任务文件；确认后请同时指定 --confirm-replace。"
        )

    source_path = Path(args.task_file)
    output_dir = Path(args.output_dir)
    output_path = output_dir / "tasks.json"
    manifest_path = output_dir / "manifest.json"
    if not args.replace and source_path.resolve() == output_path.resolve():
        raise generate.TtsError("输入文件已经是目标 tasks.json，无需再次导入。")

    incoming_payload, incoming_tasks = generate.read_tasks(source_path)
    existing_tasks: list[dict[str, Any]] = []
    if output_path.exists():
        _, existing_tasks = generate.read_tasks(output_path)

    manifest = generate.read_manifest(manifest_path)
    pending_existing = [
        task for task in existing_tasks
        if not has_manifest_audio(manifest, task["hash"])
    ]
    pending_incoming = [
        task for task in incoming_tasks
        if not has_manifest_audio(manifest, task["hash"])
    ]

    if args.replace:
        merged_tasks = generate.deduplicate_tasks(pending_incoming)
    else:
        merged_tasks = generate.deduplicate_tasks(pending_existing + pending_incoming)

    mode = "替换" if args.replace else "追加未完成任务"
    print(f"模式：{mode}")
    print(f"新任务：{len(pending_incoming)} 个未完成（{len(incoming_tasks)} 个导入任务中）")
    print(f"原任务：{len(pending_existing)} 个未完成")
    print(f"写入后：{len(merged_tasks)} 个去重任务")
    print(f"目标文件：{output_path}")

    if args.replace and pending_existing:
        print(f"警告：替换会移除原任务中的 {len(pending_existing)} 个未完成任务。")
    if args.dry_run:
        print("预览模式：未修改文件。")
        return 0

    payload = dict(incoming_payload)
    payload["tasks"] = merged_tasks
    payload["summary"] = build_summary(payload, merged_tasks)
    payload["importedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_payload(output_path, payload)
    print("任务清单已导入。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task_file", help="从日志编辑器下载的任务 JSON")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="任务和语音清单目录（默认：仓库 .tts-output）",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="用新任务替换现有清单；可能丢弃未完成任务",
    )
    parser.add_argument(
        "--confirm-replace",
        action="store_true",
        help="确认允许 --replace 覆盖现有任务清单",
    )
    parser.add_argument("--dry-run", action="store_true", help="仅显示合并结果，不写入文件")
    return parser


def main() -> int:
    try:
        return run(build_parser().parse_args())
    except generate.TtsError as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2
    except (TypeError, ValueError) as error:
        print(f"任务文件格式无效：{error}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError) as error:
        print(f"文件操作失败：{error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("已中断；未完成的任务文件保持不变。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
