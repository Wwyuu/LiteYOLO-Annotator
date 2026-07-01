"""YOLO 标注读写工具。"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


@dataclass
class YoloBox:
    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float

    def clamp(self) -> YoloBox:
        w = max(1e-6, min(1.0, self.width))
        h = max(1e-6, min(1.0, self.height))
        xc = min(max(self.x_center, w / 2), 1.0 - w / 2)
        yc = min(max(self.y_center, h / 2), 1.0 - h / 2)
        return YoloBox(self.class_id, xc, yc, w, h)

    def to_line(self) -> str:
        b = self.clamp()
        return f"{b.class_id} {b.x_center:.6f} {b.y_center:.6f} {b.width:.6f} {b.height:.6f}"

    def to_dict(self) -> dict:
        b = self.clamp()
        return {
            "class_id": b.class_id,
            "x_center": b.x_center,
            "y_center": b.y_center,
            "width": b.width,
            "height": b.height,
        }


def find_image(images_dir: Path, stem: str) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        candidate = images_dir / f"{stem}{ext}"
        if candidate.is_file():
            return candidate
    return None


def parse_label_text(text: str) -> list[YoloBox]:
    boxes: list[YoloBox] = []
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(parts[0])
            xc, yc, w, h = map(float, parts[1:5])
        except ValueError:
            continue
        boxes.append(YoloBox(class_id, xc, yc, w, h).clamp())
    return boxes


def load_labels(label_path: Path) -> list[YoloBox]:
    if not label_path.is_file():
        return []
    return parse_label_text(label_path.read_text(encoding="utf-8"))


def boxes_to_text(boxes: list[YoloBox]) -> str:
    lines = [box.to_line() for box in boxes]
    return "\n".join(lines) + ("\n" if lines else "")


def save_labels_atomic(label_path: Path, boxes: list[YoloBox], *, backup: bool = True) -> None:
    label_path.parent.mkdir(parents=True, exist_ok=True)
    content = boxes_to_text(boxes)

    if backup and label_path.is_file():
        backup_path = label_path.with_suffix(label_path.suffix + ".bak")
        backup_path.write_text(label_path.read_text(encoding="utf-8"), encoding="utf-8")

    fd, tmp_name = tempfile.mkstemp(
        dir=str(label_path.parent),
        prefix=f".{label_path.stem}_",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, label_path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def list_pairs(images_dir: Path, labels_dir: Path) -> list[dict]:
    images_dir = images_dir.resolve()
    labels_dir = labels_dir.resolve()

    image_map: dict[str, Path] = {}
    for path in images_dir.iterdir():
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            image_map[path.stem] = path

    label_stems = {p.stem for p in labels_dir.glob("*.txt") if p.is_file()}
    all_stems = sorted(image_map.keys() | label_stems)

    pairs: list[dict] = []
    for stem in all_stems:
        img_path = image_map.get(stem)
        label_path = labels_dir / f"{stem}.txt"
        box_count = 0
        if label_path.is_file():
            box_count = len(load_labels(label_path))
        pairs.append(
            {
                "stem": stem,
                "has_image": img_path is not None,
                "has_label": label_path.is_file(),
                "box_count": box_count,
                "image_ext": img_path.suffix.lower() if img_path else None,
            }
        )
    return pairs
