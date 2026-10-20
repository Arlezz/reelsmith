#!/usr/bin/env bash
# red-team.sh: casos límite de rendimiento y caché sobre un guion de 90 s (13 escenas, con música).
#
# Uso: bash red-team.sh <skill> <guion.json de 90 s> <carpeta de trabajo>
#
# Casos:
#   1. corrida limpia (referencia A), con el pico de memoria del sistema
#   2. cambiar una escena: solo se dibujan las escenas que cambian de contenido o de duración (con "duracion" en el
#      guion, el reparto del tiempo puede mover una o dos más); el resultado es idéntico (md5) a un render desde cero
#   3. volver al guion original: todo sale de la caché y el MP4 es idéntico a A
#   4. cambiar la paleta: no se reutiliza ningún segmento (nada de cuadros viejos)
#   5. corrida interrumpida a los 60 s y reanudada: reutiliza los segmentos terminados y da el mismo MP4 que A
#   6. dos videos a la vez en carpetas distintas: cachés separadas, mismo MP4 que A, cuánto se alarga cada uno
set -uo pipefail
SKILL="$(cd "${1:?skill}" && pwd)"; GUION="$(realpath "${2:?guion}")"; W="${3:?carpeta}"
S="$SKILL/scripts"
rm -rf "$W" && mkdir -p "$W" && W="$(cd "$W" && pwd)"
R="$W/resultados.md"
ahora() { date +%s.%N; }
dur() { python3 -c "print(f'{$2 - $1:.1f}')"; }
seg_cache() { grep -o "[0-9]* segmentos ([0-9]* de la caché)" reelsmith.log | tail -1; }
md5v() { md5sum "$1" | cut -c1-12; }
pico_mem() {  # pico de memoria usada del sistema mientras corre el comando (muestreo cada 0,5 s)
  local base pico u pid; base=$(free -m | awk '/Mem:/{print $3}'); pico=$base
  "$@" > /dev/null 2>&1 & pid=$!
  while kill -0 $pid 2>/dev/null; do u=$(free -m | awk '/Mem:/{print $3}'); [ "$u" -gt "$pico" ] && pico=$u; sleep 0.5; done
  wait $pid; echo "$base $pico"
}
nuevo() { rm -rf "$W/$1" && mkdir -p "$W/$1" && cp "$GUION" "$W/$1/guion.json" && cd "$W/$1" && node "$S/reelsmith.mjs" construir > /dev/null; }
export REELSMITH_TIEMPOS=/dev/null

echo "# Red team de rendimiento y caché · $(date -Iseconds)" > "$R"
echo "" >> "$R"
echo "Máquina: $(nproc) CPU, $(free -m | awk '/Mem:/{print $2}') MB. Guion: $(basename "$GUION")." >> "$R"
echo "" >> "$R"
echo "| Caso | Resultado | Tiempo (s) | Esperado | ¿Pasa? |" >> "$R"
echo "|---|---|---|---|---|" >> "$R"
fila() { echo "| $1 | $2 | $3 | $4 | $5 |" >> "$R"; echo "$1: $2 · $3 s · $5"; }

# 1. corrida limpia
nuevo a; t0=$(ahora)
read -r mb mp < <(pico_mem node "$S/reelsmith.mjs" final --estilo corporativa)
t1=$(ahora); A=$(md5v showreel-corporativa.mp4); AV=$(md5v video-mudo.mp4)
TA=$(dur $t0 $t1)
fila "1. Corrida limpia (90 s, 13 escenas)" "$(seg_cache) · memoria: base $mb MB, pico $mp MB (+$((mp - mb)) MB) · $(python3 -c "import json; d=json.load(open('final.json')); print('check-audio', d['check_audio'], '· medir_pista', d['medir_pista'])")" "$TA" "pico bajo 8 GB; jueces PASA" "$([ "$mp" -lt 7500 ] && echo sí || echo NO)"

# 2. cambiar una escena (la 9: su titular)
python3 - <<'EOF'
import json
g = json.load(open("guion.json"))
e = [x for x in g["escenas"] if x["tipo"] == "texto"][-1]
e["titulo"] = e["titulo"] + " (versión 2)"
json.dump(g, open("guion.json", "w"), ensure_ascii=False, indent=1)
EOF
node "$S/reelsmith.mjs" construir > /dev/null; cp guion.json "$W/guion-cambiado.json"
t0=$(ahora); node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; t1=$(ahora)
B_INC=$(md5v video-mudo.mp4); SC=$(seg_cache)
( rm -rf "$W/b-limpio" && mkdir -p "$W/b-limpio" && cp "$W/guion-cambiado.json" "$W/b-limpio/guion.json" && cd "$W/b-limpio" \
  && node "$S/reelsmith.mjs" construir > /dev/null && node "$S/render-nativo.mjs" escena.html video-mudo.mp4 > /dev/null 2>&1 )
B_LIMPIO=$(md5v "$W/b-limpio/video-mudo.mp4")
fila "2. Cambiar el titular de una escena" "$SC · video $B_INC; desde cero $B_LIMPIO" "$(dur $t0 $t1)" "solo las escenas que cambian; mismo md5 que desde cero" "$([ "$B_INC" = "$B_LIMPIO" ] && echo sí || echo NO)"

# 3. volver al original
cp "$GUION" guion.json && node "$S/reelsmith.mjs" construir > /dev/null
t0=$(ahora); node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; t1=$(ahora)
fila "3. Volver al guion original" "$(seg_cache) · audio de caché: $(python3 -c "import json; print(json.load(open('final.json'))['audio_de_cache'])") · MP4 $(md5v showreel-corporativa.mp4) (A: $A)" "$(dur $t0 $t1)" "todo de la caché; MP4 = A" "$([ "$(md5v showreel-corporativa.mp4)" = "$A" ] && echo sí || echo NO)"

# 4. cambiar la paleta
python3 - <<'EOF'
import json
g = json.load(open("guion.json")); g["paleta"] = "petroleo"
json.dump(g, open("guion.json", "w"), ensure_ascii=False, indent=1)
EOF
node "$S/reelsmith.mjs" construir > /dev/null
t0=$(ahora); node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; t1=$(ahora)
SC=$(seg_cache)
fila "4. Cambiar la paleta" "$SC · video $(md5v video-mudo.mp4) (A: $AV)" "$(dur $t0 $t1)" "0 segmentos de la caché; video distinto de A" "$(echo "$SC" | grep -q "(0 de la caché)" && [ "$(md5v video-mudo.mp4)" != "$AV" ] && echo sí || echo NO)"

# 5. interrumpida y reanudada
nuevo c
node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null 2>&1 & pid=$!
sleep 60; pkill -TERM -P $pid 2>/dev/null; kill -TERM $pid 2>/dev/null; sleep 1
pkill -f "render-nativo.mjs escena.html video-mudo.mp4" 2>/dev/null; pkill -f "headless_shell" 2>/dev/null
pkill -f "componer.py|planificar_mezcla.py|medir_pista.py|mezcla.sh" 2>/dev/null; sleep 2
LISTOS=$(ls .cache/render/*.mp4 2>/dev/null | grep -v tmp- | wc -l)
t0=$(ahora); node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; t1=$(ahora)
fila "5. Interrumpida a los 60 s y reanudada" "$LISTOS segmentos terminados al cortar · al reanudar: $(seg_cache) · MP4 $(md5v showreel-corporativa.mp4)" "$(dur $t0 $t1) (+60 antes del corte)" "reutiliza lo terminado; MP4 = A" "$([ "$(md5v showreel-corporativa.mp4)" = "$A" ] && echo sí || echo NO)"

# 6. dos videos a la vez
nuevo d1; nuevo d2
t0=$(ahora)
( cd "$W/d1" && node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; echo "$(ahora)" > fin.txt ) &
( cd "$W/d2" && node "$S/reelsmith.mjs" final --estilo corporativa > /dev/null; echo "$(ahora)" > fin.txt ) &
wait
T1=$(dur $t0 "$(cat "$W/d1/fin.txt")"); T2=$(dur $t0 "$(cat "$W/d2/fin.txt")")
M1=$(md5v "$W/d1/showreel-corporativa.mp4"); M2=$(md5v "$W/d2/showreel-corporativa.mp4")
fila "6. Dos videos a la vez" "cada uno: $T1 s y $T2 s (solo: $TA s) · MP4 $M1 y $M2 (A: $A)" "$T1 / $T2" "los dos = A; cada uno tarda cerca del doble (2 núcleos compartidos)" "$([ "$M1" = "$A" ] && [ "$M2" = "$A" ] && echo sí || echo NO)"

echo "" >> "$R"
echo "Todas las corridas con \`reelsmith.mjs final --estilo corporativa\`; md5 de los primeros 12 caracteres." >> "$R"
cat "$R"
