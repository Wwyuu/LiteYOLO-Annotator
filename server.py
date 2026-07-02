"""YOLO标注工具 Web 服务。"""

from __future__ import annotations

import argparse
import mimetypes
import socket
from pathlib import Path
from typing import Any

import yaml
from flask import Flask, jsonify, request, send_from_directory

from edit_log import EditLog
from yolo_io import YoloBox, find_image, list_pairs, load_labels, save_labels_atomic

TOOL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TOOL_DIR.parent
STATIC_DIR = TOOL_DIR / "static"
DEFAULT_CONFIG = TOOL_DIR / "config.yaml"


def resolve_path(path_str: str, *, base: Path = PROJECT_ROOT) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path.resolve()
    return (base / path).resolve()


def load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.is_file():
        return {}
    with config_path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"配置文件格式错误: {config_path}")
    return data


def resolve_tool_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path.resolve()
    return (TOOL_DIR / path).resolve()


def create_app(
    images_dir: Path,
    labels_dir: Path,
    class_names: list[str],
    edit_log: EditLog,
) -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    app.config["IMAGES_DIR"] = images_dir.resolve()
    app.config["LABELS_DIR"] = labels_dir.resolve()
    app.config["CLASS_NAMES"] = class_names
    app.config["EDIT_LOG"] = edit_log

    @app.get("/")
    def index():
        response = send_from_directory(str(STATIC_DIR), "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.after_request
    def disable_static_cache(response):
        if request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/api/config")
    def api_config():
        edit_log: EditLog = app.config["EDIT_LOG"]
        stats = edit_log.get_stats()
        return jsonify(
            {
                "images_dir": str(app.config["IMAGES_DIR"]),
                "labels_dir": str(app.config["LABELS_DIR"]),
                "class_names": app.config["CLASS_NAMES"],
                "edit_log_json": str(edit_log.json_path),
                "edit_log_txt": str(edit_log.txt_path),
                "edited_count": stats["edited_count"],
                "total_added": stats["total_added"],
                "total_deleted": stats["total_deleted"],
            }
        )

    @app.get("/api/edits")
    def api_edits():
        edit_log: EditLog = app.config["EDIT_LOG"]
        return jsonify({"items": edit_log.get_items(), "total": len(edit_log.get_items())})

    @app.get("/api/images")
    def api_images():
        pairs = list_pairs(app.config["IMAGES_DIR"], app.config["LABELS_DIR"])
        edit_log: EditLog = app.config["EDIT_LOG"]
        edits = edit_log.get_items()
        for item in pairs:
            edit_info = edits.get(item["stem"])
            if isinstance(edit_info, dict):
                item["edited"] = True
                item["edited_at"] = edit_info.get("edited_at")
                item["edit_count"] = edit_info.get("edit_count", 0)
                item["boxes_added"] = edit_info.get("boxes_added", 0)
                item["boxes_deleted"] = edit_info.get("boxes_deleted", 0)
            else:
                item["edited"] = False
                item["edited_at"] = None
                item["edit_count"] = 0
                item["boxes_added"] = 0
                item["boxes_deleted"] = 0
        return jsonify({"items": pairs, "total": len(pairs)})

    @app.get("/api/image/<stem>")
    def api_image(stem: str):
        img_path = find_image(app.config["IMAGES_DIR"], stem)
        if img_path is None:
            return jsonify({"error": "image not found"}), 404
        mime, _ = mimetypes.guess_type(img_path.name)
        return send_from_directory(
            str(img_path.parent),
            img_path.name,
            mimetype=mime or "application/octet-stream",
        )

    @app.get("/api/labels/<stem>")
    def api_get_labels(stem: str):
        label_path = app.config["LABELS_DIR"] / f"{stem}.txt"
        boxes = load_labels(label_path)
        return jsonify(
            {
                "stem": stem,
                "boxes": [box.to_dict() for box in boxes],
                "exists": label_path.is_file(),
            }
        )

    @app.put("/api/labels/<stem>")
    def api_put_labels(stem: str):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or "boxes" not in payload:
            return jsonify({"error": "invalid payload"}), 400

        raw_boxes = payload.get("boxes")
        if not isinstance(raw_boxes, list):
            return jsonify({"error": "boxes must be a list"}), 400

        boxes: list[YoloBox] = []
        max_class = len(app.config["CLASS_NAMES"]) - 1
        for item in raw_boxes:
            if not isinstance(item, dict):
                continue
            try:
                class_id = int(item.get("class_id", 0))
                xc = float(item["x_center"])
                yc = float(item["y_center"])
                w = float(item["width"])
                h = float(item["height"])
            except (KeyError, TypeError, ValueError):
                return jsonify({"error": "invalid box fields"}), 400
            if class_id < 0 or class_id > max_class:
                return jsonify({"error": f"class_id out of range: {class_id}"}), 400
            if w <= 0 or h <= 0:
                continue
            boxes.append(YoloBox(class_id, xc, yc, w, h).clamp())

        label_path = app.config["LABELS_DIR"] / f"{stem}.txt"
        try:
            save_labels_atomic(label_path, boxes)
            edit_log: EditLog = app.config["EDIT_LOG"]
            stats_payload = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
            added = int(stats_payload.get("added", 0) or 0)
            deleted = int(stats_payload.get("deleted", 0) or 0)
            edit_info = edit_log.record(stem, len(boxes), added=added, deleted=deleted)
            global_stats = edit_log.get_stats()
        except (OSError, ValueError) as exc:
            return jsonify({"error": f"save failed: {exc}"}), 500

        return jsonify(
            {
                "ok": True,
                "stem": stem,
                "box_count": len(boxes),
                "path": str(label_path),
                "edited_at": edit_info["edited_at"],
                "edit_count": edit_info["edit_count"],
                "boxes_added": edit_info.get("boxes_added", 0),
                "boxes_deleted": edit_info.get("boxes_deleted", 0),
                "session_added": added,
                "session_deleted": deleted,
                "total_added": global_stats["total_added"],
                "total_deleted": global_stats["total_deleted"],
                "edit_log_json": str(edit_log.json_path),
                "edit_log_txt": str(edit_log.txt_path),
            }
        )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YOLO标注工具")
    parser.add_argument(
        "--config",
        type=str,
        default=str(DEFAULT_CONFIG),
        help="配置文件路径（默认 label_editor/config.yaml）",
    )
    parser.add_argument("--images", type=str, default=None, help="图片目录（覆盖配置）")
    parser.add_argument("--labels", type=str, default=None, help="标注目录（覆盖配置）")
    parser.add_argument("--host", type=str, default=None, help="监听地址（覆盖配置）")
    parser.add_argument("--port", type=int, default=None, help="监听端口（覆盖配置）")
    parser.add_argument("--classes", type=str, default=None, help="类别名，逗号分隔（覆盖配置）")
    return parser.parse_args()


def ensure_port_available(host: str, port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError as exc:
            raise SystemExit(
                f"端口 {port} 已被占用，请先关闭旧的标注服务再启动。\n"
                f"可在 PowerShell 中执行：\n"
                f"  Get-NetTCPConnection -LocalPort {port} | Select-Object -ExpandProperty OwningProcess\n"
                f"  taskkill /PID <进程号> /F\n"
                f"原始错误: {exc}"
            ) from exc


def main() -> None:
    args = parse_args()
    config_path = Path(args.config).resolve()
    config = load_config(config_path)

    images_dir = resolve_path(args.images or config.get("images", "submission_rfdetr/images"))
    labels_dir = resolve_path(args.labels or config.get("labels", "runs/detect/label_conf015"))
    edit_log_path = resolve_tool_path(config.get("edit_log", "edited_labels.json"))
    edit_log = EditLog(edit_log_path)
    host = args.host or config.get("host", "127.0.0.1")
    port = int(args.port or config.get("port", 8765))

    if args.classes:
        class_names = [name.strip() for name in args.classes.split(",") if name.strip()]
    else:
        raw_classes = config.get("classes", ["weed"])
        class_names = [str(name) for name in raw_classes] if isinstance(raw_classes, list) else ["weed"]

    if not images_dir.is_dir():
        raise SystemExit(f"图片目录不存在: {images_dir}")
    labels_dir.mkdir(parents=True, exist_ok=True)

    pairs = list_pairs(images_dir, labels_dir)
    matched = sum(1 for item in pairs if item["has_image"] and item["has_label"])
    print("YOLO标注工具")
    print(f"工具目录: {TOOL_DIR}")
    print(f"项目根目录: {PROJECT_ROOT}")
    print(f"配置文件: {config_path}")
    print(f"图片目录: {images_dir}")
    print(f"标注目录: {labels_dir}")
    print(f"编辑记录: {edit_log.json_path}")
    print(f"编辑清单: {edit_log.txt_path}")
    print(f"已编辑: {len(edit_log.get_items())} 个文件")
    stats = edit_log.get_stats()
    print(f"累计新增框: {stats['total_added']} | 累计删除框: {stats['total_deleted']}")
    print(f"图片数: {sum(1 for item in pairs if item['has_image'])}")
    print(f"标注数: {sum(1 for item in pairs if item['has_label'])}")
    print(f"已配对: {matched}")
    print(f"打开浏览器: http://{host}:{port}")

    ensure_port_available(host, port)
    app = create_app(images_dir, labels_dir, class_names, edit_log)
    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
