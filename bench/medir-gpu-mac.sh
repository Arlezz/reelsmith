#!/usr/bin/env bash
# medir-gpu-mac.sh: mide el render con la codificación por GPU (h264_videotoolbox) contra la CPU (libx264), en un Mac.
#
# Uso, desde la Terminal de macOS (no desde una VM ni un contenedor: VideoToolbox solo existe en macOS):
#   bash bench/medir-gpu-mac.sh [repeticiones]      (por defecto 3; tarda unos 10 a 20 minutos)
#
# Qué hace, por cada video de referencia (ref20 y ref90):
#   1. Un render con CPU para calibrar: mide su tasa de bits. La GPU codifica a esa misma tasa, así la comparación de
#      calidad es a igual tamaño de archivo.
#   2. Renders intercalados CPU / GPU (benchmark.py, modo render), mediana de N.
#   3. SSIM de la GPU contra la CPU (meta: 0,98 o más).
# Deja el resultado en bench/resultados/<fecha>_gpu-mac-<ref>.json y .md, y un resumen en bench/resultados/<fecha>_gpu-mac.txt.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
SKILL="$RAIZ/skills/video-showreel-nativo"
REPS="${1:-3}"
TRABAJO="${TMPDIR:-/tmp}/bench-gpu-mac"
FECHA="$(date +%Y-%m-%d_%H%M)"
RESUMEN="$AQUI/resultados/${FECHA}_gpu-mac.txt"
mkdir -p "$AQUI/resultados"

falta() { echo "FALTA: $1"; echo "  $2"; exit 2; }
[ "$(uname -s)" = "Darwin" ] || falta "esto no es macOS" "VideoToolbox solo existe en macOS: corre el script en la Terminal del Mac."
command -v node > /dev/null || falta "node" "Instala Node 22 o más (por ejemplo: nvm install 22)."
NODE_MAYOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAYOR" -ge 22 ] || falta "node 22 o más (tienes $(node --version))" "nvm install 22 && nvm use 22"
command -v ffmpeg > /dev/null || falta "ffmpeg" "brew install ffmpeg"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox || falta "ffmpeg con h264_videotoolbox" "El ffmpeg de Homebrew lo trae: brew install ffmpeg"
command -v python3 > /dev/null || falta "python3" "xcode-select --install (o brew install python)"
if ! node "$SKILL/scripts/render-nativo.mjs" --verificar > /dev/null 2>&1; then
  echo "Instalando el navegador del render (chromium-headless-shell, unos 100 MB, una sola vez)…"
  npx -y playwright@1.56.0 install chromium-headless-shell
fi

{
  echo "# GPU (h264_videotoolbox) contra CPU (libx264) · $(date '+%Y-%m-%d %H:%M')"
  echo "Mac: $(sysctl -n machdep.cpu.brand_string) · $(sysctl -n hw.ncpu) núcleos · $(( $(sysctl -n hw.memsize) / 1073741824 )) GB · macOS $(sw_vers -productVersion)"
  echo "$(node --version) · $(ffmpeg -version | head -1)"
  node "$SKILL/scripts/render-nativo.mjs" --verificar 2>&1 | tail -3
  echo
} | tee "$RESUMEN"

for REF in ref20 ref90; do
  META="$AQUI/referencias/$REF/meta.json"
  DUR="$(python3 -c "import json; print(json.load(open('$META'))['duracion_s'])")"
  # 1) calibración: un render con CPU y su tasa de bits
  CAL="$TRABAJO/calibracion-$REF"
  rm -rf "$CAL" && mkdir -p "$CAL" && cp -R "$AQUI/referencias/$REF/." "$CAL/"
  ( cd "$CAL" && [ -f construir.mjs ] && node construir.mjs > /dev/null || true )
  echo "[$REF] calibración con CPU…"
  T0=$(python3 -c 'import time; print(time.time())')
  ( cd "$CAL" && SHOWREEL_TIEMPOS=/dev/null node "$SKILL/scripts/render-nativo.mjs" escena.html cal.mp4 --duracion "$DUR" --sin-cache --cache "$CAL/.cache" | tail -1 )
  BPS="$(ffprobe -v error -select_streams v:0 -show_entries format=bit_rate -of csv=p=0 "$CAL/cal.mp4")"
  echo "[$REF] calibración: $(python3 -c "print(round($(python3 -c 'import time; print(time.time())') - $T0, 1))") s · tasa de bits de la CPU: $((BPS / 1000)) kb/s" | tee -a "$RESUMEN"
  # 2) A/B intercalado, mediana de REPS
  export RENDER_BITRATE="$BPS"
  python3 "$AQUI/benchmark.py" --refs "$REF" --repeticiones "$REPS" --etiqueta "gpu-mac-$REF" --trabajo "$TRABAJO" \
    --variantes "[{\"nombre\": \"cpu\", \"skill\": \"$SKILL\", \"modo\": \"render\"},
                  {\"nombre\": \"gpu\", \"skill\": \"$SKILL\", \"modo\": \"render\", \"extra\": \"--codificador h264_videotoolbox\"}]" \
    | grep -E "^\[|^- \*\*|guardado" | tee -a "$RESUMEN"
  # 3) calidad: SSIM de la GPU contra la CPU (primera repetición de cada una)
  A="$TRABAJO/cpu-$REF-0/video-mudo.mp4"; B="$TRABAJO/gpu-$REF-0/video-mudo.mp4"
  SSIM="$(ffmpeg -nostats -i "$B" -i "$A" -lavfi "[0:v][1:v]ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' | tail -1)"
  echo "[$REF] SSIM GPU contra CPU: ${SSIM#All:} · tamaño CPU $(( $(stat -f %z "$A") / 1024 )) KB, GPU $(( $(stat -f %z "$B") / 1024 )) KB" | tee -a "$RESUMEN"
  echo | tee -a "$RESUMEN"
done
echo "Listo. Resumen: $RESUMEN"
