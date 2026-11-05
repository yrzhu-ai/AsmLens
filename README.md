# AsmLens

**Assembly Lens** — IGV-style browser for assembly **coverage / problem regions**.

Server maps reads → builds coordinate tracks → packs a **delivery zip**.  
Desktop opens the zip (or project folder). **No BAM on the desktop.**

## One-line install (like conda)

```bash
curl -fsSL https://raw.githubusercontent.com/yrzhu-ai/AsmLens/main/install.sh | bash
```

Requires an existing **conda/mamba** (Miniconda / Mambaforge).  
Installer clones this repo to `~/asmlens`, creates env `asmlens` (python, minimap2, samtools), and puts `asmlens` on `~/.local/bin`.

```bash
export PATH="$HOME/.local/bin:$PATH"
asmlens run -h
```

## Server usage

```bash
asmlens run \
  -q assembly.fa \
  -hifi reads.hifi.fq.gz \
  -t 16 \
  -o asmlens_out

# optional reference
asmlens run -q assembly.fa -ref ref.fa -hifi hifi.fq.gz -t 32 -o out

# other read types (can combine)
asmlens run -q asm.fa -clr clr.fq.gz -ont ont.fq.gz -Illumina r1.fq.gz r2.fq.gz -t 24 -o out
```

| Flag | Meaning |
|---|---|
| `-q` | Assembly FASTA to evaluate (required) |
| `-hifi` / `-clr` / `-ont` / `-Illumina` | Read files (need ≥1 type) |
| `-t` | Threads |
| `-ref` | Optional reference FASTA |
| `-o` | Output directory |

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

## Demo (no reads)

```bash
asmlens serve -p examples/demo_project --port 8765
```

## Developer install

```bash
git clone https://github.com/yrzhu-ai/AsmLens.git
cd AsmLens
pip install -e ".[desktop]"
```

## License

MIT
