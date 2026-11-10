# AsmLens（组装透镜）

**AsmLens = Assembly Lens（组装透镜）** — 像透镜一样聚焦查看组装**覆盖度 / 问题区间 / 低覆盖归因**（不是完整 IGV）。  
当前版本：**1.0.0**。

Server maps reads → builds coordinate tracks → packs a **delivery zip**.  
Desktop opens the zip (or project folder). **No BAM on the desktop.**

## One-line install (like conda)

```bash
curl -fsSL https://raw.githubusercontent.com/yrzhu-ai/AsmLens/main/install.sh | bash
```

Requires an existing **conda/mamba** (Miniconda / Mambaforge).  
Installer clones this repo to `~/asmlens`, creates env **`AsmLens-env`**（可用 `ASMLENS_ENV_NAME` 覆盖），并把 `asmlens` 放到 `~/.local/bin`。

```bash
conda activate AsmLens-env
asmlens -h
```

## Server usage

激活环境后直接输入 `asmlens`（不必写 `run`）：

```bash
conda activate AsmLens-env

# 双基因组 + HiFi（推荐）
asmlens -q assembly.fa -ref reference.fa -hifi reads.hifi.fq.gz -t 16 -o asmlens_out

# 多套测序可一起给
asmlens -q asm.fa -ref ref.fa \
  -hifi hifi.fq.gz -clr clr.fq.gz -ont ont.fq.gz \
  -Illumina r1.fq.gz r2.fq.gz -t 32 -o out

# 复用已有 BAM / CRAQ / QV（跳过重比对）
asmlens -q asm.fa -ref ref.fa \
  --bam query.sorted.bam --ref-bam ref.sorted.bam \
  --craq /path/to/runAQI_out --qv-bed low_qv.bed \
  -o out

# 共线性 + SyRI 结构变异（推荐有 -ref 时）
asmlens -q asm.fa -ref ref.fa -hifi hifi.fq.gz -t 32 \
  --align-mode nucmer --run-syri --run-genomesyn -o out
```

有 `-ref` 时默认会导出共线性 BED 轨；`--run-syri` / `--run-genomesyn` 需环境中有对应软件（如 `syri-env` / `genomesyn-env`）。

| Flag | Meaning |
|---|---|
| `-q` | 待评估组装 FASTA（必填） |
| `-ref` | 参考基因组（建议填，用于共线性+低覆盖归因） |
| `-hifi` / `-clr` / `-ont` / `-Illumina` | 测序数据（与 `--bam` 至少提供一种） |
| `--bam` / `--query-bam` | 已有比对到组装的 BAM（可多个） |
| `--ref-bam` | 已有比对到参考的 BAM（可多个） |
| `--craq` / `--craq-dir` | 已有 CRAQ 结果目录 |
| `--qv` / `--qv-bed` / `--qv-tsv` | 已有 QV 结果 |
| `-t` | 线程数 |
| `-o` | 输出目录 |
| `--align-mode` | `minimap2` / `nucmer` |

详细数据清单见 [`docs/所需数据清单.md`](docs/所需数据清单.md)。
### Outputs

```
asmlens_out/
  project/                 # open with desktop/serve
  asmlens_bundle_*.zip     # delivery package for users
  LATEST_BUNDLE.txt
  work/                    # intermediates (BAM removed unless --keep-bam)
  logs/
```

Give users **`asmlens_bundle_*.zip`**. On desktop:

```bash
asmlens desktop -p asmlens_bundle_YYYYMMDD_HHMMSS.zip
# or unzip first, then:
asmlens desktop -p project/
asmlens serve -p project/ --port 8765
```

Desktop (Chinese UI): open zip/project → multi-track browser → filter by problem type / attribution status → export current view as **SVG**. Plugins: drop JS under `web/plugins/` and list in `MANIFEST.json`.

### Windows `.exe`（双击打开）

```bat
packaging\build_windows.bat
```

生成 `dist\AsmLens\AsmLens.exe`：双击选 zip / 拖拽 zip 到 exe 即可。说明见 [`packaging/README.md`](packaging/README.md)。

**发行包**：发布页提供 `AsmLens-windows-x64.zip`（解压后运行 `AsmLens.exe`）。本地打包产物也可在 `dist/AsmLens-windows-x64.zip`。

### Cursor Agent Skill（服务器流水线）

仓库内：[`.cursor/skills/asmlens-pipeline/SKILL.md`](.cursor/skills/asmlens-pipeline/SKILL.md)  
在 Cursor 中启用后，智能体可按 skill 协助跑完整 `asmlens` 交付包流程（数据清单、命令、大基因组注意点、输出验收）。

## Demo (no reads)

```bash
asmlens serve -p examples/demo_project --port 8765
# or
asmlens desktop -p examples/demo_project
# 省略 -p：弹出文件选择框 / 打开演示
asmlens desktop
```

## Developer install

```bash
git clone https://github.com/yrzhu-ai/AsmLens.git
cd AsmLens
pip install -e ".[desktop]"
```

## License

MIT
