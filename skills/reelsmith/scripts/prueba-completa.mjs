// prueba-completa.mjs: corre el pipeline completo sobre la plantilla y el guion de ejemplo, y deja todo en una carpeta.
// Sirve para comprobar una instalación y como prueba de regresión después de tocar los scripts. Corre igual en Linux,
// macOS y Windows (antes era solo bash: prueba-completa.sh ahora llama a este archivo).
//
// Uso: node prueba-completa.mjs carpeta-de-salida [corporativa|trailer|ambos]   (por defecto: ambos)
// Prueba la vía manual (la plantilla, en los dos estilos) y la del catálogo (assets/guion-ejemplo.json con reelsmith.mjs).
// Tarda unos 4 minutos en 2 núcleos. Sale con código distinto de 0 si algún paso o juez falla.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_PYTHON, NODE, md5, python, pythonArgs } from "./entorno.mjs";

const S = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(S);
const [salidaArg, estilosArg = "ambos"] = process.argv.slice(2);
if (!salidaArg) { console.error("uso: node prueba-completa.mjs carpeta-de-salida [corporativa|trailer|ambos]"); process.exit(2); }
const ESTILOS = estilosArg === "ambos" ? ["corporativa", "trailer"] : [estilosArg];
mkdirSync(salidaArg, { recursive: true });
const OUT = path.resolve(salidaArg);
const ENV = { ...process.env, ...ENV_PYTHON };

// corre un comando con la salida a la vista (o capturada); si falla y no se pidió tolerar, termina la prueba
function correr(cmd, args, cwd, { capturar = false, tolerar = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: "utf8", stdio: capturar ? ["ignore", "pipe", "pipe"] : "inherit", maxBuffer: 1 << 28 });
  if (r.error) { console.error(`no pude correr ${cmd}: ${r.error.message}`); process.exit(2); }
  if (r.status !== 0 && !tolerar) {
    if (capturar) process.stderr.write((r.stdout || "") + (r.stderr || ""));
    console.error(`falló: ${path.basename(cmd)} ${args.map((a) => path.basename(String(a))).join(" ")} (código ${r.status})`);
    process.exit(r.status || 1);
  }
  return r;
}
const nodo = (cwd, script, ...args) => correr(NODE, [script, ...args], cwd);
// -I (aislado) como en la versión de bash; componer.py corre sin -I
const py = (cwd, script, args, o = {}) =>
  correr(python().cmd, pythonArgs(...(o.aislado === false ? [] : ["-I"]), path.join(S, script), ...args), cwd, o);
const escribirMd5 = (cwd, archivos, destino) => {
  const txt = archivos.map((a) => `${md5(path.join(cwd, a))}  ${a}`).join("\n") + "\n";
  if (destino) writeFileSync(path.join(cwd, destino), txt);
  process.stdout.write(txt);
};

// ningún cuadro puede quedar vacío: liso y del color del fondo de la plantilla (#090E50, luma ~33). Pasaba en los cortes
// cuando el delay caía justo en el cuadro, y en el cuadro 0 cuando la portada entraba desde opacidad 0
const REVISAR_CUADROS = `
import json, subprocess, sys
video, cortes = sys.argv[1], sys.argv[2]
out = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"],
                     capture_output=True, text=True, check=True).stdout
fr, cur = [], {}
for l in out.splitlines():
    if l.startswith("frame:"):
        cur = {}; fr.append(cur)
    elif "YMIN=" in l or "YMAX=" in l or "YAVG=" in l:
        k, v = l.split("lavfi.signalstats.")[1].split("=")
        cur[k] = float(v)
vacios = [i for i, f in enumerate(fr) if f.get("YMAX", 0) - f.get("YMIN", 0) < 2 and abs(f.get("YAVG", 0) - 33) < 3]
plan = json.load(open(cortes, encoding="utf-8"))
malos = [c["nombre"] for c in plan["cortes"] if c.get("detectado") and c.get("deriva_ms") not in (0, 0.0) and c.get("peso", 0) >= 0.6]
print(f"cuadros vacíos: {vacios or 'ninguno'} · cortes con deriva: {malos or 'ninguno'}")
sys.exit(1 if vacios or malos else 0)
`;
const revisarCuadros = (cwd, video, cortes) => correr(python().cmd, pythonArgs("-I", "-c", REVISAR_CUADROS, video, cortes), cwd);
const leerJson = (f) => JSON.parse(readFileSync(f, "utf8"));

// ---------------------------------------------------------------- vía manual: la plantilla
const P = path.join(OUT, "proyecto");
rmSync(P, { recursive: true, force: true });
cpSync(path.join(SKILL, "assets", "plantilla"), P, { recursive: true });
cpSync(path.join(S, "utilidades.mjs"), path.join(P, "utilidades.mjs"));
const t0 = Date.now();
nodo(P, "construir.mjs");
nodo(P, path.join(S, "render-nativo.mjs"), "escena.html", "video-mudo.mp4", "--hoja", "hoja.png");
escribirMd5(P, ["video-mudo.mp4"], "video-mudo.md5");
py(P, "medir_cortes.py", ["video-mudo.mp4", "--plan", "plan_cortes.json", "--salida", "cortes.json"]);
revisarCuadros(P, "video-mudo.mp4", "cortes.json");
const principal = leerJson(path.join(P, "cortes.json")).cortes.find((c) => c.peso >= 1).t;
for (const e of ESTILOS) {
  const m = `musica-${e}`;
  py(P, "componer.py", ["cortes.json", "--estilo", e, "--salida", m, "--video", "video-mudo.mp4"], { aislado: false });
  escribirMd5(P, readdirSync(path.join(P, m)).filter((f) => f.endsWith(".wav")).sort().map((f) => `${m}/${f}`), `${m}/wav.md5`);
  const mz = py(P, "planificar_mezcla.py", [`${m}/variante.json`], { capturar: true });
  writeFileSync(path.join(P, m, "mezcla.log"), mz.stdout + mz.stderr);
  const ca = correr(NODE, [path.join(S, "check-audio.mjs"), `${m}/musica-${e}.mp4`, "--expect", String(principal), "--marker", `${m}/sfx-impacto.wav`],
    P, { capturar: true, tolerar: true });
  process.stdout.write(ca.stdout.split(/\r?\n/).filter((l) => /^\s+\[|resultado/.test(l)).join("\n") + "\n");
  if (ca.status !== 0) { console.error(`check-audio no pasó (estilo ${e}):\n${ca.stdout}${ca.stderr}`); process.exit(1); }
  py(P, "medir_pista.py", [`${m}/composicion.json`, "--wav", `${m}/stems/musica.wav`, "--png", `${m}/medicion.png`, "--json", `${m}/medicion.json`],
    { capturar: true, tolerar: true });  // REVISAR no hace fallar la prueba: es un juicio para el oído
  const d = leerJson(path.join(P, m, "medicion.json"));
  console.log("  medir_pista:", d.resultado, JSON.stringify(Object.fromEntries(Object.entries(d.criterios).map(([k, v]) => [k, v.pasa]))));
}
console.log(`plantilla lista en ${Math.round((Date.now() - t0) / 1000)} s: ${P}`);

// ---------------------------------------------------------------- vía del catálogo (la normal)
// guion → construir → vista → final, que corre sus propios jueces y sale con 1 si check-audio falla
const t1 = Date.now();
const C = path.join(OUT, "catalogo");
rmSync(C, { recursive: true, force: true });
mkdirSync(C, { recursive: true });
cpSync(path.join(SKILL, "assets", "guion-ejemplo.json"), path.join(C, "guion.json"));
const sr = path.join(S, "reelsmith.mjs");
correr(NODE, [sr, "construir"], C, { capturar: true });
const sb = readFileSync(path.join(C, "storyboard.md"), "utf8");
const iAvisos = sb.search(/^Avisos/m);
if (iAvisos >= 0) { console.error("el guion de ejemplo dio avisos:\n" + sb.slice(iAvisos)); process.exit(1); }
nodo(C, sr, "vista");
const fin = correr(NODE, [sr, "final", "--estilo", "corporativa"], C, { capturar: true, tolerar: true });
writeFileSync(path.join(C, "final.log"), fin.stdout + fin.stderr);
if (fin.status !== 0) { process.stderr.write(fin.stdout + fin.stderr); process.exit(1); }
revisarCuadros(C, "video-mudo.mp4", "cortes.json");
const fj = leerJson(path.join(C, "final.json"));
console.log("  check-audio:", JSON.stringify(fj.check_audio), "· medir_pista:", fj.medir_pista, "· cortes fuera del plan:", fj.cortes_fuera_del_plan);
if (!(fj.medir_pista === "PASA" && fj.cortes_fuera_del_plan === 0)) process.exit(1);
if (!existsSync(path.join(C, "showreel-corporativa.mp4"))) { console.error("falta showreel-corporativa.mp4"); process.exit(1); }
escribirMd5(C, ["video-mudo.mp4", "showreel-corporativa.mp4"], "final.md5");
console.log(`catálogo listo en ${Math.round((Date.now() - t1) / 1000)} s: ${C}`);
