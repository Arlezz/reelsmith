// medir-equipo.mjs: mide la skill en este computador (Windows, macOS o Linux) y deja el resultado en bench/resultados/.
//
// Uso: node bench/medir-equipo.mjs [--repeticiones 3] [--sin-gpu | --solo-gpu] [--etiqueta windows]
//   --solo-gpu: solo el paso 5 (para repetir la medición de la GPU sin rehacer lo demás).
//   --salida <carpeta>: dónde dejar los resultados (por defecto, bench/resultados).
//   En Windows lo corre bench\medir-windows.ps1 después de instalar lo que falte.
//
// Qué hace:
//   1. Anota el equipo: CPU, núcleos, memoria, tarjeta de video y versiones de Node, ffmpeg y Python.
//   2. Corre prueba-completa.mjs: el pipeline completo (plantilla en los dos estilos y guion del catálogo, con jueces).
//      Si Chromium no responde a beginFrame en este equipo, repite con capturas comunes (RENDER_MODO=capturas) y lo anota.
//   3. Repite N veces, cada una en una carpeta limpia y sin caché, lo que hizo la máquina en la corrida de agente final-1:
//      construir el guion que escribió ese agente, la vista y `reelsmith.mjs final`. Mide el reloj de pared y compara el
//      md5 del video entre corridas (determinismo) y contra el de Linux.
//   4. Punta a punta = tiempo del agente (modelo y escritura, medido en final-1, final-2 y final-3; no depende de la
//      máquina) + tiempo de máquina medido aquí.
//   5. GPU: si ffmpeg tiene un codificador por hardware que funcione (NVENC, Quick Sync, AMF o VideoToolbox), dibuja ref20
//      y ref90 con CPU y con GPU, intercalados y a la misma tasa de bits, y mide el SSIM de la GPU contra la CPU.
// Deja bench/resultados/<fecha>_<etiqueta>.txt y .json; los va escribiendo a medida que avanza.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_PYTHON, NODE, md5, python, pythonArgs } from "../skills/reelsmith/scripts/entorno.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(path.dirname(AQUI), "skills", "reelsmith");
const S = path.join(SKILL, "scripts");
const argv = process.argv.slice(2);
const opt = (k, def) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : def; };
const REPS = Number(opt("repeticiones", 3));
const SOLO_GPU = argv.includes("--solo-gpu");
const SISTEMA = { win32: "windows", darwin: "mac", linux: "linux" }[process.platform] || process.platform;
const ETIQUETA = opt("etiqueta", SISTEMA);
const TRABAJO = path.resolve(opt("trabajo", path.join(os.tmpdir(), "bench-equipo")));
const dos = (n) => String(n).padStart(2, "0");
const d = new Date();
const FECHA = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}`;
const RES = path.join(opt("salida") ? path.resolve(opt("salida")) : path.join(AQUI, "resultados"), `${FECHA}_${ETIQUETA}`);
mkdirSync(path.dirname(RES), { recursive: true });
mkdirSync(TRABAJO, { recursive: true });

const lineas = [];
const R = { fecha: FECHA, etiqueta: ETIQUETA, sistema: process.platform };
const guardar = () => { writeFileSync(RES + ".txt", lineas.join("\n") + "\n"); writeFileSync(RES + ".json", JSON.stringify(R, null, 1)); };
const anotar = (s = "") => { console.log(s); lineas.push(s); guardar(); };
const ahora = () => performance.now() / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
const mediana = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const coma = (x, dec = 1) => (typeof x === "number" ? x.toFixed(dec).replace(".", ",") : String(x));
let ENV = { ...process.env, ...ENV_PYTHON };

// corre un comando, guarda su salida en un log y devuelve código, salida y segundos
function correr(cmd, args, cwd, log, env = ENV) {
  const t0 = ahora();
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true });
  const out = ((r.stdout || "") + (r.stderr || "") + (r.error ? `\n${r.error.message}` : "")).replace(/\r\n/g, "\n");  // Windows: CRLF
  if (log) writeFileSync(log, `$ ${path.basename(cmd)} ${args.join(" ")}\n${out}`, { flag: "a" });
  return { code: r.status ?? 1, out, s: ahora() - t0 };
}
function ssim(a, b) {
  const r = spawnSync("ffmpeg", ["-nostats", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const m = (r.stderr || "").match(/All:([0-9.]+)/g);
  return m ? Number(m[m.length - 1].slice(4)) : null;
}
const salida1 = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true }); return r.status === 0 ? (r.stdout || "").replace(/\r\n/g, "\n").trim() : ""; };
function fallar(msg, log) {
  if (log && existsSync(log)) {
    const txt = readFileSync(log, "utf8");
    console.log(txt.split("\n").slice(-40).join("\n"));
    writeFileSync(RES + "-fallo.log", txt);
    anotar(`FALLÓ: ${msg}. El log completo quedó en ${RES}-fallo.log`);
  } else anotar(`FALLÓ: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. el equipo
function tarjetasDeVideo() {
  if (process.platform === "win32") {
    return salida1("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '; '"]);
  }
  if (process.platform === "darwin") return salida1("sysctl", ["-n", "machdep.cpu.brand_string"]) + " (GPU integrada)";
  return salida1("sh", ["-c", "lspci 2>/dev/null | grep -i -E 'vga|3d|display' | cut -d: -f3 | paste -sd ';'"]);
}
const so = process.platform === "darwin" ? `macOS ${salida1("sw_vers", ["-productVersion"])}`
  : process.platform === "linux" ? (((() => { try { return readFileSync("/etc/os-release", "utf8"); } catch { return ""; } })().match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || "Linux") + ` (${os.release()})`
    : `${os.version()} (${os.release()})`;
R.equipo = {
  cpu: os.cpus()[0]?.model.trim(), nucleos: os.cpus().length, memoria_gb: Math.round(os.totalmem() / 1073741824), so, gpu: tarjetasDeVideo(),
  node: process.version, ffmpeg: salida1("ffmpeg", ["-version"]).split("\n")[0],
  python: salida1(python().cmd, pythonArgs("-c", "import sys; print(sys.version.split()[0])")),
};
anotar(`# Medición en ${ETIQUETA} · ${FECHA.replace("_", " ")}`);
anotar(`Equipo: ${R.equipo.cpu} · ${R.equipo.nucleos} núcleos lógicos · ${R.equipo.memoria_gb} GB · ${so}`);
anotar(`Tarjeta de video: ${R.equipo.gpu || "no detectada"}`);
anotar(`${R.equipo.node} · ${R.equipo.ffmpeg} · Python ${R.equipo.python}`);
const ver = correr(NODE, [path.join(S, "render-nativo.mjs"), "--verificar"], AQUI);
if (ver.code !== 0) fallar(`render-nativo.mjs --verificar:\n${ver.out}`);
anotar(ver.out.trim().split("\n").filter((l) => /^(navegador|modo|CPU)/.test(l)).join("\n"));
anotar();

if (!SOLO_GPU) {  // pasos 2 a 4
// ---------------------------------------------------------------- 2. prueba completa
console.log("Prueba completa del pipeline (plantilla en los dos estilos y guion del catálogo), unos minutos…");
const LOG_PRUEBA = path.join(TRABAJO, "prueba.log");
const prueba = () => { rmSync(LOG_PRUEBA, { force: true }); return correr(NODE, [path.join(S, "prueba-completa.mjs"), path.join(TRABAJO, "prueba")], AQUI, LOG_PRUEBA); };
let p = prueba();
R.modo_render = process.env.RENDER_MODO || (process.platform === "darwin" ? "capturas" : "beginFrame");
const SIN_BEGINFRAME = /no respondió HeadlessExperimental\.beginFrame|HeadlessExperimental\.beginFrame' wasn't found|begin ?frame control/i;
if (p.code !== 0 && !process.env.RENDER_MODO && SIN_BEGINFRAME.test(p.out)) {
  anotar("beginFrame no respondió en este equipo: repito con capturas comunes (RENDER_MODO=capturas).");
  ENV = { ...ENV, RENDER_MODO: "capturas" };
  R.modo_render = "capturas (beginFrame no respondió)";
  rmSync(LOG_PRUEBA, { force: true });
  p = correr(NODE, [path.join(S, "prueba-completa.mjs"), path.join(TRABAJO, "prueba")], AQUI, LOG_PRUEBA);
}
if (p.code !== 0) fallar("prueba-completa.mjs", LOG_PRUEBA);
R.prueba_completa = { pasa: true, s: r1(p.s) };
anotar(`prueba-completa: PASA en ${Math.round(p.s)} s (plantilla en los dos estilos y guion del catálogo, con jueces)`);
for (const l of p.out.split("\n").filter((l) => /check-audio:|medir_pista:/.test(l))) anotar(l);
anotar();

// ---------------------------------------------------------------- 3. parte de máquina de la corrida final-1, N veces
const GUION = path.join(AQUI, "resultados", "corridas-agente", "final-1-guion.json");
const refLinux = (() => { try { return JSON.parse(readFileSync(path.join(AQUI, "resultados", "corridas-agente", "final-1-referencia-linux.json"), "utf8")); } catch { return null; } })();
R.corridas = [];
for (let i = 1; i <= REPS; i++) {
  console.log(`Corrida ${i} de ${REPS}: construir, vista y final con música, mezcla y jueces…`);
  const D = path.join(TRABAJO, `corrida-${i}`);
  rmSync(D, { recursive: true, force: true });
  mkdirSync(D, { recursive: true });
  cpSync(GUION, path.join(D, "guion.json"));
  const env = { ...ENV, REELSMITH_TIEMPOS: path.join(D, "tiempos.jsonl") };
  const log = path.join(D, "corrida.log");
  const sr = path.join(S, "reelsmith.mjs");
  const a = correr(NODE, [sr, "construir"], D, log, env);
  if (a.code) fallar(`construir en la corrida ${i}`, log);
  const b = correr(NODE, [sr, "vista"], D, log, env);
  if (b.code) fallar(`vista en la corrida ${i}`, log);
  const c = correr(NODE, [sr, "final", "--estilo", "corporativa"], D, log, env);
  if (c.code) fallar(`final en la corrida ${i}`, log);
  const fin = JSON.parse(readFileSync(path.join(D, "final.json"), "utf8"));
  const etapas = {};
  for (const l of readFileSync(path.join(D, "tiempos.jsonl"), "utf8").split("\n").filter((x) => x.trim())) {
    const e = JSON.parse(l);
    if (e.tipo === "maquina") etapas[e.etapa] = r1((etapas[e.etapa] || 0) + e.s);
  }
  const m = { corrida: i, maquina_s: r1(a.s + b.s + c.s), construir_s: Math.round(a.s * 100) / 100, vista_s: r1(b.s), final_s: r1(c.s), etapas_s: etapas,
    check_audio: fin.check_audio, medir_pista: fin.medir_pista, cortes_fuera_del_plan: fin.cortes_fuera_del_plan,
    md5_video_mudo: md5(path.join(D, "video-mudo.mp4")), duracion_video_s: fin.duracion_s };
  R.corridas.push(m);
  anotar(`corrida ${i}: máquina ${coma(m.maquina_s)} s (construir ${coma(m.construir_s, 2)} · vista ${coma(m.vista_s)} · final ${coma(m.final_s)}) · ` +
    `render ${coma(etapas.render)} s · música ${coma(etapas.musica)} s · check-audio ${JSON.stringify(m.check_audio)} · medir_pista ${m.medir_pista}`);
}
const md5s = new Set(R.corridas.map((c) => c.md5_video_mudo));
R.determinista = md5s.size === 1;
anotar(`Video mudo: ${R.determinista ? `md5 idéntico en las ${REPS} corridas` : `md5 distinto entre corridas (${md5s.size} valores)`}` +
  (refLinux ? ` · ${[...md5s][0] === refLinux.md5_video_mudo ? "idéntico byte a byte al de Linux" : "distinto del de Linux"}` : ""));
R.igual_a_linux = refLinux ? [...md5s][0] === refLinux.md5_video_mudo : null;
// calidad contra Linux: si está el video de referencia, SSIM
const VIDEO_LINUX = path.join(path.dirname(path.dirname(AQUI)), "referencia-linux", "final-1-video-mudo.mp4");
if (R.igual_a_linux === false && existsSync(VIDEO_LINUX)) {
  R.ssim_contra_linux = ssim(path.join(TRABAJO, "corrida-1", "video-mudo.mp4"), VIDEO_LINUX);
  anotar(`SSIM del video de este equipo contra el de Linux: ${R.ssim_contra_linux}`);
}
anotar();

// ---------------------------------------------------------------- 4. punta a punta = agente + máquina
const maq = mediana(R.corridas.map((c) => c.maquina_s));
const render = mediana(R.corridas.map((c) => c.etapas_s.render || 0));
const dirAg = path.join(AQUI, "resultados", "corridas-agente");
const agente = ["final-1", "final-2", "final-3"].map((n) => { const t = JSON.parse(readFileSync(path.join(dirAg, `${n}-transcripcion.json`), "utf8")); return r1(t.total_s - t.herramientas_s); });
const ag = mediana(agente);
const total = r1(ag + maq);
const nube = mediana(["final-1", "final-2", "final-3"].map((n) => JSON.parse(readFileSync(path.join(dirAg, `${n}-transcripcion.json`), "utf8")).total_s));
const mac = (() => {
  const f = readdirSync(path.join(AQUI, "resultados")).filter((x) => x.endsWith("_mac-completo.json")).sort().pop();
  try { return f ? JSON.parse(readFileSync(path.join(AQUI, "resultados", f), "utf8")).punta_a_punta_s : null; } catch { return null; }
})();
const jueces = R.corridas.every((c) => c.check_audio.every((x) => x.endsWith("PASA")) && c.medir_pista === "PASA");
Object.assign(R, { maquina_mediana_s: r1(maq), render_mediana_s: r1(render), agente_s: agente, agente_mediana_s: ag, punta_a_punta_s: total,
  nube_2vcpu_s: nube, mac_m5_s: mac, jueces_pasan: jueces });
anotar(`Máquina en este equipo (construir + vista + final), mediana de ${REPS}: ${coma(maq)} s · render ${coma(render)} s`);
anotar(`Agente (modelo y escritura), mediana de final-1/2/3: ${coma(ag)} s`);
anotar(`PUNTA A PUNTA EN ESTE EQUIPO (agente + máquina): ${coma(total)} s = ${coma(total / 60)} min`);
anotar(`  como referencia: ${coma(nube)} s en la máquina de prueba de 2 vCPU${mac ? ` · ${coma(mac)} s en el MacBook M5` : ""}`);
anotar(`Jueces: ${jueces ? "PASA en todas" : "ALGUNO FALLA: ver las corridas"}`);
anotar();

}  // fin de los pasos 2 a 4

// ---------------------------------------------------------------- 5. GPU contra CPU (solo el render)
const CANDIDATOS = { win32: ["h264_nvenc", "h264_qsv", "h264_amf"], darwin: ["h264_videotoolbox"], linux: ["h264_nvenc", "h264_qsv"] }[process.platform] || [];
const listados = salida1("ffmpeg", ["-hide_banner", "-encoders"]);
const probar = (enc) => spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=1", "-pix_fmt", "yuv420p", "-c:v", enc, "-b:v", "8M", "-f", "null", "-"],
  { encoding: "utf8", windowsHide: true }).status === 0;
const gpu = argv.includes("--sin-gpu") ? null : CANDIDATOS.find((e) => listados.includes(e) && probar(e));
R.gpu = { codificador: gpu || null, probados: CANDIDATOS.filter((e) => listados.includes(e)) };
if (argv.includes("--sin-gpu")) anotar("GPU: no se midió (--sin-gpu).");
else if (!gpu) anotar(`GPU: ningún codificador por hardware funcionó en este ffmpeg (probé: ${R.gpu.probados.join(", ") || "ninguno disponible"}). Queda libx264.`);
else {
  // Con NVENC el render usa a lo más 8 sesiones (ver render-nativo.mjs): se mide también la CPU con esos mismos trabajadores,
  // para separar el efecto del codificador del de tener menos navegadores a la vez.
  const tope = /_nvenc$/.test(gpu) ? Number(process.env.RENDER_SESIONES_NVENC || 8) : null;
  anotar(`GPU (${gpu}${tope ? `, ${tope} sesiones a la vez` : ""}) contra CPU (libx264), solo el render, intercalados, mediana de ${REPS}, a igual tasa de bits:`);
  R.gpu.sesiones = tope;
  R.gpu.refs = {};
  for (const ref of ["ref20", "ref90"]) {
    const src = path.join(AQUI, "referencias", ref);
    const meta = JSON.parse(readFileSync(path.join(src, "meta.json"), "utf8"));
    const D = path.join(TRABAJO, `gpu-${ref}`);
    rmSync(D, { recursive: true, force: true });
    cpSync(src, D, { recursive: true });
    const log = path.join(D, "gpu.log");
    if (existsSync(path.join(D, "construir.mjs"))) { const k = correr(NODE, ["construir.mjs"], D, log); if (k.code) fallar(`construir de ${ref}`, log); }
    const env = { ...ENV, REELSMITH_TIEMPOS: path.join(D, "tiempos.jsonl") };
    // devuelve segundos y segmentos repetidos (la última línea del render lo dice)
    const dibujar = (salida, extra = [], e = env) => {
      const k = correr(NODE, [path.join(S, "render-nativo.mjs"), "escena.html", salida, "--duracion", String(meta.duracion_s), "--sin-cache", ...extra], D, log, e);
      if (k.code) fallar(`render de ${ref} (${salida})`, log);
      const m = k.out.match(/(\d+) segmento\(s\) repetido/);
      return { s: k.s, repetidos: m ? Number(m[1]) : 0 };
    };
    console.log(`[${ref}] calibración con CPU…`);
    dibujar("calibracion.mp4");
    const bps = salida1("ffprobe", ["-v", "error", "-show_entries", "format=bit_rate", "-of", "csv=p=0", path.join(D, "calibracion.mp4")]);
    const v = { cpu: [], gpu: [], ...(tope ? { cpu_igual: [] } : {}) };
    for (let i = 0; i < REPS; i++) {
      console.log(`[${ref}] repetición ${i + 1} de ${REPS}: CPU${tope ? `, CPU con ${tope} trabajadores` : ""} y GPU…`);
      v.cpu.push(dibujar(`cpu-${i}.mp4`));
      if (tope) v.cpu_igual.push(dibujar(`cpu${tope}-${i}.mp4`, ["--trabajadores", String(tope)]));
      v.gpu.push(dibujar(`gpu-${i}.mp4`, ["--codificador", gpu], { ...env, RENDER_BITRATE: bps }));
    }
    const med = (xs) => r1(mediana(xs.map((x) => x.s)));
    const rep = (xs) => xs.reduce((a, x) => a + x.repetidos, 0);
    const mc = med(v.cpu), mg = med(v.gpu), mi = tope ? med(v.cpu_igual) : null;
    const kb = (f) => Math.round(statSync(path.join(D, f)).size / 1024);
    const sm = ssim(path.join(D, "gpu-0.mp4"), path.join(D, "cpu-0.mp4"));
    R.gpu.refs[ref] = { duracion_s: meta.duracion_s, cpu_s: v.cpu.map((x) => r1(x.s)), gpu_s: v.gpu.map((x) => r1(x.s)), cpu_mediana_s: mc, gpu_mediana_s: mg,
      cambio_pct: Math.round((mg / mc - 1) * 1000) / 10, ...(tope ? { cpu_mismos_trabajadores_s: v.cpu_igual.map((x) => r1(x.s)), cpu_mismos_trabajadores_mediana_s: mi } : {}),
      segmentos_repetidos: { cpu: rep(v.cpu), gpu: rep(v.gpu), ...(tope ? { cpu_mismos_trabajadores: rep(v.cpu_igual) } : {}) },
      ssim_gpu_contra_cpu: sm, kb_cpu: kb("cpu-0.mp4"), kb_gpu: kb("gpu-0.mp4"), tasa_bits_bps: Number(bps) };
    anotar(`[${ref}] CPU ${coma(mc)} s · GPU ${coma(mg)} s (${mg <= mc ? "−" : "+"}${coma(Math.abs(R.gpu.refs[ref].cambio_pct))} %)` +
      (tope ? ` · CPU con ${tope} trabajadores ${coma(mi)} s` : "") +
      ` · SSIM GPU contra CPU ${sm} · ${kb("cpu-0.mp4")} KB contra ${kb("gpu-0.mp4")} KB · segmentos repetidos: ${JSON.stringify(R.gpu.refs[ref].segmentos_repetidos)}`);
  }
}
anotar();
anotar(`Listo. Resumen: ${RES}.txt`);
