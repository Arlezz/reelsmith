// showreel.mjs: un comando para cada fase del video. Lo usan el agente y el benchmark.
//
//   node showreel.mjs construir [guion.json]         guion → escena.html, plan_cortes.json, escenas.json, storyboard.md
//   node showreel.mjs vista [--escena e3,e5]          cuadros clave a media resolución → vista.png (o vista-1.png, …)
//   node showreel.mjs final --estilo corporativa      render final + música + mezcla + jueces → <nombre>.mp4
//        [--nombre showreel] [--trabajadores N] [--sin-musica] [--preset medium] [--sin-cache] [--sin-prioridad] [--duracion s] [--codificador h264_videotoolbox]
//   node showreel.mjs tiempos                         desglose de tiempos de la corrida
//   node showreel.mjs marca <etapa> [--nota "…"]      lo mismo que python3 tiempos.py marca (sirve igual en Windows)
//
// "final" hace en paralelo lo que no depende entre sí: mientras se dibuja el video, compone la música desde el plan de
// cortes (los tiempos del catálogo caen en cuadros exactos), la mezcla y la mide. Al terminar el video, une el audio sin
// recodificar y corre los jueces sobre el MP4 (check-audio por cada principal y medir_cortes). Si un corte medido no
// coincide con el plan, recompone la música con los cortes medidos (respaldo para escenas escritas a mano).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_PYTHON, NODE, pythonArgs, python } from "./entorno.mjs";

const S = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...resto] = process.argv.slice(2);
const opt = (k, def) => { const i = resto.indexOf("--" + k); return i >= 0 ? resto[i + 1] : def; };
const tiene = (k) => resto.includes("--" + k);
const LOG = "showreel.log";

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
    appendFileSync(process.env.SHOWREEL_TIEMPOS || "tiempos.jsonl", JSON.stringify({ v: 1, tipo: "maquina", etapa, t0: Number(t0.toFixed(3)),
      t1: Number(t1.toFixed(3)), s: Number((t1 - t0).toFixed(3)), pid: process.pid, datos }) + "\n");
  } catch { /* */ }
};
const nd = (script, args, o) => correr(NODE, [path.join(S, script), ...args], o);

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
    console.error("falta escena.html o plan_cortes.json: corre antes `node showreel.mjs construir`");
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
  if (!pasa) console.log("check-audio FALLA: ver showreel.log");
  process.exit(pasa ? 0 : 1);
}

console.error("uso: node showreel.mjs construir [guion.json] | vista [--escena e3] | final --estilo corporativa|trailer [--nombre x] | tiempos");
process.exit(2);
