// render-nativo.mjs: convierte un HTML con animaciones CSS en un MP4 mudo, sin framework de video ni paquetes npm.
//
// Uso:
//   node render-nativo.mjs escena.html video-mudo.mp4 [--hoja hoja.png] [--trabajadores N] [--preset veryfast]
//        [--crf 16] [--sin-cache] [--un-solo-paso] [--fps 30] [--duracion 20] [--codificador h264_videotoolbox]
//   node render-nativo.mjs escena.html --vista vista.png [--escena e3,e5] [--escala 0.5]
//   node render-nativo.mjs --verificar      (dice qué navegador, node y ffmpeg usará, sin renderizar)
//
// Render final: divide el video en segmentos (una escena por segmento si existe escenas.json, el manifiesto que
// escribe escenas.mjs; si no, en partes iguales), los dibuja en paralelo con N navegadores y los une sin recodificar.
// Cada segmento queda en .cache/render/<clave>.mp4; la clave incluye todo lo que cambia sus cuadros (el contenido de la
// escena y de las transiciones que la tocan, la base de estilos, fps, calidad, versión del render, navegador y
// ffmpeg). Cambiar una escena vuelve a dibujar solo esa escena; cambiar la paleta, todas. Una corrida interrumpida
// retoma desde los segmentos ya terminados.
// Vista: dibuja solo los cuadros que hay que mirar (por escena: el del corte, uno a media escena y el último), a media
// resolución, y arma hojas de contacto con etiquetas. Con --escena, solo esas escenas; el resto sale de la caché.
//
// Cada segmento se dibuja en una página nueva, desde su primer cuadro: el resultado no depende de qué otros segmentos
// se dibujaron antes ni de cuántos trabajadores hubo. Con beginFrame (Linux) el MP4 sale idéntico byte a byte entre
// corridas. En macOS beginFrame no existe: cae a capturas comunes y lo avisa.
//
// Navegador: CHROME_PATH, o el headless_shell de Playwright en PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright,
// ~/Library/Caches/ms-playwright, %LOCALAPPDATA%/ms-playwright o /opt/pw-browsers (lo instala
// `npx -y playwright@1.56.0 install chromium-headless-shell`, salvo que PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
// Contrato del HTML (references/construccion-html.md): 1920x1080, todo el movimiento con @keyframes, tiempos absolutos
// desde 0 s con animation-delay, sin JavaScript que cree animaciones después de cargar, fuentes locales.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_RENDER = "3";
const T_INICIO = Date.now();  // reloj desde el arranque del proceso (tiempos.jsonl)
const args = process.argv.slice(2);
const registrar = (etapa, datos) => {  // una línea JSON en tiempos.jsonl (o REELSMITH_TIEMPOS); nunca hace fallar el render
  try {
    const t1 = Date.now() / 1000, t0 = T_INICIO / 1000;
    appendFileSync(process.env.REELSMITH_TIEMPOS || "tiempos.jsonl", JSON.stringify({ v: 1, tipo: "maquina", etapa, t0: Number(t0.toFixed(3)),
      t1: Number(t1.toFixed(3)), s: Number((t1 - t0).toFixed(3)), pid: process.pid, datos }) + "\n");
  } catch { /* sin registro */ }
};
const conValor = new Set(["--fps", "--duracion", "--hoja", "--trabajadores", "--preset", "--crf", "--vista", "--escena", "--escala", "--cache", "--calidad-jpeg", "--codificador"]);
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && conValor.has(args[i - 1])));
const opt = (k, def) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : def; };
const tiene = (k) => args.includes("--" + k);
const [input, output = "video-mudo.mp4"] = pos;
const fps = Number(opt("fps", 30));
const W = 1920, H = 1080;

// beginFrame (cuadros exactos, MP4 idéntico byte a byte) en Linux y Windows; macOS no lo tiene y usa capturas comunes.
// RENDER_MODO=capturas o RENDER_MODO=beginFrame fuerza uno de los dos (por ejemplo, si un Chromium no responde a beginFrame).
function usaBeginFrame() {
  if (process.env.RENDER_MODO) return process.env.RENDER_MODO.toLowerCase() !== "capturas";
  return process.platform !== "darwin";
}

function buscarNavegador() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"), path.join(os.homedir(), "AppData", "Local", "ms-playwright"), "/opt/pw-browsers"];
  for (const b of bases.filter(Boolean)) {
    if (!existsSync(b)) continue;
    for (const d of readdirSync(b).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      for (const sub of ["chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-mac/headless_shell",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell", "chrome-win/headless_shell.exe",
        "chrome-headless-shell-win64/chrome-headless-shell.exe"]) {
        const p = path.join(b, d, sub);
        if (existsSync(p)) return p;
      }
      // otras arquitecturas (por ejemplo Linux arm64, en un contenedor en un Mac con chip M) pueden usar otra carpeta
      const nombres = new Set(["headless_shell", "headless_shell.exe", "chrome-headless-shell", "chrome-headless-shell.exe"]);
      const pila = [[path.join(b, d), 0]];
      while (pila.length) {
        const [dir, prof] = pila.pop();
        let entradas = [];
        try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entradas) {
          if (e.isFile() && nombres.has(e.name)) return path.join(dir, e.name);
          if (e.isDirectory() && prof < 3) pila.push([path.join(dir, e.name), prof + 1]);
        }
      }
    }
  }
  console.error("no encontré headless_shell: npx -y playwright@1.56.0 install chromium-headless-shell (o define CHROME_PATH)");
  process.exit(2);
}

if (tiene("verificar")) {
  const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  console.log(`navegador: ${buscarNavegador()}\nnode: ${process.version} (WebSocket: ${typeof WebSocket === "function" ? "sí" : "NO: usa node 22 o más"})\n` +
    `ffmpeg: ${ff.status === 0 ? ff.stdout.split(/\r?\n/)[0] : "NO encontrado"}\nmodo: ${usaBeginFrame() ? "beginFrame (MP4 idéntico byte a byte)" : "capturas comunes"} · sistema: ${process.platform}\n` +
    `CPU: ${os.cpus().length} · memoria libre: ${Math.round(os.freemem() / 1048576)} MB · trabajadores por defecto: ${trabajadoresAuto(99)}`);
  process.exit(ff.status === 0 && typeof WebSocket === "function" ? 0 : 2);
}
if (!input) {
  console.error("uso: node render-nativo.mjs escena.html video-mudo.mp4 [--hoja hoja.png] [--trabajadores N] | escena.html --vista vista.png [--escena e3] | --verificar");
  process.exit(2);
}

// Trabajadores: dos por CPU. Cada cuadro espera la ida y vuelta con el navegador (beginFrame) y en esa espera la CPU
// queda ociosa; con dos navegadores por núcleo se llena (medido en 2 vCPU: 1 trabajador 75 % de CPU ocupada, 4
// trabajadores 96 %, render de 20 s de 82 s a 50 s). Cada navegador usa unos 450 MB: se deja 1 GB libre.
function trabajadoresAuto(segmentos) {
  // En macOS, os.freemem() cuenta solo las páginas libres (la memoria en caché o comprimible no entra) y suele dar 1 o 2
  // GB aunque sobre: ahí se estima con la memoria total. El tope real entre renders lo ponen los cupos (más abajo).
  const libreMb = process.platform === "darwin" ? os.totalmem() / 1048576 - 2048 : os.freemem() / 1048576 - 1024;
  const porMem = Math.max(1, Math.floor(libreMb / 500));
  return Math.max(1, Math.min(2 * os.cpus().length, porMem, segmentos));
}

// Cupos de trabajadores compartidos por todos los renders de la máquina (archivos de bloqueo en la carpeta temporal).
// Cada navegador con su página ocupa ~650 MB: con dos videos a la vez, cada uno con 4 trabajadores en 8 GB, el
// sistema mató páginas por falta de memoria (medido en el red team). Con cupos, el segundo video espera turno.
const DIR_CUPOS = path.join(os.tmpdir(), "reelsmith-render-cupos");
const CUPOS = Math.max(1, Math.min(2 * os.cpus().length, Math.floor((os.totalmem() / 1048576 - 1536) / 700)));
const misCupos = new Set();
async function tomarCupo() {
  mkdirSync(DIR_CUPOS, { recursive: true });
  for (;;) {
    for (let i = 0; i < CUPOS; i++) {
      const f = path.join(DIR_CUPOS, `cupo-${i}`);
      try {
        const fd = openSync(f, "wx");
        writeSync(fd, String(process.pid));
        closeSync(fd);
        misCupos.add(f);
        return f;
      } catch {
        // ocupado: si su dueño ya no existe (una corrida que se cortó), se libera
        try {
          const pid = Number(readFileSync(f, "utf8"));
          if (pid > 0) process.kill(pid, 0);
        } catch (e) { if (e.code === "ESRCH") { try { rmSync(f); } catch { /* */ } } }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
function soltarCupo(f) { if (f && misCupos.delete(f)) { try { rmSync(f); } catch { /* */ } } }
const procesosNav = new Set();  // navegadores vivos: se cierran si el render se corta
process.on("exit", () => {
  for (const f of misCupos) { try { rmSync(f); } catch { /* */ } }
  for (const p of procesosNav) { try { p.kill("SIGKILL"); } catch { /* */ } }
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

const deterministico = usaBeginFrame();
const NAVEGADOR = buscarNavegador();
const RAPIDO = tiene("captura-rapida");               // experimento: optimizeForSpeed en la captura
const CALIDAD = Number(opt("calidad-jpeg", 92));      // calidad del JPEG intermedio (92 por defecto)
// Ninguna llamada a Chromium tarda más que esto (un cuadro tarda menos de 1 s, y unos 3 s con dos videos a la vez): si
// pasa, el navegador se colgó y el segmento (o la vista) se repite con uno nuevo. Medido: con dos videos a la vez, 2 de
// 4 trabajadores quedaron esperando para siempre (páginas muertas por falta de memoria), y una vista de 3 cuadros, sin
// carga, esperó para siempre un HeadlessExperimental.beginFrame.
const ESPERA_MAX_MS = Number(process.env.RENDER_ESPERA_MAX_S || 30) * 1000;
const REINTENTOS = 2;
const sha = (...xs) => createHash("sha256").update(xs.join("\u0000")).digest("hex").slice(0, 24);
const versionFfmpeg = (spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout || "").split(/\r?\n/)[0];

// ---------------------------------------------------------------- un navegador por trabajador
async function lanzarNavegador() {
  const perfil = mkdtempSync(path.join(os.tmpdir(), "render-nativo-"));
  const banderas = ["--headless", "--remote-debugging-port=0", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    "--font-render-hinting=none", "--no-first-run", `--user-data-dir=${perfil}`, ...(deterministico ? ["--deterministic-mode"] : []),
    "--num-raster-threads=2",  // -7 % de tiempo en 2 vCPU; los cuadros salen idénticos (verificado con framemd5)
    ...(process.env.RENDER_BANDERAS ? process.env.RENDER_BANDERAS.split(" ") : []), "about:blank"];
  const nav = spawn(NAVEGADOR, banderas, { stdio: ["ignore", "ignore", "pipe"] });
  procesosNav.add(nav);
  nav.on("exit", () => procesosNav.delete(nav));
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    nav.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); });
    nav.on("exit", (c) => rej(new Error("el navegador terminó al partir (código " + c + "):\n" + buf)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let nid = 0;
  const pend = new Map(), eventos = [];
  const fallarTodo = (motivo) => { for (const [i, p] of pend) { pend.delete(i); p.rej(new Error(motivo)); } };
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else {
      eventos.push(m);
      // una página que se cae no responde nunca lo que tenía pendiente
      if (m.method === "Inspector.targetCrashed" || m.method === "Target.targetCrashed") fallarTodo("la página del navegador se cayó");
    }
  });
  ws.addEventListener("close", () => fallarTodo("se cerró la conexión con el navegador"));
  nav.on("exit", () => fallarTodo("el navegador terminó"));
  const enviar = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++nid;
    const reloj = setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(`el navegador no respondió ${method} en ${ESPERA_MAX_MS / 1000} s`)); } }, ESPERA_MAX_MS);
    pend.set(i, { res: (v) => { clearTimeout(reloj); res(v); }, rej: (e) => { clearTimeout(reloj); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const cerrar = () => { try { ws.close(); } catch { /* */ } try { nav.kill("SIGKILL"); } catch { /* */ } try { rmSync(perfil, { recursive: true, force: true }); } catch { /* */ } };
  return { enviar, eventos, cerrar };
}

// Página nueva (contexto propio) con la escena cargada y todas las animaciones en pausa.
async function abrirPagina(nav, url, escala) {
  const { browserContextId } = await nav.enviar("Target.createBrowserContext");
  const { targetId } = await nav.enviar("Target.createTarget", { url: "about:blank", width: W, height: H, browserContextId, enableBeginFrameControl: deterministico });
  const { sessionId } = await nav.enviar("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => nav.enviar(m, p, sessionId);
  const mios = () => nav.eventos.filter((e) => e.sessionId === sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Network.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: escala, mobile: false });
  const iv = 1000 / fps;
  let reloj = 0;
  const cuadro = (extra = {}) => deterministico
    ? s("HeadlessExperimental.beginFrame", { frameTimeTicks: (reloj += iv), interval: iv, ...extra })
    : Promise.resolve({});
  const evaluar = async (expr) => {
    const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const esperar = async (cond, n = 600) => {
    for (let k = 0; k < n; k++) {
      if (await cond()) return true;
      await cuadro({ noDisplayUpdates: true });
      if (!deterministico) await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };
  await s("Page.navigate", { url });
  if (!(await esperar(async () => mios().some((e) => e.method === "Page.loadEventFired")))) throw new Error("la página no terminó de cargar");
  await evaluar(`window.__listo = null; Promise.all([document.fonts.ready, ...[...document.images].map((im) => im.decode().catch(() => null))])
    .then(() => { document.getAnimations().forEach((a) => a.pause()); window.__listo = {
      n: document.getAnimations().length, dur: Number(document.documentElement.dataset.duracion || NaN),
      fuentes: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family))] }; }); 1`);
  if (!(await esperar(async () => (await evaluar("window.__listo")) !== null))) throw new Error("las fuentes o imágenes no terminaron de cargar");
  const info = await evaluar("window.__listo");
  const errores = mios().filter((e) => e.method === "Runtime.exceptionThrown" || e.method === "Network.loadingFailed")
    .map((e) => e.method === "Network.loadingFailed" ? "no cargó un recurso: " + e.params.errorText : "error de JavaScript: " + e.params.exceptionDetails.text);
  if (errores.length) throw new Error("errores al cargar la página:\n  " + errores.join("\n  "));
  let anterior = null;
  // La lista de animaciones se toma una vez (ya en pausa) y se reutiliza: pedir document.getAnimations() y pausar todo en
  // cada cuadro costaba 17 s de CPU en un video de 90 s. Cada 30 cuadros se revisa que no hayan aparecido animaciones
  // nuevas (el contrato lo prohíbe; si pasa, se avisa).
  await evaluar("window.__anims = document.getAnimations(); 1");
  let k = 0;
  // posiciona todas las animaciones en el cuadro f y devuelve el JPEG
  const capturar = async (f, calidad = 92) => {
    const revisar = k++ % 30 === 0;
    const n = await evaluar(`(() => { const t = ${(f / fps) * 1000}; const a = window.__anims; for (let i = 0; i < a.length; i++) a[i].currentTime = t;
      return ${revisar ? "document.getAnimations().length" : "-1"}; })()`);
    let img;
    if (deterministico) {
      const r = await cuadro({ screenshot: { format: "jpeg", quality: calidad, ...(RAPIDO ? { optimizeForSpeed: true } : {}) } });
      img = r.screenshotData ? Buffer.from(r.screenshotData, "base64") : anterior;  // sin daño: el cuadro es igual al anterior
    } else {
      img = Buffer.from((await s("Page.captureScreenshot", { format: "jpeg", quality: calidad })).data, "base64");
    }
    if (!img) throw new Error("el navegador no entregó el primer cuadro");
    anterior = img;
    return { img, n };
  };
  // Deja visible solo lo que puede verse en una escena (ella y sus capas de transición): lo demás pasa a display: none.
  // Así los cuadros de una escena dependen solo de lo que entra en su clave de caché, aunque otra escena tenga un error
  // de visibilidad. Las animaciones se vuelven a listar y a pausar.
  const aislar = async (visibles) => {
    const sel = visibles.map((v) => `:not(#${v})`).join("");
    return evaluar(`(() => { let st = document.getElementById("__aislar"); if (!st) { st = document.createElement("style"); st.id = "__aislar"; document.head.appendChild(st); }
      st.textContent = ${JSON.stringify(`#raiz > *${sel} { display: none !important; }`)};
      document.body.offsetHeight; window.__anims = document.getAnimations(); window.__anims.forEach((a) => a.pause()); return window.__anims.length; })()`);
  };
  const cerrar = async () => {
    try { await nav.enviar("Target.closeTarget", { targetId }); await nav.enviar("Target.disposeBrowserContext", { browserContextId }); } catch { /* */ }
  };
  return { info, capturar, cerrar, aislar };
}

// ---------------------------------------------------------------- qué hay que dibujar
const html = readFileSync(input, "utf8");
const dirEscena = path.dirname(path.resolve(input));
const url = pathToFileURL(path.resolve(input)).href;
const cacheDir = path.resolve(opt("cache", path.join(dirEscena, ".cache")));
const manPath = path.join(dirEscena, "escenas.json");
let manifiesto = null;
if (existsSync(manPath)) {
  try {
    const m = JSON.parse(readFileSync(manPath, "utf8"));
    // el manifiesto solo vale si describe este mismo HTML
    if (m.html_sha === sha(html)) manifiesto = m;
    else console.warn("aviso: escenas.json no corresponde a este escena.html (¿se editó a mano?): se ignora y se divide en partes iguales");
  } catch { /* manifiesto ilegible: se ignora */ }
}
// recursos locales que la página carga (fuentes, imágenes): entran en la clave del modo sin manifiesto
const recursos = [...html.matchAll(/url\(["']?(\.\/[^"')]+)["']?\)|src=["'](\.\/[^"']+)["']/g)].map((m) => m[1] || m[2]);
const huellaRecursos = recursos.map((r) => { try { return sha(readFileSync(path.join(dirEscena, r))); } catch { return "falta:" + r; } }).join(",");

const durDecl = Number(opt("duracion", (html.match(/data-duracion="([\d.]+)"/) || [])[1]));
if (!Number.isFinite(durDecl) || durDecl <= 0) { console.error("falta la duración: --duracion o <html data-duracion>"); process.exit(2); }
const total = Math.round(fps * durDecl);

// ================================================================ VISTA
if (tiene("vista")) {
  const salidaVista = opt("vista");
  const escala = Number(opt("escala", 0.5));
  const soloEsc = opt("escena") ? new Set(opt("escena").split(",")) : null;
  const pedidos = [];  // {f, etiqueta, clave}
  const visiblesDe = new Map((manifiesto?.escenas || []).filter((e) => e.visibles).map((e) => [e.id, e.visibles]));
  if (manifiesto) {
    for (const e of manifiesto.escenas) {
      e.revisar.forEach((f, k) => pedidos.push({ f, esc: e.id, etiqueta: `${e.id} · ${e.tipo} · ${(f / fps).toFixed(2)} s${k === 0 ? " (corte)" : k === 2 ? " (último)" : ""}`,
        clave: sha("vista", VERSION_RENDER, e.clave, String(f - e.cuadro_ini), String(escala)) }));
    }
  } else {
    for (let f = 0; f < total; f += fps) pedidos.push({ f, esc: null, etiqueta: `${(f / fps).toFixed(0)} s`, clave: sha("vista", VERSION_RENDER, sha(html), huellaRecursos, String(f), String(escala)) });
  }
  const dirV = path.join(cacheDir, "vista");
  mkdirSync(dirV, { recursive: true });
  // las claves dependen del contenido: tras cambiar una escena, solo sus cuadros faltan en la caché y se dibujan.
  // --escena solo achica la hoja a esas escenas.
  if (soloEsc) pedidos.splice(0, pedidos.length, ...pedidos.filter((p) => !p.esc || soloEsc.has(p.esc)));
  const faltan = pedidos.filter((p) => tiene("sin-cache") || !existsSync(path.join(dirV, p.clave + ".jpg")));
  let nav = await lanzarNavegador();
  let pag = null;
  try {
    if (faltan.length) {
      // cada cuadro se guarda apenas sale: si el navegador se cuelga, se abre otro y se sigue desde el que faltaba
      let i = 0;
      for (let intento = 0; i < faltan.length; intento++) {
        try {
          pag = await abrirPagina(nav, url, escala);
          let aislada = null;
          for (; i < faltan.length; i++) {
            const p = faltan[i];
            const vis = p.esc && visiblesDe.get(p.esc);
            if (vis && aislada !== p.esc) { await pag.aislar(vis); aislada = p.esc; }
            const { img } = await pag.capturar(p.f, 80);
            writeFileSync(path.join(dirV, p.clave + ".jpg"), img);
          }
          await pag.cerrar();
        } catch (err) {
          if (intento >= REINTENTOS) throw err;
          console.warn(`aviso: la vista falló (${err.message}); sigo con un navegador nuevo`);
          nav.cerrar();
          nav = await lanzarNavegador();
        }
      }
    }
    // hojas de contacto: 5 escenas (15 cuadros) por hoja, con etiqueta; se arman en una página del mismo navegador
    const porHoja = 15;
    const hojas = [];
    for (let i = 0; i < pedidos.length; i += porHoja) hojas.push(pedidos.slice(i, i + porHoja));
    const salidas = [];
    for (let h = 0; h < hojas.length; h++) {
      const celdas = hojas[h].map((p) => `<figure><img src="data:image/jpeg;base64,${readFileSync(path.join(dirV, p.clave + ".jpg")).toString("base64")}"><figcaption>${p.etiqueta}</figcaption></figure>`).join("");
      const filas = Math.ceil(hojas[h].length / 3);
      const alto = 40 + filas * (270 + 44);
      const hojaHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font:600 22px sans-serif;color:#111}
main{display:grid;grid-template-columns:repeat(3,480px);gap:16px 16px;padding:20px}figure{margin:0}img{width:480px;height:270px;display:block;outline:1px solid #ccc}
figcaption{margin-top:4px}</style></head><body><main>${celdas}</main></body></html>`;
      const tmp = path.join(os.tmpdir(), `hoja-${process.pid}-${h}.html`);
      writeFileSync(tmp, hojaHtml);
      let pagH;
      try { pagH = await abrirHoja(nav, pathToFileURL(tmp).href, 1520, alto); } catch (err) {
        console.warn(`aviso: la hoja falló (${err.message}); la repito con un navegador nuevo`);
        nav.cerrar();
        nav = await lanzarNavegador();
        pagH = await abrirHoja(nav, pathToFileURL(tmp).href, 1520, alto);
      }
      const destino = hojas.length === 1 ? salidaVista : salidaVista.replace(/(\.\w+)$/, `-${h + 1}$1`);
      writeFileSync(destino, pagH);
      try { rmSync(tmp, { force: true }); } catch { /* Windows: el navegador puede tener el archivo abierto */ }
      salidas.push(destino);
    }
    registrar("vista", { cuadros_pedidos: pedidos.length, cuadros_dibujados: faltan.length, escala, hojas: salidas.length, escenas: soloEsc ? [...soloEsc] : "todas" });
    console.log(`vista: ${salidas.join(", ")} · ${pedidos.length} cuadros (${faltan.length} dibujados, ${pedidos.length - faltan.length} de la caché) · ${((Date.now() - T_INICIO) / 1000).toFixed(1)} s`);
  } finally {
    nav.cerrar();
  }
  process.exit(0);
}

async function abrirHoja(nav, urlHoja, ancho, alto) {
  const { browserContextId } = await nav.enviar("Target.createBrowserContext");
  const { targetId } = await nav.enviar("Target.createTarget", { url: "about:blank", width: ancho, height: alto, browserContextId, enableBeginFrameControl: deterministico });
  const { sessionId } = await nav.enviar("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => nav.enviar(m, p, sessionId);
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false });
  await s("Page.navigate", { url: urlHoja });
  let img = null;
  for (let k = 0; k < 200 && !img; k++) {
    const listo = nav.eventos.some((e) => e.sessionId === sessionId && e.method === "Page.loadEventFired");
    if (deterministico) {
      const r = await s("HeadlessExperimental.beginFrame", { frameTimeTicks: (k + 1) * 33.3, interval: 33.3, ...(listo ? { screenshot: { format: "png" } } : { noDisplayUpdates: true }) });
      if (listo && r.screenshotData) img = Buffer.from(r.screenshotData, "base64");
    } else if (listo) {
      img = Buffer.from((await s("Page.captureScreenshot", { format: "png" })).data, "base64");
    } else await new Promise((r) => setTimeout(r, 20));
  }
  try { await nav.enviar("Target.closeTarget", { targetId }); await nav.enviar("Target.disposeBrowserContext", { browserContextId }); } catch { /* */ }
  if (!img) throw new Error("no se pudo dibujar la hoja de contacto");
  return img;
}

// ================================================================ RENDER FINAL
// veryfast: mismo tamaño de archivo que medium a crf 16 y SSIM 0,9991 contra el render de la versión 0.1.0; ahorra
// ~10 % de la CPU del render (superfast duplica el tamaño sin ganar tiempo)
const preset = opt("preset", "veryfast");
const crf = String(opt("crf", 16));
const unSoloPaso = tiene("un-solo-paso");
const codificador = opt("codificador", "libx264");
// NVENC en tarjetas GeForce admite pocas sesiones de codificación a la vez (8 con los drivers actuales). Con más, ffmpeg
// falla con "OpenEncodeSessionEx failed: incompatible client key (21)" y el segmento se repite. Medido en una RTX 5070 con
// 32 trabajadores: 10 de 32 segmentos repetidos y el render de 20 s un 33 % más lento que con la CPU. Con NVENC, los
// segmentos y los trabajadores se limitan a RENDER_SESIONES_NVENC (8 por defecto).
const topeCodificador = /_nvenc$/.test(codificador) ? Math.max(1, Number(process.env.RENDER_SESIONES_NVENC || 8)) : Infinity;
let segmentos;
if (unSoloPaso) {
  segmentos = [{ id: "todo", a: 0, b: total, clave: sha("render", VERSION_RENDER, sha(html), huellaRecursos, "0", String(total)) }];
} else if (manifiesto && manifiesto.cuadros === total) {
  segmentos = manifiesto.escenas.map((e) => ({ id: e.id, a: e.cuadro_ini, b: e.cuadro_fin, clave: e.clave, visibles: e.visibles }));
} else {
  const n = Math.max(1, Math.min(topeCodificador, Number(opt("trabajadores", 0)) || trabajadoresAuto(99)));
  segmentos = [];
  for (let k = 0; k < n; k++) {
    const a = Math.round((k * total) / n), b = Math.round(((k + 1) * total) / n);
    segmentos.push({ id: `parte${k + 1}`, a, b, clave: sha("parte", sha(html), huellaRecursos, String(a), String(b)) });
  }
}
// --codificador: libx264 (por defecto, en CPU) o un codificador por hardware de ffmpeg (h264_videotoolbox en un Mac,
// h264_nvenc, h264_qsv o h264_amf en Windows). La codificación es ~27 % de la CPU del render; la GPU no acelera el dibujo
// de los cuadros. Medido en bench/RENDIMIENTO.md: en un MacBook M5 ahorra entre 6 y 18 %; el defecto sigue siendo libx264.
const paramsCodif = codificador === "libx264"
  ? ["-c:v", "libx264", "-preset", preset, "-pix_fmt", "yuv420p", "-crf", crf]
  : ["-c:v", codificador, "-b:v", process.env.RENDER_BITRATE || "16M", "-pix_fmt", "yuv420p"];
for (const sg of segmentos) sg.archivo = path.join(cacheDir, "render", sha(VERSION_RENDER, sg.clave, String(fps), String(sg.b - sg.a),
  paramsCodif.join(" "), deterministico ? "bf" : "cap", NAVEGADOR, versionFfmpeg) + ".mp4");
mkdirSync(path.join(cacheDir, "render"), { recursive: true });
// restos de una corrida interrumpida
for (const f of readdirSync(path.join(cacheDir, "render"))) if (f.includes(".tmp-")) {
  try { if (Date.now() - statSync(path.join(cacheDir, "render", f)).mtimeMs > 60_000) rmSync(path.join(cacheDir, "render", f)); } catch { /* */ }
}
const usarCache = !tiene("sin-cache");
const pendientes = segmentos.filter((sg) => !(usarCache && existsSync(sg.archivo)));
const nTrab = Math.max(1, Math.min(topeCodificador, Number(opt("trabajadores", 0)) || trabajadoresAuto(pendientes.length), Math.max(1, pendientes.length)));
let cuadrosDibujados = 0, aviso = null, infoPagina = null;
const reintentos = [];
const tiemposSeg = [];
const t0 = Date.now();

async function dibujarSegmento(nav, sg) {
  const ts = Date.now();
  const tmp = `${sg.archivo}.tmp-${process.pid}.mp4`;
  let ff = null, pag = null, dibujados = 0;
  try {
    pag = await abrirPagina(nav, url, 1);
    infoPagina = infoPagina || pag.info;
    if (pag.info.n === 0) throw new Error("la página no tiene animaciones CSS: nada que renderizar");
    const nBase = sg.visibles ? await pag.aislar(sg.visibles) : pag.info.n;
    ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "-",
      ...paramsCodif, "-an", tmp], { stdio: ["pipe", "inherit", "inherit"] });
    const cierreFf = new Promise((r) => ff.on("close", r));
    ff.stdin.on("error", () => { /* ffmpeg terminó: lo informa su código de salida */ });
    for (let f = sg.a; f < sg.b; f++) {
      const { img, n } = await pag.capturar(f, CALIDAD);
      // que la cantidad baje es normal (una animación terminada sin fill-mode sale de la lista); que suba, no
      if (n >= 0 && n > nBase && !aviso) aviso = { f, antes: nBase, ahora: n };
      if (!ff.stdin.write(img)) {
        await Promise.race([new Promise((r) => ff.stdin.once("drain", r)),
          cierreFf.then((c) => { throw new Error(`ffmpeg terminó antes de tiempo (código ${c}) en el segmento ${sg.id}`); })]);
      }
      dibujados++;
    }
    ff.stdin.end();
    const codigo = await cierreFf;
    await pag.cerrar();
    if (codigo !== 0) throw new Error(`ffmpeg falló en el segmento ${sg.id}`);
    renameSync(tmp, sg.archivo);  // atómico: un segmento a medias nunca queda con su nombre final
    cuadrosDibujados += dibujados;
    tiemposSeg.push({ id: sg.id, cuadros: sg.b - sg.a, s: Number(((Date.now() - ts) / 1000).toFixed(2)) });
    process.stdout.write(`segmento ${sg.id}: ${sg.b - sg.a} cuadros en ${((Date.now() - ts) / 1000).toFixed(1)} s\n`);
  } catch (err) {
    if (ff) { try { ff.kill("SIGKILL"); } catch { /* */ } }
    try { rmSync(tmp, { force: true }); } catch { /* */ }
    throw err;
  }
}

if (pendientes.length) {
  const cola = [...pendientes].sort((x, y) => (y.b - y.a) - (x.b - x.a));  // los más largos primero: reparto más parejo
  const navs = [];
  try {
    await Promise.all(Array.from({ length: nTrab }, async () => {
      const cupo = await tomarCupo();
      if (!cola.length) { soltarCupo(cupo); return; }
      let nav = await lanzarNavegador();
      navs.push(nav);
      try {
      while (cola.length) {
        const sg = cola.shift();
        for (let intento = 0; ; intento++) {
          try { await dibujarSegmento(nav, sg); break; } catch (err) {
            if (intento >= REINTENTOS) throw err;
            // navegador colgado o caído: se descarta y el segmento se repite entero con uno nuevo (el resultado es el mismo)
            console.warn(`aviso: el segmento ${sg.id} falló (${err.message}); lo repito con un navegador nuevo`);
            reintentos.push({ id: sg.id, motivo: err.message });
            nav.cerrar();
            nav = await lanzarNavegador();
            navs.push(nav);
          }
        }
      }
      } finally {
        nav.cerrar();
        soltarCupo(cupo);
      }
    }));
  } finally {
    navs.forEach((n) => n.cerrar());
  }
}
const t_dibujo = (Date.now() - t0) / 1000;
// unir sin recodificar
const tu = Date.now();
const lista = path.join(cacheDir, `lista-${process.pid}.txt`);
// "duration" fija dónde empieza cada segmento: cuadros / fps exactos. Sin eso, ffmpeg 9 (macOS, Homebrew) corría las
// marcas de tiempo 0,7 ms por cada unión y los cortes se medían fuera del cuadro (con ffmpeg 6 no pasaba).
writeFileSync(lista, segmentos.map((sg) => `file '${sg.archivo.replace(/'/g, "'\\''")}'\nduration ${((sg.b - sg.a) / fps).toFixed(6)}`).join("\n") + "\n");
const un = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", "-movflags", "+faststart", output], { stdio: "inherit" });
rmSync(lista, { force: true });
if (un.status !== 0) { console.error("falló la unión de segmentos"); process.exit(2); }
// comprobación: cada cuadro del MP4 unido tiene que estar en k / fps exacto (±1 tic de la base de tiempo)
{
  const tb = (spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=time_base", "-of", "csv=p=0", output], { encoding: "utf8" }).stdout || "").trim();
  const [num, den] = tb.split("/").map(Number);
  const pts = (spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts", "-of", "csv=p=0", output], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout || "")
    .split("\n").filter((l) => l.trim() !== "").map((l) => Number(l.split(",")[0])).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (num && den && pts.length) {
    const paso = den / (num * fps);
    const peor = pts.reduce((m, p, k) => Math.max(m, Math.abs(p - (pts[0] + k * paso))), 0);
    if (pts.length !== total || peor > 1.01) console.warn(`aviso: las marcas de tiempo del MP4 unido no caen en los cuadros exactos (${pts.length} de ${total} cuadros; ` +
      `desvío máximo ${((peor * num) / den * 1000).toFixed(2)} ms). Los cortes se medirán corridos.`);
  }
}
const t_union = (Date.now() - tu) / 1000;
if (aviso) console.warn(`aviso: en el cuadro ${aviso.f} aparecieron animaciones nuevas (${aviso.antes} → ${aviso.ahora}). Algo las crea durante la ` +
  "reproducción (JavaScript, :hover o un cambio de clase) y el render deja de ser determinista.");
if (!deterministico) console.warn(`aviso: ${process.platform === "darwin" ? "macOS no tiene beginFrame; " : ""}se usaron capturas comunes (mismo aspecto, pero el MP4 no es idéntico byte a byte).`);
const hoja = opt("hoja");
let t_hoja = 0;
if (hoja) {
  const th = Date.now();
  spawnSync("ffmpeg", ["-y", "-v", "error", "-i", output, "-vf", `select=not(mod(n\\,${fps})),scale=320:-1,tile=6x${Math.ceil(durDecl / 6)}:padding=4:color=white`,
    "-fps_mode", "vfr", "-frames:v", "1", hoja], { stdio: "inherit" });
  t_hoja = (Date.now() - th) / 1000;
}
registrar("render", { cuadros: total, fps, duracion_s: durDecl, modo: deterministico ? "beginFrame" : "capturas", version: VERSION_RENDER,
  segmentos: segmentos.length, segmentos_cache: segmentos.length - pendientes.length, cuadros_dibujados: cuadrosDibujados, trabajadores: pendientes.length ? nTrab : 0,
  preset, crf: Number(crf), manifiesto: Boolean(manifiesto) && !unSoloPaso, dibujo_s: Number(t_dibujo.toFixed(2)), union_s: Number(t_union.toFixed(2)),
  hoja_s: Number(t_hoja.toFixed(2)), s_por_cuadro_dibujado: cuadrosDibujados ? Number((t_dibujo / cuadrosDibujados).toFixed(4)) : null, segmentos_detalle: tiemposSeg,
  reintentos });
console.log(`listo: ${output} · ${total} cuadros a ${fps} fps (${durDecl} s) · ${segmentos.length} segmentos (${segmentos.length - pendientes.length} de la caché) · ` +
  `${cuadrosDibujados} cuadros dibujados con ${pendientes.length ? nTrab : 0} trabajadores · ${infoPagina ? infoPagina.n + " animaciones · fuentes: " + (infoPagina.fuentes.join(", ") || "del sistema") + " · " : ""}` +
  `${deterministico ? "beginFrame" : "capturas comunes"} · ${((Date.now() - T_INICIO) / 1000).toFixed(1)} s${hoja ? " · hoja: " + hoja : ""}` +
  `${reintentos.length ? ` · ${reintentos.length} segmento(s) repetido(s) por un fallo del navegador o del codificador` : ""}`);
process.exit(0);
