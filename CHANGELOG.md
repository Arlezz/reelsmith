# Cambios

Reelsmith se llamó `video-showreel-nativo` hasta la 0.2.1.

## 0.3.0: Reelsmith, repositorio y contenedor

- **Nombre nuevo:** Reelsmith (plugin, skill y comando). La skill `video-showreel` es otra y no cambia.
- **Un solo comando, `reelsmith`** (`npm link`).
  - Suma `doctor`, `nuevo`, `video`, `prueba`, `medir`, `version` y `--docker`.
  - Reemplaza a `showreel.mjs`.
  - Las variables pasan a `REELSMITH_*`.
  - El entorno de Python queda en `reelsmith/venv`.
- **Instrucciones:** `AGENTS.md` para cualquier agente; `CLAUDE.md` lo importa.
- **Contenedor:** `Dockerfile` con versiones fijas (Ubuntu 24.04, Node 22, ffmpeg 6.1, Python 3.12, Chromium 1194).
- **CI:** GitHub Actions corre la prueba completa nativa y en la imagen, y publica la imagen en ghcr.io.
- **Referencia de md5:** `bench/referencia-md5.json`; `bench/comparar-md5.mjs` compara otra corrida contra ella.
- **ruff:** con el estándar de CENIA (`pyproject.toml`). Sin cambios de comportamiento: la prueba completa da los mismos md5 que la 0.2.1.
- **Prueba de transferencia:** un agente nuevo, solo con el repo y `AGENTS.md`, hizo el video de 90 s en 3,7 min, con los jueces en PASA a la primera. Seis ajustes de documentación y de `doctor` salieron de esa prueba (`bench/RENDIMIENTO.md` §9d).
- **Contenedor medido en el MacBook M5** (Docker con 10 CPU y 8 GB): 46,3 s de máquina contra 38,6 s nativos, 2,0 min de punta a punta contra 1,8, y el video idéntico entre corridas (`bench/RENDIMIENTO.md` §9e).

## 0.2.1 (19/10/2026): Windows

- La mezcla ya no llama a bash: `planificar_mezcla.py` corre los mismos comandos de `mezcla.sh` desde Python. El audio sale idéntico byte a byte.
- Los scripts de Python leen y escriben UTF-8 aunque la consola no lo sea. Antes, en una consola Latin-1 la mezcla fallaba por una flecha en un mensaje.
- `entorno.mjs` elige el Python (en Windows, `python3` no existe) y usa el mismo Node para los procesos hijos.
- `prueba-completa.mjs` reemplaza al script de bash, que queda como atajo.
- En Windows, el render corre con prioridad "por debajo de lo normal", el equivalente de `nice 10`.
- `RENDER_MODO=capturas` fuerza capturas comunes si un Chromium no responde a `beginFrame`.
- `medir_cortes.py` ya no pone la ruta del archivo temporal dentro del grafo de filtros de ffmpeg: una ruta de Windows (`C:\...`) lo rompía.
- Con NVENC, el render usa a lo más 8 sesiones de codificación (lo que admite una GeForce); con más, los segmentos fallaban y se repetían.
- Medido en un PC con Windows 11 (Ryzen 7 9800X3D, RTX 5070): el video de 90 s queda en 2,0 min de punta a punta, con render determinista y jueces PASA. Detalle en `bench/RENDIMIENTO.md` §9c.
- `node reelsmith.mjs marca <etapa>` hace lo mismo que `python3 tiempos.py marca`.
- En Linux, la prueba completa da los mismos md5 que la 0.2.0: video, WAV, `audio.m4a` y MP4 final.

## 0.2.0 (19/10/2026): tiempo hasta el resultado

Detalle, método y mediciones en `bench/RENDIMIENTO.md`. En 2 vCPU y 8 GB, sin GPU, mediana de 3:

| | 0.1.0 | 0.2.0 |
|---|---|---|
| Video de 90 s, del pedido al MP4 (agente incluido) | 50,8 min | 4,3 min (1,8 min en un MacBook M5; 2,0 min en un PC con Windows) |
| Solo la máquina, una pasada (ref90) | 557 s | 225 s |
| Render de 20 s (ref20) | 89,6 s | 60,0 s |
| Cambiar una escena y verla | un render completo (4 a 5 min) | 11,3 s (1,2 s de máquina) |
| Costo del modelo por video | USD 8,96 | USD 0,52 |
| Calidad contra 0.1.0 | — | SSIM 0,998 a 0,999; jueces PASA |

Lo que más pesó: el guion de catálogo en vez de HTML escrito a mano, la vista rápida en vez de renders completos para revisar, y `final` con render, audio y jueces en paralelo. En un MacBook M5 (10 núcleos), el render de 20 s tarda 10,6 s con CPU; la GPU (`--codificador h264_videotoolbox`) lo baja solo entre un 6 y un 18 %. En un PC con Windows y una RTX 5070 pasa lo mismo: `--codificador h264_nvenc` baja el render de 90 s un 16 % y el de 20 s nada. El defecto sigue siendo libx264.

## 0.1.0: estado de la prueba (18/10/2026)

**Regresión.** Probado sobre el showreel de 20 s, la plantilla de 17,5 s, un video de 30 s con dos principales y listas sintéticas, en los dos estilos:

- `check-audio`: PASA en todos los casos, con desfase de 0 ms en cada principal.
- `medir_pista`: PASA en todos los casos realistas. Da REVISAR solo con principales en los extremos del video, que la guía ya evita.

**Prueba de transferencia.** Otro agente hizo un video de 30 s leyendo solo la skill.

- Tardó unos 26 minutos.
- Encontró 16 problemas de documentación y 2 errores reales:
  - un cuadro vacío cuando un corte caía justo en un cuadro;
  - una portada vacía en el cuadro 0.
- Quedaron corregidos 15. El restante (la máscara circular no cubre las esquinas en el cuadro anterior al corte) es así por diseño, y ahora está explicado en la plantilla.
- `prueba-completa.mjs` ahora detecta los dos errores.

**Pendiente:**

- El juicio de oído del equipo, con la rúbrica de `musica-y-mezcla.md` §6.
- Un video real de 45 a 60 s hecho por alguien del equipo.
