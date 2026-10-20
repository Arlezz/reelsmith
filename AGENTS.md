# Reelsmith: instrucciones para agentes

Reelsmith hace showreels de proyectos. Se escribe un guion de escenas en JSON y sale un MP4 con música y efectos compuestos por código, sincronizados con los cortes. Todo es reproducible, y los derechos del audio son propios.

Este archivo vale para cualquier agente: Claude Code, Codex, Cursor u otro. El procedimiento completo está en `skills/reelsmith/SKILL.md`. Este archivo lo resume y agrega lo propio del repo.

## Preparar el equipo (una vez)

```bash
npm link                # deja el comando reelsmith en el PATH (sin paquetes de npm)
reelsmith doctor        # revisa Node 22, ffmpeg, Python 3.11+ con sus paquetes y el navegador
```

- Si `doctor` marca algo como FALTA, imprime cómo instalarlo según el sistema. En Windows hay un script que instala todo: `bench\medir-windows.ps1 -SoloInstalar`.
- Sin `npm link`, usa `node skills/reelsmith/scripts/reelsmith.mjs` en lugar de `reelsmith`. Si `doctor` avisa que el `reelsmith` del PATH es de otra copia del repo, corre `npm link` en esta.
- Sin instalar nada más que Docker: `docker build -t reelsmith .` una vez, y luego `reelsmith --docker <comando>`.

## Hacer un video

1. **Lo primero, antes de leer nada más:** `reelsmith nuevo proyecto && cd proyecto && reelsmith marca pedido`. Así el reloj de la corrida empieza con el pedido y `tiempos.jsonl` queda dentro del proyecto. Todos los comandos siguientes corren en `proyecto/`.
2. **Lee `skills/reelsmith/SKILL.md` completo.** Tiene el flujo (contenido → preguntas → guion → vista → final → entrega), las reglas de lectura y la meta de tiempo. Su paso «pedido» ya lo hiciste en el punto 1. Los tipos de escena y las paletas están en `skills/reelsmith/references/catalogo.md`.
3. **Escribe `guion.json`** (reemplaza el de ejemplo) con escenas del catálogo y `"duracion"` si hay una duración pedida.
4. **Construye y revisa:** `reelsmith construir`, luego `reelsmith vista`. Muestra `vista.png` a la persona: es el punto de control. Corrige el guion y repite la vista hasta que la apruebe.
5. **Final:** `reelsmith final --estilo corporativa --nombre <nombre-claro>` (o `--estilo trailer`). El MP4 queda como `<nombre-claro>-corporativa.mp4`.
6. **Entrega:** el MP4, el resumen de `final.json` y la tabla de `reelsmith tiempos`.

Marca el inicio de cada etapa tuya con `reelsmith marca <etapa>`: `pedido`, `contenido`, `preguntas`, `guion`, `vista`, `correccion`, `final`, `entrega` y `fin`. Las marcas alimentan el registro de tiempos.

## Reglas

- **Escribe solo `guion.json`.** No edites `escena.html` ni el plan de cortes: se regeneran. Para lo que el catálogo no cubre existe la escena `libre` (ver SKILL.md).
- **Revisa con la vista, nunca con el render final.** Corre `final` una vez, salvo que un juez falle.
- **No entregues si un juez falla.** `check-audio` tiene que dar PASA en cada corte principal y `medir_pista` tiene que dar PASA. Si falla, lee `reelsmith.log` y corrige el guion.
- **Sin medios de terceros.** La música y los efectos los compone la skill: no descargues pistas, imágenes ni fuentes.
- **Textos para la persona en español neutro**, sin voseo.

## Cambiar el código

- **Dónde está:** los scripts están en `skills/reelsmith/scripts/`. Node 22 sin paquetes de npm; Python 3.11 o más con `requirements.txt`.
- **Prueba obligatoria:** después de tocar un script, `reelsmith prueba <carpeta>` tiene que pasar. En Linux, `node bench/comparar-md5.mjs <carpeta>` compara los md5 con `bench/referencia-md5.json`.
  - Si un cambio no debía cambiar el resultado, los md5 tienen que seguir iguales.
  - Si lo cambia a propósito, actualiza la referencia y explica el cambio en el commit.
- **Python:** `ruff check --fix . && ruff format .`, con la configuración de `pyproject.toml` (estándar de CENIA).
- **Rendimiento:** si un cambio puede mover los tiempos, mide antes y después con `reelsmith medir` o `bench/benchmark.py` (A/B intercalado), y anótalo en `bench/RENDIMIENTO.md`.
- **Multiplataforma:** todo tiene que correr en Linux, macOS y Windows.
  - Nada de bash en el pipeline.
  - Rutas con `path.join`.
  - Python siempre con `encoding="utf-8"`.
  - Nunca una ruta absoluta dentro de un filtro de ffmpeg.
  - Los problemas ya encontrados están en `bench/RENDIMIENTO.md` §9b y §9c.
- **Versión:** la de `package.json`, `.claude-plugin/plugin.json` y `pyproject.toml` cambia junta.
- **Commits:** mensajes en español.

## Mapa del repo

```
AGENTS.md, CLAUDE.md          instrucciones para agentes (CLAUDE.md importa este archivo)
README.md                     para personas: qué hace, instalación, comandos
package.json                  el comando reelsmith (npm link)
Dockerfile                    imagen con todo instalado y versiones fijas
.claude-plugin/plugin.json    para instalarlo como plugin de Claude
skills/reelsmith/
  SKILL.md                    el procedimiento completo
  references/                 catálogo, dirección, construcción HTML, música y mezcla
  assets/                     guion de ejemplo y plantilla de la vía manual
  scripts/                    reelsmith.mjs (comando), render, catálogo, música, mezcla, jueces
bench/                        benchmark, mediciones por equipo, referencia de md5 y resultados fechados
.github/workflows/ci.yml      prueba completa nativa y en la imagen, en cada push
```
