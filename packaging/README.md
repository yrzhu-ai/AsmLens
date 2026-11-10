# 打包 Windows 可执行文件（AsmLens.exe）

## 能否做成 exe？

可以。桌面端是 **Python + FastAPI + pywebview**，用 **PyInstaller** 打成文件夹/`AsmLens.exe` 后，双击即可：

1. 弹出选择框 → 选服务器给的 `asmlens_bundle_*.zip`（或 `project.json`）
2. 取消选择 → 打开内置演示工程
3. 也可把 zip **拖到 exe 上**打开

## 在本机构建

需要已安装 Python 3.9+（并加入 PATH）：

```bat
cd D:\cursor_workspace\AsmLens
packaging\build_windows.bat
```

产物：`dist\AsmLens\AsmLens.exe`（同目录还有依赖 dll，请整夹分发，不要只拷一个 exe）。

## 给用户用

把整个 `dist\AsmLens\` 文件夹拷过去，双击 `AsmLens.exe`。  
服务器流水线产出的 `asmlens_bundle_*.zip` 用这个 exe 打开即可，**桌面端不需要 BAM / minimap2**。

## 说明

- 使用 `console=False`，无黑色命令行窗口
- Web 静态页与演示数据已打进包内
- 杀毒软件偶发误报 PyInstaller 程序，可加白名单或改用签名证书
