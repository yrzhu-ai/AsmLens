# AsmLens

**Assembly Lens** — an IGV-style browser for **assembly problem regions**.

It focuses on coordinates from coverage / CRAQ / QV (Merqury-style) analysis.  
**No BAM required** in the viewer: the server turns large depth/CRAQ/QV files into compact BED / bedGraph tracks; the desktop (or browser) only loads the region you are looking at.

| Side | Role |
|---|---|
| **Server** | `asmlens prepare` builds a project; `asmlens serve` provides a small API + web UI |
| **Desktop** | `asmlens desktop` opens the same UI in a native window (pywebview) |

Inspired by IGV navigation (locus bar, zoom/pan, track stack, jump-to-region list), and by coverage zero-region extraction scripts under `可视化覆盖/`.

## Why not BAM?

BAM files are huge and slow to scan genome-wide. CRAQ / depth / windowed QV already summarize where assemblies look wrong. AsmLens keeps those **coordinate tracks** and a **problem-region sidebar**, so you can jump straight to issues.

## Install

```bash
cd AsmLens
python -m pip install -e .
# optional desktop window
python -m pip install -e ".[desktop]"
```

## Quick start (demo)

```bash
# terminal 1 / or use desktop
asmlens serve -p examples/demo_project --port 8765
# open http://127.0.0.1:8765/

# or desktop window
asmlens desktop -p examples/demo_project
```

## Build a project from your data

```bash
asmlens prepare -o my_project --name "Abaca v2v2" \
  --fai genome.fa.fai \
  --depth sample.depth.txt \
  --min-length 100 \
  --low-max-depth 5 \
  --craq-dir /path/to/runAQI_out \
  --qv-tsv windows.qv.tsv --max-qv 30
```

Inputs (any subset beyond chrom sizes):

- `--fai` or `--chrom-sizes` — chromosome lengths  
- `--depth` — `samtools depth -a` text (zero / low coverage + optional bedGraph)  
- `--craq-dir` — CRAQ `runAQI_out` (CRE/CSE/CRH/CSH/low_coverage BEDs)  
- `--qv-bed` or `--qv-tsv` — low-QV windows  

Then:

```bash
asmlens serve -p my_project
# or
asmlens desktop -p my_project
```

## Desktop UI (IGV-like)

- Chromosome selector + `chr:start-end` locus box  
- Zoom / pan (buttons, wheel, drag)  
- Stacked tracks: coverage bedGraph + BED feature tracks  
- Left panel: **problem regions only** — click to jump with flank  

## Project layout

```
my_project/
  project.json
  chrom.sizes
  problems.tsv
  tracks/
    zero_coverage.bed
    low_coverage.bed
    coverage.bedgraph
    craq_CRE.bed
    ...
```

## Repository layout

```
server/asmlens/   # prepare + API + CLI
web/              # IGV-style front-end
desktop/          # thin pywebview entry
examples/         # demo project
```

## License

MIT
