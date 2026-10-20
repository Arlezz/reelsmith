# Rendimiento de Reelsmith: dónde se iba el tiempo y qué lo redujo

Reelsmith se llamó `video-showreel-nativo` hasta la versión 0.2.1. Las mediciones de este informe son de esas versiones; los archivos de `resultados/` conservan el nombre y las rutas de entonces.

Medido el 18 y 19/10/2026 sobre la versión 0.1.0 (base) y la 0.2.0 (final), en la misma máquina. La 0.2.1 agrega Windows (sección 9c) sin cambiar el resultado en Linux: mismos md5.

## Resumen

- **Un video de 90 s pasó de 50,8 min a 4,3 min** (mediana de 3 corridas de agente de punta a punta, mismo brief, en 2 vCPU). En un MacBook M5 de 10 núcleos baja a **1,8 min**, y en un PC con Windows (Ryzen 7 9800X3D, 16 hilos) a **2,0 min**. El reloj corre desde el pedido hasta el MP4 reproducible e incluye el tiempo del agente.
- **El render no era el cuello de botella.** El 46 % del tiempo era del agente: escribir HTML y CSS, armar el storyboard a mano y corregir. Del tiempo de máquina, dos tercios eran trabajo repetido: 3 o 4 renders completos de 90 s con sus jueces.
- **Los tres cambios que más redujeron el tiempo:**
  1. Guion de catálogo en vez de HTML a mano: −1 322 s.
  2. Vista rápida en vez de renders completos para revisar: −1 090 s.
  3. `final` en un comando, con todo lo posible en paralelo: −333 s.
- **Calidad sin cambios:**
  - SSIM 0,9991 (ref20) y 0,9981 (ref90) contra la versión base.
  - `check-audio` y `medir_pista` pasan en todas las corridas.
  - El MP4 sale idéntico byte a byte entre repeticiones.
- **Costo del modelo por video:** de USD 8,96 a USD 0,52 (mediana, precios de lista).
- **GPU, medida en un MacBook (Apple M5) y en un PC con una RTX 5070:** ahorra poco. El render de 90 s bajó un 18 % en el Mac y un 16 % en el PC; el de 20 s, un 6 % en el Mac y nada en el PC (+2 %). SSIM de 0,996 a 0,999 contra la CPU. Pesan mucho más los núcleos: el mismo render de 20 s tarda 10,6 s en el Mac y 11,8 s en el PC con CPU, contra 60 s en la máquina de prueba de 2 núcleos. En los dos equipos rápidos lo más largo ya no es el render sino la música, así que la GPU no acorta la corrida.

## 1. Cómo se midió

| | |
|---|---|
| Máquina | 2 vCPU Xeon 2,8 GHz, 8 GB, sin GPU (sirve también como el caso "notebook de 8 GB") |
| Corridas de agente | Mismo prompt (`prompt-corrida.md`) y mismo brief de 90 s (`brief-90s.md`). El punto de control se da por aprobado, así que el tiempo de respuesta del usuario no cuenta. Tiempo del modelo, de herramientas, tokens y costo con `analizar_transcripcion.py` |
| Desglose por etapa | `tiempos.jsonl` de cada corrida: marcas del agente más registros automáticos de cada script |
| Máquina sola | `benchmark.py`: los dos videos de referencia, ref20 (20 s, 825 animaciones) y ref90 (90 s, 12 escenas, con audio), de punta a punta |
| Comparación | Antes y después intercalados en la misma ventana de tiempo, mediana de 3. La velocidad de la máquina cambió hasta un 35 % durante el día: comparar corridas de horas distintas engaña |
| Calidad | md5 contra la versión base; si difiere, SSIM promedio y mínimo. `check-audio` (sincronía, loudness, pico) y `medir_pista` |
| Costo | Precios de lista de Claude Opus 5.5 al 19/10/2026: entrada USD 4, salida USD 20, escritura de caché USD 5 y lectura de caché USD 0,20 por millón de tokens |

La corrida base-1 tuvo una pausa de 1 309 s en la que un comando tardó en empezar. Fue un problema de la infraestructura, no de la skill, y se descontó.

## 2. Dónde se iba el tiempo (antes, versión 0.1.0)

Mediana de 3 corridas de agente (base-1, base-2, base-3). Total: **3 025 s** según `tiempos.jsonl`; 3 046 s según la transcripción, que suma la lectura del pedido y el mensaje final. Todo corre en serie, así que todo está en la ruta crítica.

| Etapa | s | % | Ruta crítica |
|---|---|---|---|
| Máquina: render (3 o 4 renders completos de 90 s) | 984 | 32,5 | sí |
| Agente: escribir las escenas en HTML y CSS | 577 | 19,1 | sí |
| Agente: preguntas, brief y storyboard | 346 | 11,4 | sí |
| Máquina: `check-audio` (4 a 6 corridas) | 280 | 9,3 | sí |
| Máquina: `medir_cortes` (3 o 4) | 200 | 6,6 | sí |
| Agente: revisar cuadros | 140 | 4,6 | sí |
| Agente: verificar | 125 | 4,1 | sí |
| Máquina: mezcla (2 o 3) | 116 | 3,8 | sí |
| Agente: música (decidir, leer avisos) | 95 | 3,1 | sí |
| Máquina: componer la música (2 o 3) | 38 | 1,3 | sí |
| Máquina: `medir_pista` (3) | 31 | 1,0 | sí |
| Agente: otros (pedido, correcciones) | 42 | 1,4 | sí |

Son medianas por etapa, así que no suman exactamente el total. **Agente: 1 382 s (46 %). Máquina: 1 643 s (54 %).** Una sola pasada de máquina sobre ref90 tarda 557 s: el resto, unos 1 090 s, fue trabajo repetido.

## 3. Después (versión 0.2.0)

Mediana de 3 corridas de agente (final-1, final-2 y final-3). Total: **242,5 s** según `tiempos.jsonl`; **257,4 s** de punta a punta según la transcripción. Las tres pasaron los jueces a la primera, sin correcciones.

| Etapa | s | En la ruta crítica |
|---|---|---|
| Máquina: render (una vez, 12 segmentos, 4 trabajadores) | 163,0 | sí |
| Agente: leer la skill y el contenido | 19,3 | sí |
| Máquina: `medir_cortes` | 18,5 | sí |
| Agente: escribir el guion | 13,7 | sí |
| Agente: mirar la vista | 11,7 | sí |
| Agente: correr `final`, entregar y el pedido | 15,8 | sí |
| Máquina: vista | 3,3 | sí |
| Máquina: mezcla | 82,0 | no (en paralelo con el render) |
| Máquina: componer la música | 44,4 | no |
| Máquina: `check-audio` (2) | 29,0 | no (en paralelo con `medir_cortes`) |
| Máquina: `medir_pista` | 22,6 | no |

**Agente: 59,5 s. Máquina: 182,9 s.** Ahora el render sí es el cuello de botella: en 2 núcleos, el dibujo de los cuadros es el piso.

## 4. Las optimizaciones, ordenadas por ganancia medida

### Las tres que más redujeron

| # | Cambio | Oficio | Antes | Después | Ganancia |
|---|---|---|---|---|---|
| 1 | **Guion de catálogo.** El agente escribe unas 40 líneas de JSON con escenas probadas. El HTML, los tiempos sobre la grilla, el plan de cortes y el storyboard los hace `reelsmith.mjs construir`, en 20 ms | eliminar | agente 1 382 s | agente 60 s | **−1 322 s** |
| 2 | **Vista rápida en vez de renders para revisar.** Tres cuadros clave por escena a media resolución, con caché por escena (2 a 4 s). Como el catálogo llega bien a la primera, el render completo se hace una sola vez | eliminar, cachear, incremental | 3 o 4 renders completos con sus jueces: ~1 090 s repetidos | 1 render; vista 3,3 s | **−1 090 s** |
| 3 | **`final` en un comando, en paralelo.** Ver el detalle abajo | paralelo, eliminar | una pasada de máquina en ref90: 557 s | 225 s | **−333 s** (2,48×) |

Detalle del cambio 3 (A/B de ref90, mediana de 3):

- **Render por escena, en paralelo:** cada escena es un segmento y se dibujan varios a la vez, con x264 `veryfast`. Pasó de 263 s a 203 s, y eso mientras el audio compite por la CPU. Solo, el render de ref20 pasó de 89,6 s a 60,0 s.
- **Audio en paralelo:** la música, la mezcla y `medir_pista` se hacen desde el plan de cortes mientras se dibuja el video. Salieron de la ruta crítica unos 84 s.
- **`check-audio`:** de 143 s a 28 s. Lee solo una ventana de ±1,5 s alrededor de cada corte y los principales se revisan en paralelo.
- **`medir_cortes`:** de 69 s a 18,5 s. Lee la luminancia en bruto en vez de usar `signalstats`, con resultados idénticos.

### Las demás, medidas y más chicas

| Cambio | Medición |
|---|---|
| Mezcla con `ebur128` y ganancia lineal en vez de `loudnorm` en dos pasadas (que sobremuestrea todo a 192 kHz) | ffmpeg de la mezcla de 90 s: de 28 a 37 s pasó a 11 s; a veces ahorra una segunda codificación AAC. Resultado: −14,1 LUFS y −1,2 dBTP (antes −14,4 y −1,6) |
| Caché del audio (si los cortes no se movieron) | Volver a correr `final` tras cambiar una palabra: 34 s, contra 172 a 209 s |
| Caché por segmento | Cambiar una escena y volver a correr `final`: se dibujan solo las escenas que cambian (red team, caso 2) |
| `"duracion"` en el guion: el armado reparte el tiempo que falta | Antes el agente armaba de 2 a 4 veces para llegar a 90 s; ahora, 1 vez. De nueva-3/4/5 (mediana 373 s) a final-1/2/3 (257 s), junto con los tres arreglos de la fila siguiente |
| Arreglos vistos en las corridas de agente | Juez `check-audio` engañado por un montaje (un falso FALLA costaba un `final` extra de 130 s). Cortina invisible después de un impacto (obligaba a recomponer y volver a mezclar: unos 100 s). Cuadro del medio de la vista sin el sello |
| Render con prioridad baja (`nice`) y jueces finales en paralelo | `final` de 90 s: de 183 s a 172,6 s |
| x264 `veryfast` en vez de `medium` | −10 % de CPU del render, mismo tamaño, SSIM 0,9991 |
| Plan de mezcla con ventanas | 17 s menos en un video de 90 s con 14 efectos (valores idénticos bit a bit) |

### Tokens y costo (por video de 90 s, mediana de 3)

| | Antes | Después |
|---|---|---|
| Tiempo del modelo | 1 361 s | 72 s |
| Respuestas del modelo / llamadas a herramientas | 46 / 50 | 12 / 15 |
| Tokens de salida | 139 864 | 6 055 |
| Tokens leídos de caché | 9,24 M | 0,89 M |
| Costo | USD 8,96 (5,15 a 10,70) | USD 0,52 (0,50 a 0,76) |

## 5. Metas

| Meta | Resultado | ¿Cumple? |
|---|---|---|
| Video de 90 s de punta a punta: de 1 a 2 h a ≤ 10 min | 50,8 min → **4,3 min** (257,4 s; las tres corridas entre 256,7 y 261,9 s) en 2 vCPU; **1,8 min** (110,7 s) en el Mac M5; **2,0 min** (119,2 s) en el PC con Windows | sí |
| Render de 20 s: ≤ 60 s en CPU, y el valor en GPU | En la máquina de prueba (2 vCPU): **58,5 s y 60,0 s** (medianas de dos sesiones A/B; la base: 90,5 y 89,6 s). En el Mac M5: **10,6 s con CPU y 9,95 s con GPU** | sí, justo en 2 vCPU; holgado en el Mac |
| Ciclo de iteración (cambiar una escena y verla) ≤ 15 s | En la misma sesión: **11,3 s** (9,9 a 14,1 s; 1,1 a 1,4 s son de máquina). En una sesión nueva que no conoce el proyecto: 18,7 y 23,6 s. Antes: un render completo, de 4 a 5 min | sí en la misma sesión |
| Calidad: SSIM ≥ 0,98 o hash idéntico; `check-audio` pasa | SSIM 0,9991 (mín. 0,9972) en ref20 y 0,9981 (mín. 0,9953) en ref90. md5 idéntico entre repeticiones. `check-audio` y `medir_pista` pasan en las 24 corridas de benchmark con jueces y en las 3 corridas de agente de la versión final, a la primera | sí |
| Tokens y costo, antes y después | Tabla de la sección 4 | medido |

El ciclo de iteración se midió dos veces. La primera, con un agente nuevo y el proyecto ya hecho: 18,7 s, 23,6 s y 123,1 s. El caso de 123 s fue un `beginFrame` de Chromium que nunca respondió; ahora se corta a los 30 s y se reintenta. La segunda, siguiendo la misma conversación que hizo el video, que es el caso normal: 14,1 s, 11,3 s y 9,9 s.

## 6. Hipótesis

- **(a) "El render es el cuello de botella": refutada para la versión base.** El render era el 33 % del tiempo y el agente el 46 %. Además, dos tercios del tiempo de máquina era trabajo repetido. Después de los cambios, el render sí es lo más largo de la ruta crítica: 163 de 242 s.
- **(b) "La GPU lo resuelve": refutada, ahora medido.** La GPU solo puede codificar, y la codificación x264 es el 27 % de la CPU del render; el 70 % es dibujar y capturar los cuadros en Chromium. En un Mac M5 la GPU bajó el render un 6 % (20 s) y un 18 % (90 s): 0,7 s y 5,9 s. En un PC con una RTX 5070 (NVENC), +2 % y −16 %. Al tiempo del agente no le cambia nada, y en esos dos equipos el render corre en paralelo con la música, que tarda más: la corrida no se acorta. En la base habría ahorrado como mucho 266 de 3 025 s (9 %).
- **(c) "Bajar calidad para ir más rápido": no hizo falta.** Se llegó con eliminar, cachear, paralelizar y trabajo incremental. La resolución y el JPEG intermedio (calidad 92) no cambiaron. `veryfast` deja el mismo tamaño de archivo y SSIM 0,9991. La media resolución se usa solo en la vista para revisar, nunca en el MP4.

## 7. Red team

Detalle en `resultados/2026-10-19_red-team.md`. Guion de 90 s con 13 escenas y audio.

| Caso | Resultado |
|---|---|
| Video de 90 s, 13 escenas, con audio | 195 s; pico de memoria 3,7 GB en 8 GB; jueces PASA |
| Cambiar una escena | Se dibujaron 3 de 13 segmentos: la escena y 2 que cambiaron de duración al repartir el tiempo. El MP4 es idéntico (md5) a un render desde cero |
| Volver al guion anterior | 13 de 13 segmentos y el audio salen de la caché: 25 s, MP4 idéntico |
| Cambiar la paleta | 0 de 13 de la caché: ningún cuadro viejo |
| Corrida interrumpida a los 60 s y reanudada | Reutiliza los 2 segmentos terminados; MP4 idéntico al de la corrida limpia |
| Dos videos a la vez en 8 GB | **Falló en la primera versión.** El sistema mató páginas por falta de memoria (8 navegadores) y un render quedó colgado para siempre. **Arreglado** con un tiempo máximo por llamada a Chromium, reintento con un navegador nuevo y cupos de trabajadores compartidos entre renders (4 en 8 GB). Con el arreglo: 360 s y 315 s, sin páginas caídas, y los dos MP4 idénticos al de referencia |

Las pruebas, el red team y las corridas de agente encontraron, además, estos errores, todos corregidos:

- Una palabra del montaje que se seguía viendo en las escenas siguientes. Ahora el render también oculta todo lo que no es la escena que dibuja, así que una escena no puede ensuciar la caché de otra.
- Un juez engañado por los cambios de fondo del montaje.
- Una cortina invisible después de un impacto.
- Un pulso visible antes de tiempo en la escena de pasos.
- Graves bajo 50 Hz, 1,2 dB sobre el perfil en un video de 90 s con dos caídas largas.

## 8. Instrumentación (queda en el plugin)

- **Registro de cada corrida:** `proyecto/tiempos.jsonl`.
  - El agente marca el inicio de cada etapa con `tiempos.py marca <etapa>`.
  - Cada script de máquina escribe solo su registro, con sus datos: segmentos, caché, trabajadores, reintentos.
- **Informe:** `node reelsmith.mjs tiempos` imprime, por etapa, los segundos, el porcentaje y los segundos en la ruta crítica ("en ruta"), y las tres etapas que más pesan en ella.
  - La ruta crítica se calcula de atrás hacia adelante: en cada instante, lo que se estaba esperando. Lo que corrió en paralelo y terminó antes no cuenta.
  - Con una corrida reanudada, cuenta desde el último `pedido`.
- **Corridas de agente:** `bench/analizar_transcripcion.py` separa el tiempo del modelo del de herramientas, por etapa, y da tokens y costo.

## 9. Pendiente y descartado

**Pendiente:**

- **En el Mac y en Windows, la música pasa a ser la ruta crítica.** La rama de audio tarda unos 34 s en el Mac y 38 s en el PC, contra 23 y 25 s del render. Acelerar `componer.py` y la mezcla (filtros en numpy, menos procesos de Python) es lo siguiente que bajaría el tiempo en máquinas con muchos núcleos.
- **Cuántos trabajadores en máquinas grandes.** Con 16 hilos, 8 trabajadores dibujaron el video de 90 s más rápido que 32 (25,5 s contra 27,3 s); en el de 20 s fue al revés (12,6 s contra 11,8 s). Falta medir el punto justo antes de cambiar el defecto (2 por CPU).
- **Sin optimizar todavía:**
  - `check-audio` con varios principales en una sola pasada; se estima −8 s en la cola de `final`.
  - El plan de la mezcla en Python: 14 s solo, y más lento cuando compite con el render.

**Descartado, con su medición:**

| Idea | Medición |
|---|---|
| `medir_cortes` en trozos en paralelo | Sin ganancia: los 2 núcleos ya estaban ocupados. Se reemplazó por la lectura de luminancia en bruto (5× más rápido) |
| Posicionar las animaciones con JS más eficiente | Sin ganancia medible. Se dejó porque los cuadros salen idénticos |
| `optimizeForSpeed` en la captura y JPEG 85 | Sin ganancia |
| x264 `superfast` | Duplica el tamaño del archivo sin ganar tiempo |
| x264 con `-threads 1` por segmento | Sin diferencia: 53,8 a 61,8 s contra 56,3 a 57,0 s, dentro del ruido de la máquina (±7 s) |
| Un solo hilo de OpenBLAS en la música | 17,9 s contra 17,9 s |
| Audio después del render, en serie | 197 s contra 172 s en paralelo |
| Bajar la calidad (hipótesis c) | No hizo falta |

## 9b. Medición en un Mac: GPU y más núcleos (19/10/2026)

MacBook con Apple M5, 10 núcleos y 24 GB, macOS 27.0.1, Node 26.7 y ffmpeg 9.0.2. El script `bench/medir-gpu-mac.sh` corrió en la Terminal: render solo, CPU (libx264) contra GPU (h264_videotoolbox), intercalados, mediana de 3, 20 trabajadores. La GPU codificó a la misma tasa de bits que la CPU para comparar la calidad a igual tamaño.

| Video | CPU (s) | GPU (s) | GPU vs CPU | SSIM GPU contra CPU | Tamaño CPU / GPU |
|---|---|---|---|---|---|
| ref20 (20 s, 825 animaciones) | 10,6 | 9,95 | −6 % | 0,998 | 5,4 / 5,1 MB |
| ref90 (90 s, 12 escenas) | 32,96 | 27,11 | −18 % | 0,996 | 18,5 / 19,3 MB |

- **La GPU ahorra poco, como se esperaba:** solo reemplaza la codificación. En ref20, con 825 animaciones, el dibujo de los cuadros pesa más y la ganancia es menor.
- **Los núcleos pesan mucho más.** El render de 20 s pasó de 60,0 s en la máquina de prueba (2 vCPU) a 10,6 s en el Mac con CPU: 5,7× más rápido. El de 90 s tardó 33 s, contra 203 s en la máquina de prueba (dentro de `final`, compitiendo con el audio).
- **Una diferencia de modo:** en macOS el render captura los cuadros de forma normal, sin `beginFrame`. El MP4 se ve igual, pero no es idéntico byte a byte entre corridas, y por eso el benchmark marca "determinista False".
- **Recomendación: seguir con libx264 por defecto.** Es el mismo en todas las máquinas, controla la calidad (CRF 16) y la GPU ahorra entre 0,7 y 6 s por video. La GPU queda como opción: `reelsmith.mjs final --codificador h264_videotoolbox`.

Resultados: `resultados/2026-10-19_0959_gpu-mac.txt`, `2026-10-19_1000_gpu-mac-ref20` y `2026-10-19_1004_gpu-mac-ref90`.

### Corrida completa en el Mac (19/10/2026)

`bench/medir-mac-completo.sh` corrió en la Terminal del Mac. Primero pasó `prueba-completa.sh`: plantilla en los dos estilos y guion del catálogo, con jueces, en 39 s. Después repitió 3 veces, desde cero y sin caché, lo que hace la máquina en la corrida de agente final-1: construir, vista y `final` con música, mezcla y jueces.

| | Máquina de prueba (2 vCPU) | Mac M5 (10 núcleos) |
|---|---|---|
| Máquina: construir + vista + `final` (mediana de 3) | 182,9 s | **38,6 s** (32,5 a 38,9) |
| Render | 163 s | 23,3 s |
| Rama de audio: componer + mezcla + `medir_pista` | ~150 s (en paralelo) | ~34 s (en paralelo; ahora es la ruta crítica) |
| Agente: modelo y escritura (mediana de final-1/2/3) | 72,1 s | 72,1 s (no depende de la máquina) |
| **Punta a punta** | **257,4 s (4,3 min)**, medido | **110,7 s (1,8 min)**, agente + máquina |
| Jueces | PASA | PASA en las 3 |

- **Cómo se armó el punta a punta del Mac.** Desde Cowork no se puede correr el agente con las herramientas nativas de macOS: su terminal en el Mac es una máquina virtual Linux. Por eso se suma la parte de máquina, medida en el Mac, al tiempo del agente, que no depende de la máquina.
- **El método se probó en la máquina de 2 vCPU:** la suma dio 263,6 s y la corrida real de agente fue 257,4 s, un 2,4 % de diferencia.
- **Correr en el Mac sacó a la luz tres incompatibilidades, ya corregidas y probadas en Linux:**
  1. **ffmpeg 9 corría la hora de los cuadros al unir segmentos:** 0,7 ms por unión, y los cortes se medían fuera del cuadro. La unión ahora fija la duración exacta de cada segmento y revisa la hora de cada cuadro.
  2. **El ffmpeg de Homebrew no trae libsoxr:** la mezcla usa el remuestreador de ffmpeg cuando falta.
  3. **macOS informa casi nada de memoria libre:** los trabajadores se calculan con la memoria total; los cupos siguen protegiendo de la falta de memoria.
- **Mejora del catálogo hallada de paso:** si un montaje va antes de un impacto, su última palabra ahora va en el color que más contrasta con el fondo del impacto. El salto de luminancia del corte principal pasó de 2,4 a 116,5.

Resultados: `resultados/2026-10-19_1217_mac-completo.txt`, `.json` y `.log`.

## 9c. Medición en Windows (19/10/2026)

PC con AMD Ryzen 7 9800X3D (8 núcleos, 16 hilos), 62 GB, NVIDIA GeForce RTX 5070 y Windows 11 Pro 10.0.26200. Node 22.19, ffmpeg 9.0.2 (build completo de Gyan, instalado con winget) y Python 3.13.2. Chromium: el `headless_shell` 1234 que ya estaba instalado, más nuevo que el 1194 de las otras máquinas. Corrió `bench\medir-windows.ps1`, que instala lo que falte y llama a `bench/medir-equipo.mjs`.

| | Máquina de prueba (2 vCPU) | Mac M5 (10 núcleos) | PC con Windows (16 hilos) |
|---|---|---|---|
| Prueba completa (plantilla y catálogo, con jueces) | unos 4 min | 39 s | 60 s |
| Máquina: construir + vista + `final` (mediana de 3) | 182,9 s | 38,6 s | **47,1 s** (46,8 a 47,1) |
| Render | 163 s | 23,3 s | 24,9 s |
| Rama de audio: componer + mezcla + `medir_pista` | ~150 s | ~34 s | 38,3 s (16,7 + 13,7 + 7,9): la ruta crítica |
| Agente (mediana de final-1/2/3) | 72,1 s | 72,1 s | 72,1 s |
| **Punta a punta** | **257,4 s (4,3 min)** | **110,7 s (1,8 min)** | **119,2 s (2,0 min)** |
| Jueces | PASA | PASA en las 3 | PASA en las 3 |

- **El render es determinista en Windows:** `beginFrame` funciona y el video salió idéntico byte a byte en las 3 corridas. No es idéntico al de Linux (otro sistema y otro Chromium): SSIM 0,998 contra el de Linux.
- **GPU (NVENC) contra CPU, solo el render, mediana de 3, a igual tasa de bits:**

| Video | CPU, 32 trabajadores | GPU, 8 sesiones | CPU, 8 trabajadores | SSIM GPU contra CPU | Tamaño CPU / GPU |
|---|---|---|---|---|---|
| ref20 | 11,8 s | 12,0 s (+2 %) | 12,6 s | 0,999 | 5,5 / 5,1 MB |
| ref90 | 27,3 s | 22,9 s (−16 %) | 25,5 s | 0,998 | 18,3 / 17,3 MB |

  Con los mismos 8 trabajadores, la GPU dibuja entre un 5 % (ref20) y un 10 % (ref90) más rápido que la CPU: eso es lo que ahorra el codificador. Como en el Mac, se queda libx264 por defecto; `--codificador h264_nvenc` queda como opción.
- **La primera medición de GPU no servía.** El render abría 32 sesiones de NVENC a la vez y una GeForce admite 8: las demás fallaban con `OpenEncodeSessionEx failed: incompatible client key (21)` y el render repetía el segmento (10 de 32 en ref20, 26 de 32 en ref90). Salía un 33 % más lento que la CPU. Ahora, con NVENC, el render usa a lo más 8 sesiones (`RENDER_SESIONES_NVENC`) y no repitió ningún segmento.
- **Lo que hubo que cambiar para Windows (versión 0.2.1), todo probado en Linux con los mismos md5 de antes:**
  1. La mezcla llamaba a bash: ahora `planificar_mezcla.py` corre los mismos comandos de `mezcla.sh` desde Python. El audio sale idéntico byte a byte por los dos caminos.
  2. Python escribía con la página de códigos de la consola: en una consola Latin-1 (simulada en Linux) la mezcla se caía por una flecha en un mensaje. Ahora los scripts leen y escriben UTF-8.
  3. `python3` no existe en Windows: `entorno.mjs` elige el intérprete (primero el entorno aislado que crea el script de instalación).
  4. `medir_cortes.py` ponía una ruta de Windows (`C:\...`) dentro del grafo de filtros de ffmpeg, que la rompía. Ahora usa una ruta relativa.
  5. Las salidas de ffmpeg traen fin de línea de Windows; los scripts de Node las parten con `\r?\n`.
  6. El tope de sesiones de NVENC del punto anterior.
- **Prueba completa portable:** `prueba-completa.mjs` reemplaza al script de bash (que queda como atajo) y corre igual en los tres sistemas.

Resultados: `resultados/2026-10-19_2212_windows.txt` y `.json` (corrida completa), y `2026-10-19_2232_windows-gpu.txt` y `.json` (GPU con el tope de sesiones). La primera medición de GPU, con los reintentos, está en `2026-10-19_2212_windows`.

## 9d. Prueba de transferencia con AGENTS.md (0.3.0, 19/10/2026)

Un agente nuevo, sin la skill instalada y sin contexto, recibió un clon limpio del repo, la instrucción de empezar por `AGENTS.md` y el mismo brief de 90 s de las corridas de agente. El agente fue Claude, el mismo modelo de las otras corridas: la prueba mide si `AGENTS.md` basta para llegar al video, no cómo lo haría otro agente.

| | Resultado |
|---|---|
| Video | 90,2 s, 12 escenas, 1080p; `final` corrió una sola vez |
| Jueces | `check-audio` PASA en los 2 principales; `medir_pista` PASA; 0 cortes fuera del plan |
| Tiempo del agente de punta a punta | 224 s (3,7 min), con la lectura de las instrucciones |
| Registro de la corrida | 191,4 s: agente 57,8 s y máquina 133,6 s. La máquina de prueba estaba más rápida ese día: no se compara con los 257,4 s de §3 |
| Herramientas y tokens | 21 llamadas; unos 107 000 tokens |

El agente anotó siete cosas que le hicieron perder tiempo. Seis quedaron corregidas:

1. El `reelsmith` del PATH era de otro clon y `doctor` no lo decía. Ahora lo avisa.
2. No quedaba claro si marcar `pedido` antes o después de leer, ni dónde crear la carpeta, y `tiempos.jsonl` quedó fuera del proyecto. `AGENTS.md` ahora abre con un solo comando que crea la carpeta, entra y marca.
3. El ejemplo del catálogo tiene 13 escenas y el pedido pedía de 10 a 12. SKILL.md ahora dice que el ejemplo muestra la forma y que el número de escenas sale del pedido.
4. El ejemplo usa un titular que no estaba en el contenido. SKILL.md ahora dice que se usan solo los textos del contenido.
5. El pedido nombraba las recetas B y C de `direccion.md`, pero nada decía cómo se traducen a tipos de escena. SKILL.md ahora trae la equivalencia.
6. `--nombre` no aparecía en SKILL.md aunque la entrega pide un nombre claro. Ahora está en el paso 5 de los dos documentos.

La séptima no es un error: la marca `pedido` va antes de leer las instrucciones, así que el tiempo de lectura cae fuera del registro. La tabla de arriba usa el reloj del agente.

## 9e. El contenedor en el MacBook M5 (0.3.0, 20/10/2026)

`docker build -t reelsmith .` en el Mac construyó la imagen para arm64. Durante la construcción pasó la prueba completa. Después, `reelsmith --docker medir` repitió 3 veces la parte de máquina de final-1. Docker Desktop tenía 10 CPU y 8 GB, la memoria que trae por defecto.

| | Mac nativo (macOS) | Mac en el contenedor (Linux arm64) |
|---|---|---|
| Prueba completa | 39 s | 50 s |
| Máquina: construir + vista + `final` (mediana de 3) | 38,6 s | **46,3 s** (44,0 a 57,6) |
| Render | 23,3 s (20 trabajadores) | 37,5 s (10 trabajadores: con 8 GB, la memoria limita) |
| Rama de audio: componer + mezcla + `medir_pista` | ~34 s | 38,9 s (18,0 + 15,4 + 5,5) |
| Jueces | 2,8 s | ~6 s |
| **Punta a punta, con los 72,1 s del agente** | **110,7 s (1,8 min)** | **118,4 s (2,0 min)** |
| Video entre corridas | distinto (capturas comunes) | **idéntico byte a byte** (`beginFrame`) |
| Jueces | PASA | PASA en las 3 |

- **El contenedor cuesta un 7 % de punta a punta en el Mac:** 7,7 s más. Casi todo sale del render, que dibuja con la mitad de navegadores porque Docker tenía 8 GB. Con más memoria en Docker Desktop (Settings → Resources) debería acercarse; no está medido.
- **En el Mac, el contenedor da algo que lo nativo no da:** el mismo video byte a byte en cada corrida. El md5 no es el de la máquina de prueba: es otra arquitectura, arm64 contra x86.
- **La primera corrida fue más lenta (57,6 s):** la música tardó 27,2 s contra 17,7 y 18,0 en las otras. Lo más probable es el arranque en frío: archivos de la imagen que todavía no estaban en caché. No está verificado; las otras dos son las representativas.

Resultados: `resultados/2026-10-20_1345_mac-contenedor.txt` y `.json`.

## 10. Cómo reproducir

```bash
# benchmark de máquina, antes y después intercalados (unos 50 min en 2 núcleos)
python3 bench/benchmark.py --refs ref20,ref90 --repeticiones 3 --etiqueta ab --golden <carpeta golden> \
  --variantes '[{"nombre":"base","skill":"<skill 0.1.0>","modo":"etapas"},{"nombre":"final","skill":"skills/reelsmith","modo":"final"}]'
# red team de caché y rendimiento (unos 25 min)
bash bench/red-team.sh skills/reelsmith <guion de 90 s> /tmp/red-team
# corrida de agente: prompt-corrida.md con {SKILL}, {CORRIDA} y {BRIEF}; luego
python3 bench/analizar_transcripcion.py <transcripción.jsonl> --json corrida.json
# medir un computador (Linux, macOS o Windows): prueba completa, corrida de 90 s y GPU contra CPU (unos 10 min)
node bench/medir-equipo.mjs [--repeticiones 3] [--sin-gpu | --solo-gpu]
```

En Windows, desde PowerShell: `powershell -ExecutionPolicy Bypass -File bench\medir-windows.ps1`. Instala con winget lo que falte, crea el entorno de Python y llama a `medir-equipo.mjs`.

Resultados guardados en `bench/resultados/`:

- Línea base: `2026-10-18_2214_linea-base-ref20` y `2026-10-19_0006_linea-base-ref90`.
- A/B: `2026-10-19_0519_ab-base-vs-final`, `2026-10-19_0527_ab-render-ref20-final` y las intermedias.
- Red team: `2026-10-19_red-team.md`.
- Corridas de agente: `corridas-agente/`, con transcripción analizada, `tiempos.jsonl` y guion de cada una.
