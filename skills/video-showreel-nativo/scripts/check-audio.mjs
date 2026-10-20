#!/usr/bin/env node
// check-audio.mjs — juez externo para el audio de un render.
// Dado un MP4 reporta, con comandos reproducibles, los cuatro criterios:
//   1. pista de audio presente y utilizable (ffprobe + silencedetect): 48 kHz, estéreo, misma duración que el video
//      (±50 ms) y sin huecos de silencio de 1 s o más (red team: una entrada de música en una intro silenciosa y un
//      grafo que colapsó a mono pasaban el criterio cuando solo se exigía que la pista existiera)
//   2. desfase entre corte visual y marcador sonoro (beep a 1 kHz), umbral 40 ms
//   3. loudness integrado -14 LUFS ±1 y true peak < -1 dBTP, sin muestras recortadas
//   4. ducking: la música baja ≥ 10 dB durante la locución (medido en la banda grave de la música)
//
// Uso: node check-audio.mjs video.mp4 [--expect 9.5667] [--voice 3.5 11.91] [--ref 15 18]
//      [--band 40 100] [--freq 1000 | --marker impacto.wav [--marker-stem efectos.wav --ref-mix mezcla-cruda.wav]]
//      [--target -14] [--tol 1] [--tp -1] [--sync-ms 40] [--min-psr 10] [--sr 48000] [--channels 2] [--max-gap 1] [--gap-db -45] [--json]
// Marcador de sincronía: por defecto un beep de --freq Hz; con --marker, el propio archivo del efecto (un impacto
// real): se ubica en la mezcla por correlación cruzada normalizada (filtro adaptado) y se reporta su ataque.
// Requiere ffmpeg y ffprobe en el PATH. Sale con código 1 si algún criterio evaluado falla.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const T_INICIO = Date.now();  // reloj desde el arranque del proceso (tiempos.jsonl)

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
if (!file) { console.error("uso: node check-audio.mjs video.mp4 [opciones]"); process.exit(2); }
const opt = (name, n = 1, def = undefined) => {
  const i = argv.indexOf("--" + name);
  if (i < 0) return def;
  return n === 0 ? true : argv.slice(i + 1, i + 1 + n).map(Number);
};
const expect = opt("expect", 1, [NaN])[0];
const voice = opt("voice", 2, null);
const ref = opt("ref", 2, null);
const band = opt("band", 2, [40, 100]);
const freq = opt("freq", 1, [1000])[0];
const target = opt("target", 1, [-14])[0];
const tol = opt("tol", 1, [1])[0];
const tpMax = opt("tp", 1, [-1])[0];
const syncMs = opt("sync-ms", 1, [40])[0];
const asJson = opt("json", 0, false) === true;
const wantSr = opt("sr", 1, [48000])[0];
const wantCh = opt("channels", 1, [2])[0];
const maxGap = opt("max-gap", 1, [1])[0];   // segundos de silencio continuo tolerados
const gapDb = opt("gap-db", 1, [-45])[0];   // umbral de silencio (dBFS) para silencedetect
const optStr = (name) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : undefined; };
const marker = optStr("marker");
const minPsr = Number(optStr("min-psr") ?? 10); // nitidez mínima del pico GCC-PHAT. Calibrado con impactos reales: presente 15-104 en el stem, ausente 6-8
const markerStem = optStr("marker-stem"); // stem de efectos (sin música): el impacto se ubica ahí, sin enmascaramiento
const refMix = optStr("ref-mix");         // mezcla cruda previa al master: mide el desfase que agregan master, AAC y mux // archivo del efecto usado como marcador (impacto real); sin esta opción se busca un beep de --freq Hz
const SR = 48000;

const run = (cmd, args, binary = false) => {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, encoding: binary ? "buffer" : "utf8" });
  if (r.status !== 0 && !binary) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr}`);
  return r;
};
const cmdline = (cmd, args) => [cmd, ...args.map((a) => (/[\s'"\[\]]/.test(a) ? `'${a}'` : a))].join(" ");
let channels = 1;
// Decodifica a float32 sin mezclar canales (un downmix cambiaría los picos); devuelve el canal 0 y el bloque intercalado.
const pcm = (filters) => {
  const args = ["-v", "error", "-i", file, "-vn", "-af", filters, "-f", "f32le", "-ar", String(SR), "-"];
  const r = run("ffmpeg", args, true);
  const buf = r.stdout;
  const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const x = new Float32Array(Math.floor(all.length / channels));
  for (let i = 0; i < x.length; i++) x[i] = all[i * channels];
  return { x, all, cmd: cmdline("ffmpeg", args) };
};
const rms = (x, a, b) => { let s = 0, n = 0; for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) { s += x[i] * x[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
const dB = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const report = { file, criteria: {}, commands: {} };
let failed = false;
const verdict = (key, pass, detail) => { report.criteria[key] = { pass, ...detail }; if (pass === false) failed = true; };

/* 1. Pista de audio */
{
  const args = ["-v", "error", "-show_entries", "stream=index,codec_type,codec_name,sample_rate,channels,duration:format=duration", "-of", "json", file];
  const info = JSON.parse(run("ffprobe", args).stdout);
  report.commands.probe = cmdline("ffprobe", args);
  const a = info.streams.find((s) => s.codec_type === "audio");
  channels = a ? Number(a.channels) : 1;
  const v = info.streams.find((s) => s.codec_type === "video");
  const dur = Number(info.format.duration);
  if (!a) { verdict("1_pista_audio", false, { detalle: "el contenedor no tiene pista de audio" }); finish(); }
  // huecos: silencedetect sobre la pista decodificada (ignora el último segundo, donde termina el fundido de salida)
  const sargs = ["-nostats", "-v", "info", "-i", file, "-vn", "-af", `silencedetect=n=${gapDb}dB:d=${maxGap}`, "-f", "null", "-"];
  const st = spawnSync("ffmpeg", sargs, { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
  report.commands.huecos = cmdline("ffmpeg", sargs);
  const starts = [...st.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...st.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const huecos = starts.map((s0, i) => ({ desde_s: +Math.max(0, s0).toFixed(2), hasta_s: +(ends[i] ?? dur).toFixed(2) }))
    .filter((h) => h.desde_s < dur - 1.0);
  const delta = v ? Math.round((Number(a.duration) - Number(v.duration)) * 1000) : null;
  const okSr = Number(a.sample_rate) === wantSr, okCh = Number(a.channels) === wantCh, okDur = delta !== null && Math.abs(delta) <= 50, okGap = huecos.length === 0;
  verdict("1_pista_audio", okSr && okCh && okDur && okGap, {
    codec: a.codec_name, sample_rate: Number(a.sample_rate), channels: a.channels, audio_s: Number(a.duration), video_s: Number(v?.duration), contenedor_s: dur,
    delta_audio_video_ms: delta, huecos_de_silencio: huecos,
    detalle: { frecuencia_ok: okSr, canales_ok: okCh, duracion_ok: okDur, sin_huecos: okGap, exigido: `${wantSr} Hz, ${wantCh} canales, ±50 ms, sin silencios ≥ ${maxGap} s bajo ${gapDb} dBFS` } });
}

/* 2. Sincronía: corte visual vs beep */
{
  // 2a. luminancia media por frame. Con --expect solo hace falta la ventana de ±1 s (más un margen): se decodifica solo
  //     ese tramo (búsqueda en la entrada + -copyts conserva los tiempos originales). Los cuadros decodificados son los
  //     mismos que al leer el video entero, así que el resultado no cambia; en un video de 90 s baja de ~60 s a ~1 s.
  const ventana = isNaN(expect) ? [] : ["-copyts", "-ss", String(Math.max(0, expect - 1.5).toFixed(3)), "-t", "3.2"];
  const vargs = ["-nostats", "-v", "error", ...ventana, "-i", file, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"];
  const out = run("ffmpeg", vargs).stdout;
  report.commands.luma = cmdline("ffmpeg", vargs);
  const frames = [];
  let t = null;
  for (const line of out.split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/); if (m) { t = Number(m[1]); continue; }
    const y = line.match(/YAVG=([\d.]+)/); if (y && t !== null) frames.push({ t, y: Number(y[1]) });
  }
  const lo = isNaN(expect) ? 0 : expect - 1, hi = isNaN(expect) ? Infinity : expect + 1;
  // El corte es el salto de luminancia más cercano a --expect entre los fuertes de la ventana (al menos el 60 % del
  // mayor). Tomar solo el mayor fallaba con un montaje de palabras justo antes del principal: un cambio de fondo del
  // montaje, 1 s antes, saltaba 91,9 contra 89,6 del corte real. Sin --expect, el mayor.
  const saltos = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t < lo || frames[i].t > hi) continue;
    saltos.push({ i, jump: Math.abs(frames[i].y - frames[i - 1].y) });
  }
  const mayor = saltos.reduce((m, x) => Math.max(m, x.jump), 0);
  const fuertes = saltos.filter((x) => x.jump >= 0.6 * mayor && x.jump > 0);
  const best = fuertes.length
    ? (isNaN(expect) ? fuertes.reduce((a, b) => (b.jump > a.jump ? b : a)) : fuertes.reduce((a, b) => (Math.abs(frames[b.i].t - expect) < Math.abs(frames[a.i].t - expect) ? b : a)))
    : { i: -1, jump: 0 };
  const tVisual = best.i >= 0 ? frames[best.i].t : NaN;
  if (marker) {
    // 2b'. Marcador real (un impacto). El ataque del efecto en su archivo se define como el primer cruce a 20 dB bajo
    //      el máximo de su envolvente de 5 ms; la plantilla son 250 ms desde 2 ms antes de ese ataque.
    //      Ubicación por GCC-PHAT (β = 0,6), que blanquea el espectro y no se deja engañar por el grave de la música.
    //      Modo A (recomendado): --marker-stem y --ref-mix. El impacto se ubica en el stem de efectos (limpio) y el MP4 se
    //      alinea contra la mezcla cruda; la suma de ambos es el instante real del impacto en el MP4.
    //      Modo B: solo --marker. Se busca en la mezcla del MP4; si la música enmascara el efecto (pico poco nítido), no mide.
    const mono = (arr, ch) => { const n = Math.floor(arr.length / ch); const o = new Float64Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let c = 0; c < ch; c++) a += arr[i * ch + c]; o[i] = a / ch; } return o; };
    const decodeMono = (f) => { const a = ["-v", "error", "-i", f, "-vn", "-af", `aresample=${SR}`, "-ac", "1", "-f", "f32le", "-"]; const b = run("ffmpeg", a, true).stdout;
      return { x: Float64Array.from(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))), cmd: cmdline("ffmpeg", a) }; };
    const fft = (re, im, inv) => { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= n; len <<= 1) { const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
      if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } };
    const gccPhat = (seg, tpl, beta = 0.6) => { let n = 1; while (n < seg.length + tpl.length) n <<= 1;
      const xr = new Float64Array(n), xi = new Float64Array(n), tr = new Float64Array(n), ti = new Float64Array(n);
      for (let i = 0; i < seg.length; i++) xr[i] = seg[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (seg.length - 1))); for (let i = 0; i < tpl.length; i++) tr[i] = tpl[i];
      fft(xr, xi, false); fft(tr, ti, false);
      for (let k = 0; k < n; k++) { const cr = xr[k] * tr[k] + xi[k] * ti[k], ci = xi[k] * tr[k] - xr[k] * ti[k]; const w = Math.pow(Math.hypot(cr, ci), beta) + 1e-12; xr[k] = cr / w; xi[k] = ci / w; }
      fft(xr, xi, true); const L = seg.length - tpl.length + 1; let k = 0; for (let i = 1; i < L; i++) if (xr[i] > xr[k]) k = i;
      const ex = Math.floor(0.005 * SR); let mu = 0, c = 0; for (let i = 0; i < L; i++) if (Math.abs(i - k) > ex) { mu += xr[i]; c++; } mu /= c;
      let sd = 0; for (let i = 0; i < L; i++) if (Math.abs(i - k) > ex) sd += (xr[i] - mu) ** 2; sd = Math.sqrt(sd / c);
      return { lag: k, psr: (xr[k] - mu) / (sd + 1e-12) }; };
    const mk = decodeMono(marker).x;
    const w5 = Math.floor(0.005 * SR); let mxe = 0; const e5 = new Float64Array(mk.length);
    { let acc = 0; for (let i = 0; i < mk.length; i++) { acc += mk[i] * mk[i]; if (i >= w5) acc -= mk[i - w5] * mk[i - w5]; e5[i] = acc / w5; if (e5[i] > mxe) mxe = e5[i]; } }
    let onK = 0; while (onK < e5.length && e5[onK] < mxe / 100) onK++; onK = Math.max(0, onK - Math.floor(w5 / 2));
    const st = Math.max(0, onK - Math.floor(0.002 * SR)); const tpl = mk.subarray(st, st + Math.floor(0.25 * SR));
    const winA = Math.max(0, Math.floor((isNaN(expect) ? 0 : expect - 1) * SR));
    const locate = (sig) => { const winB = Math.min(sig.length, Math.floor((isNaN(expect) ? sig.length / SR : expect + 1) * SR) + tpl.length);
      const r = gccPhat(sig.subarray(winA, winB), tpl); return { t: (winA + r.lag + (onK - st)) / SR, psr: r.psr }; };
    let tAudio, psr, modo, offsetMaster = 0;
    if (markerStem && refMix) {
      modo = "stem de efectos + alineación del MP4 contra la mezcla cruda";
      const stem = decodeMono(markerStem), ref = decodeMono(refMix), mp4 = mono(pcm(`aresample=${SR}`).all, channels);
      const loc = locate(stem.x); psr = loc.psr;
      // desfase global: GCC-PHAT de 4 s del MP4 contra la mezcla cruda, alrededor del marcador (±50 ms de búsqueda)
      const c0 = Math.max(0, Math.floor((loc.t - 2) * SR)), c1 = c0 + Math.floor(4 * SR), pad = Math.floor(0.05 * SR);
      const g = gccPhat(mp4.subarray(Math.max(0, c0 - pad), c1 + pad), ref.x.subarray(c0, c1), 1.0);
      offsetMaster = (Math.max(0, c0 - pad) + g.lag - c0) / SR;
      tAudio = loc.t + offsetMaster;
      report.commands.marcador = `${stem.cmd}  +  ${ref.cmd}  +  ${cmdline("ffmpeg", ["-v", "error", "-i", file, "-vn", "-f", "f32le", "-"])}  (GCC-PHAT)`;
    } else {
      modo = "búsqueda directa en la mezcla del MP4";
      const mix = mono(pcm(`aresample=${SR}`).all, channels); const loc = locate(mix); tAudio = loc.t; psr = loc.psr;
      report.commands.marcador = `${cmdline("ffmpeg", ["-v", "error", "-i", marker, "-ac", "1", "-f", "f32le", "-"])}  +  mezcla del MP4  (GCC-PHAT β=0,6)`;
    }
    const offsetMs = (tAudio - tVisual) * 1000;
    const measurable = best.i >= 0 && psr >= minPsr;
    verdict("2_sincronia", measurable ? Math.abs(offsetMs) < syncMs : null, {
      corte_visual_s: +tVisual.toFixed(4), salto_luma: +best.jump.toFixed(1), marcador: marker.split("/").pop(), modo, ataque_en_archivo_s: +(onK / SR).toFixed(4),
      impacto_s: +tAudio.toFixed(4), nitidez_pico: +psr.toFixed(1), nitidez_minima: minPsr, desfase_master_ms: +(offsetMaster * 1000).toFixed(2),
      desfase_ms: measurable ? +offsetMs.toFixed(1) : null, umbral_ms: syncMs,
      nota: measurable ? "desfase positivo = el audio llega después del corte" : "marcador no ubicable con nitidez (el efecto no está o la música lo enmascara): use --marker-stem y --ref-mix",
    });
  } else {
  // 2b. inicio del beep, en dos etapas: (i) banda estrecha (Q=25) para ubicar el tono sostenido aunque haya voz o
  //     música cerca de 1 kHz; (ii) banda ancha (Q=4, subida ≈ 1 ms) alrededor de ese punto para fijar el ataque con precisión.
  const narrow = pcm(`aresample=${SR},bandpass=f=${freq}:width_type=q:w=25`);
  const { x, cmd } = pcm(`aresample=${SR},bandpass=f=${freq}:width_type=q:w=4`);
  report.commands.beep = narrow.cmd + "  →  " + cmd;
  const s0 = Math.floor((isNaN(expect) ? 0 : Math.max(0, expect - 1)) * SR), s1 = Math.min(x.length, Math.floor((isNaN(expect) ? x.length / SR : expect + 1) * SR));
  const W = 48; const env = []; // ventanas de 1 ms
  for (let i = s0; i + W <= s1; i += W) env.push(rms(narrow.x, i, i + W));
  let iMax = 0; for (let i = 1; i < env.length; i++) if (env[i] > env[iMax]) iMax = i;
  const sorted = [...env].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
  let k = iMax; while (k > 0 && env[k - 1] >= env[iMax] * 0.25) k--;
  const coarse = s0 + k * W;
  let ref = 0; for (let i = coarse; i < Math.min(x.length, coarse + Math.floor(0.04 * SR)); i++) ref = Math.max(ref, Math.abs(x[i]));
  let onset = -1; for (let i = Math.max(s0, coarse - Math.floor(0.03 * SR)); i < coarse + Math.floor(0.04 * SR); i++) if (Math.abs(x[i]) >= ref * 0.25) { onset = i; break; }
  const peak = env[iMax], noise = med;
  const tAudio = onset >= 0 ? onset / SR : NaN;
  const offsetMs = (tAudio - tVisual) * 1000;
  const measurable = best.i >= 0 && onset >= 0 && peak > noise * 10;
  verdict("2_sincronia", measurable ? Math.abs(offsetMs) < syncMs : null, {
    corte_visual_s: +tVisual.toFixed(4), salto_luma: +best.jump.toFixed(1), beep_s: +tAudio.toFixed(4), beep_sobre_fondo_db: +(dB(peak) - dB(noise)).toFixed(1),
    desfase_ms: measurable ? +offsetMs.toFixed(1) : null, umbral_ms: syncMs,
    nota: measurable ? "desfase positivo = el audio llega después del corte" : "no se encontró marcador medible (sin salto de luminancia o sin beep en la ventana)",
  });
  }
}

/* 3. Loudness, true peak y clipping */
{
  const largs = ["-nostats", "-v", "info", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"];
  const r = spawnSync("ffmpeg", largs, { encoding: "utf8", maxBuffer: 1 << 28 });
  report.commands.loudness = cmdline("ffmpeg", largs);
  const txt = r.stderr;
  const I = Number((txt.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/(-?[\d.]+)/)[1]);
  const LRA = Number((txt.match(/LRA:\s+(-?[\d.]+) LU/g) || []).pop()?.match(/(-?[\d.]+)/)[1]);
  const TP = Number((txt.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/(-?[\d.]+)/)[1]);
  const { all, cmd } = pcm("anull");
  report.commands.clipping = cmd + "  (cuenta de muestras, en todos los canales, con |x| >= 0.999)";
  let clipped = 0, maxAbs = 0; for (let i = 0; i < all.length; i++) { const v = Math.abs(all[i]); if (v >= 0.999) clipped++; if (v > maxAbs) maxAbs = v; }
  const okI = Math.abs(I - target) <= tol, okTP = TP < tpMax, okClip = clipped === 0;
  verdict("3_loudness", okI && okTP && okClip, { integrado_lufs: I, objetivo: `${target} ±${tol}`, lra_lu: LRA, true_peak_dbtp: TP, tp_maximo: tpMax,
    pico_muestra_dbfs: +dB(maxAbs).toFixed(2), muestras_recortadas: clipped, detalle: { loudness_ok: okI, true_peak_ok: okTP, sin_clipping: okClip } });
}

/* 4. Ducking (solo si se indica la ventana de locución) */
if (voice) {
  const [v0, v1] = voice;
  const { x, cmd } = pcm(`aresample=${SR},highpass=f=${band[0]}:poles=2,lowpass=f=${band[1]}:poles=2`);
  report.commands.ducking = cmd;
  const during = rms(x, Math.floor((v0 + 0.5) * SR), Math.floor((v1 - 0.5) * SR));
  const refWin = ref || [v1 + 1.5, v1 + 3.5];
  const before = rms(x, Math.floor(refWin[0] * SR), Math.floor(refWin[1] * SR));
  const depth = dB(before) - dB(during);
  verdict("4_ducking", depth >= 10, { banda_hz: band, ventana_locucion_s: [v0 + 0.5, v1 - 0.5], ventana_referencia_s: refWin,
    nivel_referencia_db: +dB(before).toFixed(1), nivel_durante_locucion_db: +dB(during).toFixed(1), profundidad_db: +depth.toFixed(1), minimo_db: 10,
    nota: "mide la banda grave de la música (donde la voz casi no tiene energía) dentro y fuera de la locución" });
} else {
  report.criteria["4_ducking"] = { pass: null, nota: "no aplica sin locución: indique --voice inicio fin (segundos de la línea de tiempo) cuando haya voz" };
}
finish();

function finish() {
  report.resultado = failed ? "FALLA" : "PASA";
  try {  // registro de tiempos de la corrida; nunca hace fallar al juez
    const t0 = T_INICIO / 1000, t1 = Date.now() / 1000;
    appendFileSync(process.env.SHOWREEL_TIEMPOS || "tiempos.jsonl", JSON.stringify({ v: 1, tipo: "maquina", etapa: "verificar_audio",
      t0: Number(t0.toFixed(3)), t1: Number(t1.toFixed(3)), s: Number((t1 - t0).toFixed(3)), pid: process.pid,
      datos: { resultado: report.resultado, expect: Number.isFinite(expect) ? expect : null } }) + "\n");
  } catch { /* sin registro */ }
  if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(failed ? 1 : 0); }
  console.log(`check-audio · ${file}`);
  for (const [k, v] of Object.entries(report.criteria)) {
    const tag = v.pass === true ? "PASA " : v.pass === false ? "FALLA" : "n/a  ";
    const { pass, ...rest } = v;
    console.log(`  [${tag}] ${k}: ${JSON.stringify(rest)}`);
  }
  console.log("  comandos:");
  for (const [k, c] of Object.entries(report.commands)) console.log(`    ${k}: ${c}`);
  console.log(`  resultado: ${report.resultado}`);
  process.exit(failed ? 1 : 0);
}
