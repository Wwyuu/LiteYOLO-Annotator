@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo YOLO标注工具
echo 工具目录: %cd%
echo 配置文件: config.yaml
echo.
python server.py
pause
