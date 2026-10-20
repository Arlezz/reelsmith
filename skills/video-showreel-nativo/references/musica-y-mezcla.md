# Música, efectos y mezcla

Con música ajena, se busca en la pista el punto donde su caída coincide con un corte. Aquí es al revés: **la música se escribe para el video**. Cada corte tiene su golpe y el video no se mueve.

Todo se sintetiza por código (`sintesis.py`: osciladores, filtros, ruido y reverb por convolución), sin muestras ni modelos de terceros. Los derechos son 100 % propios, y por eso la skill puede traer el motor incluido.

## 1. Estilo según el objetivo

| Objetivo del video | Estilo | Tempo | Qué suena |
|---|---|---|---|
| Presentación técnica, lanzamiento, recap de logros, morph de UI | **Corporativa con energía** | 118 a 130 bpm, Do mayor | Pad, arpegio FM, bombo en negras, clap, bajo house, melodía en la caída; campana y botón al final |
| Showreel de impacto, tecnología, anuncio con fuerza | **Tráiler tecnológico** | 135 a 150 bpm a medio tiempo, Re menor | Drone, ostinato, redoble de toms en el build, braam y sub en la caída, golpes metálicos; braam final |
| Tutorial con locución, o el usuario no quiere música | **Sin música** | — | Solo efectos, o nada |

Recomienda primero la corporativa, salvo que el objetivo sea impacto. No hay más estilos en esta versión: el motor rinde en electrónica corporativa y de tráiler, y no imita instrumentos acústicos (piano, cuerdas, voces).

## 2. Cómo compone `componer.py`

```bash
python3 <skill>/scripts/componer.py cortes.json --estilo corporativa --salida musica --video video-mudo.mp4
```

Con el guion del catálogo, `showreel.mjs final` lo llama solo, con los cortes del plan (caen en cuadros exactos) y el tempo del guion (`--bpm`), mientras se dibuja el video. En la vía manual toma `cortes.json`, que escribe `medir_cortes.py` con los instantes medidos en el video. Cada corte lleva su peso:

| Peso | Rol | Qué recibe |
|---|---|---|
| 1,0 | Principal | Antes, un compás de build sin bombo ni bajo, con un redoble que acelera y la última semicorchea en silencio. En el corte, la caída: sección completa, braam en el tráiler, riser que termina en el corte e impacto en el corte |
| 0,6 a 0,99 | Sección | Acento en el instante exacto (stab, clap o platillo según la sección) y un whoosh |
| Menos de 0,6 | Menor | Acento suave en el instante exacto, sin efecto |
| `final_s` | Asentamiento del logo | Acorde o golpe final en el tiempo fuerte más cercano; botón suave si hay tiempo (corporativa); cola que termina antes del final del video |

Pasos:

1. **Tempo.** Con `--bpm`, el dado (el catálogo pasa el del guion: sus golpes internos están en esa grilla). Sin `--bpm`, recorre el rango del estilo en pasos de 0,01 bpm, con el primer principal como tiempo fuerte, y gana el que deja el menor error máximo de los cortes contra la grilla de semicorcheas. El pulso es constante, como en la música real.
2. **Secciones ancladas a los cortes.** Intro hasta la primera sección, groove liviano (A), build, caída y final. Entre dos principales, el desajuste se esconde en el build.
3. **Acentos.** Van en el instante exacto del corte, aunque eso los corra hasta un cuadro respecto de la grilla. Bombo y bajo siguen la grilla.
4. **Salida.**
   - `musica.wav`: duración exacta del video, 48 kHz float, pico de −3 dBFS, sin master.
   - Los efectos (`sfx-*.wav`).
   - `composicion.json`: compases, acordes, error de cada corte contra la grilla, efectos y `avisos`.
   - `variante.json`: insumo de la mezcla.

Es determinista: la misma entrada da los mismos archivos (md5). Tarda de 4 a 18 s según la duración (90 s: unos 18 s en 2 núcleos).

**Avisos que imprime y qué hacer:**

| Aviso | Qué hacer |
|---|---|
| Un corte queda a más de 45 ms de la grilla | Con el catálogo no debería pasar (los golpes caen en la grilla); en una escena `libre`, mueve su golpe a la grilla. En la vía manual, mueve ese corte 1 o 2 cuadros en `construir.mjs` hacia la grilla del storyboard, o baja su peso a menor. También puedes probar `--bpm` con otro tempo del rango |
| Ningún principal deja espacio para el riser | El principal está antes de 2,3 s. Muévelo más tarde (debería estar entre el 35 % y el 65 % del video) |
| El logo se asienta encima del último principal | La caída no tiene cuerpo. Separa el logo del principal al menos 2 compases |

## 3. Mezcla

```bash
python3 -I <skill>/scripts/planificar_mezcla.py musica/variante.json     # → musica/musica.mp4, stems/ y plan.json
```

`planificar_mezcla.py` escribe `mezcla.sh` con los comandos literales de ffmpeg y ejecuta esos mismos comandos desde Python, sin bash, para que corra igual en Windows. Para repetir la mezcla con bash: `(cd musica && bash mezcla.sh)`. Los dos caminos dan el mismo `audio.m4a`, byte a byte; `SHOWREEL_MEZCLA_BASH=1` hace que el script use bash.

Con `--solo-audio` deja el master en `musica/audio.m4a` sin tocar el video: así `showreel.mjs final` mezcla mientras el video se dibuja. Después, `bash mezcla.sh unir` (o el ffmpeg de su última línea) lo une al video sin recodificar.

- **Colocación de cada efecto por su punto de oficio:**
  - Impacto: por su ataque.
  - Whoosh: por su pico.
  - Riser: por su final.

  La colocación es exacta a la muestra.
- **Nivel de cada efecto:** queda 8 dB bajo la música en ese instante (rango de oficio: 6 a 10 dB).
- **Efectos que se apilan:** se baja solo el que suena en el bloque más fuerte.
- **Master:**
  - Todo a 48 kHz float.
  - Ganancia lineal a −14 LUFS, medidos con `ebur128` (BS.1770). Hasta la versión 0.1.0 era `loudnorm` en dos pasadas: en modo lineal aplica la misma ganancia, pero tardaba 4 veces más porque sobremuestrea todo a 192 kHz.
  - Limitador de pico verdadero sobremuestreado, con techo de −2 dBTP antes del AAC.
  - Si el AAC deja el MP4 sobre −1,2 dBTP, baja la ganancia y vuelve a codificar.
- **Guardas:** rechaza una música que no cubra el 90 % del video y stems con frecuencia, canales o duración incorrectos.

El video se copia sin recodificar: el MP4 final tiene la imagen idéntica a `video-mudo.mp4`.

## 4. Jueces

Los dos son obligatorios antes de entregar.

### `check-audio.mjs` (sobre el MP4)

```bash
node <skill>/scripts/check-audio.mjs musica/musica.mp4 --expect <t del principal> --marker musica/sfx-impacto.wav
```

| Criterio | Exige |
|---|---|
| 1. Pista de audio | 48 kHz, estéreo, misma duración que el video (±50 ms), sin silencios de 1 s o más |
| 2. Sincronía | El impacto, ubicado en la mezcla por correlación, a 40 ms o menos del corte visual medido |
| 3. Loudness | −14 LUFS ±1, pico verdadero bajo −1 dBTP, sin muestras recortadas |
| 4. Ducking | Solo con locución (`--voice inicio fin`); no aplica aquí |

Debe decir `resultado: PASA`. Con un segundo principal, repite con `--expect` en ese instante.

### `medir_pista.py` (sobre la música)

```bash
python3 -I <skill>/scripts/medir_pista.py musica/composicion.json --wav musica/stems/musica.wav --png medicion.png
```

Compara contra `perfil-profesional.json`: las cifras medidas de 4 pistas profesionales de Mixkit (Games Music, Close Up, Epical Drums 05 y Motivating Mornings). Los audios no vienen en la skill.

| Criterio | Exige | Si no pasa, suena… |
|---|---|---|
| 1. Espectro | Tercios de octava entre 63 Hz y 10 kHz, a 4 dB o menos de la envolvente profesional | Delgada (falta cuerpo), opaca (faltan agudos) o chillona |
| 2. Graves bajo 50 Hz | Sin exceso sobre la referencia más cargada + 3 dB | Bien en audífonos, pero se come el margen del limitador; el notebook no los reproduce |
| 3. Ancho | Correlación L/R sobre 300 Hz entre 0,15 y 0,60 | Angosta (mono) o desarmada |
| 4. Arco | Caída entre 1,5 y 2,5 LU sobre la sección A | Plana, o con una caída que salta de volumen |
| 5. Golpe principal | Escalón de 6 dB o más (graves o total) y ataque grave a 40 ms o menos del corte | El corte principal no se siente |

`REVISAR` no impide entregar: informa al usuario qué criterio falló y qué significa, con la tabla de arriba. Corrige antes de entregar cuando sea el criterio 5 o el 2. En las pruebas, el 5 falló solo con principales en los extremos del video (antes del 10 % o después del 85 %). El 2 falló una vez con la corporativa en un video de 90 s con dos caídas largas (+1,2 dB a 50 Hz); el corte de 48 Hz de la corporativa ahora es de −6,5 dB y pasa.

## 5. Medido en las pruebas

Las cuatro primeras filas pasan los dos jueces: `check-audio` (desfase de 0 ms en cada principal, de −14,6 a −13,9 LUFS) y `medir_pista`.

| Video | Corporativa | Tráiler |
|---|---|---|
| Showreel `@nova-ia/ui`, 20 s; cortes puestos sin grilla | 128,85 bpm; peor corte a 37 ms | 142,86 bpm; peor corte a 33 ms |
| Plantilla, 17,5 s; guion a 128 bpm | 128,0 bpm; 25 ms | 144,0 bpm; 25 ms |
| Prueba de transferencia, 30 s, 2 principales; guion a 144 bpm | 126,0 bpm; 43 ms | 144,0 bpm; 17 ms |
| Listas sintéticas de 15 a 30 s, con 1 o 2 principales | PASA | PASA |
| Principal antes del 10 % o después del 85 % | REVISAR (espectro o graves) | REVISAR |

La fila de 30 s muestra por qué el guion va en la grilla del estilo elegido: el mismo video, armado a 144 bpm, deja la corporativa a 43 ms, cerca del límite de 45. Si cambias de estilo después del render y aparece el aviso, mueve los cortes señalados.

El pipeline completo es determinista. Dos corridas de `prueba-completa.mjs` dan el mismo md5 en `video-mudo.mp4`, en cada WAV y en el MP4 final.

## 6. Rúbrica de oído (juez: el usuario)

Las mediciones acotan el espectro, el ancho y el arco, pero no dicen si suena a producción. Pídele al usuario escuchar una vez con audífonos y otra con los parlantes del computador, y responder Sí, A medias o No:

1. ¿El impacto cae en el corte principal?
2. ¿La música acompaña el ritmo de los cortes?
3. ¿El nivel es cómodo comparado con un video de YouTube?
4. ¿El final cierra o se corta?
5. ¿Suena a producción o a demo?

Si la 5 es "a demo", prueba el otro estilo. Si persiste, anótalo en el proyecto como hallazgo de la prueba.

## 7. Licencias

- **Música y efectos:** sintetizados por `componer.py` y `sintesis.py`, sin muestras ni modelos de terceros. Son nuestros: no tienen las restricciones de la licencia de Mixkit (TV, radio, juegos, Content ID), y el motor se puede redistribuir con la skill.
- **Fuentes de la plantilla:** Quicksand e Inter, licencia SIL Open Font License 1.1 (`assets/plantilla/fuentes/OFL-*.txt`). Se pueden incluir y distribuir con el video y la skill. No se pueden vender solas, y Quicksand no se puede modificar conservando su nombre.
- **`perfil-profesional.json`:** solo cifras medidas sobre pistas de Mixkit, no audio. La licencia de Mixkit no permite redistribuir sus pistas ni efectos dentro de una herramienta, por eso la skill no trae ningún archivo de Mixkit.
