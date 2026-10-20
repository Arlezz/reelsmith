# Construcción en HTML y CSS

El video es una página HTML de 1920 × 1080 donde todo el movimiento es CSS. `render-nativo.mjs` la recorre cuadro a cuadro y la convierte en MP4. Esta guía cubre el contrato que la página debe cumplir, la plantilla, las técnicas y las trampas conocidas.

**Cuándo se usa:** la vía normal es el guion con el catálogo (`catalogo.md`), que ya cumple todo esto. Esta guía sirve para una escena `libre` dentro del guion o para un video entero fuera del catálogo (la plantilla), que tarda bastante más.

## 1. Contrato de la página

El render solo funciona si la página cumple esto. Cada punto existe porque su ausencia rompió un render.

| Regla | Por qué |
|---|---|
| `<html data-duracion="17.5">` y un `#raiz` de 1920 × 1080 con `overflow: hidden` | El render lee la duración de ahí y captura ese tamaño |
| Todo el movimiento con `@keyframes` y `animation` | El render pausa las animaciones y fija su `currentTime`. Una `transition` no se puede posicionar |
| Tiempos absolutos: cada animación arranca en su `animation-delay`, medido desde 0 s | Un solo reloj posiciona todo. No encadenes con eventos (`animationend`) |
| Sin JavaScript en la página | Lo que se calcula (letras, partículas, resortes) se resuelve al construir, en `construir.mjs` |
| Fuentes locales con `@font-face` y `font-display: block`, en `fuentes/` | Una fuente remota puede no cargar y el texto cambia de ancho entre cuadros |
| Caracteres que la fuente trae | Los `.woff2` incluidos son el subconjunto latino: Latin-1 (á é í ó ú ñ ü ¿ ¡ « » °), comillas y guiones tipográficos, €, ™, ↑, ↓ y el signo menos (−). No traen → ni otros símbolos: el navegador los toma de otra fuente. Dibújalos en SVG |
| Imágenes locales (`img/`), en PNG, JPG o SVG | El render espera a que se decodifiquen; un recurso que no carga detiene el render con error |
| Nada que dependa de `:hover`, `:focus` o del tamaño de la ventana | No hay cursor real ni ventana variable |

`render-nativo.mjs` verifica lo verificable: que haya animaciones, que no fallen recursos, que no aparezcan animaciones nuevas durante el render, y qué fuentes cargaron. Revisa su última línea.

## 2. La plantilla

`assets/plantilla/` es un video completo de 17,5 s con la paleta CENIA oscura. Sirve de punto de partida y de ejemplo de cada técnica:

- **5 escenas.** Apertura con título por letras, pasos con chips, montaje de palabras, caída con chispas y logo final.
- **3 transiciones.** Cortina, máscara circular y fuga de cámara.
- **7 puntos de golpe**, sobre una grilla de 128 bpm.

```
proyecto/
  construir.mjs      ← lo que editas: guion, escenas, CSS
  utilidades.mjs     ← copia de scripts/utilidades.mjs (no se edita)
  fuentes/           ← Quicksand e Inter (licencia OFL, se pueden distribuir)
  escena.html        ← generado: no se edita a mano
  plan_cortes.json   ← generado: los puntos de golpe con su peso
```

Para un video nuevo:

1. `cp -r <skill>/assets/plantilla proyecto && cp <skill>/scripts/utilidades.mjs proyecto/`
2. Reescribe el guion (`T`, `DURACION`, `LOGO_QUIETO`), las escenas y el plan.
3. `node construir.mjs`

Mantén el patrón: **un solo objeto `T` con los instantes de cada corte**. El CSS y el plan se escriben desde ese mismo objeto, así nunca divergen.

## 3. `utilidades.mjs`

| Función | Para qué |
|---|---|
| `grilla(bpm, compás, tiempo)` | Instante de un tiempo musical, ya redondeado al cuadro (30 fps). `grilla(128, 5)` = 9,3667 s |
| `aCuadro(t)` | Redondea al cuadro más cercano |
| `s(t)` | Segundos para CSS, 0,5 ms antes y truncados a 4 decimales: así un corte no sale vacío ni tarde (ver trampas) |
| `ventana(entra, sale)` | `style` de una escena: visible desde el cuadro de `entra` hasta el de `sale` |
| `letras(texto)` / `palabras(texto)` | Spans con `--i` para escalonar con `calc(var(--i) * 0.05s)` |
| `resorte({ zeta, frecuencia })` | Resorte en forma cerrada como easing CSS `linear()`, con su duración de asentamiento |
| `azar(semilla)` | Sorteos reproducibles (partículas, posiciones) |
| `escribirPlan(ruta, cortes, final)` | Escribe `plan_cortes.json` |
| `lectura(texto)` | Regla de lectura: segundos que el texto debe quedar quieto (una cifra con su unidad cuenta como una palabra) |

## 4. Técnicas

**Escenas.** Cada `<section class="escena">` lleva `style="${ventana(entra, sale)}"`. La plantilla define `mostrar` y `ocultar` con `steps(1, jump-start)`: la escena es visible exactamente desde el cuadro del corte. Un corte duro es simplemente que una ventana termina donde empieza la siguiente.

**Resortes.** El movimiento de la dirección (sobrepaso mínimo) se escribe como resorte:

```js
const suave = resorte({ zeta: 0.85, frecuencia: 1.8 });   // { easing: "linear(0, …, 1)", duracion: 0.7 }
// CSS: animation: aterrizar ${s(suave.duracion)} var(--suave) ${s(t)} both;
```

- `zeta` entre 0,75 y 0,9 da un aterrizaje con sobrepaso mínimo.
- `zeta` 0,5 o 0,6 es un golpe con rebote. Úsalo solo en el corte principal.

**Escalonado.** Usa `letras()` o `palabras()` y `animation-delay: calc(T + var(--i) * 0.05s)`. Entre 40 y 80 ms por letra, y entre 80 y 120 ms por palabra.

**Máscaras de texto.** `.mask { overflow: hidden }` envuelve cada palabra, y la palabra entra con `translateY(110%) → none`. El texto sube desde una línea invisible.

**Cortinas y barridos.** Un `div` a pantalla completa anima `clip-path: inset(...)` con keyframes intermedios: cubre todo justo en el corte y descubre después. La escena siguiente aparece bajo la cortina en el cuadro del corte. Siempre revela un objeto que cruza, nunca un fundido.

**Máscara circular.** Un círculo crece con `scale()` hasta cubrir la pantalla y se oculta en el corte.

**Cámara.** Un contenedor `.camara` por escena. Combina:

- Empuje lento durante la lectura (`scale(1) → scale(1.04)`).
- Fuga al salir (`scale(2.4)` con opacidad a 0 en 0,35 s).
- Paralaje: capas con distinto desplazamiento.

Dos animaciones sobre `transform` en el mismo elemento: la última de la lista manda mientras está activa. Por eso la fuga va con `forwards` y sin `both`.

**3D.** `perspective` en el padre, `transform-style: preserve-3d` en la cámara y `translate3d`/`rotateY` en las piezas. El showreel de prueba de 20 s lo usa para la arquitectura.

**Partículas.** Se sortean con `azar(semilla)` en `construir.mjs`: posición, destino, tamaño y duración en variables CSS. Una sola `@keyframes` las mueve a todas. Más de unas 800 animaciones encarecen el render (20 s con 825 animaciones tardaron 80 s).

**Trazos.** En los `path` de SVG, `stroke-dasharray` igual al largo y `stroke-dashoffset` del largo a 0. Los atributos SVG no aceptan `var()`: usa `style="stroke: var(--main)"`.

**Contadores.** Un número que cuenta se anima con una propiedad registrada (probado en el render):

```css
@property --n { syntax: "<integer>"; inherits: false; initial-value: 0; }
.num { counter-reset: n var(--n); animation: cuenta 1.5s linear 0.2s both; }
.num::after { content: counter(n); }
@keyframes cuenta { from { --n: 0; } to { --n: 128; } }
```

**Recorrido por un trazado.** `offset-path: path("M …")` y `offset-distance: 0% → 100%`.

## 5. Trampas conocidas

| Trampa | Síntoma | Solución |
|---|---|---|
| Delay justo en el cuadro del corte (`7.5s` en el cuadro 225) | Un cuadro vacío: la escena que sale ya se ocultó y la que entra todavía no aparece. `medir_cortes.py` no lo detecta | Escribe todos los tiempos con `s()`, que deja el delay 0,5 ms antes |
| Delay redondeado hacia arriba (`9.3667s` para el cuadro 281 = 9,36666… s) | El corte sale un cuadro tarde (`deriva_ms: 33.3` en `cortes.json`) | Igual: `s()` |
| Dos animaciones apiladas sobre el mismo elemento, y la de arriba omite una propiedad en un extremo (`to { opacity: 0.7 }` sin el fondo) | La propiedad omitida conserva el valor de la animación de abajo | Escribe todas las propiedades animadas en los dos extremos |
| `animation-fill-mode: both` en algo que empieza visible (un destello con `from { opacity: 0.35 }`) | Un velo cubre la escena desde 0 s | `forwards` cuando el estado `from` no debe verse antes del delay |
| Cortes fuera de la grilla de cuadros | Deriva de medio cuadro, acentos que no calzan | Tiempos con `grilla()` o `aCuadro()` |
| `will-change` en algo que la cámara escala | Texto borroso | No lo uses |
| Lo que debe verse en el cuadro 0 entra con `opacity: 0` desde 0 s | Primer cuadro vacío: la portada no se ve | Empieza su entrada antes de 0 s con un delay negativo (la plantilla usa `calc(-0.3s + var(--i) * 0.04s)`), o déjalo visible desde el inicio |
| Una salida suave (fundido, fuga con opacidad) como cambio de sección | `medir_cortes.py` la deja `detectado: false` | No es un error: se usa el instante del plan, que ya está en el cuadro exacto. Si quieres que se mida, dale un cuadro duro (destello o cambio de fondo) |
| Una transición CSS (`transition:`) | No se mueve en el render | Conviértela en `@keyframes` |
| `animation-timing-function: var(--curva)` dentro de un `@keyframes` | Se ignora y la animación usa la curva de afuera (medido: un `steps()` por `var()` salió lineal) | Dentro de `@keyframes`, escribe la curva literal |
| Un hijo con `visibility: visible` (por ejemplo, con la animación `mostrar`) dentro de una escena | Se sigue viendo cuando la escena ya se ocultó: `visibility` de un hijo gana sobre la del padre | Que el hijo también se oculte en el `--sale` de su escena. En el catálogo, además, el render oculta con `display: none` todo lo que no es la escena que dibuja |
| Fuente que no cargó | El render dice `fuentes: del sistema` | Revisa la ruta de `@font-face` |
| Texto que se mueve mientras se lee | Ilegible | El movimiento va alrededor del texto y en las transiciones (regla de lectura) |

## 6. Render y revisión (vía manual)

```bash
node <skill>/scripts/render-nativo.mjs escena.html --vista vista.png      # un cuadro por segundo a media resolución, en segundos
node <skill>/scripts/render-nativo.mjs escena.html video-mudo.mp4 --hoja hoja.png
```

- **Revisa con la vista**, no con el render final: la vista dibuja solo los cuadros que pide, a media resolución, y guarda cada uno en la caché.
- **Velocidad del render final** (2 núcleos): de 0,05 a 0,1 s por cuadro con varios trabajadores, según cuánto 3D, desenfoque y SVG haya. Divide el video en partes y las dibuja en paralelo; cada parte queda en `.cache/render/` con una clave que incluye el HTML completo, así que tras un cambio se dibuja todo de nuevo (con el guion del catálogo, solo las escenas que cambian).
- **Determinismo:** en Linux, con `beginFrame`, el MP4 sale idéntico byte a byte en cada ejecución. En macOS cae a capturas comunes y lo avisa.
- **Hoja de contacto:** `hoja.png` muestra un cuadro por segundo (casilla k = segundo k).
- **Cuadros sueltos:** para revisar un corte, extrae el cuadro anterior, el del corte y el siguiente:

  ```bash
  for t in 9.3333 9.3667 9.4; do ffmpeg -v error -y -ss $t -i video-mudo.mp4 -frames:v 1 -vf scale=640:-1 c-$t.png; done
  ```

Después, `medir_cortes.py` confirma que cada corte duro del plan está donde debe (`deriva_ms: 0`):

- Una cortina que cubre la pantalla justo en el corte se registra como `"tipo": "transicion"`, con deriva 0. Es lo esperado.
- Los cambios menores (peso bajo 0,6) solo se emparejan a ±1 cuadro. Si no hay un cambio visual ahí, quedan `detectado: false` con el instante del plan.

Con la plantilla, la música, la mezcla y los jueces se corren a mano, en este orden (`showreel.mjs final` los hace solos solo con el guion del catálogo):

```bash
python3 -I <skill>/scripts/medir_cortes.py video-mudo.mp4 --plan plan_cortes.json --salida cortes.json
python3 <skill>/scripts/componer.py cortes.json --estilo corporativa --salida musica --video video-mudo.mp4
python3 -I <skill>/scripts/planificar_mezcla.py musica/variante.json
node <skill>/scripts/check-audio.mjs musica/musica.mp4 --expect <t del principal> --marker musica/sfx-impacto.wav
python3 -I <skill>/scripts/medir_pista.py musica/composicion.json --wav musica/stems/musica.wav --png medicion.png
```

En Windows, `python3` no existe: usa el Python del entorno que crea `bench\medir-windows.ps1` (`%LOCALAPPDATA%\video-showreel-nativo\venv\Scripts\python.exe`) o `py -3`, y agrega `-X utf8` (por ejemplo, `py -3 -X utf8 -I <skill>/scripts/medir_cortes.py …`).
