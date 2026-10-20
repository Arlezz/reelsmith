#!/usr/bin/env node
// reelsmith.mjs: el comando de Reelsmith. Lo usan las personas, los agentes y el benchmark. Instalado con `npm link`
// desde el repo, se llama `reelsmith`; sin instalar, `node <skill>/scripts/reelsmith.mjs`.
//
//   reelsmith doctor                                   revisa Node, ffmpeg, Python, sus paquetes y el navegador
//   reelsmith nuevo <carpeta>                          carpeta de proyecto con un guion de ejemplo
//   reelsmith video [guion.json] [opciones de final]   construir + vista + final de una vez (sin agente)
//   reelsmith prueba [carpeta]                         la prueba completa (plantilla y catálogo, con jueces)
//   reelsmith medir [opciones]                         mide este computador (bench/medir-equipo.mjs; solo desde el repo)
//   reelsmith --docker <comando>                       el mismo comando dentro del contenedor, sobre la carpeta actual
//   reelsmith version
//
//   node reelsmith.mjs construir [guion.json]         guion → escena.html, plan_cortes.json, escenas.json, storyboard.md
//   node reelsmith.mjs vista [--escena e3,e5]          cuadros clave a media resolución → vista.png (o vista-1.png, …)
//   node reelsmith.mjs final --estilo corporativa      render final + música + mezcla + jueces → <nombre>.mp4
//        [--nombre showreel] [--trabajadores N] [--sin-musica] [--preset medium] [--sin-cache] [--sin-prioridad] [--duracion s] [--codificador h264_videotoolbox]
//   node reelsmith.mjs tiempos                         desglose de tiempos de la corrida
//   node reelsmith.mjs marca <etapa> [--nota "…"]      lo mismo que python3 tiempos.py marca (sirve igual en Windows)
//
// "final" hace en paralelo lo que no depende entre sí: mientras se dibuja el video, compone la música desde el plan de
// cortes (los tiempos del catálogo caen en cuadros exactos), la mezcla y la mide. Al terminar el video, une el audio sin
// recodificar y corre los jueces sobre el MP4 (check-audio por cada principal y medir_cortes). Si un corte medido no
// coincide con el plan, recompone la música con los cortes medidos (respaldo para escenas escritas a mano).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscarPython, ENV_PYTHON, NODE, pythonArgs, python, VENV } from "./entorno.mjs";

const S = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(S);
const RAIZ = path.dirname(path.dirname(SKILL));  // la raíz del repo (o del plugin instalado)
const [cmd, ...resto] = process.argv.slice(2);
const opt = (k, def) => { const i = resto.indexOf("--" + k); return i >= 0 ? resto[i + 1] : def; };
const tiene = (k) => resto.includes("--" + k);
const LOG = "reelsmith.log";
const VERSION = (() => {
  for (const f of [path.join(RAIZ, "package.json"), path.join(RAIZ, ".claude-plugin", "plugin.json")]) {
    try { return JSON.parse(readFileSync(f, "utf8")).version; } catch { /* */ }
  }
  return "?";
})();

// ---------------------------------------------------------------- --docker: el mismo comando dentro del contenedor
if (process.argv.includes("--docker")) {
  const args = process.argv.slice(2).filter((a) => a !== "--docker");
  const imagen = process.env.REELSMITH_IMAGEN || "reelsmith";
  const dargs = ["run", "--rm", ...(process.stdout.isTTY ? ["-t"] : []), "-v", `${process.cwd()}:/trabajo`, "-w", "/trabajo"];
  // en Linux los archivos nuevos quedan con el usuario de quien corre, no de root
  if (process.platform === "linux" && process.getuid) dargs.push("--user", `${process.getuid()}:${process.getgid()}`, "-e", "HOME=/tmp");
  for (const k of ["RENDER_MODO", "RENDER_ESPERA_MAX_S"]) if (process.env[k]) dargs.push("-e", `${k}=${process.env[k]}`);
  const hay = spawnSync("docker", ["image", "inspect", imagen], { stdio: "ignore" });
  if (hay.error) { console.error(`no encontré docker (${hay.error.message}): instala Docker Desktop o Docker Engine`); process.exit(2); }
  if (hay.status !== 0 && !imagen.includes("/")) {
    console.error(`no existe la imagen "${imagen}" (o Docker no está corriendo). Constrúyela una vez desde el repo: docker build -t ${imagen} ${RAIZ}`);
    process.exit(2);
  }
  const r = spawnSync("docker", [...dargs, imagen, ...args], { stdio: "inherit" });
  if (r.error) {
    console.error(`no pude correr docker (${r.error.message}). Instala Docker y construye la imagen desde el repo: docker build -t ${imagen} .`);
    process.exit(2);
  }
  process.exit(r.status ?? 1);
}

function correr(prog, args, { silencioso = true, env = {}, alIniciar } = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(prog, args, { env: { ...process.env, ...env } });
    if (alIniciar) alIniciar(p);
    let out = "";
    p.stdout.on("data", (d) => { out += d; if (!silencioso) process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; if (!silencioso) process.stderr.write(d); });
    p.on("close", (code) => {
      appendFileSync(LOG, `$ ${prog} ${args.join(" ")}\n# ${((Date.now() - t0) / 1000).toFixed(1)} s, código ${code}\n${out.slice(-6000)}\n`);
      res({ code, out, s: (Date.now() - t0) / 1000 });
    });
  });
}
const py = (script, args, o = {}) => correr(python().cmd, pythonArgs(path.join(S, script), ...args), { ...o, env: { ...ENV_PYTHON, ...(o.env || {}) } });
const sha = (...partes) => createHash("sha256").update(partes.join("\u0000")).digest("hex").slice(0, 24);
const registrar = (etapa, t0, datos) => {  // misma línea que tiempos.py; nunca hace fallar la corrida
  try {
    const t1 = Date.now() / 1000;
    appendFileSync(process.env.REELSMITH_TIEMPOS || "tiempos.jsonl", JSON.stringify({ v: 1, tipo: "maquina", etapa, t0: Number(t0.toFixed(3)),
      t1: Number(t1.toFixed(3)), s: Number((t1 - t0).toFixed(3)), pid: process.pid, datos }) + "\n");
  } catch { /* */ }
};
const nd = (script, args, o) => correr(NODE, [path.join(S, script), ...args], o);
// subcomando de este mismo archivo, con la salida a la vista
const yo = (...args) => spawnSync(NODE, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit" }).status ?? 1;

if (cmd === "version" || cmd === "--version") {
  console.log(`reelsmith ${VERSION}`);
  process.exit(0);
}

if (!cmd || cmd === "ayuda" || cmd === "--help" || cmd === "-h") {
  console.log(`reelsmith ${VERSION}: showreels desde un guion, con música compuesta por código

  reelsmith doctor                      revisa lo que hace falta y dice cómo instalarlo
  reelsmith nuevo <carpeta>             carpeta de proyecto con un guion de ejemplo
  reelsmith video [guion.json]          construir + vista + final de una vez
  reelsmith construir [guion.json]      guion → escena.html, plan de cortes, storyboard
  reelsmith vista [--escena e3,e5]      cuadros clave a media resolución (vista.png)
  reelsmith final --estilo corporativa  video + música + mezcla + jueces → showreel-corporativa.mp4
       [--estilo trailer] [--nombre x] [--sin-musica] [--sin-cache] [--codificador h264_nvenc]
  reelsmith tiempos                     desglose de tiempos de la corrida
  reelsmith marca <etapa>               marca el inicio de una etapa del agente
  reelsmith prueba [carpeta]            prueba completa del pipeline, con jueces
  reelsmith medir [--repeticiones 3]    mide este computador (desde el repo)
  reelsmith --docker <comando>          lo mismo, dentro del contenedor (docker build -t reelsmith .)

Flujo y reglas: AGENTS.md y skills/reelsmith/SKILL.md.`);
  process.exit(cmd ? 0 : 2);
}

if (cmd === "doctor") {
  const filas = [];
  let falta = false;
  const fila = (estado, que, detalle) => { filas.push([estado, que, detalle]); if (estado === "FALTA") falta = true; };
  const salida = (prog, args) => { const r = spawnSync(prog, args, { encoding: "utf8" }); return r.error || r.status !== 0 ? null : (r.stdout || "").replace(/\r\n/g, "\n"); };
  const mayor = Number(process.versions.node.split(".")[0]);
  fila(mayor >= 22 && typeof WebSocket === "function" ? "ok" : "FALTA", "Node 22 o más", process.version);
  const ff = salida("ffmpeg", ["-hide_banner", "-version"]);
  fila(ff ? "ok" : "FALTA", "ffmpeg", ff ? ff.split("\n")[0].replace(/ Copyright.*/, "") : "no está en el PATH");
  fila(salida("ffprobe", ["-version"]) ? "ok" : "FALTA", "ffprobe", "");
  if (ff) {
    const conf = ff + (salida("ffmpeg", ["-hide_banner", "-buildconf"]) || "");
    fila(/libsoxr/.test(conf) ? "ok" : "aviso", "libsoxr en ffmpeg", /libsoxr/.test(conf) ? "sí" : "no: la mezcla usa el remuestreador de ffmpeg (mismo resultado en 48 kHz)");
  }
  const py = buscarPython();
  if (!py) fila("FALTA", "Python 3.11 o más", `probé: ${buscarPython.probados.join(", ")}`);
  else {
    const ver = salida(py.cmd, [...py.pre, "-c", "import sys; print(sys.version.split()[0]); print(sys.executable)"]) || "";
    const [v, exe] = ver.trim().split("\n");
    fila("ok", "Python", `${v} · ${exe}`);
    const pedidos = Object.fromEntries(readFileSync(path.join(S, "requirements.txt"), "utf8").split(/\r?\n/)
      .filter((l) => /^[\w-]+==/.test(l)).map((l) => l.split("==")));
    const codigo = `import importlib.metadata as m, json\nr = {}\nfor p in ${JSON.stringify(Object.keys(pedidos))}:\n    try: r[p] = m.version(p)\n    except Exception: r[p] = None\nprint(json.dumps(r))`;
    let tiene = {};
    try { tiene = JSON.parse(salida(py.cmd, [...py.pre, "-c", codigo]) || "{}"); } catch { /* */ }
    for (const [p, v] of Object.entries(pedidos)) {
      fila(!tiene[p] ? "FALTA" : tiene[p] === v ? "ok" : "aviso", `paquete ${p}`, !tiene[p] ? `falta (se pide ${v})` : tiene[p] === v ? v : `${tiene[p]} (se probó con ${v})`);
    }
  }
  const nav = spawnSync(NODE, [path.join(S, "render-nativo.mjs"), "--verificar"], { encoding: "utf8" });
  const lineaNav = (nav.stdout || "").split(/\r?\n/).find((l) => l.startsWith("navegador:"));
  const lineaModo = (nav.stdout || "").split(/\r?\n/).find((l) => l.startsWith("modo:"));
  fila(lineaNav ? "ok" : "FALTA", "navegador del render", lineaNav ? lineaNav.slice(11) : "no encontré chromium-headless-shell");
  if (lineaModo) fila("ok", "modo de render", lineaModo.slice(6));
  // el comando reelsmith del PATH, si lo hay, debe ser esta copia (con varios clones, npm link deja el último)
  if (process.platform !== "win32") {
    const este = realpathSync(fileURLToPath(import.meta.url));
    const enPath = (process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "reelsmith")).find((p) => existsSync(p));
    if (!enPath) fila("aviso", "comando reelsmith", "no está en el PATH: corre npm link en el repo (o usa node <repo>/skills/reelsmith/scripts/reelsmith.mjs)");
    else if (realpathSync(enPath) !== este) fila("aviso", "comando reelsmith", `el del PATH es otra copia (${realpathSync(enPath)}): corre npm link en ${RAIZ}`);
    else fila("ok", "comando reelsmith", enPath);
  }
  const dk = salida("docker", ["--version"]);
  fila(dk ? "ok" : "aviso", "Docker (opcional, para --docker)", dk ? dk.trim() : "no está: solo hace falta para correr en el contenedor");
  const ancho = Math.max(...filas.map((f) => f[1].length));
  for (const [e, q, d] of filas) console.log(`${e === "ok" ? "  ok   " : e === "aviso" ? "  aviso" : "  FALTA"}  ${q.padEnd(ancho)}  ${d}`);
  if (falta) {
    const req = path.join(S, "requirements.txt");
    console.log(`\nCómo instalar lo que falta${process.platform === "win32" ? " (Windows)" : process.platform === "darwin" ? " (macOS)" : " (Linux)"}:`);
    if (process.platform === "win32") {
      console.log(`  powershell -ExecutionPolicy Bypass -File ${path.join(RAIZ, "bench", "medir-windows.ps1")} -SoloInstalar`);
      console.log("  (instala con winget Node, ffmpeg y Python, crea el entorno de Python y el navegador, y corre la prueba completa)");
    } else {
      console.log(process.platform === "darwin" ? "  brew install node@22 ffmpeg python@3.13" : "  sudo apt install ffmpeg python3-venv   (y Node 22: https://nodejs.org)");
      console.log(`  python3 -m venv ${VENV} && ${path.join(VENV, "bin", "pip")} install -r ${req}`);
      console.log("  npx -y playwright@1.56.0 install chromium-headless-shell");
    }
    console.log("O sin instalar nada más que Docker: docker build -t reelsmith <repo> y luego reelsmith --docker <comando>.");
  } else console.log("\nTodo listo.");
  process.exit(falta ? 1 : 0);
}

if (cmd === "nuevo") {
  const destino = resto.find((a) => !a.startsWith("--"));
  if (!destino) { console.error("uso: reelsmith nuevo <carpeta>"); process.exit(2); }
  if (existsSync(destino) && readdirSync(destino).length) { console.error(`${destino} ya existe y no está vacía`); process.exit(2); }
  mkdirSync(destino, { recursive: true });
  cpSync(path.join(SKILL, "assets", "guion-ejemplo.json"), path.join(destino, "guion.json"));
  console.log(`listo: ${path.join(destino, "guion.json")} (guion de ejemplo de 43 s con todos los tipos de escena)

Siguientes pasos:
  cd ${destino}
  edita guion.json (tipos de escena y paletas: ${path.join(SKILL, "references", "catalogo.md")})
  reelsmith construir && reelsmith vista      revisa vista.png
  reelsmith final --estilo corporativa        o --estilo trailer
O todo de una vez: reelsmith video`);
  process.exit(0);
}

if (cmd === "video") {
  const guion = resto.find((a) => a.endsWith(".json")) || "guion.json";
  const resto2 = resto.filter((a) => a !== guion);
  if (!existsSync(guion)) { console.error(`no encontré ${guion}: crea uno con reelsmith nuevo <carpeta>`); process.exit(2); }
  for (const [etapa, args] of [["construir", [guion]], ["vista", []], ["final", resto2.length ? resto2 : ["--estilo", "corporativa"]]]) {
    console.log(`\n== ${etapa}`);
    const c = yo(etapa, ...args);
    if (c !== 0) { console.error(`falló ${etapa} (código ${c})`); process.exit(c); }
  }
  process.exit(0);
}

if (cmd === "prueba") {
  const carpeta = resto.find((a) => !a.startsWith("--")) || path.join(os.tmpdir(), "reelsmith-prueba");
  process.exit(spawnSync(NODE, [path.join(S, "prueba-completa.mjs"), carpeta, ...resto.filter((a) => a !== carpeta)], { stdio: "inherit" }).status ?? 1);
}

if (cmd === "medir") {
  const script = path.join(RAIZ, "bench", "medir-equipo.mjs");
  if (!existsSync(script)) { console.error("reelsmith medir corre desde el repo: falta bench/medir-equipo.mjs"); process.exit(2); }
  const extra = [];
  if (process.env.REELSMITH_EN_CONTENEDOR) {  // dentro del contenedor: los resultados quedan en la carpeta montada
    if (!resto.includes("--salida")) extra.push("--salida", path.resolve("resultados-medicion"));
    if (!resto.includes("--etiqueta")) extra.push("--etiqueta", "contenedor");
  }
  process.exit(spawnSync(NODE, [script, ...resto, ...extra], { stdio: "inherit" }).status ?? 1);
}

if (cmd === "construir") {
  const r = await nd("escenas.mjs", [resto.find((a) => !a.startsWith("--")) || "guion.json"], { silencioso: false });
  process.exit(r.code);
}

if (cmd === "vista") {
  const extra = opt("escena") ? ["--escena", opt("escena")] : [];
  const r = await nd("render-nativo.mjs", ["escena.html", "--vista", "vista.png", ...extra], { silencioso: false });
  process.exit(r.code);
}

if (cmd === "marca") {
  const r = await py("tiempos.py", ["marca", ...resto], { silencioso: false });
  process.exit(r.code);
}

if (cmd === "tiempos") {
  const r = await py("tiempos.py", ["informe"], { silencioso: false });
  process.exit(r.code);
}

if (cmd === "final") {
  const estilo = opt("estilo", "corporativa");
  const nombre = opt("nombre", "showreel");
  const t0 = Date.now();
  if (!existsSync("escena.html") || !existsSync("plan_cortes.json")) {
    console.error("falta escena.html o plan_cortes.json: corre antes `node reelsmith.mjs construir`");
    process.exit(2);
  }
  const html = readFileSync("escena.html", "utf8");
  const dur = Number(opt("duracion", (html.match(/data-duracion="([\d.]+)"/) || [])[1]));
  if (!Number.isFinite(dur) || dur <= 0) { console.error("falta la duración: --duracion o <html data-duracion>"); process.exit(2); }
  const plan = JSON.parse(readFileSync("plan_cortes.json", "utf8"));
  // cortes del plan en el formato de componer.py. Un tiempo escrito con 2 decimales (3.17) que está a menos de 7 ms de
  // un cuadro se lleva a ese cuadro (3.1667): es redondeo de quien escribió el plan, y el corte se ve en ese cuadro.
  const snap = (t) => (Math.abs(t * 30 - Math.round(t * 30)) < 0.2 ? Number((Math.round(t * 30) / 30).toFixed(4)) : t);
  const cortesPlan = plan.cortes.map((c) => ({ t: snap(c.t), nombre: c.nombre, peso: c.peso, detectado: null }));
  writeFileSync("cortes-plan.json", JSON.stringify({ duracion_video_s: dur, final_s: plan.final_s ?? null, cortes: cortesPlan }, null, 1));
  const renderArgs = [path.join(S, "render-nativo.mjs"), "escena.html", "video-mudo.mp4", "--hoja", "hoja.png", "--duracion", String(dur),
    ...(opt("trabajadores") ? ["--trabajadores", opt("trabajadores")] : []), ...(opt("preset") ? ["--preset", opt("preset")] : []),
    ...(opt("codificador") ? ["--codificador", opt("codificador")] : []),
    ...(tiene("sin-cache") ? ["--sin-cache"] : [])];
  // El render corre con prioridad baja (nice 10; en Windows, "por debajo de lo normal", que heredan el navegador y
  // ffmpeg): usa toda la CPU que sobra, pero no le quita CPU a la música, que es un solo hilo y si no se queda esperando
  // detrás del navegador (medido: la rama de audio pasaba de 69 s a 161 s).
  const bajarPrioridad = (p) => { try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* */ } };
  const renderVideo = () => tiene("sin-prioridad") ? correr(NODE, renderArgs)
    : process.platform === "win32" ? correr(NODE, renderArgs, { alIniciar: bajarPrioridad })
      : correr("nice", ["-n", "10", NODE, ...renderArgs]);
  // el tempo de la música es el del guion: los golpes internos de las escenas están en esa grilla
  const bpmArgs = plan.bpm_guion ? ["--bpm", String(plan.bpm_guion)] : [];
  const sinMusica = tiene("sin-musica");
  // Caché del audio: la música, la mezcla y su medición dependen solo de los cortes, el estilo, el tempo y el código de
  // audio (no del video). Cambiar textos o colores de una escena sin mover cortes reutiliza el audio entero.
  const versionFfmpeg = (spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout || "").split(/\r?\n/)[0];
  const codigoAudio = ["componer.py", "sintesis.py", "planificar_mezcla.py", "medir_pista.py", "perfil-profesional.json"]
    .map((f) => { try { return readFileSync(path.join(S, f)); } catch { return f; } });
  const audio = async (cortes) => {
    const ta = Date.now() / 1000;
    const clave = sha("audio-1", readFileSync(cortes), estilo, bpmArgs.join(" "), path.resolve("video-mudo.mp4"), versionFfmpeg, ...codigoAudio);
    const dirC = path.join(".cache", "audio", clave);
    if (!tiene("sin-cache") && existsSync(path.join(dirC, "listo.json"))) {
      rmSync("musica", { recursive: true, force: true });
      cpSync(path.join(dirC, "musica"), "musica", { recursive: true });
      for (const f of ["medicion.json", "medicion.png"]) if (existsSync(path.join(dirC, f))) cpSync(path.join(dirC, f), f);
      const listo = JSON.parse(readFileSync(path.join(dirC, "listo.json"), "utf8"));
      registrar("musica_cache", ta, { clave });
      return { ok: true, ...listo, cache: true };
    }
    const c = await py("componer.py", [cortes, "--estilo", estilo, "--salida", "musica", "--video", path.resolve("video-mudo.mp4"), ...bpmArgs]);
    if (c.code) return { ok: false, paso: "componer", out: c.out };
    const m = await py("planificar_mezcla.py", ["musica/variante.json", "--solo-audio"]);
    if (m.code) return { ok: false, paso: "mezcla", out: m.out };
    const j = await py("medir_pista.py", ["musica/composicion.json", "--wav", "musica/stems/musica.wav", "--png", "medicion.png", "--json", "medicion.json"]);
    if (!existsSync("medicion.json")) return { ok: false, paso: "medir_pista", out: j.out };
    const listo = { medir_pista: JSON.parse(readFileSync("medicion.json", "utf8")).resultado, componer: c.out.trim().split("\n").pop() };
    try {  // se guarda completo o no se guarda (rename atómico)
      const tmp = `${dirC}.tmp-${process.pid}`;
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      cpSync("musica", path.join(tmp, "musica"), { recursive: true });
      for (const f of ["medicion.json", "medicion.png"]) if (existsSync(f)) cpSync(f, path.join(tmp, f));
      writeFileSync(path.join(tmp, "listo.json"), JSON.stringify(listo));
      rmSync(dirC, { recursive: true, force: true });
      renameSync(tmp, dirC);
    } catch { /* sin caché: no es un error */ }
    return { ok: true, ...listo, cache: false };
  };
  // Con final_s en el plan (el catálogo siempre lo trae), el plan basta para componer mientras se dibuja. Sin final_s
  // (un plan escrito a mano), el asentamiento del logo se mide en el video: la música va después, con los cortes medidos.
  const especulativo = plan.final_s != null;
  const medirCortes = () => py("medir_cortes.py", ["video-mudo.mp4", "--plan", "plan_cortes.json", "--salida", "cortes.json"]);
  let rv, ra, rc0 = null;
  console.log(`final: render${sinMusica ? "" : especulativo ? " ∥ música + mezcla + medir_pista" : ", cortes, música + mezcla + medir_pista"} …`);
  if (sinMusica || especulativo) {
    [rv, ra] = await Promise.all([renderVideo(), sinMusica ? Promise.resolve(null) : audio("cortes-plan.json")]);
  } else {
    console.log("el plan no trae final_s: la música se compone después del render, con los cortes medidos (agrega final_s al plan para hacerlo en paralelo)");
    rv = await renderVideo();
  }
  if (rv.code) { console.error(rv.out.slice(-3000)); process.exit(2); }
  console.log(rv.out.trim().split("\n").pop());
  if (sinMusica) {
    const rc = await medirCortes();
    console.log(`listo: video-mudo.mp4 (sin música) · cortes: ${rc.out.trim().split("\n").pop()} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(rc.code);
  }
  if (!especulativo) {
    rc0 = await medirCortes();
    if (rc0.code) { console.error(rc0.out.slice(-3000)); process.exit(2); }
    ra = await audio("cortes.json");
  }
  if (!ra.ok) { console.error(`falló ${ra.paso}:\n${ra.out.slice(-3000)}`); process.exit(2); }
  // unir y los jueces en paralelo: check-audio (uno por principal) sobre el MP4 unido mientras medir_cortes mide el video
  const salida = `${nombre}-${estilo}.mp4`;
  const unir = () => correr("ffmpeg", ["-y", "-v", "error", "-i", "video-mudo.mp4", "-i", "musica/audio.m4a", "-map", "0:v", "-map", "1:a", "-c", "copy",
    "-t", String(dur), "-movflags", "+faststart", salida]);
  const principales = (especulativo ? cortesPlan : JSON.parse(readFileSync("cortes.json", "utf8")).cortes).filter((c) => c.peso >= 1).map((c) => c.t);
  const unirYChequear = async () => {
    const u = await unir();
    if (u.code) return { u, checks: [] };
    return { u, checks: await Promise.all(principales.map((t) => nd("check-audio.mjs", [salida, "--expect", String(t), "--marker", "musica/sfx-impacto.wav"]))) };
  };
  let [uc, rc] = await Promise.all([unirYChequear(), rc0 ? Promise.resolve(rc0) : medirCortes()]);
  if (uc.u.code || rc.code) { console.error((uc.u.out + rc.out).slice(-3000)); process.exit(2); }
  const cortes = JSON.parse(readFileSync("cortes.json", "utf8"));
  const tPlan = new Map(cortesPlan.map((c) => [c.nombre, c.t]));
  const corridos = cortes.cortes.filter((c) => c.detectado && c.peso >= 0.6 && Math.abs(c.t - (tPlan.get(c.nombre) ?? c.t)) > 0.001)
    .map((c) => ({ ...c, deriva_ms: Number(((c.t - tPlan.get(c.nombre)) * 1000).toFixed(1)) }));
  let recompuesto = false;
  if (especulativo && corridos.length) {
    // el video no coincide con el plan en algún corte duro: la música se rehace con los cortes medidos y se vuelve a juzgar
    console.log(`aviso: ${corridos.length} corte(s) medidos fuera del plan (${corridos.map((c) => `${c.nombre}: ${c.deriva_ms} ms`).join("; ")}); recompongo con los cortes medidos`);
    const ra2 = await audio("cortes.json");
    if (!ra2.ok) { console.error(`falló ${ra2.paso}:\n${ra2.out.slice(-3000)}`); process.exit(2); }
    Object.assign(ra, ra2);
    principales.splice(0, principales.length, ...cortes.cortes.filter((c) => c.peso >= 1).map((c) => c.t));
    uc = await unirYChequear();
    recompuesto = true;
  }
  const checks = uc.checks;
  const pasa = checks.every((c) => c.code === 0);
  const resumen = { mp4: salida, duracion_s: dur, render: rv.out.trim().split("\n").pop(), musica: ra.componer, audio_de_cache: ra.cache, recompuesto,
    check_audio: checks.map((c, i) => `${principales[i]} s: ${c.code === 0 ? "PASA" : "FALLA"}`), medir_pista: ra.medir_pista,
    musica_desde: especulativo ? (recompuesto ? "cortes medidos (recompuesta)" : "plan, en paralelo con el render") : "cortes medidos, después del render",
    cortes_fuera_del_plan: corridos.length, segundos: Number(((Date.now() - t0) / 1000).toFixed(1)) };
  writeFileSync("final.json", JSON.stringify(resumen, null, 1));
  console.log(JSON.stringify(resumen, null, 1));
  if (!pasa) console.log("check-audio FALLA: ver reelsmith.log");
  process.exit(pasa ? 0 : 1);
}

console.error(`no conozco el comando "${cmd}". Ver: reelsmith ayuda`);
process.exit(2);
