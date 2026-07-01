"""标注编辑记录读写。"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class EditLog:
    def __init__(self, json_path: Path) -> None:
        self.json_path = json_path.resolve()
        self.txt_path = self.json_path.with_suffix(".txt")
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.json_path.is_file():
            return {"version": 1, "items": {}}
        with self.json_path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return {"version": 1, "items": {}}
        items = data.get("items")
        if not isinstance(items, dict):
            data["items"] = {}
        return data

    def get_items(self) -> dict[str, dict[str, Any]]:
        items = self._data.get("items", {})
        return items if isinstance(items, dict) else {}

    def get(self, stem: str) -> dict[str, Any] | None:
        item = self.get_items().get(stem)
        return item if isinstance(item, dict) else None

    def record(self, stem: str, box_count: int) -> dict[str, Any]:
        items = self._data.setdefault("items", {})
        prev = items.get(stem) if isinstance(items.get(stem), dict) else {}
        record = {
            "edited_at": _now_str(),
            "edit_count": int(prev.get("edit_count", 0)) + 1,
            "box_count": box_count,
        }
        items[stem] = record
        self._save()
        return record

    def _save(self) -> None:
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(self._data, ensure_ascii=False, indent=2) + "\n"
        self._atomic_write(self.json_path, content)
        self._write_txt()

    def _write_txt(self) -> None:
        items = self.get_items()
        lines = [
            "# 手动编辑过的标注记录",
            "# 仅在标注工具中点击「保存」后写入",
            f"# 共 {len(items)} 个文件",
            "# 格式: 编辑时间 | 文件名 | 框数 | 累计保存次数",
            "",
        ]
        sorted_items = sorted(
            items.items(),
            key=lambda pair: pair[1].get("edited_at", ""),
            reverse=True,
        )
        for stem, info in sorted_items:
            edited_at = info.get("edited_at", "")
            box_count = info.get("box_count", 0)
            edit_count = info.get("edit_count", 0)
            lines.append(f"{edited_at} | {stem} | {box_count}框 | 第{edit_count}次保存")
        self._atomic_write(self.txt_path, "\n".join(lines) + "\n")

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        fd, tmp_name = tempfile.mkstemp(
            dir=str(path.parent),
            prefix=f".{path.stem}_",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
