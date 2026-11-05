#!/usr/bin/env bash
# AsmLens one-line installer (conda/mamba style)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yrzhu-ai/AsmLens/main/install.sh | bash
#   # or
#   wget -qO- https://raw.githubusercontent.com/yrzhu-ai/AsmLens/main/install.sh | bash
#
# Env overrides:
#   ASMLENS_HOME   install prefix (default: $HOME/asmlens)
#   ASMLENS_GIT    git URL (default: https://github.com/yrzhu-ai/AsmLens.git)
#   ASMLENS_BRANCH branch/tag (default: main)

set -euo pipefail

ASMLENS_HOME="${ASMLENS_HOME:-$HOME/asmlens}"
ASMLENS_GIT="${ASMLENS_GIT:-https://github.com/yrzhu-ai/AsmLens.git}"
ASMLENS_BRANCH="${ASMLENS_BRANCH:-main}"
ENV_NAME="${ASMLENS_ENV_NAME:-asmlens}"

echo "============================================================"
echo " AsmLens installer"
echo " Home : $ASMLENS_HOME"
echo " Repo : $ASMLENS_GIT ($ASMLENS_BRANCH)"
echo "============================================================"

have() { command -v "$1" >/dev/null 2>&1; }

pick_conda() {
  if have mamba; then echo mamba; return; fi
  if have conda; then echo conda; return; fi
  if [ -x "$HOME/miniconda3/bin/conda" ]; then echo "$HOME/miniconda3/bin/conda"; return; fi
  if [ -x "$HOME/mambaforge/bin/mamba" ]; then echo "$HOME/mambaforge/bin/mamba"; return; fi
  if [ -x "$HOME/miniforge3/bin/mamba" ]; then echo "$HOME/miniforge3/bin/mamba"; return; fi
  echo ""
}

CONDA_BIN="$(pick_conda)"
if [ -z "$CONDA_BIN" ]; then
  cat <<'EOF'
[ERROR] conda/mamba not found.

Install Miniconda first, then re-run this script:
  wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
  bash Miniconda3-latest-Linux-x86_64.sh -b -p $HOME/miniconda3
  source $HOME/miniconda3/etc/profile.d/conda.sh
EOF
  exit 1
fi
echo "[info] using: $CONDA_BIN"

# source conda.sh when possible
if [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/miniconda3/etc/profile.d/conda.sh"
elif [ -f "$HOME/miniforge3/etc/profile.d/conda.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/miniforge3/etc/profile.d/conda.sh"
elif [ -f "$HOME/mambaforge/etc/profile.d/conda.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/mambaforge/etc/profile.d/conda.sh"
fi

mkdir -p "$(dirname "$ASMLENS_HOME")"
if [ -d "$ASMLENS_HOME/.git" ]; then
  echo "[info] updating existing clone ..."
  git -C "$ASMLENS_HOME" fetch --depth 1 origin "$ASMLENS_BRANCH"
  git -C "$ASMLENS_HOME" checkout "$ASMLENS_BRANCH"
  git -C "$ASMLENS_HOME" reset --hard "origin/$ASMLENS_BRANCH" || true
else
  echo "[info] cloning AsmLens ..."
  rm -rf "$ASMLENS_HOME"
  git clone --depth 1 -b "$ASMLENS_BRANCH" "$ASMLENS_GIT" "$ASMLENS_HOME"
fi

echo "[info] creating/updating conda env: $ENV_NAME"
if "$CONDA_BIN" env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  "$CONDA_BIN" install -y -n "$ENV_NAME" -c conda-forge -c bioconda \
    python=3.11 pip minimap2 samtools || true
else
  "$CONDA_BIN" create -y -n "$ENV_NAME" -c conda-forge -c bioconda \
    python=3.11 pip minimap2 samtools
fi

# activate and pip install
# shellcheck disable=SC1091
eval "$("$CONDA_BIN" shell.bash hook 2>/dev/null || true)"
conda activate "$ENV_NAME" 2>/dev/null || true

python -m pip install -U pip
python -m pip install -e "$ASMLENS_HOME[desktop]"

BIN_DIR="${ASMLENS_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
WRAPPER="$BIN_DIR/asmlens"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
# AsmLens launcher (created by install.sh)
source "\$(conda info --base)/etc/profile.d/conda.sh"
conda activate ${ENV_NAME}
exec asmlens "\$@"
EOF
chmod +x "$WRAPPER"
# also expose module path
SITE_MSG=$(python - <<'PY'
import asmlens, pathlib
print(pathlib.Path(asmlens.__file__).resolve().parent)
PY
)

echo
echo "============================================================"
echo " AsmLens installed successfully"
echo "============================================================"
echo " Package : $ASMLENS_HOME"
echo " Env     : $ENV_NAME"
echo " Launcher: $WRAPPER"
echo " Module  : $SITE_MSG"
echo
echo " Make sure ~/.local/bin is on PATH, e.g.:"
echo "   echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
echo
echo " Quick test:"
echo "   asmlens run -h"
echo
echo " Example:"
echo "   asmlens run -q assembly.fa -hifi reads.hifi.fq.gz -t 16 -o asmlens_out"
echo "   # download asmlens_out/asmlens_bundle_*.zip to desktop, then:"
echo "   asmlens desktop -p asmlens_bundle_*.zip"
echo "============================================================"
