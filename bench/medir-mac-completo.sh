#!/usr/bin/env bash
# medir-mac-completo.sh: mide en un Mac la parte de máquina de una corrida de agente de punta a punta (guion → vista →
# final con música, mezcla y jueces) y la suma al tiempo del agente medido en las corridas de referencia.
#
# Uso, desde la Terminal de macOS:
#   bash bench/medir-mac-completo.sh [repeticiones]      (por defecto 3; tarda unos 10 minutos la primera vez)
#
# Qué hace:
#   1. Prepara Python: busca un python 3.11 a 3.13, crea un entorno aislado en ~/.cache/video-showreel-nativo/venv e
#      instala scripts/requirements.txt (numpy, scipy, numba, soundfile, pyloudnorm, matplotlib). No toca el python del
#      sistema.
#   2. Corre prueba-completa.sh: comprueba que todo el pipeline funciona en macOS (plantilla y catálogo, con jueces).
#   3. Repite N veces, cada una en una carpeta limpia y sin caché, lo que hizo la máquina en la corrida de agente final-1:
#      construir el guion que escribió ese agente, la vista y `showreel.mjs final`. Mide el reloj de pared.
#   4. Corrida de punta a punta = tiempo del agente (modelo y escritura, medido en final-1, final-2 y final-3; no depende
#      de la máquina) + tiempo de máquina medido aquí.
# Deja el resultado en bench/resultados/<fecha>_mac-completo.txt y .json.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
SKILL="$RAIZ/skills/video-showreel-nativo"
S="$SKILL/scripts"
REPS="${1:-3}"
TRABAJO="${TMPDIR:-/tmp}/bench-mac-completo"
VENV="$HOME/.cache/video-showreel-nativo/venv"
FECHA="$(date +%Y-%m-%d_%H%M)"
RES="$AQUI/resultados/${FECHA}_mac-completo"
mkdir -p "$AQUI/resultados"
ahora() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
falta() { echo "FALTA: $1"; echo "  $2"; exit 2; }

# ---------------------------------------------------------------- requisitos
[ "$(uname -s)" = "Darwin" ] || falta "esto no es macOS" "Corre el script en la Terminal del Mac."
command -v node > /dev/null || falta "node" "nvm install 22"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || falta "node 22 o más (tienes $(node --version))" "nvm install 22 && nvm use 22"
command -v ffmpeg > /dev/null || falta "ffmpeg" "brew install ffmpeg"
node "$S/render-nativo.mjs" --verificar > /dev/null 2>&1 || npx -y playwright@1.56.0 install chromium-headless-shell
PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" > /dev/null && "$c" -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)' 2> /dev/null; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || falta "python 3.11 a 3.13 (el python del sistema de macOS es 3.9)" "brew install python@3.13"

# ---------------------------------------------------------------- entorno de Python
if [ ! -x "$VENV/bin/python3" ] || ! "$VENV/bin/python3" -c "import numba, scipy, pyloudnorm, soundfile, matplotlib" 2> /dev/null; then
  echo "Creando el entorno de Python en $VENV con $("$PY" --version) (una sola vez, unos 200 MB)…"
  rm -rf "$VENV"
  "$PY" -m venv "$VENV"
  "$VENV/bin/python3" -m pip install --quiet --upgrade pip
  "$VENV/bin/python3" -m pip install --quiet -r "$S/requirements.txt"
fi
export PATH="$VENV/bin:$PATH"   # los scripts llaman a python3: así usan el del entorno
python3 -c "import numba, scipy, pyloudnorm, soundfile, matplotlib; print('python listo:', __import__('sys').version.split()[0])"

{
  echo "# Corrida completa en el Mac · $(date '+%Y-%m-%d %H:%M')"
  echo "Mac: $(sysctl -n machdep.cpu.brand_string) · $(sysctl -n hw.ncpu) núcleos · $(( $(sysctl -n hw.memsize) / 1073741824 )) GB · macOS $(sw_vers -productVersion)"
  echo "$(node --version) · $(ffmpeg -version | head -1) · $(python3 --version)"
  echo
} | tee "$RES.txt"

# ---------------------------------------------------------------- 2. prueba completa
echo "Prueba completa del pipeline (plantilla y catálogo)…"
T0=$(ahora)
if ! bash "$S/prueba-completa.sh" "$TRABAJO/prueba" > "$TRABAJO-prueba.log" 2>&1; then
  tail -30 "$TRABAJO-prueba.log"
  echo "FALLÓ prueba-completa.sh: el log completo está en $TRABAJO-prueba.log (cópialo a bench/resultados/ y avísame)"
  cp "$TRABAJO-prueba.log" "$RES-prueba-fallida.log"
  exit 1
fi
echo "prueba-completa.sh: PASA en $(python3 -c "print(round($(ahora) - $T0))") s (plantilla en los dos estilos y guion del catálogo, con jueces)" | tee -a "$RES.txt"
grep -E "check-audio:|medir_pista:" "$TRABAJO-prueba.log" | tail -2 | tee -a "$RES.txt"
echo | tee -a "$RES.txt"

# ---------------------------------------------------------------- 3. parte de máquina de la corrida final-1, N veces
GUION="$AQUI/resultados/corridas-agente/final-1-guion.json"
for i in $(seq 1 "$REPS"); do
  D="$TRABAJO/corrida-$i"
  rm -rf "$D" && mkdir -p "$D" && cp "$GUION" "$D/guion.json"
  export SHOWREEL_TIEMPOS="$D/tiempos.jsonl"
  cd "$D"
  T0=$(ahora)
  node "$S/showreel.mjs" construir > construir.log
  T1=$(ahora)
  node "$S/showreel.mjs" vista > vista.log
  T2=$(ahora)
  node "$S/showreel.mjs" final --estilo corporativa > final.log 2>&1 || { tail -20 final.log; echo "FALLÓ final en la corrida $i: log en $D/final.log"; exit 1; }
  T3=$(ahora)
  python3 - "$D" "$T0" "$T1" "$T2" "$T3" "$i" <<'EOF' | tee -a "$RES.txt"
import json, sys
d, t0, t1, t2, t3, i = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
fin = json.load(open(f"{d}/final.json"))
etapas = {}
for l in open(f"{d}/tiempos.jsonl"):
    e = json.loads(l)
    if e.get("tipo") == "maquina":
        etapas[e["etapa"]] = round(etapas.get(e["etapa"], 0) + e["s"], 1)
r = {"corrida": int(i), "maquina_s": round(t3 - t0, 1), "construir_s": round(t1 - t0, 2), "vista_s": round(t2 - t1, 1), "final_s": round(t3 - t2, 1),
     "etapas_s": etapas, "check_audio": fin["check_audio"], "medir_pista": fin["medir_pista"], "cortes_fuera_del_plan": fin["cortes_fuera_del_plan"],
     "musica_desde": fin.get("musica_desde"), "duracion_video_s": fin["duracion_s"]}
json.dump(r, open(f"{d}/medicion.json", "w"))
print(f"corrida {i}: máquina {r['maquina_s']} s (construir {r['construir_s']} · vista {r['vista_s']} · final {r['final_s']}) · "
      f"render {etapas.get('render')} s · check-audio {r['check_audio']} · medir_pista {r['medir_pista']}")
EOF
  cd "$RAIZ"
done

# ---------------------------------------------------------------- 4. punta a punta = agente (medido) + máquina (Mac)
python3 - "$TRABAJO" "$REPS" "$AQUI/resultados/corridas-agente" "$RES" <<'EOF' | tee -a "$RES.txt"
import json, statistics, sys
trabajo, reps, dir_agente, res = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
med = [json.load(open(f"{trabajo}/corrida-{i}/medicion.json")) for i in range(1, reps + 1)]
maq = statistics.median(m["maquina_s"] for m in med)
render = statistics.median(m["etapas_s"].get("render", 0) for m in med)
agente = []
for n in ("final-1", "final-2", "final-3"):
    t = json.load(open(f"{dir_agente}/{n}-transcripcion.json"))
    agente.append(round(t["total_s"] - t["herramientas_s"], 1))  # modelo + escritura; no depende de la máquina
ag = statistics.median(agente)
total = round(ag + maq, 1)
nube = [json.load(open(f"{dir_agente}/{n}-transcripcion.json"))["total_s"] for n in ("final-1", "final-2", "final-3")]
pasa = all(all(c.endswith("PASA") for c in m["check_audio"]) and m["medir_pista"] == "PASA" for m in med)
print()
print(f"Máquina en el Mac (construir + vista + final), mediana de {reps}: {maq} s · render {render} s")
print(f"Agente (modelo y escritura), mediana de final-1/2/3: {ag} s  {agente}")
print(f"PUNTA A PUNTA EN EL MAC (agente + máquina): {total} s = {round(total / 60, 1)} min")
print(f"  en la máquina de prueba de 2 vCPU fue {statistics.median(nube)} s (mediana de final-1/2/3)")
print(f"Jueces: {'PASA en todas' if pasa else 'ALGUNO FALLA: ver las corridas'}")
json.dump({"corridas": med, "maquina_mediana_s": maq, "render_mediana_s": render, "agente_s": agente, "agente_mediana_s": ag,
           "punta_a_punta_s": total, "nube_2vcpu_s": nube, "jueces_pasan": pasa}, open(res + ".json", "w"), indent=1, ensure_ascii=False)
EOF
echo "Listo. Resumen: $RES.txt"
