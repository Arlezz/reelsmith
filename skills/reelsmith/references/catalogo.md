# Catálogo de escenas (guion.json)

El video se describe en `guion.json`: una lista de escenas de un catálogo probado, con sus textos. `reelsmith.mjs construir` lo convierte en el HTML. Calcula solo:

- la duración de cada escena, con la regla de lectura;
- los tiempos sobre la grilla del bpm;
- el plan de cortes y el storyboard.

No se escribe CSS. Un guion de 90 s tiene unas 40 líneas.

## Estructura

```json
{
 "titulo": "nombre del video",
 "duracion": 90,
 "bpm": 128,
 "paleta": "cenia-oscura",
 "fuente": "Quicksand",
 "escenas": [ { "tipo": "portada", ... }, ... ]
}
```

| Campo | Valores |
|---|---|
| `duracion` | Opcional. Segundos pedidos. El armado alarga las escenas de lectura más justa, de a medio compás, hasta llegar (±0,5 s). Si los textos necesitan más, avisa |
| `bpm` | El tempo del guion. Corporativa: 124 a 128. Tráiler: 140 a 144 |
| `paleta` | `cenia-oscura` (por defecto), `cenia-clara`, `gris-calido`, `petroleo`, `papel-tecnico`, `grafito-lima`, o `{"ground": "#…", "main": "#…", "ink": "#…", "accent": "#…"}` |
| `fuente` | `Quicksand` (por defecto) o `Inter` |

Campos comunes de toda escena:

| Campo | Para qué |
|---|---|
| `tipo` | Uno de los tipos de abajo |
| `entrada` | Cómo entra la escena: `corte` (por defecto), `cortina`, `mascara`, `fuga`, `destello`. `corte` puede repetirse; las demás, no dos seguidas iguales. Un principal entra con `corte` |
| `principal` | `true` en la escena donde cae la música: el impacto y la caída. Va en un inicio de compás (el armado lo ajusta solo) |
| `compases` | Opcional. Fija la duración (también la del cierre); si no alcanza para leer, el armado avisa. Con `duracion` casi nunca hace falta |

## Tipos

| Tipo | Campos | Qué se ve | Duración automática |
|---|---|---|---|
| `portada` | `titulo`, `bajada` | Título letra a letra (ya visible en el cuadro 0), línea y bajada | Lectura + 0,9 s |
| `texto` | `kicker`, `titulo`, `bajada`, `fuente` | Kicker, titular que sube palabra a palabra, bajada opcional, fuente en un chip | Lectura + 1,0 s |
| `dato` | `kicker`, `valor`, `prefijo`, `unidad`, `texto`, `fuente` | Una cifra grande. Si `valor` es entero, cuenta desde 0; si no (0,994 o "2×"), aterriza. Debajo, la frase del dato | Lectura + 1,6 s |
| `lista` | `kicker`, `titulo`, `items` | Titular y chips que aterrizan uno tras otro (2 a 6 ítems) | Lectura + 0,15 s por ítem |
| `pasos` | `kicker`, `titulo`, `pasos` | Nodos en fila que aparecen uno por tiempo, unidos por una línea que se dibuja, y un pulso que la recorre (3 a 7 pasos) | Según los pasos |
| `montaje` | `palabras` | Una palabra a pantalla completa por cada medio compás, con el fondo alternado. Ideal justo antes de un principal | 2 tiempos por palabra |
| `impacto` | `titulo`, `bajada`, `sello` | Fondo `main`, mensaje grande que golpea con rebote, chispas, chip `sello` opcional. Es la escena de un principal | Lectura + 1,2 s (mínimo 2 compases) |
| `cierre` | `logo`, `linea` | Logo letra a letra, línea y meta; quieto al menos 3,5 s. Va última | Fija, unos 5 s |
| `libre` | `html`, `css`, `segundos`, `lectura`, `golpes` | Escena escrita a mano (ver abajo) | `segundos` |

Textos:

- **Titulares:** de 3 a 12 palabras. El tamaño de letra baja solo con el largo.
- **Cifras:** una cifra con su unidad cuenta como una palabra.
- **Sin símbolos que la fuente no trae:** nada de → ni emojis. Para una secuencia, usa `pasos`.

## Orden recomendado (receta para un showreel)

1. `portada`.
2. De 2 a 4 escenas de contexto: `texto`, `dato`, `lista` o `pasos`.
3. `montaje` de 3 o 4 palabras.
4. `impacto` **principal**, entre el 35 % y el 65 % del video.
5. De 2 a 4 escenas de resultados.
6. Con 45 s o más, un segundo `impacto` principal entre el 55 % y el 75 %.
7. `cierre`.

## Qué hace el armado por ti

- **Tiempos:** cada escena dura lo que pide su texto (regla de lectura), redondeado a medios compases. Con `duracion`, lo que falta se reparte entre las escenas. Los golpes internos (la cifra que llega, el último paso, el sello) caen en la grilla de semicorcheas.
- **Principales:** si un principal no cae en inicio de compás, alarga la escena anterior lo justo. Si cae fuera de su rango (35–65 %; con dos, 25–50 % y 55–75 %), avisa.
- **Transiciones:** una cortina después de un impacto va en el color de la tinta, para que se vea sobre el fondo `main`.
- **Caché:** cada escena tiene su clave (su contenido, su duración, la base y las transiciones que la tocan). Cambiar una escena vuelve a dibujar solo esa en la vista y en el render final; cambiar la paleta o la fuente, todas.
- **Aislamiento:** al dibujar una escena, el render oculta todo lo demás. Nada de otra escena puede colarse en sus cuadros.

## Escena libre

Para algo que el catálogo no cubre:

```json
{"tipo": "libre", "segundos": 6, "lectura": "texto que se lee",
 "html": "<div class=\"centro\"><p class=\"x\">Hola</p></div>",
 "css": "#ID .x { font-size: 120px; animation: aparecer 0.5s linear calc(var(--t0) + 0.2s) both; }",
 "golpes": [{"t": 2.0, "nombre": "llega el gráfico", "peso": 0.3}]}
```

- Cada selector empieza con `#ID`; el armado lo reemplaza por el id de la escena. Si un selector no empieza con `#ID`, el armado se detiene con error: tocaría otras escenas y la caché quedaría vieja.
- Sus `@keyframes` son globales: no pueden llamarse como los de la base, y cambiarlos vuelve a dibujar todas las escenas.
- Los tiempos se escriben relativos al inicio de la escena: `calc(var(--t0) + Xs)`. Así la caché y la vista siguen funcionando.
- Las animaciones de la base se pueden usar: `subir`, `aparecer`, `aterrizar`, `entrar-izq`, `impacto`, `regla`, `dibujar`, `chispa`.
- Pon sus `golpes` en la grilla (múltiplos de un cuarto de tiempo: a 128 bpm, 0,1172 s) para que la música los acentúe sin error.
- Las técnicas y trampas de CSS están en `construccion-html.md`.

## Ejemplo completo (90 s, 13 escenas)

```json
{
 "titulo": "video-with-ai · showreel 90 s", "duracion": 90, "bpm": 128, "paleta": "cenia-oscura", "fuente": "Quicksand",
 "escenas": [
  {"tipo": "portada", "titulo": "video-with-ai", "bajada": "Videos de proyecto hechos con código"},
  {"tipo": "texto", "entrada": "cortina", "kicker": "El problema", "titulo": "Un video de 90 s con agentes tomaba de 1 a 2 horas"},
  {"tipo": "dato", "kicker": "La prueba", "prefijo": "SSIM", "valor": 0.994, "texto": "HyperFrames y render nativo con el mismo HTML"},
  {"tipo": "texto", "entrada": "mascara", "kicker": "La decisión", "titulo": "Video y música nativos, sin framework de video"},
  {"tipo": "pasos", "entrada": "cortina", "kicker": "Pipeline", "titulo": "Seis pasos, un solo comando", "pasos": ["HTML y CSS", "render", "cortes", "música", "mezcla", "jueces"]},
  {"tipo": "montaje", "palabras": ["RENDER", "CORTES", "MÚSICA", "MEZCLA"]},
  {"tipo": "impacto", "principal": true, "titulo": "BYTE A BYTE", "bajada": "El MP4 sale idéntico en cada render"},
  {"tipo": "dato", "entrada": "fuga", "kicker": "Render", "valor": 76, "unidad": "s", "texto": "para 20 s con 825 animaciones"},
  {"tipo": "texto", "entrada": "cortina", "kicker": "Música", "titulo": "Compuesta a la medida: cada corte tiene su golpe"},
  {"tipo": "impacto", "principal": true, "titulo": "−14 LUFS", "bajada": "Mezcla con pico bajo −1 dBTP", "sello": "Derechos 100 % propios"},
  {"tipo": "dato", "entrada": "cortina", "kicker": "Sincronía", "valor": 0, "unidad": "ms", "texto": "del impacto al corte principal"},
  {"tipo": "dato", "entrada": "fuga", "kicker": "Transferencia", "valor": 28, "unidad": "min", "texto": "le tomó a un agente nuevo hacer un video de 30 s"},
  {"tipo": "cierre", "entrada": "destello", "logo": "CENIA", "linea": "video-with-ai"}
 ]
}
```
