---
name: asmlens-pipeline
description: >-
  Run the full AsmLens server pipeline (assembly QC delivery zip): map reads,
  coverage/lowcov, optional ref synteny attribution, CRAQ/QV/SyRI/GenomeSyn2,
  then pack asmlens_bundle_*.zip for the desktop viewer. Use when the user asks
  to run AsmLens, build a delivery bundle, process assembly vs reference with
  HiFi/BAM, or set up server-side QC for large genomes (e.g. wheat).
---

# AsmLens server pipeline

## Goal

Produce a **desktop delivery zip** (`asmlens_bundle_*.zip`) from assembly FASTA (+ optional ref / reads / BAM / CRAQ). Desktop opens the zip only — **no BAM on desktop**.

## Prerequisites

- Conda env with AsmLens CLI (`AsmLens-env` or project install): `asmlens -h`
- Tools as needed: `minimap2`, `samtools`, optional `nucmer`/`syri`/`GenomeSyn2` (`module load GenomeSyn2` on clusters — do **not** rewrite PATH)
- Disk: intermediates under `-o` can be large; prefer SSD / scratch

## Data checklist

| Priority | Input | Flag |
|---|---|---|
| Required | Query assembly FASTA | `-q` |
| Strongly recommended | Reference FASTA | `-ref` |
| Reads and/or BAM | HiFi/CLR/ONT/Illumina and/or `--bam` / `--ref-bam` | `-hifi` … / `--bam` |
| Optional | CRAQ dir, QV bed/tsv | `--craq-dir`, `--qv-bed` |
| Optional | SyRI / GenomeSyn2 | `--run-syri`, `--run-genomesyn`, `--align-mode nucmer` |

Details: `docs/所需数据清单.md`.

## Standard commands

Activate env, then:

```bash
# Typical dual-genome + HiFi
asmlens -q assembly.fa -ref reference.fa -hifi reads.hifi.fq.gz -t 16 -o asmlens_out

# Reuse BAMs (skip remapping)
asmlens -q asm.fa -ref ref.fa \
  --bam query.sorted.bam --ref-bam ref.sorted.bam \
  -t 32 -o asmlens_out

# Synteny + SyRI (needs tools in env)
asmlens -q asm.fa -ref ref.fa -hifi hifi.fq.gz -t 32 \
  --align-mode nucmer --run-syri --run-genomesyn -o asmlens_out
```

On clusters with GenomeSyn2 modules:

```bash
module load GenomeSyn2   # only; do not export custom PATH overlays
asmlens ... --run-genomesyn -o asmlens_out
```

## Outputs to hand to users

```
asmlens_out/
  project/                 # optional open with serve
  asmlens_bundle_*.zip     # ← give this to desktop AsmLens.exe
  LATEST_BUNDLE.txt
  work/                    # intermediates (BAM removed unless --keep-bam)
  logs/
```

Desktop: open zip via **文件 → 打开交付包**.

## Large genomes (wheat-scale)

- Prefer **HPC**: many cores (`-t 32+`), **≥128GB RAM** for whole-genome align/depth; not a laptop job
- Chromosome-level assemblies browse better than thousands of scaffolds
- Desktop defaults: whole-genome overview = synteny only; coverage = **zero-cov + min length**; user widens filters later

## Agent workflow

1. Confirm inputs exist (FASTA / reads or BAM / optional CRAQ).
2. Choose `-o` on large disk; set `-t` to available cores.
3. Run `asmlens …`; stream logs; on failure read `logs/` and retry with `--bam` if mapping already done.
4. Verify `asmlens_bundle_*.zip` (or `LATEST_BUNDLE.txt`) and report path + size.
5. Do **not** git commit/push or delete workdirs unless the user asks.
6. On shared servers: only run commands the user authorized; write an 操作记录 if that is project practice.

## Desktop vs server

| | Server `asmlens` | Desktop exe |
|---|---|---|
| Role | Build tracks + zip | View zip |
| Threads | Multi-thread CPU (`-t`) | UI + local HTTP |
| GPU | Not required | Not required |
