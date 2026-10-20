#!/usr/bin/env bash
# prueba-completa.sh: atajo a prueba-completa.mjs, que hace la prueba completa en Linux, macOS y Windows.
# Uso: bash prueba-completa.sh carpeta-de-salida [corporativa|trailer|ambos]   (o: node prueba-completa.mjs …)
exec node "$(dirname "$0")/prueba-completa.mjs" "$@"
