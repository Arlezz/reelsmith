# reelsmith (versión de prueba)

Skill de prueba para hacer showreels de proyectos sin el tipo Motion. Lleva el pipeline que se decidió el 18/10/2026 ("video y música nativos"):

1. El video se describe en un **guion** (`guion.json`) con escenas de un catálogo probado; un comando lo convierte en HTML y CSS.
2. Se revisa con una **vista** rápida: tres cuadros por escena a media resolución, en segundos.
3. `reelsmith.mjs final` lo renderiza a MP4 con Chromium y, en paralelo, le **compone música y efectos por código** a la medida de sus cortes, la mezcla a −14 LUFS y la pasa por los jueces.

No reemplaza a `video-showreel`, que sigue igual. Cuando esta versión se valide con el equipo, se decide si la reemplaza.

## Comandos

```bash
S=skills/reelsmith/scripts
node $S/reelsmith.mjs construir            # guion.json → escena.html, plan_cortes.json, escenas.json, storyboard.md
node $S/reelsmith.mjs vista [--escena e5]  # hoja de cuadros clave (vista.png)
node $S/reelsmith.mjs final --estilo corporativa   # MP4 con música, mezcla y jueces
node $S/reelsmith.mjs tiempos              # desglose de tiempos de la corrida
node $S/prueba-completa.mjs /tmp/prueba   # pipeline completo con jueces (Linux, macOS y Windows)
```

## Qué cambia respecto de `video-showreel`

| | `video-showreel` | `reelsmith` |
|---|---|---|
| Motor de video | Artifact Motion (export desde la interfaz) | HTML y CSS → `render-nativo.mjs` → MP4 |
| Música | Sintetizador de Motion, o pista ajena agregada después | Compuesta por código a la medida de los cortes; derechos 100 % propios |
| Sincronía | Grilla del film | Cortes medidos en el video; acentos en el cuadro exacto |
| Mezcla | La de Motion | ffmpeg: −14 LUFS, pico verdadero bajo −1 dBTP, efectos a 8 dB bajo la música |
| Verificación | Visual | Hoja de contacto, cortes medidos, `check-audio` y `medir_pista` |
| Reproducible | Sí, dentro de Motion | Sí, byte a byte: video, WAV y MP4 final |

Se mantienen las recetas de dirección, las paletas, la regla de lectura, el repertorio de movimiento y el punto de control del storyboard.

## Requisitos

- **Node 22 o más.** El render habla con Chromium por WebSocket, sin paquetes npm.
- **ffmpeg 6 o más.**
- **Python 3.11 o más**, con `scripts/requirements.txt`: numpy, scipy, numba, soundfile, pyloudnorm y matplotlib.
- **`headless_shell` de Chromium.** Viene en el sandbox de Cowork. En otro entorno: `npx -y playwright@1.56.0 install chromium-headless-shell`.

Comprobar: `node skills/reelsmith/scripts/render-nativo.mjs --verificar`, y luego `node skills/reelsmith/scripts/prueba-completa.mjs /tmp/prueba` (unos 4 minutos en 2 núcleos).

**Windows (desde la 0.2.1).** En PowerShell, en esta carpeta: `powershell -ExecutionPolicy Bypass -File bench\medir-windows.ps1 -SoloInstalar`. Instala con winget lo que falte, crea un entorno de Python aislado en `%LOCALAPPDATA%\reelsmith\venv` (los scripts lo encuentran solos), instala el navegador y corre la prueba completa. Sin `-SoloInstalar`, además mide el equipo (ver `bench/RENDIMIENTO.md`).

En macOS, el render cae a capturas comunes: el video se ve igual, pero no es idéntico byte a byte. En Linux y Windows usa `beginFrame`.

## Estructura

```
reelsmith/
  .claude-plugin/plugin.json
  skills/reelsmith/
    SKILL.md                      flujo: contenido → preguntas → guion → vista → final → entrega
    references/
      catalogo.md                 formato del guion, tipos de escena, receta de un showreel (la vía normal)
      direccion.md                recetas, paletas, lectura y capacidad, grilla, repertorio
      construccion-html.md        contrato de la página, plantilla, técnicas CSS, trampas (escena libre y vía manual)
      musica-y-mezcla.md          estilos, composición, mezcla, jueces, rúbrica de oído, licencias
    assets/
      guion-ejemplo.json          guion de 43 s con todos los tipos (lo usa prueba-completa.sh)
      plantilla/                  video manual de ejemplo de 17,5 s (construir.mjs) con Quicksand e Inter (OFL)
    scripts/
      reelsmith.mjs                un comando por fase: construir, vista, final, tiempos
      escenas.mjs                 catálogo: guion → HTML, plan de cortes, manifiesto de escenas con claves de caché
      render-nativo.mjs           HTML → MP4 mudo por segmentos en paralelo, con caché; vista rápida
      tiempos.py                  registro de tiempos de cada corrida y su informe (con ruta crítica)
      utilidades.mjs              grilla, tiempos al cuadro, resortes, letras, plan de cortes
      medir_cortes.py             cortes medidos en el video, cruzados con el plan
      componer.py + sintesis.py   música y efectos por código (corporativa y tráiler)
      planificar_mezcla.py        mezcla y master con ffmpeg (escribe mezcla.sh y corre los mismos comandos, sin bash)
      check-audio.mjs             juez del MP4: pista, sincronía, loudness
      medir_pista.py              juez de la música, contra el perfil de 4 pistas profesionales
      perfil-profesional.json     cifras medidas (no audio) de esas 4 pistas
      prueba-completa.mjs         pipeline completo: plantilla (vía manual) y guion de ejemplo (catálogo); .sh es un atajo
      entorno.mjs                 Python, Node y md5 en Linux, macOS y Windows
  bench/
    benchmark.py                  benchmark fijo (ref20 y ref90), con comparación A/B intercalada
    analizar_transcripcion.py     tiempo del modelo y de herramientas, y tokens, de una corrida de agente
    medir-equipo.mjs              mide un computador: prueba completa, corrida de 90 s y GPU contra CPU (cualquier sistema)
    medir-windows.ps1             instala lo que falte en Windows y corre medir-equipo.mjs (o solo instala)
    medir-mac-completo.sh, medir-gpu-mac.sh   las mediciones del MacBook M5
    brief-90s.md, prompt-corrida.md   insumos fijos para medir corridas de agente de punta a punta
    referencias/                  los dos videos de referencia
    resultados/                   resultados fechados (línea base incluida)
```

## Rendimiento (versión 0.2.0, 19/10/2026)

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

## Versión 0.2.1 (19/10/2026): Windows

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

## Estado de la prueba (18/10/2026)

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

## Licencias

- **Código, música y efectos generados:** propios.
- **Fuentes Quicksand e Inter:** SIL Open Font License 1.1 (licencias en `assets/plantilla/fuentes/`), descargadas de @fontsource-variable 5.3.0.
- **Medios de terceros:** la skill no incluye ninguno. `perfil-profesional.json` tiene solo cifras medidas sobre pistas de Mixkit.
