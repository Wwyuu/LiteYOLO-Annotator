# 轻量化YOLO标注工具

一款轻量、本地运行的 YOLO 格式目标检测标注工具。通过浏览器即可完成图片浏览、框选、编辑与保存，适用于任意 YOLO 检测数据集（单类别或多类别均可）。

本工具不依赖 LabelImg、Roboflow 等外部平台，仅需 Python 环境，适合在本地快速校对模型预测结果、补标漏标或从零标注。

## 主要功能

- **YOLO 格式读写**：标注保存为 `class_id x_center y_center width height`（归一化坐标）
- **可视化编辑**：查看已有框，支持移动、缩放、删除、新增框选
- **多类别支持**：在配置文件中自定义类别名称与顺序
- **图片导航**：左侧列表、搜索、筛选（全部 / 有标注 / 无标注 / 已编辑）
- **编辑记录**：保存时自动记录编辑时间与次数，输出 `edited_labels.json` 与 `edited_labels.txt`
- **稳定保存**：原子写入标注文件，保存前自动备份 `.bak`

## 环境要求

- Python 3.10+
- Windows / macOS / Linux

## 安装

```bash
cd label_editor
pip install -r requirements.txt
```

## 快速开始

**方式一：双击启动（Windows）**

```
run.bat
```

**方式二：命令行启动**

```bash
cd label_editor
python server.py
```

启动后在浏览器打开：

```
http://127.0.0.1:8765
```

## 配置说明

编辑 `config.yaml`：

```yaml
# 图片与标注目录（相对于项目根目录）
images: submission_rfdetr/images
labels: runs/detect/label_conf015

# 编辑记录（相对于 label_editor 目录）
edit_log: edited_labels.json

# 类别列表，顺序对应 YOLO class_id：0, 1, 2, ...
classes:
  - weed

host: 127.0.0.1
port: 8765
```

### 路径规则

| 配置项 | 相对基准 |
|--------|----------|
| `images`、`labels` | 项目根目录（`label_editor` 的上一级） |
| `edit_log` | `label_editor` 目录 |

### 多类别示例

```yaml
classes:
  - wheat
  - weed
  - pest
```

### 命令行覆盖配置

```bash
python server.py --images path/to/images --labels path/to/labels --classes wheat,weed --port 9000
```

## 快捷键

| 按键 | 功能 |
|------|------|
| `V` | 选择模式（移动 / 缩放框） |
| `R` | 框选模式（新建标注） |
| `Delete` | 删除当前选中框 |
| `Ctrl + S` | 保存 |
| `←` / `→` | 上一张 / 下一张 |
| `F` | 适应窗口 |
| 滚轮 | 缩放 |
| 空格 + 拖拽 | 平移画布 |

## 编辑记录

每次点击「保存」后，工具会记录该图片的编辑信息：

- `label_editor/edited_labels.json`：结构化数据，供程序读取
- `label_editor/edited_labels.txt`：可读清单，按时间倒序排列

界面左侧可筛选「已编辑」图片，并显示最近编辑时间与累计保存次数。

## 目录结构

```
label_editor/
├── README.md           # 说明文档
├── config.yaml         # 配置文件
├── server.py           # Web 服务入口
├── yolo_io.py          # YOLO 读写
├── edit_log.py         # 编辑记录
├── requirements.txt    # 依赖
├── run.bat             # Windows 启动脚本
├── edited_labels.json  # 编辑记录（运行后生成）
├── edited_labels.txt   # 编辑清单（运行后生成）
└── static/             # 前端页面
    ├── index.html
    ├── editor.css
    └── editor.js
```

## 标注文件格式

每张图片对应一个同名 `.txt` 文件，每行一个目标：

```
<class_id> <x_center> <y_center> <width> <height>
```

坐标均为相对图片宽高的归一化值（0～1）。

## 常见问题

**端口被占用**

```powershell
Get-NetTCPConnection -LocalPort 8765 | Select-Object -ExpandProperty OwningProcess
taskkill /PID <进程号> /F
```

或换端口启动：

```bash
python server.py --port 8766
```

**页面无变化**

修改配置或前端后，请重启服务，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

## 许可证

本项目供学习与科研使用。
