# AsmLens pipeline — quick reference

## CLI flags (common)

| Flag | Meaning |
|---|---|
| `-q` | Query / assembly FASTA |
| `-ref` | Reference FASTA |
| `-hifi` / `-clr` / `-ont` / `-Illumina` | Reads |
| `--bam` / `--ref-bam` | Existing sorted BAMs |
| `-t` | Threads |
| `-o` | Output directory |
| `--align-mode` | `minimap2` \| `nucmer` |
| `--run-syri` / `--run-genomesyn` | Optional SV / GenomeSyn2 |
| `--craq-dir` / `--qv-bed` | Optional QC overlays |
| `--keep-bam` | Keep work BAMs |

## Verify success

1. Exit code 0
2. `asmlens_out/LATEST_BUNDLE.txt` points to zip
3. Zip contains `project.json` + `tracks/` + `problems.tsv` (or equivalent)

## Failure tips

- Missing minimap2/samtools → install in conda env
- OOM on large genomes → raise memory / reduce concurrent jobs / use precomputed BAM
- GenomeSyn2 not found → `module load GenomeSyn2` only (no PATH hacks)
- Empty ref coverage → provide `--ref-bam` or reads with map-to-ref enabled
