# Dirección: recetas, paleta, lectura y movimiento

Adaptado de `video-showreel`: las mismas recetas y reglas, ahora con HTML y CSS en lugar de Motion. La técnica de cada movimiento está en `construccion-html.md`.

## 1. Recetas de dirección

Cada receta trae su dirección, lo prohibido y su estructura. Lo prohibido es tan importante como la dirección: escríbelo en el brief.

### A. Morph de UI: un solo objeto que nunca se corta

- **Cuándo:** librerías de componentes, design systems, producto con UI.
- **Insumos:** de 8 a 12 estados de UI reales. Por ejemplo: botón → cargando → check → toast → menú → toggle → tabs → tabla → gráfico → paleta de comandos → vuelta al botón.
- **Dirección:**
  - Un único elemento que cambia de tamaño, radio y color. Su contenido se reemplaza con un desenfoque corto.
  - Un cursor dibujado (un `div` con forma de flecha) provoca cada cambio con un clic visible, con su anillo.
  - Lienzo neutro, componentes en los colores de la paleta y una sola tipografía de UI.
  - Resortes en todo, con sobrepaso mínimo. La cámara se acerca para que cada estado llene el cuadro.
  - El último cuadro es igual al primero: el video hace loop.
- **En CSS:** el objeto es un solo `div` con una `@keyframes` por propiedad (ancho, alto, radio, color) y un keyframe por estado. Escribe los keyframes desde el guion en `construir.mjs`. Los estados internos son capas que se cruzan con `opacity` y `filter: blur()`.
- **Prohibido:** easing con rebote exagerado, explosiones de partículas, brillos, degradados en la UI, iconos con trazos distintos, tiempo muerto, cualquier cosa que parezca plantilla.
- **Estructura:** alrededor de 120 bpm (estilo corporativo); algo pasa en cada tiempo. De 6 a 8 compases para 8 a 12 estados.
- **Lectura:** las etiquetas dentro de los componentes quedan exentas de la regla de lectura, pero deben leerse en el cuadro (28 px efectivos o más tras el zoom).

### B. Arquitectura que se arma: piezas que encajan

- **Cuándo:** sistemas, paquetes, plataformas, monorepos.
- **Dirección:** bloques que aterrizan sobre una cuadrícula, un núcleo que se abre en sus partes, conexiones que se dibujan y paquetes que viajan por ellas. Cámara continua, con perspectiva 3D, que viaja entre escenas.
- **Prohibido:** diapositivas con fundido, cajas que aparecen sin llegar desde ningún lado, todos los elementos moviéndose igual.
- **Estructura:** problema → solución → arquitectura → funcionalidades → hitos → cierre. Un momento estrella cada 15 a 20 s.

### C. Tipografía cinética

- **Cuándo:** lanzamientos, mensajes, manifiestos, resúmenes cortos.
- **Dirección:** las palabras son el objeto. Entran por golpes, se parten para dejar pasar la siguiente, y una palabra clave aterriza grande y se queda. Pocas palabras por cuadro.
- **Prohibido:** párrafos, más de una dirección de entrada por línea, efectos de texto de plantilla (onda, neón, glitch).
- **Estructura:** una frase por cada 1 o 2 compases; la regla de lectura manda.

### D. Datos que se dibujan

- **Cuándo:** métricas, resultados, releases, líneas de tiempo.
- **Dirección:** ejes y líneas que se trazan solos, barras que crecen, números que cuentan, una anotación a mano que señala el dato clave.
- **Prohibido:** gráficos 3D, leyendas que nadie alcanza a leer, cifras inventadas.
- **Estructura:** un dato por escena, con su fuente en un chip. La fuente es de dónde salió el dato ("README", "medido en la prueba del 18/10"). Si el usuario no la dio y no se puede saber, omite el chip: nunca inventes una fuente.
- **Lectura:** los rótulos de ejes y las etiquetas de datos quedan exentos, como en la receta A. La frase que explica el dato sigue la regla.

### E. Recorrido de producto (walkthrough)

- **Cuándo:** tutoriales y demos de uso.
- **Dirección:**
  - La UI se recrea desde el código real.
  - La cámara se acerca de 1,6 a 2,4× sobre cada acción.
  - Un cursor escribe, hace clic y arrastra, y el resultado se construye en pantalla.
  - Ritmo más pausado.
- **Prohibido:** mostrar la ventana entera más de unos 1,2 s, saltos sin causa visible.
- **Música:** la corporativa a 118 bpm, o sin música si el tutorial tiene locución (esta versión de prueba no hace ducking de voz).

## 2. Paleta

Cuatro colores por rol:

- `ground`: el fondo.
- `main`: formas y titulares grandes.
- `ink`: el texto.
- `accent`: los toques.

Van como variables en `:root` (`--ground`, `--main`, `--ink`, `--accent`).

- `ink` sobre `ground` debe tener contraste de 4,5:1 o más.
- `main` sobre `ground`, 3:1 o más, y solo en formas o texto grande. Si no se cumple, ajusta la luminosidad del color más cercano y dilo.
- Nunca solo negro, rojo y blanco, salvo que el usuario lo pida.

### Predefinidas

| Nombre | ground | main | ink | accent | Nota |
|---|---|---|---|---|---|
| CENIA oscura | `#090E50` | `#E72887` | `#FFFFFF` | `#FAD4E7` | De cenia.cl; accent derivado del rosa. Tipografía: Quicksand (incluida en la plantilla) |
| CENIA clara | `#FFFFFF` | `#090E50` | `#090E50` | `#E72887` | De cenia.cl |
| Gris cálido UI | `#EEECE8` | `#111111` | `#111111` | `#E72887` | Para morph de UI; accent opcional. Tipografía: Inter (incluida) |
| Petróleo | `#0C3B4A` | `#F2B33D` | `#F3F6F8` | `#7FD1C7` | |
| Papel técnico | `#F6F4EF` | `#1F6F78` | `#1B1D24` | `#E0A43A` | |
| Grafito y lima | `#1B1E23` | `#B8E04A` | `#F2F3F5` | `#6EC1FF` | |

Contraste medido en CENIA oscura: blanco sobre navy, 17,6:1; magenta sobre navy, 4,2:1 (solo formas y titulares).

**Del usuario.** Acepta hex, rgb u oklch, y convierte todo a `#rrggbb`. Si da menos de cuatro colores, completa con tintes y sombras de los suyos y con neutros.

**Extraída de una web.** Abre la página con el navegador disponible y lee las variables CSS de color, los colores más usados y las tipografías:

```js
(() => {
  const count = {}, fonts = {}, vars = {};
  const add = (k, w) => { if (!/rgba\(0, 0, 0, 0\)|transparent/.test(k)) count[k] = (count[k] || 0) + w; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el);
    add('bg ' + s.backgroundColor, Math.min(r.width * r.height, 2e6) / 1000);
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) { add('text ' + s.color, 1); fonts[s.fontFamily] = (fonts[s.fontFamily] || 0) + 1; }
  }
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.selectorText === ':root') for (const p of r.style) if (p.startsWith('--')) vars[p] = r.style.getPropertyValue(p).trim(); } catch (e) {} }
  return { top: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 20), fonts, vars };
})()
```

Prioriza las variables con nombre de marca (por ejemplo, `--pink-cenia`) por sobre los presets del CMS.

**Extraída de una imagen.** Cuantiza la imagen y ordena por frecuencia:

```python
from PIL import Image
im = Image.open(ruta).convert('RGB'); im.thumbnail((300, 300))
q = im.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette()[:24]; cuentas = sorted(q.getcolors(), reverse=True)
print(['#%02X%02X%02X (%d)' % (*pal[i*3:i*3+3], n) for n, i in cuentas])
```

En los dos casos, **muestra la paleta propuesta con sus roles antes de usarla**.

**Tipografía de la marca.** Si no es Quicksand ni Inter, usa la de la marca solo si su licencia permite incluir el archivo (por ejemplo, OFL de Google Fonts). Copia el `.woff2` a `fuentes/` junto con su licencia. Si no se puede, usa Inter y dilo.

## 3. Regla de lectura (textos explicativos)

- Cada texto entra en unos 0,6 s y luego queda **quieto** `max(3, 1,5 + 0,35 × palabras)` s (`lectura()` en `utilidades.mjs`).
- Calcula la duración de cada escena con esa regla antes del storyboard. Si no cabe, acorta textos: nunca recortes escenas ni aceleres.
- El movimiento ocurre **alrededor** del texto y en las transiciones, nunca sobre un texto que se está leyendo. Un foco a la vez; lo anterior se atenúa (no bajo 0,7 de opacidad).
- Los rótulos de montaje (3 palabras o menos, uno por golpe) quedan exentos, pero al final de un montaje va una tarjeta que reúne todo y queda quieta el tiempo de leerla.
- Una cifra con su unidad cuenta como una palabra ("20 s", "−14 LUFS"); `lectura()` ya lo hace.

**Capacidad.** Un texto explicativo de unas 6 palabras ocupa unos 4,6 s: 0,6 s de entrada, 3,6 s quieto y 0,4 s de transición. Con una apertura de 3 s y un logo de 3,5 s:

| Duración | Textos explicativos de ~6 palabras que caben |
|---|---|
| 20 s | 2 |
| 30 s | 5 |
| 45 s | 8 |
| 60 s | 11 |

Si el contenido pedido no cabe en la duración pedida, no lo resuelvas en silencio. Vuelve al punto de control con dos opciones: alargar el video o quitar textos (di cuáles). Juntar dos datos en un montaje de rótulos cortos es una tercera opción, si son cifras.

## 4. Estructura sobre la grilla

La música se compone a la medida del video, pero el video se planifica sobre la grilla del estilo. Así el compositor encuentra un tempo que deja cada corte a un cuadro o menos de la grilla (33 ms o menos; 25 ms en la plantilla). Con cortes puestos sin grilla, el showreel de prueba llegó a 37 ms, y desde 45 ms el acento se siente corrido.

| | Corporativa | Tráiler |
|---|---|---|
| Tempo del guion | 124 a 128 bpm | 140 a 144 bpm |
| Compás (4 tiempos) | 1,875 s a 128 bpm | 1,667 s a 144 bpm |

- **Apertura fuerte** (3 s o menos): la portada ya está en el cuadro 0, con un primer movimiento llamativo.
- **Cambios de sección** (peso 0,6) cada 2 a 4 compases, en un inicio de compás: cortinas, máscaras, fugas de cámara.
- **Corte principal** (peso 1,0), en un inicio de compás, **entre el 35 % y el 65 % de la duración**. Ahí cae la música: lo precede un compás de build y lo sigue la sección completa.
  - Con 30 s o más, puede haber dos principales separados por 4 compases o más. El primero, entre el 25 % y el 45 %; el segundo, entre el 55 % y el 75 %.
  - Antes de un principal hace falta al menos 2,3 s de video para que quepa el riser.
- **Cambios menores** (peso 0,3 o 0,4) en tiempos: palabras de un montaje, cambios de fondo, aterrizajes importantes.
- **Cierre:** las piezas del inicio vuelven y se arman en el logo o la frase final. Debe asentarse (`final_s`) cerca de un inicio de compás y quedar quieto al menos 3 s.
- **Un momento estrella** cada 15 a 20 s: zoom-through, transformación grande o montaje.
- Todo dato en pantalla debe ser real.

## 5. Repertorio

Combínalo: ninguna escena repite el movimiento principal de la anterior.

**Cámara**

- *Empuje o retroceso* lento durante las pausas (del 2 % al 4 %), y uno marcado (de 1,2 a 1,5×) para revelar un detalle.
- *Whip pan* entre escenas, con estela de movimiento: 2 o 3 copias desfasadas que se desvanecen.
- *Paralaje:* fondo, cuadrícula y objetos en capas que se desplazan a distinta velocidad.
- *Zoom-through:* la cámara entra en un objeto y su interior es la escena siguiente.
- *Rotación de cámara* leve (de 2° a 5°) en las transiciones.

**Escena y transiciones**

- *Match cut o transformación:* un elemento de una escena se convierte en el de la siguiente.
- *Máscaras y barridos* revelados por un objeto que cruza, nunca un barrido genérico.
- *Split screen* para comparar.
- *Montaje sobre el golpe:* cortes cada 1 o 2 tiempos con rótulos de 3 palabras o menos.

**Objetos**

- Anticipación, sobrepaso y asentamiento al llegar (resortes). Squash and stretch al impactar, de 15 % o menos.
- Cascadas escalonadas (de 200 a 400 ms entre piezas), trayectorias en arco, rebote que decae.
- Formas que se transforman, líneas que se dibujan solas, contadores que suben, chips que se escriben letra a letra.
- Movimiento secundario en las pausas: partículas que viajan por una conexión, piezas que respiran.
