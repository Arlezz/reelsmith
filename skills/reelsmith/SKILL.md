---
name: reelsmith
description: "Reelsmith: crea un showreel de un proyecto desde un guion de escenas, lo renderiza a MP4 y le compone música y efectos por código a la medida de sus cortes (derechos 100 % propios). Úsala cuando pidan Reelsmith, un video renderizado a MP4 fuera de Motion o un video con música propia."
---

# Reelsmith

Showreels de proyectos sin el tipo Motion (hasta la 0.2.1 se llamaba `video-showreel-nativo`; `video-showreel` es otra skill y sigue igual):

- El video se describe en un **guion** (`guion.json`) con escenas de un catálogo probado. Un comando lo convierte en HTML y CSS.
- Se renderiza a MP4 con Chromium y se le **compone música y efectos por código** a la medida de sus cortes.
- Se mezcla y se mide con dos jueces.

Todo es reproducible y los derechos del audio son 100 % propios. Si el usuario pide el artifact Motion, usa `video-showreel`.

**Flujo:** contenido → preguntas → guion → vista (punto de control) → final → entrega.

**Meta de tiempo:** un video de 90 s en 10 minutos o menos, desde el pedido hasta el MP4. Lo que más tiempo se lleva es escribir y revisar, no la máquina. Por eso:

- Escribe el guion de una vez. No escribas CSS ni HTML.
- Revisa con la vista (1 s), nunca con el render final.
- Corre `final` una sola vez, salvo que un juez falle.

`$SKILL` es la carpeta de este archivo; `proyecto/` es la carpeta de trabajo del video. Corre todos los comandos desde `proyecto/`, y en cada uno define `S=$SKILL/scripts`.

## Registro de tiempos (en cada corrida)

Cada corrida deja su desglose en `proyecto/tiempos.jsonl`. Los scripts de máquina se registran solos. Tú marcas el inicio de cada etapa tuya:

```bash
python3 $S/tiempos.py marca <etapa>
```

En Windows, donde `python3` no existe, usa `node $S/reelsmith.mjs marca <etapa>`: hace lo mismo.

| Marca | Cuándo |
|---|---|
| `pedido` | Lo primero: `mkdir -p proyecto && cd proyecto && python3 $S/tiempos.py marca pedido` |
| `contenido` | Al empezar el paso 1 |
| `preguntas` | Al empezar el paso 2 |
| `guion` | Al empezar el paso 3 |
| `vista` | Al mirar la hoja de la vista |
| `correccion` | Cada vez que vuelvas a editar el guion por algo que viste |
| `final` | Al correr el paso 5 |
| `entrega` | Al empezar el paso 6 |
| `fin` | Al terminar, justo antes del mensaje final |

`node $S/reelsmith.mjs tiempos` imprime la tabla: etapa, segundos, porcentaje y las tres etapas que más pesan. Va en la entrega.

## 0. Preparación (una vez por entorno)

Requisitos: node 22 o más, ffmpeg 6 o más y python 3.11 o más. Funciona en Linux, macOS y Windows.

```bash
pip install -r $S/requirements.txt --break-system-packages
node $S/render-nativo.mjs --verificar      # navegador, node, ffmpeg y modo de render
```

- **Windows:** en PowerShell, desde la carpeta del plugin, `powershell -ExecutionPolicy Bypass -File bench\medir-windows.ps1 -SoloInstalar` instala lo que falte (Node, ffmpeg, Python con sus paquetes en un entorno aislado y el navegador) y corre la prueba completa. Los scripts encuentran solos ese entorno de Python. Si Chromium no responde a `beginFrame`, `RENDER_MODO=capturas` cambia a capturas comunes.

- **Navegador:** el render busca el `headless_shell` de Chromium en `CHROME_PATH`, `PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright` y `/opt/pw-browsers`. Si no lo encuentra: `npx -y playwright@1.56.0 install chromium-headless-shell`.
- **Después de tocar un script:** `node $S/prueba-completa.mjs /tmp/prueba-skill` corre todo el pipeline y falla si algún paso o juez falla. En Linux y macOS, `bash $S/prueba-completa.sh` hace lo mismo.

## 1. Contenido

Toma el contenido de lo que haya:

- **Descripción del usuario:** usa solo lo que dio. No agregues funcionalidades ni cifras.
- **Repositorio:** README, documentación, manifiestos y `git log`.
- **Documento o recap** (por ejemplo, de `recap-de-proyecto`): es la fuente principal. Lo marcado [Inferido] o [Por confirmar] no se presenta como hecho.

Todo dato en pantalla debe ser real.

## 2. Preguntas (una sola tanda)

Usa `AskUserQuestion` solo con lo que el pedido no responda. Lo demás toma su valor por defecto y se informa al final.

1. **Música:** corporativa con energía (por defecto), tráiler tecnológico o sin música.
2. **Paleta:** `cenia-oscura` (por defecto), otra del catálogo o la del usuario.
3. **Duración:** por defecto, de 30 a 60 s. El armado calcula cuánto dura cada escena con la regla de lectura.

## 3. Guion

Lee `references/catalogo.md` y escribe `proyecto/guion.json`: una escena del catálogo por idea, con sus textos, y la duración pedida en `"duracion"`. El ejemplo de 90 s del catálogo es la receta. Luego:

```bash
node $S/reelsmith.mjs construir
```

Escribe `escena.html`, `plan_cortes.json`, `escenas.json` y `storyboard.md`, y muestra el storyboard con la duración de cada escena.

- Si sale una línea `Avisos:`, corrígela en el guion antes de seguir.
- Con `"duracion"`, el armado reparte lo que falta entre las escenas: no ajustes compases a mano. Si avisa que los textos necesitan más tiempo, quita una escena o acorta textos.

## 4. Vista y punto de control

```bash
node $S/reelsmith.mjs vista
```

Escribe `vista.png` (o `vista-1.png`, `vista-2.png`…): tres cuadros por escena (el corte, el medio y el último) en 1 a 4 s. **Mira cada hoja** y revisa:

- textos cortados, encimados o fuera del cuadro;
- elementos que se quedan de una escena en otra;
- contraste suficiente;
- que el orden y las cifras sean los del contenido.

El último cuadro de una escena puede mostrar la transición de la siguiente (cortina, máscara, zoom de fuga): es lo esperado.

Para corregir, edita `guion.json` y vuelve a ver solo esa escena (menos de 1 s, el resto sale de la caché):

```bash
node $S/reelsmith.mjs construir && node $S/reelsmith.mjs vista --escena e5
```

**Punto de control:** muestra al usuario el storyboard y las hojas de la vista, y espera su confirmación antes del paso 5.

## 5. Final

```bash
node $S/reelsmith.mjs final --estilo corporativa      # o --estilo trailer; --sin-musica entrega solo el video
```

Hace todo en un comando, en paralelo donde se puede:

- render del video (una escena por segmento, varios a la vez);
- música compuesta desde el plan de cortes, mezcla a −14 LUFS y su juez (`medir_pista`);
- unión del audio sin recodificar;
- jueces sobre el MP4: `check-audio` en cada principal y `medir_cortes`.

Escribe `showreel-<estilo>.mp4` y `final.json` con el resultado. Si algún corte medido no coincide con el plan, recompone la música con los cortes medidos (lo avisa).

- **check-audio** debe dar `PASA` en cada principal. Si da `FALLA`, no entregues: lee `reelsmith.log` y corrige.
- **medir_pista** da `PASA` o `REVISAR`. Con `REVISAR`, aplica la tabla de `musica-y-mezcla.md` §4.

Tras una corrección, `final` vuelve a dibujar solo las escenas que cambiaron. Si los cortes no se movieron, la música sale de la caché.

## 6. Entrega

1. Entrega el MP4 con un nombre claro (por ejemplo, `showreel-<proyecto>-<estilo>.mp4`).
2. Si el usuario lo quiere reproducible, entrega también `guion.json`: con este skill rehace el mismo video byte a byte.
3. En pocas líneas, informa:
   - duración final y tiempo que tomó, con la tabla de `node $S/reelsmith.mjs tiempos`;
   - decisiones tomadas por defecto;
   - resultado de los jueces y tempo de la música;
   - que viste cuadros, no el video en movimiento;
   - que el juicio de oído es del usuario, con la rúbrica de `musica-y-mezcla.md` §6.

## Cuando el catálogo no alcanza

1. **Una escena distinta:** usa una escena `libre` dentro del guion (HTML y CSS propios, tiempos relativos). Ver `catalogo.md` y las técnicas de `construccion-html.md`.
2. **Un video entero fuera del catálogo** (por ejemplo, un morph de UI): la vía manual con la plantilla, descrita en `construccion-html.md` §2 y §6, con las recetas de `direccion.md`. Tarda bastante más: avísalo al usuario.
