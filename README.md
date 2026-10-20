# Reelsmith

Showreels de proyectos desde un guion. Se escribe un guion de escenas en JSON y Reelsmith entrega un MP4 de 1080p. La música y los efectos los compone por código, a la medida de los cortes, así que los derechos del audio son propios.

```bash
reelsmith nuevo mi-video && cd mi-video     # guion de ejemplo
reelsmith video                             # construir + vista + final → showreel-corporativa.mp4
```

- **Rápido:** un video de 90 s, del pedido al MP4 y con el agente incluido, tarda 4,3 min en 2 vCPU, 1,8 min en un MacBook M5 y 2,0 min en un PC con Windows. Antes eran 50,8 min.
- **Medible:** dos jueces revisan cada video. `check-audio` mide la sincronía en cada corte principal, el loudness y el pico; `medir_pista` compara la música con el perfil de 4 pistas profesionales.
- **Reproducible:** en un mismo equipo con Linux o Windows, el mismo guion da siempre el mismo MP4, byte a byte. Entre sistemas cambia en píxeles sueltos (SSIM 0,998), y en macOS no es idéntico entre corridas.
- **Para agentes:** `AGENTS.md` sirve para Claude Code, Codex, Cursor u otro. El procedimiento completo está en `skills/reelsmith/SKILL.md`.

## Cómo funciona

1. **Guion** (`guion.json`): escenas de un catálogo probado (portada, texto, dato, lista, pasos, montaje, impacto y cierre), una paleta y una duración. `reelsmith construir` lo convierte en HTML y CSS, con cada corte en un cuadro exacto sobre la grilla del tempo.
2. **Vista:** tres cuadros por escena a media resolución, en 1 a 4 s, con caché por escena. Es el punto de control con la persona.
3. **Final:** dos ramas en paralelo.
   - El video se dibuja en Chromium, por escena y con varios navegadores a la vez.
   - La música se compone desde el plan de cortes, se mezcla a −14 LUFS y se mide.
   - Después se unen sin recodificar y pasan por los jueces.

## Instalación

Hace falta Node 22 o más, ffmpeg 6 o más, Python 3.11 o más con `skills/reelsmith/scripts/requirements.txt`, y el `headless_shell` de Chromium.

```bash
git clone <este repo> reelsmith && cd reelsmith
npm link              # deja el comando reelsmith en el PATH (no instala paquetes de npm)
reelsmith doctor      # revisa todo y dice cómo instalar lo que falte
reelsmith prueba      # prueba completa con jueces, unos minutos
```

- **Windows:** en PowerShell, `powershell -ExecutionPolicy Bypass -File bench\medir-windows.ps1 -SoloInstalar`. Instala con winget lo que falte, crea el entorno de Python en `%LOCALAPPDATA%\reelsmith\venv` (los scripts lo encuentran solos), instala el navegador y corre la prueba.
- **macOS y Linux:** `reelsmith doctor` imprime los comandos. El entorno de Python va en `~/.cache/reelsmith/venv`.
- **Sin instalar nada más que Docker:**

  ```bash
  docker build -t reelsmith .          # una vez, desde el repo
  reelsmith --docker video             # cualquier comando, dentro del contenedor, sobre la carpeta actual
  ```

  La imagen trae las mismas versiones que la máquina de prueba: Ubuntu 24.04, Node 22, ffmpeg 6.1, Python 3.12 y Chromium 1194. Sin `npm link`, el equivalente es `docker run --rm -v "$PWD:/trabajo" reelsmith video`.

## Comandos

| Comando | Qué hace |
|---|---|
| `reelsmith doctor` | Revisa Node, ffmpeg, Python con sus paquetes y el navegador |
| `reelsmith nuevo <carpeta>` | Carpeta de proyecto con un guion de ejemplo |
| `reelsmith video [guion.json]` | Construir, vista y final de una vez |
| `reelsmith construir [guion.json]` | Guion → `escena.html`, plan de cortes y storyboard |
| `reelsmith vista [--escena e3,e5]` | Cuadros clave a media resolución (`vista.png`) |
| `reelsmith final --estilo corporativa` | Video, música, mezcla y jueces → `showreel-corporativa.mp4`. También `--estilo trailer`, `--sin-musica`, `--nombre` y `--codificador h264_nvenc` |
| `reelsmith tiempos` | Desglose de tiempos de la corrida |
| `reelsmith prueba [carpeta]` | Prueba completa del pipeline, con jueces |
| `reelsmith medir` | Mide este computador; ver `bench/RENDIMIENTO.md` |
| `reelsmith --docker <comando>` | El mismo comando dentro del contenedor |

## Rendimiento

Mediana de 3 corridas de agente con el mismo brief de 90 s. Detalle, método y mediciones en `bench/RENDIMIENTO.md`.

| | Máquina de prueba (2 vCPU) | MacBook M5 | PC con Windows (16 hilos) |
|---|---|---|---|
| Del pedido al MP4, agente incluido | 4,3 min (antes 50,8) | 1,8 min | 2,0 min |
| Solo la máquina | 183 s | 39 s | 47 s |
| Costo del modelo por video | USD 0,52 (antes 8,96) | igual | igual |

La GPU ahorra poco (entre 0 y 18 % del render), así que el codificador por defecto sigue siendo libx264.

## Estructura

Ver el mapa en `AGENTS.md`. Los cambios por versión están en `CHANGELOG.md`.

## Licencias

- **Código, música y efectos generados:** propios.
- **Fuentes Quicksand e Inter:** SIL Open Font License 1.1, descargadas de @fontsource-variable 5.3.0. Las licencias están en `skills/reelsmith/assets/plantilla/fuentes/`.
- **Medios de terceros:** ninguno. `perfil-profesional.json` tiene solo cifras medidas sobre pistas de Mixkit, sin audio.
