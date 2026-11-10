# 操作记录 — 安装 Python 并打包 AsmLens.exe

- **日期**: 2026-11-05
- **指令**: 请帮我做成 exe，需要按照 python 就安装

## 改了什么 / 做了什么
- 静默安装 **Python 3.12.10** 到  
  `C:\Users\Administrator\AppData\Local\Programs\Python\Python312\`（已加入用户 PATH）
- `pip install -e ".[desktop]" pyinstaller`
- `python -m PyInstaller --noconfirm --clean packaging\asmlens.spec`
- 产物：`D:\cursor_workspace\AsmLens\dist\AsmLens\AsmLens.exe`
- 桌面快捷方式：`桌面\AsmLens.lnk`
- 对演示工程做了约 8 秒冒烟启动后结束进程

## 使用
- 双击桌面 **AsmLens** 快捷方式，或  
  `D:\cursor_workspace\AsmLens\dist\AsmLens\AsmLens.exe`
- 整夹分发：拷贝整个 `dist\AsmLens\` 目录

## 没改什么
- 未改业务源码（本次仅为安装与打包）
- 未 git commit/push
- 未动学校 test2 任务
